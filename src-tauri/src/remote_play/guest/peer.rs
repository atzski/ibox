//! Côté invité d'une session, **sans aucune E/S** (option A, docs/STEAMDECK.md §6.2) : machine à
//! états autour de `str0m::Rtc`. Il répond à l'offre de l'hôte Windows actuel, reçoit les images
//! H.264 reconstituées et le son Opus, écrit sur les DataChannels `input` et `control` créés par
//! l'hôte, et redemande une image clé quand le flux est interrompu. Les paquets UDP et l'horloge
//! sont fournis par l'appelant (`run.rs` en vrai, les tests en mémoire).

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::channel::ChannelId;
use str0m::media::{KeyframeRequestKind, MediaKind, Mid};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, IceConnectionState, Input, Output, Rtc, RtcConfig};

use crate::remote_play::transport::stats::{jitter_ms, Meter, VIDEO_CLOCK_HZ};

/// Libellés des DataChannels ouverts par l'hôte (`transport/router.rs`).
pub const INPUT_LABEL: &str = "input";
pub const CONTROL_LABEL: &str = "control";
/// Intervalle minimal entre deux demandes d'image clé (une IDR 4K pèse plusieurs centaines de Ko).
pub const KEYFRAME_COOLDOWN: Duration = Duration::from_millis(500);

/// Paquet UDP à émettre.
#[derive(Debug, Clone)]
pub struct Datagram {
    pub source: SocketAddr,
    pub destination: SocketAddr,
    pub data: Vec<u8>,
}

/// Ce que l'invité remonte à l'interface.
#[derive(Debug, Clone, PartialEq)]
pub enum GuestEvent {
    Connected,
    Disconnected,
    /// Image H.264 complète (Annex B), temps RTP à 90 kHz.
    Video { data: Vec<u8>, rtp_time: u64, keyframe: bool, arrived: Instant },
    /// Paquet Opus, temps RTP à 48 kHz.
    Audio { data: Vec<u8>, rtp_time: u64 },
    /// Message reçu sur `control` (protocole `protocol.rs`).
    Control(Vec<u8>),
}

/// Statistiques de réception (remplacent `getStats()` du WebView).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestStats {
    pub connected: bool,
    pub connect_ms: Option<u64>,
    pub frames: u64,
    pub keyframes: u64,
    /// Images reçues après une interruption du flux (perte non réparée).
    pub gaps: u64,
    pub keyframe_requests: u64,
    pub fps: f64,
    pub kbps: f64,
    pub rtt_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub loss: Option<f32>,
    pub nacks: u64,
}

pub struct GuestPeer {
    rtc: Rtc,
    started: Instant,
    video: Option<Mid>,
    audio: Option<Mid>,
    input: Option<ChannelId>,
    control: Option<ChannelId>,
    /// Une image clé est attendue : les images suivantes ne sont pas décodables seules.
    need_keyframe: bool,
    last_request: Option<Instant>,
    stats: GuestStats,
    frames_meter: Meter,
    bytes_meter: Meter,
}

/// Type d'unité NAL de chaque unité d'une image Annex B.
fn nal_types(data: &[u8]) -> impl Iterator<Item = u8> + '_ {
    let mut i = 0;
    std::iter::from_fn(move || {
        while i + 3 <= data.len() {
            let start3 = data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1;
            i += 1;
            if start3 && i + 2 < data.len() {
                i += 2;
                return Some(data[i] & 0x1f);
            }
        }
        None
    })
}

/// Image clé : une tranche IDR (5), précédée en pratique de SPS (7) et PPS (8).
pub fn is_keyframe(data: &[u8]) -> bool {
    nal_types(data).any(|t| t == 5)
}

impl GuestPeer {
    /// Répond à l'offre de l'hôte. `locals` : candidats de cet appareil (adresses de ses sockets
    /// et, sur Internet, adresses publiques vues par STUN). Renvoie la réponse SDP à signer.
    pub fn new(offer: &str, locals: &[Candidate], now: Instant) -> Result<(GuestPeer, String), String> {
        let mut rtc = RtcConfig::new()
            .clear_codecs()
            .enable_h264(true)
            .enable_opus(true, false)
            .set_stats_interval(Some(Duration::from_secs(1)))
            .build(now);
        for c in locals {
            rtc.add_local_candidate(c.clone());
        }
        let offer = SdpOffer::from_sdp_string(offer).map_err(|e| format!("offre de l'hôte illisible : {e}"))?;
        let answer = rtc.sdp_api().accept_offer(offer).map_err(|e| format!("offre de l'hôte refusée : {e}"))?;
        let peer = GuestPeer {
            rtc,
            started: now,
            video: None,
            audio: None,
            input: None,
            control: None,
            need_keyframe: true,
            last_request: None,
            stats: GuestStats::default(),
            frames_meter: Meter::new(Duration::from_secs(1)),
            bytes_meter: Meter::new(Duration::from_secs(1)),
        };
        Ok((peer, answer.to_sdp_string()))
    }

    /// Candidat distant reçu après coup (ICE progressif).
    pub fn add_remote_candidate(&mut self, line: &str) -> Result<(), String> {
        let c = Candidate::from_sdp_string(line.trim().trim_start_matches("a=")).map_err(|e| format!("candidat invalide : {e}"))?;
        self.rtc.add_remote_candidate(c);
        Ok(())
    }

