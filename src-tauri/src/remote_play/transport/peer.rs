//! Côté hôte d'une session : machine à états autour de `str0m::Rtc`, **sans aucune E/S**. Les
//! paquets UDP, l'horloge et les images encodées sont fournis par l'appelant (`host.rs` en vrai,
//! les tests en mémoire). Une piste vidéo H.264 en envoi seul et deux DataChannels créés par
//! l'hôte : `input` (non ordonné, 0 retransmission) et `control` (fiable).

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use str0m::bwe::{Bitrate, BweKind};
use str0m::channel::{ChannelConfig, ChannelId, Reliability};
use str0m::change::{SdpAnswer, SdpPendingOffer};
use str0m::format::Codec;
use str0m::media::{Direction, Frequency, MediaKind, MediaTime, Mid, Pt};
use str0m::net::{Protocol, Receive};
use str0m::rtp::{AbsCaptureTime, Extension};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

use super::rate::RateController;
use super::router::{self, Channel, CONTROL_LABEL, INPUT_LABEL};
use super::sdp;
use super::stats::{jitter_ms, median_max_ms, pts_to_90khz, Meter, TransportStats, VIDEO_CLOCK_HZ};
use crate::remote_play::encode::Profile;
use crate::remote_play::input::{Done, Engine, Pads, Screen, Sink};
use crate::remote_play::permissions::{Denied, ParticipantId};
use crate::remote_play::protocol::{self, Message};

/// Identifiant de l'unique invité d'une session P2P (Phase 2 : un invité).
pub const GUEST: ParticipantId = 1;
/// Débit plancher demandé à l'estimateur (kbit/s).
pub const MIN_KBPS: u32 = 500;
/// Débit que l'estimateur de bande passante cherche à atteindre (kbit/s) : 3 × le plafond vidéo,
/// pour que le lissage d'envoi soit bien plus rapide que l'encodeur.
pub fn probe_ceiling_kbps(max_kbps: u32) -> u64 {
    (max_kbps as u64 * 3).clamp(MIN_KBPS as u64, 300_000)
}

/// Une image clé pèse plusieurs images ordinaires : pas plus d'une par intervalle, même si
/// l'invité en redemande (celle qui vient de partir répond déjà à sa demande).
pub const KEYFRAME_MIN_INTERVAL: Duration = Duration::from_millis(250);
/// Cadence des statistiques de str0m (aller-retour, pertes, paire ICE).
pub const STATS_INTERVAL: Duration = Duration::from_millis(250);
/// Âge au-delà duquel une image encore en file d'envoi n'est plus suivie.
pub const FLIGHT_MAX_AGE: Duration = Duration::from_secs(2);
/// Écart entre deux messages `Timing` envoyés à l'invité.
pub const TIMING_INTERVAL: Duration = Duration::from_millis(250);

/// Image remise à str0m dont le dernier paquet n'a pas encore été remis au réseau.
#[derive(Debug, Clone, Copy)]
struct Flight {
    rtp: u32,
    captured: Instant,
    captured_wall: SystemTime,
    written: Instant,
}

fn unix_micros(t: SystemTime) -> u64 {
    t.duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_micros() as u64).unwrap_or(0)
}

/// En-tête d'un paquet RTP sortant : (type de charge, dernier paquet de l'image, temps RTP).
/// `None` pour tout le reste (STUN, DTLS, RTCP, bourrage).
pub fn rtp_header(data: &[u8]) -> Option<(u8, bool, u32)> {
    if data.len() < 12 || data[0] >> 6 != 2 || (192..=223).contains(&data[1]) || data[0] & 0x20 != 0 {
        return None;
    }
    Some((data[1] & 0x7f, data[1] & 0x80 != 0, u32::from_be_bytes([data[4], data[5], data[6], data[7]])))
}

/// Identifiants des extensions RTP ajoutées (libres dans la table standard de str0m).
pub const PLAYOUT_DELAY_EXT: u8 = 6;
pub const CAPTURE_TIME_EXT: u8 = 7;
/// Flux (msid) du son, distinct de celui de l'image (« ibox ») : pas de synchronisation A/V.
pub const AUDIO_STREAM: &str = "ibox-sound";

