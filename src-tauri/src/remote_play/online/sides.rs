//! Les deux côtés de la signalisation iNetbox, **sans E/S** : ce qui est scellé avant envoi et ce
//! qu'on accepte d'un message relevé. Le serveur n'est jamais cru : chaque message est vérifié
//! contre la clé épinglée de l'appareil du pair (TOFU), sa session, son jeton et l'empreinte DTLS.

use ed25519_dalek::VerifyingKey;
use serde::Serialize;

use super::api::{Device, Mail};
use crate::remote_play::signaling::envelope::{normalize_fingerprint, Channel, Envelope, Kind, Sealed, TokenLedger};
use crate::remote_play::signaling::identity::{self, DeviceKey};
use crate::remote_play::signaling::pinning::{Pins, Trust};
use crate::remote_play::signaling::safety::safety_code;
use crate::remote_play::signaling::SignalError;
use crate::remote_play::transport::sdp;

/// Confiance dans l'appareil du pair, pour l'affichage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TrustView {
    /// Premier contact avec cet ami : clé épinglée maintenant, code à comparer.
    FirstContact,
    /// Nouvel appareil d'un ami connu.
    NewDevice,
    /// Clé déjà épinglée.
    Known,
    /// Clé déjà épinglée et code de sécurité comparé de vive voix.
    Verified,
}

impl From<Trust> for TrustView {
    fn from(t: Trust) -> Self {
        match t {
            Trust::FirstContact => TrustView::FirstContact,
            Trust::NewDevice => TrustView::NewDevice,
            Trust::Known { verified: true } => TrustView::Verified,
            Trust::Known { verified: false } => TrustView::Known,
        }
    }
}

/// Appareil du pair une fois vérifié.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerDevice {
    pub device: String,
    pub trust: TrustView,
    pub safety_code: String,
}

/// Ce qu'un message vérifié demande de faire.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// Offre (côté invité) ou réponse (côté hôte), SDP vérifié.
    Description(String),
    /// Candidats ICE arrivés après coup.
    Candidates(Vec<String>),
    /// Le pair a quitté la session.
    Bye,
}

/// Vérifie un message relevé : appareil actif du **compte du pair**, clé épinglée (premier
/// contact ou identique), puis enveloppe (signature, session, jeton, numéro, heure, empreinte).
/// Rien n'est retenu si le message est refusé (sauf l'épinglage d'un premier contact valide).
#[allow(clippy::too_many_arguments)]
fn verify(chan: &mut Channel, me: &VerifyingKey, peer_account: &str, devices: &[Device], pins: &mut Pins, known: &mut Option<PeerDevice>, mail: &Mail, now_ms: u64) -> Result<Envelope, SignalError> {
    if mail.from != peer_account {
        return Err(SignalError::WrongParticipant);
    }
    if let Some(p) = known {
        // l'appareil du pair est fixé par son premier message valide
        if p.device != mail.device_id {
            return Err(SignalError::WrongParticipant);
        }
    }
    let device = devices.iter().find(|d| d.id == mail.device_id && d.revoked_at.is_none()).ok_or(SignalError::BadSignature)?;
    let key = identity::parse_public(&device.public_key)?;
    // signature d'abord, avec la clé annoncée, avant d'épingler quoi que ce soit
    identity::verify(&key, mail.body.as_bytes(), &mail.signature)?;
    let trust = pins.check(peer_account, &device.id, &device.public_key, now_ms)?;
    chan.bind_peer(key)?;
    let env = chan.open(&mail.body, &mail.signature, now_ms)?;
    if known.is_none() {
        *known = Some(PeerDevice { device: device.id.clone(), trust: trust.into(), safety_code: safety_code(me, &key) });
    }
    Ok(env)
}

fn event(env: Envelope) -> Result<Event, SignalError> {
    match env.kind {
        Kind::Offer | Kind::Answer => env.sdp.map(Event::Description).ok_or(SignalError::Malformed),
        Kind::Ice => Ok(Event::Candidates(env.candidates)),
        Kind::Bye => Ok(Event::Bye),
    }
}

/// Côté hôte : il scelle l'offre avant de connaître l'appareil de l'invité ; la réponse fixe cet
/// appareil et consomme le jeton d'invitation (usage unique, aussi côté hôte).
pub struct HostSide {
    chan: Channel,
    guest: String,
    token: String,
    ledger: TokenLedger,
    fingerprint: Option<String>,
    answered: bool,
    pub peer: Option<PeerDevice>,
}

impl HostSide {
    pub fn new(session: &str, me: &str, guest: &str, token: &str, expires_at_ms: u64) -> Self {
        let mut ledger = TokenLedger::default();
        ledger.issue(token, expires_at_ms);
        HostSide { chan: Channel::unbound(session, me, guest, token), guest: guest.into(), token: token.into(), ledger, fingerprint: None, answered: false, peer: None }
    }

