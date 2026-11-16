//! Enveloppes de signalisation signées (offre/réponse SDP, candidats ICE, fin).
//!
//! Le corps est un JSON produit ici ; la signature Ed25519 couvre **les octets exacts** reçus
//! (aucune re-sérialisation avant vérification). Le corps lie le message à la session, à
//! l'expéditeur et au destinataire, à un numéro de séquence, à l'heure, au jeton d'invitation
//! et à l'empreinte DTLS : chaque ligne `a=fingerprint` du SDP doit être l'empreinte signée, et
//! l'empreinte réellement négociée par DTLS est comparée ensuite (`Channel::check_negotiated`).

use std::collections::HashMap;

use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};

use super::identity::{self, DeviceKey};
use super::{Result, SignalError, MAX_ENVELOPE_BYTES};

pub const CONTEXT: &str = "ibox-rp-signal/1";
/// Décalage d'horloge toléré (la boîte aux lettres garde 60 s).
pub const MAX_SKEW_MS: u64 = 120_000;
const MAX_CANDIDATES: usize = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Offer,
    Answer,
    Ice,
    Bye,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    pub ctx: String,
    pub session: String,
    pub from: String,
    pub to: String,
    pub seq: u64,
    pub ts: u64,
    pub kind: Kind,
    /// Empreinte DTLS de l'expéditeur, forme SDP : `sha-256 AB:CD:…` (32 octets).
    pub fingerprint: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdp: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
}

/// Ce qui part vers iNetbox (`body` + `signature`, avec l'identifiant d'appareil).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sealed {
    pub body: String,
    pub signature: String,
}

/// Empreinte normalisée (`sha-256 AB:…` en majuscules), ou erreur si ce n'est pas un SHA-256.
pub fn normalize_fingerprint(value: &str) -> Result<String> {
    let mut parts = value.split_whitespace();
    let (Some(algo), Some(hex), None) = (parts.next(), parts.next(), parts.next()) else {
        return Err(SignalError::FingerprintMismatch);
    };
    if !algo.eq_ignore_ascii_case("sha-256") {
        return Err(SignalError::FingerprintMismatch);
    }
    let bytes: Vec<&str> = hex.split(':').collect();
    if bytes.len() != 32 || !bytes.iter().all(|b| b.len() == 2 && b.chars().all(|c| c.is_ascii_hexdigit())) {
        return Err(SignalError::FingerprintMismatch);
    }
    Ok(format!("sha-256 {}", hex.to_ascii_uppercase()))
}

/// Toutes les empreintes annoncées par un SDP (session et médias).
fn sdp_fingerprints(sdp: &str) -> Result<Vec<String>> {
    sdp.lines()
        .filter_map(|l| l.trim_end_matches('\r').strip_prefix("a=fingerprint:"))
        .map(normalize_fingerprint)
        .collect()
}

/// Comparaison en temps constant (jetons).
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Vérifie la cohérence interne d'une enveloppe (avant signature comme après vérification).
fn validate(env: &Envelope) -> Result<()> {
    if env.ctx != CONTEXT {
        return Err(SignalError::BadContext);
    }
    let fp = normalize_fingerprint(&env.fingerprint)?;
    if fp != env.fingerprint {
        return Err(SignalError::FingerprintMismatch);
    }
    match env.kind {
        Kind::Offer | Kind::Answer => {
            let sdp = env.sdp.as_deref().ok_or(SignalError::Malformed)?;
            if env.token.is_none() || !env.candidates.is_empty() {
                return Err(SignalError::Malformed);
            }
            let announced = sdp_fingerprints(sdp)?;
            if announced.is_empty() || announced.iter().any(|f| *f != fp) {
                return Err(SignalError::FingerprintMismatch);
            }
        }
        Kind::Ice => {
            if env.sdp.is_some() || env.candidates.is_empty() || env.candidates.len() > MAX_CANDIDATES {
                return Err(SignalError::Malformed);
            }
            if env.candidates.iter().any(|c| c.len() > 1024 || c.contains(['\r', '\n'])) {
                return Err(SignalError::Malformed);
            }
        }
        Kind::Bye => {
            if env.sdp.is_some() || !env.candidates.is_empty() {
                return Err(SignalError::Malformed);
            }
        }
    }
    Ok(())
}