/// Ce qui exécute les messages autorisés : `input::Engine` (permissions puis injection).
pub trait InputHandler: Send {
    fn handle(&mut self, msg: Message) -> Result<Vec<Done>, Denied>;
    /// Déconnexion : tout ce que l'invité tenait est relâché.
    fn leave(&mut self) -> Vec<Done>;
}

impl<S: Sink, D: Screen, P: Pads> InputHandler for Arc<Mutex<Engine<S, D, P>>> {
    fn handle(&mut self, msg: Message) -> Result<Vec<Done>, Denied> {
        self.lock().unwrap_or_else(|e| e.into_inner()).handle(GUEST, msg)
    }
    fn leave(&mut self) -> Vec<Done> {
        self.lock().unwrap_or_else(|e| e.into_inner()).leave(GUEST)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct PeerOptions {
    /// Débit de départ et plafond de l'encodeur (kbit/s).
    pub initial_kbps: u32,
    pub max_kbps: u32,
    /// « Priorité à la réactivité » : marge plus large sous la bande passante estimée.
    pub responsive: bool,
}

/// Paquet UDP à émettre depuis `source` (un candidat local) vers `destination`.
#[derive(Debug, Clone)]
pub struct Datagram {
    pub source: SocketAddr,
    pub destination: SocketAddr,
    pub data: Vec<u8>,
}

/// Ce que la boucle doit répercuter sur l'encodeur ou l'interface.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Effects {
    /// La connexion DTLS vient d'être établie : démarrer la capture / l'encodage.
    pub connected: bool,
    /// L'invité a demandé une IDR (PLI/FIR).
    pub keyframe: bool,
    /// Nouveau débit pour l'encodeur (kbit/s).
    pub bitrate_kbps: Option<u32>,
    /// La session est terminée (déconnexion, échec ICE, fermeture).
    pub closed: bool,
}

pub struct HostPeer<H: InputHandler> {
    rtc: Rtc,
    pending: Option<SdpPendingOffer>,
    video: Mid,
    pt: Option<(Pt, Profile)>,
    /// Piste audio Opus (son du PC) ; `audio_pt` connu après la réponse de l'invité.
    audio: Mid,
    audio_pt: Option<Pt>,
    channels: HashMap<ChannelId, Channel>,
    control: Option<ChannelId>,
    handler: H,
    rate: RateController,
    effects: Effects,
    stats: TransportStats,
    offer_fingerprint: Option<String>,
    started: Instant,
    frames: Meter,
    bytes: Meter,
    encode_us: Meter,
    last_bytes_tx: Option<u64>,
    last_loss: Option<f32>,
    closed: bool,
    answered_at: Option<Instant>,
    /// Images en cours d'envoi, dans l'ordre ; suivi abandonné s'il ne correspond pas aux
    /// paquets émis (`tracking` faux) : aucune statistique plutôt qu'une statistique fausse.
    in_flight: VecDeque<Flight>,
    rtp_offset: Option<u32>,
    tracking: bool,
    unmatched: u32,
    wait_us: Meter,
    queue_us: Meter,
    host_us: Meter,
    input_us: Meter,
    last_rx: Option<Instant>,
    last_timing: Option<Instant>,
    last_keyframe: Option<Instant>,
}

/// Profil H.264 d'un `profile-level-id` (octet de profil + contraintes).
pub fn h264_profile(profile_level_id: u32) -> Option<Profile> {
    let constraints = (profile_level_id >> 8) & 0xff;
    match (profile_level_id >> 16) & 0xff {
        0x64 => Some(Profile::High),
        0x4d => Some(Profile::Main),
        // seulement Constrained Baseline (constraint_set1) : l'encodeur n'utilise ni FMO ni ASO
        0x42 if constraints & 0x40 != 0 => Some(Profile::Baseline),
        _ => None,
    }
}

fn state_name(s: IceConnectionState) -> &'static str {
    match s {
        IceConnectionState::New => "new",
        IceConnectionState::Checking => "checking",
        IceConnectionState::Connected => "connected",
        IceConnectionState::Completed => "completed",
        IceConnectionState::Disconnected => "disconnected",
    }
}