    pub fn offer(&mut self, key: &DeviceKey, offer_sdp: &str, now_ms: u64) -> Result<Sealed, SignalError> {
        let fp = sdp::fingerprint(offer_sdp).ok_or(SignalError::FingerprintMismatch)?;
        let sealed = self.chan.seal(key, Kind::Offer, &fp, Some(offer_sdp.to_string()), vec![], now_ms)?;
        self.fingerprint = Some(fp);
        Ok(sealed)
    }

    pub fn bye(&mut self, key: &DeviceKey, now_ms: u64) -> Result<Sealed, SignalError> {
        let fp = self.fingerprint.clone().ok_or(SignalError::Malformed)?;
        self.chan.seal(key, Kind::Bye, &fp, None, vec![], now_ms)
    }

    pub fn on_mail(&mut self, key: &DeviceKey, devices: &[Device], pins: &mut Pins, mail: &Mail, now_ms: u64) -> Result<Event, SignalError> {
        let env = verify(&mut self.chan, &key.verifying_key(), &self.guest, devices, pins, &mut self.peer, mail, now_ms)?;
        match env.kind {
            Kind::Answer => {
                if self.answered {
                    return Err(SignalError::Replay);
                }
                // usage unique côté hôte aussi : un second « Answer » avec le jeton est refusé
                self.ledger.consume(&self.token, now_ms)?;
                self.answered = true;
            }
            Kind::Offer => return Err(SignalError::Malformed),
            Kind::Ice if !self.answered => return Err(SignalError::Malformed),
            _ => {}
        }
        event(env)
    }
}

/// Côté invité : l'appareil de l'hôte est fixé par l'offre.
pub struct GuestSide {
    chan: Channel,
    host: String,
    fingerprint: Option<String>,
    offered: bool,
    pub peer: Option<PeerDevice>,
}

impl GuestSide {
    pub fn new(session: &str, me: &str, host: &str, token: &str) -> Self {
        GuestSide { chan: Channel::unbound(session, me, host, token), host: host.into(), fingerprint: None, offered: false, peer: None }
    }

    pub fn on_mail(&mut self, key: &DeviceKey, devices: &[Device], pins: &mut Pins, mail: &Mail, now_ms: u64) -> Result<Event, SignalError> {
        let env = verify(&mut self.chan, &key.verifying_key(), &self.host, devices, pins, &mut self.peer, mail, now_ms)?;
        match env.kind {
            Kind::Offer if self.offered => return Err(SignalError::Replay),
            Kind::Offer => self.offered = true,
            Kind::Answer => return Err(SignalError::Malformed),
            _ => {}
        }
        event(env)
    }

    /// Réponse du WebView : scellée avec sa propre empreinte DTLS.
    pub fn answer(&mut self, key: &DeviceKey, answer_sdp: &str, now_ms: u64) -> Result<Sealed, SignalError> {
        if !self.offered {
            return Err(SignalError::Malformed);
        }
        let fp = sdp::fingerprint(answer_sdp).ok_or(SignalError::FingerprintMismatch)?;
        let sealed = self.chan.seal(key, Kind::Answer, &fp, Some(answer_sdp.to_string()), vec![], now_ms)?;
        self.fingerprint = Some(fp);
        Ok(sealed)
    }

    /// Candidats trouvés après la réponse (trickle).
    pub fn candidates(&mut self, key: &DeviceKey, candidates: Vec<String>, now_ms: u64) -> Result<Sealed, SignalError> {
        let fp = self.fingerprint.clone().ok_or(SignalError::Malformed)?;
        self.chan.seal(key, Kind::Ice, &fp, None, candidates, now_ms)
    }