/// Canal de signalisation avec un pair pour une session : numérotation, anti-rejeu et empreinte.
pub struct Channel {
    session: String,
    me: String,
    peer: String,
    peer_key: Option<VerifyingKey>,
    token: String,
    next_seq: u64,
    last_peer_seq: Option<u64>,
    peer_fingerprint: Option<String>,
}

impl Channel {
    /// `peer_key` doit déjà avoir passé l'épinglage (`pinning::Pins::check`).
    pub fn new(session: &str, me: &str, peer: &str, peer_key: VerifyingKey, token: &str) -> Self {
        let mut c = Self::unbound(session, me, peer, token);
        c.peer_key = Some(peer_key);
        c
    }

    /// Canal dont on ne connaît pas encore l'appareil du pair (l'hôte, avant la réponse) : il
    /// peut sceller, mais refuse tout message tant que [`Channel::bind_peer`] n'a pas été appelé.
    pub fn unbound(session: &str, me: &str, peer: &str, token: &str) -> Self {
        Channel {
            session: session.into(),
            me: me.into(),
            peer: peer.into(),
            peer_key: None,
            token: token.into(),
            next_seq: 1,
            last_peer_seq: None,
            peer_fingerprint: None,
        }
    }

    /// Construit et signe une enveloppe vers le pair.
    pub fn seal(&mut self, key: &DeviceKey, kind: Kind, fingerprint: &str, sdp: Option<String>, candidates: Vec<String>, now_ms: u64) -> Result<Sealed> {
        let env = Envelope {
            ctx: CONTEXT.into(),
            session: self.session.clone(),
            from: self.me.clone(),
            to: self.peer.clone(),
            seq: self.next_seq,
            ts: now_ms,
            kind,
            fingerprint: normalize_fingerprint(fingerprint)?,
            token: matches!(kind, Kind::Offer | Kind::Answer).then(|| self.token.clone()),
            sdp,
            candidates,
        };
        let sealed = seal_envelope(key, &env)?;
        self.next_seq += 1;
        Ok(sealed)
    }

    /// Vérifie un message reçu ; rien n'est retenu de l'état s'il est refusé.
    pub fn open(&mut self, body: &str, signature: &str, now_ms: u64) -> Result<Envelope> {
        if body.len() > MAX_ENVELOPE_BYTES {
            return Err(SignalError::TooLarge);
        }
        // signature d'abord : un message non authentifié n'est même pas interprété
        let key = self.peer_key.as_ref().ok_or(SignalError::BadSignature)?;
        identity::verify(key, body.as_bytes(), signature)?;
        let env: Envelope = serde_json::from_str(body).map_err(|_| SignalError::Malformed)?;
        validate(&env)?;
        if env.session != self.session {
            return Err(SignalError::WrongSession);
        }
        if env.from != self.peer || env.to != self.me {
            return Err(SignalError::WrongParticipant);
        }
        if env.ts.abs_diff(now_ms) > MAX_SKEW_MS {
            return Err(SignalError::Stale);
        }
        if self.last_peer_seq.is_some_and(|last| env.seq <= last) {
            return Err(SignalError::Replay);
        }
        if let Some(token) = &env.token {
            if !same(token, &self.token) {
                return Err(SignalError::BadToken);
            }
        }
        // l'empreinte DTLS du pair ne change pas pendant la session
        if self.peer_fingerprint.as_ref().is_some_and(|fp| *fp != env.fingerprint) {
            return Err(SignalError::FingerprintMismatch);
        }
        self.peer_fingerprint = Some(env.fingerprint.clone());
        self.last_peer_seq = Some(env.seq);
        Ok(env)
    }