/// Réseau d'une adresse, sans la révéler (« aucune adresse dans les journaux »).
pub fn network_kind(addr: &SocketAddr) -> &'static str {
    match addr.ip() {
        ip if ip.is_loopback() => "loopback",
        std::net::IpAddr::V4(v4) if v4.is_private() || v4.is_link_local() => "lan",
        std::net::IpAddr::V6(v6) if (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80 => "lan",
        _ => "internet",
    }
}

impl<H: InputHandler> HostPeer<H> {
    /// Crée la session et son offre SDP complète (candidats hôtes inclus, pas de trickle).
    pub fn new(opts: PeerOptions, candidates: &[SocketAddr], handler: H, now: Instant) -> Result<(Self, String), String> {
        Self::with_reflexive(opts, candidates, &[], handler, now)
    }

    /// Comme [`HostPeer::new`], avec en plus les adresses publiques découvertes par STUN :
    /// `(adresse publique, socket locale qui l'a obtenue)` — candidats `srflx`.
    pub fn with_reflexive(opts: PeerOptions, candidates: &[SocketAddr], reflexive: &[(SocketAddr, SocketAddr)], handler: H, now: Instant) -> Result<(Self, String), String> {
        let rate = RateController::new(opts.initial_kbps, MIN_KBPS, opts.max_kbps).responsive(opts.responsive);
        let mut rtc = RtcConfig::new()
            .clear_codecs()
            .enable_h264(true)
            .enable_opus(true, false)
            .enable_bwe(Some(Bitrate::kbps(rate.current_kbps() as u64)))
            // quatre fois par seconde : l'aller-retour des paquets vidéo sert de garde de délai
            .set_stats_interval(Some(STATS_INTERVAL))
            // playout-delay 0/0 : Chromium affiche chaque image dès qu'elle est décodée, sans
            // tampon de lissage (méthode Stadia / GeForce Now) ; abs-capture-time : l'invité
            // mesure la latence capture → affichage
            .set_extension(PLAYOUT_DELAY_EXT, Extension::PlayoutDelay)
            .set_extension(CAPTURE_TIME_EXT, Extension::AbsoluteCaptureTime)
            .build(now);
        // Le pacer de str0m étale chaque image à 1,1 × l'estimation : sondée seulement jusqu'au
        // plafond de l'encodeur, l'estimation y reste collée et une image met presque un
        // intervalle entier à partir. Sonder jusqu'à 3 × le plafond (libwebrtc lisse à 2,5 ×)
        // laisse sortir les images d'un bloc ; le débit vidéo, lui, reste borné par `rate`.
        rtc.bwe().set_bitrate(Bitrate::kbps(MIN_KBPS as u64), Bitrate::kbps(probe_ceiling_kbps(opts.max_kbps)));
        for addr in candidates {
            let c = Candidate::host(*addr, "udp").map_err(|e| format!("candidat {}: {e}", network_kind(addr)))?;
            rtc.add_local_candidate(c);
        }
        for (public, base) in reflexive {
            // une adresse publique égale à la locale (IPv6 sans NAT) serait redondante : str0m l'écarte
            if let Ok(c) = Candidate::server_reflexive(*public, *base, "udp") {
                rtc.add_local_candidate(c);
            }
        }
        let mut api = rtc.sdp_api();
        let video = api.add_media(MediaKind::Video, Direction::SendOnly, Some("ibox".into()), Some("screen".into()), None);
        // flux distinct de l'image : dans un même flux, Chromium synchronise l'image sur le son et
        // la retarde d'autant que le tampon audio (dizaines de ms). L'invité les lit quand même
        // dans le même élément <video>.
        let audio = api.add_media(MediaKind::Audio, Direction::SendOnly, Some(AUDIO_STREAM.into()), Some("sound".into()), None);
        api.add_channel_with_config(ChannelConfig {
            label: INPUT_LABEL.into(),
            ordered: false,
            reliability: Reliability::MaxRetransmits { retransmits: 0 },
            ..Default::default()
        });
        api.add_channel_with_config(ChannelConfig { label: CONTROL_LABEL.into(), ordered: true, reliability: Reliability::Reliable, ..Default::default() });
        let (offer, pending) = api.apply().ok_or("offre SDP vide")?;
        let offer = offer.to_sdp_string();
        let stats = TransportStats { state: "new".into(), target_kbps: rate.current_kbps(), ..Default::default() };
        let peer = HostPeer {
            offer_fingerprint: sdp::fingerprint(&offer),
            rtc,
            pending: Some(pending),
            video,
            pt: None,
            audio,
            audio_pt: None,
            channels: HashMap::new(),
            control: None,
            handler,
            rate,
            effects: Effects::default(),
            stats,
            started: now,
            frames: Meter::new(Duration::from_secs(1)),
            bytes: Meter::new(Duration::from_secs(1)),
            encode_us: Meter::new(Duration::from_secs(2)),
            last_bytes_tx: None,
            last_loss: None,
            closed: false,
            answered_at: None,
            in_flight: VecDeque::new(),
            rtp_offset: None,
            tracking: true,
            unmatched: 0,
            wait_us: Meter::new(Duration::from_secs(2)),
            queue_us: Meter::new(Duration::from_secs(2)),
            host_us: Meter::new(Duration::from_secs(2)),
            input_us: Meter::new(Duration::from_secs(2)),
            last_rx: None,
            last_timing: None,
            last_keyframe: None,
        };
        Ok((peer, offer))
    }