    pub fn bye(&mut self, key: &DeviceKey, now_ms: u64) -> Result<Sealed, SignalError> {
        let fp = match &self.fingerprint {
            Some(f) => f.clone(),
            // pas encore répondu : une empreinte quelconque bien formée (le pair ne l'utilise pas)
            None => normalize_fingerprint(&format!("sha-256 {}", ["00"; 32].join(":")))?,
        };
        self.chan.seal(key, Kind::Bye, &fp, None, vec![], now_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "0b8f6a4e-3c1d-4f7a-9e2b-5d6c7a8b9c0d";
    const HOST: &str = "11111111-1111-4111-8111-111111111111";
    const GUEST: &str = "22222222-2222-4222-8222-222222222222";
    const HOST_DEV: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const GUEST_DEV: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAA";
    const NOW: u64 = 1_800_000_000_000;

    fn fp(byte: u8) -> String {
        format!("sha-256 {}", vec![format!("{byte:02X}"); 32].join(":"))
    }
    fn sdp(fingerprint: &str) -> String {
        format!("v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\ns=-\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=fingerprint:{fingerprint}\r\n")
    }
    fn mail(from: &str, device: &str, s: &Sealed) -> Mail {
        Mail { from: from.into(), device_id: device.into(), body: s.body.clone(), signature: s.signature.clone() }
    }
    fn device(id: &str, key: &DeviceKey) -> Device {
        Device { id: id.into(), public_key: key.public_b64(), revoked_at: None }
    }

    struct World {
        host_key: DeviceKey,
        guest_key: DeviceKey,
        host: HostSide,
        guest: GuestSide,
        host_pins: Pins,
        guest_pins: Pins,
    }

    fn world() -> World {
        World {
            host_key: DeviceKey::from_seed(&[1; 32]),
            guest_key: DeviceKey::from_seed(&[2; 32]),
            host: HostSide::new(SESSION, HOST, GUEST, TOKEN, NOW + 120_000),
            guest: GuestSide::new(SESSION, GUEST, HOST, TOKEN),
            host_pins: Pins::in_memory(),
            guest_pins: Pins::in_memory(),
        }
    }

    #[test]
    fn echange_complet_et_codes_identiques() {
        let mut w = world();
        let offer = w.host.offer(&w.host_key, &sdp(&fp(0xAB)), NOW).unwrap();
        let host_devices = [device(HOST_DEV, &w.host_key)];
        let got = w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW + 300).unwrap();
        assert_eq!(got, Event::Description(sdp(&fp(0xAB))));
        let gpeer = w.guest.peer.clone().unwrap();
        assert_eq!(gpeer.trust, TrustView::FirstContact);

        let answer = w.guest.answer(&w.guest_key, &sdp(&fp(0xCD)), NOW + 400).unwrap();
        let guest_devices = [device(GUEST_DEV, &w.guest_key)];
        let got = w.host.on_mail(&w.host_key, &guest_devices, &mut w.host_pins, &mail(GUEST, GUEST_DEV, &answer), NOW + 500).unwrap();
        assert_eq!(got, Event::Description(sdp(&fp(0xCD))));
        let hpeer = w.host.peer.clone().unwrap();
        // même code de sécurité affiché des deux côtés
        assert_eq!(hpeer.safety_code, gpeer.safety_code);
        assert_eq!(hpeer.trust, TrustView::FirstContact);

        // candidats tardifs puis départ
        let ice = w.guest.candidates(&w.guest_key, vec!["candidate:1 1 udp 1686052607 203.0.113.7 40000 typ srflx raddr 0.0.0.0 rport 0".into()], NOW + 600).unwrap();
        assert!(matches!(w.host.on_mail(&w.host_key, &guest_devices, &mut w.host_pins, &mail(GUEST, GUEST_DEV, &ice), NOW + 700).unwrap(), Event::Candidates(c) if c.len() == 1));
        let bye = w.host.bye(&w.host_key, NOW + 800).unwrap();
        assert_eq!(w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(HOST, HOST_DEV, &bye), NOW + 900).unwrap(), Event::Bye);

        // deuxième session : clés connues
        let mut w2 = World { host: HostSide::new("9b8f6a4e-3c1d-4f7a-9e2b-5d6c7a8b9c0d", HOST, GUEST, TOKEN, NOW + 120_000), guest: GuestSide::new("9b8f6a4e-3c1d-4f7a-9e2b-5d6c7a8b9c0d", GUEST, HOST, TOKEN), ..w };
        let offer = w2.host.offer(&w2.host_key, &sdp(&fp(0xAB)), NOW).unwrap();
        w2.guest.on_mail(&w2.guest_key, &host_devices, &mut w2.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW).unwrap();
        assert_eq!(w2.guest.peer.unwrap().trust, TrustView::Known);
    }

    #[test]
    fn serveur_qui_substitue_la_cle_de_l_hote() {
        let mut w = world();
        // premier contact réel : la clé de l'hôte est épinglée
        let offer = w.host.offer(&w.host_key, &sdp(&fp(0xAB)), NOW).unwrap();
        w.guest.on_mail(&w.guest_key, &[device(HOST_DEV, &w.host_key)], &mut w.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW).unwrap();
        // session suivante : le serveur annonce une autre clé pour le même appareil, et l'offre
        // est signée par l'attaquant
        let mallory = DeviceKey::from_seed(&[9; 32]);
        let mut forged_host = HostSide::new("9b8f6a4e-3c1d-4f7a-9e2b-5d6c7a8b9c0d", HOST, GUEST, TOKEN, NOW + 120_000);
        let forged = forged_host.offer(&mallory, &sdp(&fp(0xEE)), NOW).unwrap();
        let mut guest = GuestSide::new("9b8f6a4e-3c1d-4f7a-9e2b-5d6c7a8b9c0d", GUEST, HOST, TOKEN);
        let got = guest.on_mail(&w.guest_key, &[device(HOST_DEV, &mallory)], &mut w.guest_pins, &mail(HOST, HOST_DEV, &forged), NOW);
        assert_eq!(got, Err(SignalError::KeyChanged));
        assert!(guest.peer.is_none());
    }