    /// Fixe la clé (épinglée) de l'appareil du pair. Une seule fois : un autre appareil du même
    /// compte ne peut pas prendre la suite au milieu d'une session.
    pub fn bind_peer(&mut self, key: VerifyingKey) -> Result<()> {
        match self.peer_key {
            Some(k) if k != key => Err(SignalError::WrongParticipant),
            _ => {
                self.peer_key = Some(key);
                Ok(())
            }
        }
    }

    pub fn has_peer(&self) -> bool {
        self.peer_key.is_some()
    }

    /// Après la poignée de main DTLS : l'empreinte du certificat négocié doit être celle signée.
    pub fn check_negotiated(&self, negotiated: &str) -> Result<()> {
        let negotiated = normalize_fingerprint(negotiated)?;
        match &self.peer_fingerprint {
            Some(signed) if *signed == negotiated => Ok(()),
            _ => Err(SignalError::FingerprintMismatch),
        }
    }
}

pub fn seal_envelope(key: &DeviceKey, env: &Envelope) -> Result<Sealed> {
    validate(env)?;
    let body = serde_json::to_string(env).map_err(|_| SignalError::Malformed)?;
    if body.len() > MAX_ENVELOPE_BYTES {
        return Err(SignalError::TooLarge);
    }
    let signature = key.sign(body.as_bytes());
    Ok(Sealed { body, signature })
}

/// Jetons d'invitation émis par l'hôte : consommés une seule fois, avant leur expiration
/// (le serveur les consomme aussi ; l'hôte ne se fie pas qu'à lui).
#[derive(Default)]
pub struct TokenLedger {
    issued: HashMap<String, u64>,
}

impl TokenLedger {
    pub fn issue(&mut self, token: &str, expires_at_ms: u64) {
        self.issued.insert(token.into(), expires_at_ms);
    }