    /// Réponse SDP de l'invité. Renvoie le code de vérification de l'échange manuel.
    pub fn accept_answer(&mut self, answer: &str) -> Result<String, String> {
        let pending = self.pending.take().ok_or("réponse déjà acceptée")?;
        let cleaned = sdp::strip_mdns_candidates(answer);
        let parsed = SdpAnswer::from_sdp_string(&cleaned).map_err(|e| format!("réponse SDP invalide : {e}"))?;
        let answer_fp = sdp::fingerprint(&cleaned).ok_or("réponse sans empreinte DTLS")?;
        self.rtc.sdp_api().accept_answer(pending, parsed).map_err(|e| format!("réponse refusée : {e}"))?;
        self.pt = self.choose_pt();
        self.audio_pt = self.rtc.writer(self.audio).and_then(|w| w.payload_params().find(|p| p.spec().codec == Codec::Opus).map(|p| p.pt()));
        if self.pt.is_none() {
            return Err("l'invité n'accepte aucun profil H.264 compatible (packetization-mode=1)".into());
        }
        self.answered_at = Some(Instant::now());
        Ok(sdp::verification_code(self.offer_fingerprint.as_deref().unwrap_or(""), &answer_fp))
    }

    /// Type de charge H.264 retenu : High, puis Main, puis Constrained Baseline, mode 1.
    fn choose_pt(&mut self) -> Option<(Pt, Profile)> {
        let writer = self.rtc.writer(self.video)?;
        let mut best: Option<(Pt, Profile)> = None;
        for p in writer.payload_params() {
            let spec = p.spec();
            if spec.codec != Codec::H264 || spec.format.packetization_mode != Some(1) {
                continue;
            }
            let Some(profile) = spec.format.profile_level_id.and_then(h264_profile) else { continue };
            let rank = |pr: Profile| match pr {
                Profile::High => 3,
                Profile::Main => 2,
                Profile::Baseline => 1,
            };
            if best.is_none_or(|(_, b)| rank(profile) > rank(b)) {
                best = Some((p.pt(), profile));
            }
        }
        best
    }

    /// Profil H.264 que l'encodeur doit produire (connu après la réponse).
    pub fn profile(&self) -> Option<Profile> {
        self.pt.map(|(_, p)| p)
    }