    #[test]
    fn messages_refuses() {
        let mut w = world();
        let host_devices = [device(HOST_DEV, &w.host_key)];
        let offer = w.host.offer(&w.host_key, &sdp(&fp(0xAB)), NOW).unwrap();
        // expéditeur annoncé par le serveur ≠ compte de l'hôte
        assert_eq!(w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(GUEST, HOST_DEV, &offer), NOW), Err(SignalError::WrongParticipant));
        // appareil inconnu ou révoqué
        assert_eq!(w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(HOST, GUEST_DEV, &offer), NOW), Err(SignalError::BadSignature));
        let revoked = [Device { revoked_at: Some(1), ..device(HOST_DEV, &w.host_key) }];
        assert_eq!(w.guest.on_mail(&w.guest_key, &revoked, &mut w.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW), Err(SignalError::BadSignature));
        // corps modifié en route : signature invalide, aucun épinglage
        let mut tampered = mail(HOST, HOST_DEV, &offer);
        tampered.body = tampered.body.replace("0.0.0.0", "203.0.113.9");
        assert_eq!(w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &tampered, NOW), Err(SignalError::BadSignature));
        assert!(w.guest_pins.get(HOST, HOST_DEV).is_none());
        // réponse avant l'offre : refusée
        assert_eq!(w.guest.answer(&w.guest_key, &sdp(&fp(0xCD)), NOW).err(), Some(SignalError::Malformed));
        // l'offre authentique passe ; rejouée, elle est refusée
        w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW).unwrap();
        assert_eq!(w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW), Err(SignalError::Replay));
    }

    #[test]
    fn un_seul_appareil_et_une_seule_reponse() {
        let mut w = world();
        let offer = w.host.offer(&w.host_key, &sdp(&fp(0xAB)), NOW).unwrap();
        let host_devices = [device(HOST_DEV, &w.host_key)];
        w.guest.on_mail(&w.guest_key, &host_devices, &mut w.guest_pins, &mail(HOST, HOST_DEV, &offer), NOW).unwrap();
        let answer = w.guest.answer(&w.guest_key, &sdp(&fp(0xCD)), NOW).unwrap();
        // deuxième appareil du même invité qui répond aussi
        let other_key = DeviceKey::from_seed(&[3; 32]);
        let other_dev = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
        let mut other = GuestSide::new(SESSION, GUEST, HOST, TOKEN);
        other.on_mail(&other_key, &host_devices, &mut Pins::in_memory(), &mail(HOST, HOST_DEV, &offer), NOW).unwrap();
        let other_answer = other.answer(&other_key, &sdp(&fp(0xEF)), NOW).unwrap();
        let devices = [device(GUEST_DEV, &w.guest_key), device(other_dev, &other_key)];
        w.host.on_mail(&w.host_key, &devices, &mut w.host_pins, &mail(GUEST, GUEST_DEV, &answer), NOW).unwrap();
        assert_eq!(w.host.on_mail(&w.host_key, &devices, &mut w.host_pins, &mail(GUEST, other_dev, &other_answer), NOW), Err(SignalError::WrongParticipant));
        // jeton expiré : la réponse est refusée côté hôte même si le serveur l'a laissée passer
        let mut late = HostSide::new(SESSION, HOST, GUEST, TOKEN, NOW + 1_000);
        late.offer(&w.host_key, &sdp(&fp(0xAB)), NOW).unwrap();
        let mut g = GuestSide::new(SESSION, GUEST, HOST, TOKEN);
        g.on_mail(&w.guest_key, &host_devices, &mut Pins::in_memory(), &mail(HOST, HOST_DEV, &late.offer(&w.host_key, &sdp(&fp(0xAB)), NOW).unwrap()), NOW).unwrap();
        let a = g.answer(&w.guest_key, &sdp(&fp(0xCD)), NOW + 2_000).unwrap();
        assert_eq!(late.on_mail(&w.host_key, &[device(GUEST_DEV, &w.guest_key)], &mut Pins::in_memory(), &mail(GUEST, GUEST_DEV, &a), NOW + 2_000), Err(SignalError::BadToken));
    }
}