    pub fn consume(&mut self, token: &str, now_ms: u64) -> Result<()> {
        self.issued.retain(|_, exp| *exp > now_ms);
        let found = self.issued.keys().find(|t| same(t, token)).cloned();
        match found {
            Some(t) => {
                self.issued.remove(&t);
                Ok(())
            }
            None => Err(SignalError::BadToken),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SESSION: &str = "0b8f6a4e-3c1d-4f7a-9e2b-5d6c7a8b9c0d";
    const HOST: &str = "11111111-1111-4111-8111-111111111111";
    const GUEST: &str = "22222222-2222-4222-8222-222222222222";
    const EVE: &str = "33333333-3333-4333-8333-333333333333";
    const TOKEN: &str = "AAAAAAAAAAAAAAAAAAAAAA";
    const NOW: u64 = 1_800_000_000_000;

    fn fp(byte: u8) -> String {
        format!("sha-256 {}", vec![format!("{byte:02X}"); 32].join(":"))
    }
    fn sdp(fingerprint: &str) -> String {
        format!("v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\ns=-\r\na=fingerprint:{fingerprint}\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=fingerprint:{fingerprint}\r\n")
    }

    struct Pair {
        host_key: DeviceKey,
        guest_key: DeviceKey,
        host: Channel,
        guest: Channel,
    }
    fn pair() -> Pair {
        let host_key = DeviceKey::from_seed(&[1; 32]);
        let guest_key = DeviceKey::from_seed(&[2; 32]);
        let host = Channel::new(SESSION, HOST, GUEST, guest_key.verifying_key(), TOKEN);
        let guest = Channel::new(SESSION, GUEST, HOST, host_key.verifying_key(), TOKEN);
        Pair { host_key, guest_key, host, guest }
    }

    #[test]
    fn offre_reponse_ice_aller_retour() {
        let mut p = pair();
        let offer = p.host.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        let got = p.guest.open(&offer.body, &offer.signature, NOW + 500).unwrap();
        assert_eq!(got.kind, Kind::Offer);
        assert_eq!(got.token.as_deref(), Some(TOKEN));
        let answer = p.guest.seal(&p.guest_key, Kind::Answer, &fp(0xCD), Some(sdp(&fp(0xCD))), vec![], NOW).unwrap();
        p.host.open(&answer.body, &answer.signature, NOW).unwrap();
        let ice = p.host.seal(&p.host_key, Kind::Ice, &fp(0xAB), None, vec!["candidate:1 1 UDP 2122 192.0.2.1 5000 typ host".into()], NOW).unwrap();
        assert_eq!(p.guest.open(&ice.body, &ice.signature, NOW).unwrap().candidates.len(), 1);
        // les candidats ne portent pas le jeton
        assert!(!ice.body.contains(TOKEN));
        // l'empreinte DTLS négociée doit être celle signée
        assert!(p.guest.check_negotiated(&fp(0xAB).to_lowercase()).is_ok());
        assert_eq!(p.guest.check_negotiated(&fp(0xEE)), Err(SignalError::FingerprintMismatch));
        assert!(p.host.check_negotiated(&fp(0xCD)).is_ok());
    }

    #[test]
    fn sdp_altere_refuse() {
        let mut p = pair();
        let offer = p.host.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        // serveur ou réseau qui remplace l'empreinte DTLS (homme du milieu)
        let swapped = offer.body.replace(&fp(0xAB), &fp(0xEE));
        assert_eq!(p.guest.open(&swapped, &offer.signature, NOW), Err(SignalError::BadSignature));
        let tampered = offer.body.replace("IN IP4 0.0.0.0", "IN IP4 203.0.113.9");
        assert_eq!(p.guest.open(&tampered, &offer.signature, NOW), Err(SignalError::BadSignature));
        // rien n'a été retenu : l'original passe encore
        assert!(p.guest.open(&offer.body, &offer.signature, NOW).is_ok());
    }

    #[test]
    fn cle_d_un_autre_appareil_refusee() {
        let mut p = pair();
        let mallory = DeviceKey::from_seed(&[9; 32]);
        let forged = p.host.seal(&mallory, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        assert_eq!(p.guest.open(&forged.body, &forged.signature, NOW), Err(SignalError::BadSignature));
        assert_eq!(p.guest.open(&forged.body, "pas-une-signature", NOW), Err(SignalError::BadSignature));
    }

    #[test]
    fn empreinte_du_sdp_differente_de_celle_signee() {
        let p = pair();
        let mut env = Envelope {
            ctx: CONTEXT.into(), session: SESSION.into(), from: HOST.into(), to: GUEST.into(), seq: 1, ts: NOW,
            kind: Kind::Offer, fingerprint: fp(0xAB), token: Some(TOKEN.into()), sdp: Some(sdp(&fp(0xEE))), candidates: vec![],
        };
        assert_eq!(seal_envelope(&p.host_key, &env).err(), Some(SignalError::FingerprintMismatch));
        // même signé par le vrai appareil (bogue ou SDP réécrit avant signature), le pair refuse
        let mixed = format!("{}a=fingerprint:{}\r\n", sdp(&fp(0xAB)), fp(0xEE));
        env.sdp = Some(mixed);
        let body = serde_json::to_string(&env).unwrap();
        let sig = p.host_key.sign(body.as_bytes());
        let mut guest = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        assert_eq!(guest.open(&body, &sig, NOW), Err(SignalError::FingerprintMismatch));
        // SDP sans empreinte
        env.sdp = Some("v=0\r\n".into());
        let body = serde_json::to_string(&env).unwrap();
        assert_eq!(guest.open(&body, &p.host_key.sign(body.as_bytes()), NOW), Err(SignalError::FingerprintMismatch));
    }

    #[test]
    fn empreinte_qui_change_en_cours_de_session() {
        let mut p = pair();
        let a = p.host.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        p.guest.open(&a.body, &a.signature, NOW).unwrap();
        let b = p.host.seal(&p.host_key, Kind::Ice, &fp(0xEE), None, vec!["candidate:x".into()], NOW).unwrap();
        assert_eq!(p.guest.open(&b.body, &b.signature, NOW), Err(SignalError::FingerprintMismatch));
    }

    #[test]
    fn rejeu_et_ordre() {
        let mut p = pair();
        let a = p.host.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        let b = p.host.seal(&p.host_key, Kind::Ice, &fp(0xAB), None, vec!["candidate:x".into()], NOW).unwrap();
        p.guest.open(&a.body, &a.signature, NOW).unwrap();
        assert_eq!(p.guest.open(&a.body, &a.signature, NOW), Err(SignalError::Replay));
        p.guest.open(&b.body, &b.signature, NOW).unwrap();
        assert_eq!(p.guest.open(&a.body, &a.signature, NOW), Err(SignalError::Replay));
    }

    #[test]
    fn hors_delai() {
        let mut p = pair();
        let a = p.host.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        assert_eq!(p.guest.open(&a.body, &a.signature, NOW + MAX_SKEW_MS + 1), Err(SignalError::Stale));
        assert_eq!(p.guest.open(&a.body, &a.signature, NOW - MAX_SKEW_MS - 1), Err(SignalError::Stale));
    }

    #[test]
    fn autre_session_ou_tiers() {
        let p = pair();
        let mut host_other = Channel::new("autre-session", HOST, GUEST, p.guest_key.verifying_key(), TOKEN);
        let a = host_other.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        let mut guest = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        assert_eq!(guest.open(&a.body, &a.signature, NOW), Err(SignalError::WrongSession));
        // message de l'hôte destiné à Eve, transmis à l'invité par un serveur malveillant
        let mut to_eve = Channel::new(SESSION, HOST, EVE, p.guest_key.verifying_key(), TOKEN);
        let b = to_eve.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        assert_eq!(guest.open(&b.body, &b.signature, NOW), Err(SignalError::WrongParticipant));
        // un message de l'invité réfléchi vers lui-même
        let mut g2 = Channel::new(SESSION, GUEST, HOST, p.guest_key.verifying_key(), TOKEN);
        let mut g_sender = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        let c = g_sender.seal(&p.guest_key, Kind::Answer, &fp(0xCD), Some(sdp(&fp(0xCD))), vec![], NOW).unwrap();
        assert_eq!(g2.open(&c.body, &c.signature, NOW), Err(SignalError::WrongParticipant));
    }

    #[test]
    fn jeton_d_invitation() {
        let p = pair();
        let mut wrong = Channel::new(SESSION, HOST, GUEST, p.guest_key.verifying_key(), "BBBBBBBBBBBBBBBBBBBBBB");
        let a = wrong.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        let mut guest = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        assert_eq!(guest.open(&a.body, &a.signature, NOW), Err(SignalError::BadToken));

        let mut ledger = TokenLedger::default();
        ledger.issue(TOKEN, NOW + 120_000);
        assert!(ledger.consume(TOKEN, NOW).is_ok());
        assert_eq!(ledger.consume(TOKEN, NOW), Err(SignalError::BadToken));
        ledger.issue("CCCCCCCCCCCCCCCCCCCCCC", NOW + 120_000);
        assert_eq!(ledger.consume("CCCCCCCCCCCCCCCCCCCCCC", NOW + 120_000), Err(SignalError::BadToken));
    }

    #[test]
    fn corps_mal_forme_trop_gros_ou_hors_contexte() {
        let p = pair();
        let mut guest = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        let sign = |body: &str| p.host_key.sign(body.as_bytes());
        let huge = format!("{{\"pad\":\"{}\"}}", "x".repeat(MAX_ENVELOPE_BYTES));
        assert_eq!(guest.open(&huge, &sign(&huge), NOW), Err(SignalError::TooLarge));
        assert_eq!(guest.open("{}", &sign("{}"), NOW), Err(SignalError::Malformed));
        // champ inconnu glissé dans un message par ailleurs valide
        let env = Envelope {
            ctx: CONTEXT.into(), session: SESSION.into(), from: HOST.into(), to: GUEST.into(), seq: 1, ts: NOW,
            kind: Kind::Bye, fingerprint: fp(0xAB), token: None, sdp: None, candidates: vec![],
        };
        let body = serde_json::to_string(&env).unwrap().replacen('{', "{\"admin\":true,", 1);
        assert_eq!(guest.open(&body, &sign(&body), NOW), Err(SignalError::Malformed));
        // une preuve d'appareil (autre contexte) ne peut pas servir d'enveloppe
        let other = serde_json::to_string(&Envelope { ctx: "ibox-rp-device/1".into(), ..env.clone() }).unwrap();
        assert_eq!(guest.open(&other, &sign(&other), NOW), Err(SignalError::BadContext));
        // offre sans jeton
        let no_token = serde_json::to_string(&Envelope { kind: Kind::Offer, sdp: Some(sdp(&fp(0xAB))), ..env.clone() }).unwrap();
        assert_eq!(guest.open(&no_token, &sign(&no_token), NOW), Err(SignalError::Malformed));
        // trop de candidats, ou candidat qui injecte des lignes SDP
        let mut sender = Channel::new(SESSION, HOST, GUEST, p.guest_key.verifying_key(), TOKEN);
        assert_eq!(sender.seal(&p.host_key, Kind::Ice, &fp(0xAB), None, vec!["c".into(); 65], NOW).err(), Some(SignalError::Malformed));
        assert_eq!(sender.seal(&p.host_key, Kind::Ice, &fp(0xAB), None, vec!["c\r\na=fingerprint:x".into()], NOW).err(), Some(SignalError::Malformed));
        assert_eq!(sender.seal(&p.host_key, Kind::Offer, "md5 AB", Some(sdp(&fp(0xAB))), vec![], NOW).err(), Some(SignalError::FingerprintMismatch));
    }

    #[test]
    fn canal_lie_apres_coup() {
        let p = pair();
        // l'hôte scelle son offre sans connaître l'appareil de l'invité
        let mut host = Channel::unbound(SESSION, HOST, GUEST, TOKEN);
        let offer = host.seal(&p.host_key, Kind::Offer, &fp(0xAB), Some(sdp(&fp(0xAB))), vec![], NOW).unwrap();
        let mut guest = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        guest.open(&offer.body, &offer.signature, NOW).unwrap();
        let mut g = Channel::new(SESSION, GUEST, HOST, p.host_key.verifying_key(), TOKEN);
        let answer = g.seal(&p.guest_key, Kind::Answer, &fp(0xCD), Some(sdp(&fp(0xCD))), vec![], NOW).unwrap();
        // tant que la clé n'est pas liée, rien n'est accepté
        assert!(!host.has_peer());
        assert_eq!(host.open(&answer.body, &answer.signature, NOW), Err(SignalError::BadSignature));
        host.bind_peer(p.guest_key.verifying_key()).unwrap();
        assert_eq!(host.open(&answer.body, &answer.signature, NOW).unwrap().kind, Kind::Answer);
        // un autre appareil ne peut pas prendre la suite
        assert_eq!(host.bind_peer(DeviceKey::from_seed(&[9; 32]).verifying_key()), Err(SignalError::WrongParticipant));
        assert!(host.bind_peer(p.guest_key.verifying_key()).is_ok());
    }

    #[test]
    fn normalisation_des_empreintes() {
        assert_eq!(normalize_fingerprint(&fp(0xab).to_lowercase()).unwrap(), fp(0xAB));
        assert!(normalize_fingerprint("sha-1 AB:CD").is_err());
        assert!(normalize_fingerprint(&format!("{} extra", fp(0xAB))).is_err());
        assert!(normalize_fingerprint(&fp(0xAB).replace(":AB", ":G0")).is_err());
    }
}