    pub fn is_connected(&self) -> bool {
        self.stats.connected
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// Instant où la réponse de l'invité a été acceptée (début des vérifications ICE).
    pub fn answered_at(&self) -> Option<Instant> {
        self.answered_at
    }

    /// Candidat ICE de l'invité arrivé après sa réponse (trickle). Les candidats mDNS (`.local`),
    /// que str0m ne résout pas, sont ignorés. Renvoie `false` si la ligne est illisible.
    pub fn add_remote_candidate(&mut self, line: &str) -> bool {
        let line = line.trim().trim_start_matches("a=");
        if line.split_whitespace().nth(4).is_some_and(|a| a.to_ascii_lowercase().ends_with(".local")) {
            return true;
        }
        match Candidate::from_sdp_string(line) {
            Ok(c) => {
                self.rtc.add_remote_candidate(c);
                true
            }
            Err(_) => false,
        }
    }

    /// Renseigne ce que STUN a appris du réseau de l'hôte (affichage, diagnostic d'échec).
    pub fn set_network(&mut self, nat_v4: Option<super::stun::NatKind>, nat_v6: Option<super::stun::NatKind>) {
        self.stats.nat_v4 = nat_v4;
        self.stats.nat_v6 = nat_v6;
    }

    /// Un paquet UDP reçu sur `destination` (candidat local).
    pub fn receive(&mut self, now: Instant, source: SocketAddr, destination: SocketAddr, data: &[u8]) {
        let Ok(contents) = data.try_into() else { return };
        let input = Input::Receive(now, Receive { proto: Protocol::Udp, source, destination, contents });
        if self.rtc.accepts(&input) {
            self.last_rx = Some(now);
            if let Err(e) = self.rtc.handle_input(input) {
                self.fail(format!("réception : {e}"));
            }
        }
    }

    /// Fait avancer l'horloge de str0m.
    pub fn tick(&mut self, now: Instant) {
        if let Err(e) = self.rtc.handle_input(Input::Timeout(now)) {
            self.fail(format!("horloge : {e}"));
        }
    }

    /// Image H.264 (Annex B, une unité d'accès) : str0m la découpe en RTP (FU-A / STAP-A).
    /// `wallclock` : envoi de l'image à l'encodeur ; `waited` : ce qu'elle a attendu avant, depuis
    /// sa capture.
    pub fn write_frame(&mut self, now: Instant, wallclock: Instant, pts_100ns: i64, data: Vec<u8>, encode_time: Option<Duration>, waited: Duration) -> Result<(), String> {
        let (pt, _) = self.pt.ok_or("aucun codec négocié")?;
        let writer = self.rtc.writer(self.video).ok_or("piste vidéo absente")?;
        let captured = wallclock.checked_sub(waited).unwrap_or(wallclock);
        let captured_wall = SystemTime::now().checked_sub(now.saturating_duration_since(captured)).unwrap_or_else(SystemTime::now);
        let rtp = pts_to_90khz(pts_100ns);
        let keyframe = crate::remote_play::encode::h264::is_keyframe(&data);
        writer
            .playout_delay(MediaTime::from_hundredths(0), MediaTime::from_hundredths(0))
            .abs_capture_time(AbsCaptureTime { capture_time: captured_wall, clock_offset: None })
            .write(pt, wallclock, MediaTime::from_90khz(rtp), data)
            .map_err(|e| format!("envoi vidéo : {e}"))?;
        self.frames.push(now, 1);
        self.stats.frames += 1;
        if keyframe {
            self.stats.keyframes += 1;
            self.last_keyframe = Some(now);
        }
        if let Some(t) = encode_time {
            self.encode_us.push(now, t.as_micros() as u64);
        }
        self.wait_us.push(now, waited.as_micros() as u64);
        if self.tracking {
            self.expire(now);
            self.in_flight.push_back(Flight { rtp: rtp as u32, captured, captured_wall, written: now });
        }
        Ok(())
    }

    /// Oublie les images en file depuis plus de [`FLIGHT_MAX_AGE`] : la retenue qu'elles
    /// causent ne dure donc jamais plus longtemps, quoi qu'il arrive au suivi.
    fn expire(&mut self, now: Instant) {
        while self.in_flight.front().is_some_and(|f| now.saturating_duration_since(f.written) > FLIGHT_MAX_AGE) {
            self.in_flight.pop_front();
        }
    }

    fn lose_track(&mut self) {
        self.unmatched += 1;
        if self.unmatched >= 3 {
            self.tracking = false;
            self.in_flight.clear();
        }
    }

    /// Un paquet part : si c'est le dernier d'une image, elle a quitté l'hôte.
    fn on_transmit(&mut self, now: Instant, data: &[u8]) {
        if !self.tracking {
            return;
        }
        let Some((video_pt, _)) = self.pt else { return };
        let Some((pt, true, wire)) = rtp_header(data) else { return };
        if pt != *video_pt {
            return;
        }
        // str0m peut décaler les temps RTP d'une constante : mesurée sur la première image
        let Some(front) = self.in_flight.front() else { return };
        let offset = *self.rtp_offset.get_or_insert(wire.wrapping_sub(front.rtp));
        let wanted = wire.wrapping_sub(offset);
        let Some(i) = self.in_flight.iter().position(|f| f.rtp == wanted) else {
            self.lose_track();
            return;
        };
        self.unmatched = 0;
        let flight = self.in_flight[i];
        self.in_flight.drain(..=i);
        let host = now.saturating_duration_since(flight.captured);
        self.queue_us.push(now, now.saturating_duration_since(flight.written).as_micros() as u64);
        self.host_us.push(now, host.as_micros() as u64);
        if self.last_timing.is_none_or(|t| now.saturating_duration_since(t) >= TIMING_INTERVAL) {
            self.last_timing = Some(now);
            self.send_control(&Message::Timing {
                rtp: wire,
                capture_micros: unix_micros(flight.captured_wall),
                sent_micros: unix_micros(SystemTime::now()),
                host_micros: host.as_micros().min(u32::MAX as u128) as u32,
            });
        }
    }

    /// Images dont le dernier paquet attend encore dans la file d'envoi, et âge de la plus
    /// ancienne. (0, zéro) si le suivi n'est pas fiable.
    pub fn backlog(&self, now: Instant) -> (usize, Duration) {
        match self.in_flight.front() {
            Some(f) if self.tracking => (self.in_flight.len(), now.saturating_duration_since(f.written)),
            _ => (0, Duration::ZERO),
        }
    }

    /// Images écartées par la chaîne d'encodage pendant une retenue (affichage).
    pub fn set_frames_skipped(&mut self, n: u64) {
        self.stats.frames_skipped = n;
    }

    /// Paquet Opus (10 ms) ; ignoré si l'invité n'a pas accepté l'audio.
    pub fn write_audio(&mut self, wallclock: Instant, at_48khz: u64, data: &[u8]) -> Result<(), String> {
        let Some(pt) = self.audio_pt else { return Ok(()) };
        let Some(writer) = self.rtc.writer(self.audio) else { return Ok(()) };
        writer
            .write(pt, wallclock, MediaTime::new(at_48khz, Frequency::FORTY_EIGHT_KHZ), data.to_vec())
            .map_err(|e| format!("envoi du son : {e}"))
    }

    /// Message hôte → invité sur le canal `control` (vibration, pong…).
    pub fn send_control(&mut self, msg: &Message) -> bool {
        let Some(id) = self.control else { return false };
        self.rtc.channel(id).is_some_and(|mut ch| ch.write(true, &protocol::encode(msg)).is_ok())
    }

    /// Vide les sorties de str0m : paquets à émettre dans `out`, événements traités ; renvoie
    /// l'instant où rappeler [`HostPeer::tick`].
    pub fn poll(&mut self, now: Instant, out: &mut Vec<Datagram>) -> Instant {
        self.expire(now);
        loop {
            match self.rtc.poll_output() {
                Ok(Output::Timeout(t)) => return t,
                Ok(Output::Transmit(t)) => {
                    self.bytes.push(now, t.contents.len() as u64);
                    self.on_transmit(now, &t.contents);
                    out.push(Datagram { source: t.source, destination: t.destination, data: t.contents.into() });
                }
                Ok(Output::Event(e)) => self.on_event(e, now),
                Err(e) => {
                    self.fail(format!("str0m : {e}"));
                    return now + Duration::from_millis(100);
                }
            }
        }
    }

    /// Effets accumulés depuis le dernier appel.
    pub fn take_effects(&mut self) -> Effects {
        std::mem::take(&mut self.effects)
    }

    /// Termine la session sur une erreur affichée à l'hôte.
    pub fn fail_with(&mut self, error: String) {
        self.fail(error);
    }

    fn fail(&mut self, error: String) {
        if self.stats.error.is_none() {
            self.stats.error = Some(error);
        }
        self.close();
    }

    /// Ferme la session : relâche tout ce que l'invité tenait.
    pub fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.effects.closed = true;
        self.stats.connected = false;
        if self.stats.state != "failed" {
            self.stats.state = "closed".into();
        }
        let released = self.handler.leave();
        self.count(released);
        self.rtc.disconnect();
    }