    pub fn receive(&mut self, now: Instant, source: SocketAddr, destination: SocketAddr, data: &[u8]) {
        let Ok(contents) = data.try_into() else { return };
        let input = Input::Receive(now, Receive { proto: Protocol::Udp, source, destination, contents });
        if self.rtc.accepts(&input) {
            let _ = self.rtc.handle_input(input);
        }
    }

    pub fn tick(&mut self, now: Instant) {
        let _ = self.rtc.handle_input(Input::Timeout(now));
    }

    /// Vide les sorties de str0m. Renvoie l'instant du prochain réveil.
    pub fn poll(&mut self, now: Instant, out: &mut Vec<Datagram>, events: &mut Vec<GuestEvent>) -> Instant {
        loop {
            match self.rtc.poll_output() {
                Ok(Output::Timeout(t)) => return t,
                Ok(Output::Transmit(t)) => out.push(Datagram { source: t.source, destination: t.destination, data: t.contents.into() }),
                Ok(Output::Event(e)) => self.on_event(now, e, events),
                Err(_) => return now + Duration::from_millis(10),
            }
        }
    }

    fn on_event(&mut self, now: Instant, e: Event, events: &mut Vec<GuestEvent>) {
        match e {
            Event::Connected => {
                self.stats.connected = true;
                self.stats.connect_ms = Some(now.saturating_duration_since(self.started).as_millis() as u64);
                events.push(GuestEvent::Connected);
            }
            Event::IceConnectionStateChange(IceConnectionState::Disconnected) => {
                self.stats.connected = false;
                events.push(GuestEvent::Disconnected);
            }
            Event::MediaAdded(m) => match m.kind {
                MediaKind::Video => self.video = Some(m.mid),
                MediaKind::Audio => self.audio = Some(m.mid),
            },
            Event::ChannelOpen(id, label) => match label.as_str() {
                INPUT_LABEL => self.input = Some(id),
                CONTROL_LABEL => self.control = Some(id),
                _ => {}
            },
            Event::ChannelData(d) if Some(d.id) == self.control => events.push(GuestEvent::Control(d.data)),
            Event::MediaData(m) if Some(m.mid) == self.video => {
                let keyframe = is_keyframe(&m.data);
                if !m.contiguous {
                    self.stats.gaps += 1;
                    self.need_keyframe = true;
                }
                if keyframe {
                    self.need_keyframe = false;
                    self.stats.keyframes += 1;
                } else if self.need_keyframe {
                    // image non décodable seule : on la jette et on redemande une image clé
                    self.request_keyframe(now);
                    return;
                }
                self.stats.frames += 1;
                self.frames_meter.push(now, 1);
                self.bytes_meter.push(now, m.data.len() as u64);
                events.push(GuestEvent::Video { data: m.data.to_vec(), rtp_time: m.time.numer() as u64, keyframe, arrived: m.network_time });
            }
            Event::MediaData(m) if Some(m.mid) == self.audio => {
                events.push(GuestEvent::Audio { data: m.data.to_vec(), rtp_time: m.time.numer() as u64 });
            }
            Event::MediaIngressStats(s) if Some(s.mid) == self.video => {
                self.stats.rtt_ms = s.rtt.map(|d| d.as_secs_f64() * 1000.0);
                self.stats.jitter_ms = Some(jitter_ms(s.jitter, VIDEO_CLOCK_HZ));
                self.stats.loss = s.loss;
                self.stats.nacks = s.nacks;
            }
            _ => {}
        }
    }

    /// Demande une image clé à l'hôte (PLI), au plus une fois par `KEYFRAME_COOLDOWN`.
    pub fn request_keyframe(&mut self, now: Instant) -> bool {
        if self.last_request.is_some_and(|t| now.saturating_duration_since(t) < KEYFRAME_COOLDOWN) {
            return false;
        }
        let Some(mid) = self.video else { return false };
        let Some(mut w) = self.rtc.writer(mid) else { return false };
        if w.request_keyframe(None, KeyframeRequestKind::Pli).is_err() {
            return false;
        }
        self.last_request = Some(now);
        self.stats.keyframe_requests += 1;
        true
    }

    /// Écrit sur `input` (non fiable) ou `control` (fiable). `false` si le canal n'est pas ouvert.
    pub fn send(&mut self, label: &str, bytes: &[u8]) -> bool {
        let id = match label {
            INPUT_LABEL => self.input,
            CONTROL_LABEL => self.control,
            _ => None,
        };
        let Some(id) = id else { return false };
        self.rtc.channel(id).is_some_and(|mut c| c.write(true, bytes).is_ok())
    }

    pub fn channels_open(&self) -> bool {
        self.input.is_some() && self.control.is_some()
    }

    pub fn stats(&mut self, now: Instant) -> GuestStats {
        let mut s = self.stats.clone();
        s.fps = self.frames_meter.rate(now);
        s.kbps = self.bytes_meter.per_second(now) * 8.0 / 1000.0;
        s
    }

    pub fn close(&mut self) {
        self.rtc.disconnect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_cles_reconnues() {
        let idr = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65, 9, 9];
        assert!(is_keyframe(&idr));
        assert!(!is_keyframe(&[0, 0, 0, 1, 0x41, 0x9a, 2]));
        assert!(!is_keyframe(&[]));
        assert_eq!(nal_types(&idr).collect::<Vec<_>>(), [7, 8, 5]);
    }
}