    fn count(&mut self, done: Vec<Done>) {
        for d in done {
            match d {
                Ok(_) => self.stats.inputs.injected += 1,
                Err(_) => self.stats.inputs.failed += 1,
            }
        }
    }

    fn on_event(&mut self, e: Event, now: Instant) {
        match e {
            Event::IceConnectionStateChange(s) => {
                self.stats.state = state_name(s).into();
                if s == IceConnectionState::Disconnected {
                    self.close();
                }
            }
            Event::Connected => {
                self.stats.connected = true;
                self.stats.connect_ms = Some(now.duration_since(self.started).as_secs_f64() * 1000.0);
                self.effects.connected = true;
                self.effects.keyframe = true;
            }
            Event::ChannelOpen(id, label) => {
                if let Some(ch) = Channel::from_label(&label) {
                    self.channels.insert(id, ch);
                    if ch == Channel::Control {
                        self.control = Some(id);
                    }
                }
            }
            Event::ChannelClose(id) => {
                self.channels.remove(&id);
            }
            Event::ChannelData(d) => {
                self.stats.inputs.received += 1;
                let Some(&ch) = self.channels.get(&d.id) else {
                    self.stats.inputs.rejected += 1;
                    return;
                };
                match router::route(ch, d.binary, &d.data) {
                    Err(_) => self.stats.inputs.rejected += 1,
                    // RTT applicatif : l'hôte renvoie le ping tel quel, sans passer par l'injection
                    Ok(Message::Ping { id, micros }) => {
                        self.stats.inputs.pings += 1;
                        self.send_control(&Message::Pong { id, micros });
                    }
                    // latence mesurée par l'invité : affichée telle quelle à l'hôte, bornée
                    Ok(Message::Report { total_micros, guest_micros }) => {
                        let ms = |us: u32| (us <= 10_000_000).then(|| us as f64 / 1000.0);
                        self.stats.guest_latency_ms = ms(total_micros);
                        self.stats.guest_display_ms = ms(guest_micros);
                    }
                    Ok(msg) => match self.handler.handle(msg) {
                        Ok(done) => {
                            self.count(done);
                            if let Some(at) = self.last_rx {
                                self.input_us.push(now, Instant::now().saturating_duration_since(at).as_micros() as u64);
                            }
                        }
                        Err(_) => self.stats.inputs.denied += 1,
                    },
                }
            }
            Event::KeyframeRequest(_) => {
                // l'image clé partie il y a un instant répond déjà à cette demande
                if self.last_keyframe.is_some_and(|t| now.saturating_duration_since(t) < KEYFRAME_MIN_INTERVAL) {
                    self.stats.keyframes_throttled += 1;
                } else {
                    self.effects.keyframe = true;
                    self.last_keyframe = Some(now);
                }
            }
            Event::EgressBitrateEstimate(BweKind::Twcc { estimate, .. }) => {
                self.stats.bwe_kbps = Some(estimate.as_u64() / 1000);
                if let Some(kbps) = self.rate.on_estimate(estimate.as_u64(), self.last_loss, now) {
                    self.effects.bitrate_kbps = Some(kbps);
                    self.stats.target_kbps = kbps;
                    self.stats.bitrate_changes += 1;
                }
            }
            Event::PeerStats(s) => {
                self.stats.rtt_ms = s.rtt.map(|d| d.as_secs_f64() * 1000.0);
                // aller-retour du dernier paquet vidéo dont l'invité a accusé réception : il
                // grandit dès qu'une file se forme sur le trajet
                if let Some(rtt) = s.rtt.filter(|_| !crate::remote_play::lever_off("delay")) {
                    if let Some(kbps) = self.rate.on_rtt(rtt, now) {
                        self.effects.bitrate_kbps = Some(kbps);
                        self.stats.target_kbps = kbps;
                        self.stats.bitrate_changes += 1;
                        self.stats.delay_backoffs += 1;
                    }
                }
                if let Some(l) = s.egress_loss_fraction {
                    self.last_loss = Some(l);
                    self.stats.loss_pct = Some(l as f64 * 100.0);
                }
                if let Some(pair) = &s.selected_candidate_pair {
                    self.stats.local_candidate = Some(network_kind(&pair.local.addr).into());
                    let remote = network_kind(&pair.remote.addr);
                    self.stats.remote_candidate = Some(remote.into());
                    // type de connexion affiché : l'adresse du pair dit si l'on passe par Internet
                    self.stats.path = Some(match remote {
                        "loopback" => "loopback",
                        "lan" => "lan",
                        _ => "internet",
                    }.into());
                }
                self.last_bytes_tx = Some(s.bytes_tx);
            }
            Event::MediaEgressStats(s) if s.mid == self.video => {
                self.stats.plis = s.plis;
                self.stats.firs = s.firs;
                self.stats.nacks = s.nacks;
                if let Some(r) = &s.remote {
                    self.stats.packets_lost = Some(r.packets_lost);
                    self.stats.jitter_ms = Some(jitter_ms(r.jitter, VIDEO_CLOCK_HZ));
                }
                if self.stats.rtt_ms.is_none() {
                    self.stats.rtt_ms = s.rtt.map(|d| d.as_secs_f64() * 1000.0);
                }
                if let Some(rtt) = s.rtt {
                    self.stats.media_rtt_ms = Some(rtt.as_secs_f64() * 1000.0);
                }
            }
            _ => {}
        }
    }

    pub fn stats(&mut self, now: Instant) -> TransportStats {
        let mut s = self.stats.clone();
        s.elapsed_s = now.duration_since(self.started).as_secs_f64();
        s.fps = self.frames.rate(now);
        s.sent_kbps = self.bytes.per_second(now) * 8.0 / 1000.0;
        if let Some((p50, max)) = median_max_ms(self.encode_us.values(now)) {
            s.encode_ms_p50 = Some(p50);
            s.encode_ms_max = Some(max);
        }
        s.capture_wait_ms_p50 = median_max_ms(self.wait_us.values(now)).map(|m| m.0);
        if let Some((p50, max)) = median_max_ms(self.queue_us.values(now)) {
            s.send_queue_ms_p50 = Some(p50);
            s.send_queue_ms_max = Some(max);
        }
        if let Some((p50, max)) = median_max_ms(self.host_us.values(now)) {
            s.host_ms_p50 = Some(p50);
            s.host_ms_max = Some(max);
        }
        if let Some((p50, max)) = median_max_ms(self.input_us.values(now)) {
            s.input_ms_p50 = Some(p50);
            s.input_ms_max = Some(max);
        }
        s
    }

    /// Renseigne l'encodeur réellement ouvert (affichage).
    pub fn set_encoder(&mut self, name: String, resolution: (u32, u32), startup: Duration) {
        self.stats.encoder = Some(name);
        self.stats.resolution = Some(resolution);
        self.stats.video_start_ms = Some(startup.as_secs_f64() * 1000.0);
    }

    pub fn current_kbps(&self) -> u32 {
        self.rate.current_kbps()
    }
}
