//! Statistiques réelles de la session côté hôte : tout vient de str0m (RTCP de l'invité, TWCC)
//! ou de ce que l'hôte a réellement envoyé. Une valeur inconnue reste `None`, jamais inventée.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use serde::Serialize;

/// Horloge RTP de la vidéo (H.264) : 90 kHz.
pub const VIDEO_CLOCK_HZ: u32 = 90_000;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputCounters {
    /// Messages reçus sur les DataChannels.
    pub received: u64,
    /// Rejetés avant les permissions (taille, décodage, mauvais canal).
    pub rejected: u64,
    /// Refusés par `Session::authorize`.
    pub denied: u64,
    /// Actions injectées (ou ignorées pour priorité locale) / refusées par Windows.
    pub injected: u64,
    pub failed: u64,
    pub pings: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportStats {
    /// `new`, `checking`, `connected`, `completed`, `disconnected`, `closed` (ICE) ou `failed`.
    pub state: String,
    pub connected: bool,
    pub error: Option<String>,
    /// Délai entre la création de l'offre et la connexion DTLS établie.
    pub connect_ms: Option<f64>,
    pub elapsed_s: f64,
    pub rtt_ms: Option<f64>,
    /// Fraction de paquets perdus vue par l'invité (RTCP), en %.
    pub loss_pct: Option<f64>,
    pub packets_lost: Option<u64>,
    /// Gigue d'arrivée mesurée par l'invité (RTCP), en ms.
    pub jitter_ms: Option<f64>,
    /// Estimation de bande passante (TWCC) et consigne de l'encodeur.
    pub bwe_kbps: Option<u64>,
    pub target_kbps: u32,
    /// Débit réellement émis (tout compris : RTP, RTCP, SCTP) sur la dernière fenêtre.
    pub sent_kbps: f64,
    /// Images vidéo envoyées par seconde sur la dernière fenêtre.
    pub fps: f64,
    pub frames: u64,
    pub keyframes: u64,
    pub plis: u64,
    pub firs: u64,
    pub nacks: u64,
    pub bitrate_changes: u32,
    pub encoder: Option<String>,
    pub resolution: Option<(u32, u32)>,
    /// Envoi à l'encodeur → paquet remis à str0m, dernière fenêtre (ms) : médiane / max.
    pub encode_ms_p50: Option<f64>,
    pub encode_ms_max: Option<f64>,
    /// Type de la paire ICE retenue (`host`, `prflx`, `srflx`, `relay`) — jamais l'adresse.
    pub local_candidate: Option<String>,
    pub remote_candidate: Option<String>,
    /// Type de connexion de la paire retenue : `loopback`, `lan` (réseau local) ou `internet`
    /// (P2P direct par Internet ; iBox n'a jamais de relais).
    pub path: Option<String>,
    /// Comportement du NAT vu par STUN, IPv4 et IPv6 (session Internet seulement).
    pub nat_v4: Option<super::stun::NatKind>,
    pub nat_v6: Option<super::stun::NatKind>,
    pub inputs: InputCounters,
}

/// Événements datés sur une fenêtre glissante (images, octets).
#[derive(Debug, Clone)]
pub struct Meter {
    window: Duration,
    events: VecDeque<(Instant, u64)>,
}

impl Meter {
    pub fn new(window: Duration) -> Self {
        Meter { window, events: VecDeque::new() }
    }

    pub fn push(&mut self, at: Instant, amount: u64) {
        self.events.push_back((at, amount));
        self.trim(at);
    }

    fn trim(&mut self, now: Instant) {
        while self.events.front().is_some_and(|(t, _)| now.saturating_duration_since(*t) > self.window) {
            self.events.pop_front();
        }
    }

    /// Nombre d'événements par seconde sur la fenêtre.
    pub fn rate(&mut self, now: Instant) -> f64 {
        self.trim(now);
        self.events.len() as f64 / self.window.as_secs_f64()
    }

    /// Somme des quantités par seconde sur la fenêtre.
    pub fn per_second(&mut self, now: Instant) -> f64 {
        self.trim(now);
        self.events.iter().map(|(_, a)| *a).sum::<u64>() as f64 / self.window.as_secs_f64()
    }

    pub fn values(&mut self, now: Instant) -> Vec<u64> {
        self.trim(now);
        self.events.iter().map(|(_, a)| *a).collect()
    }
}

/// Gigue RTCP (unités d'horloge RTP) → millisecondes.
pub fn jitter_ms(jitter_ticks: u32, clock_hz: u32) -> f64 {
    jitter_ticks as f64 * 1000.0 / clock_hz as f64
}

/// Horodatage de l'encodeur (100 ns) → temps RTP 90 kHz.
pub fn pts_to_90khz(pts_100ns: i64) -> u64 {
    (pts_100ns.max(0) as u64) * 9 / 1000
}

/// Médiane et maximum, en ms, de durées exprimées en µs.
pub fn median_max_ms(mut micros: Vec<u64>) -> Option<(f64, f64)> {
    if micros.is_empty() {
        return None;
    }
    micros.sort_unstable();
    Some((micros[micros.len() / 2] as f64 / 1000.0, *micros.last()? as f64 / 1000.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fenetre_glissante() {
        let mut m = Meter::new(Duration::from_secs(1));
        let t = Instant::now();
        for i in 0..60 {
            m.push(t + Duration::from_millis(i * 16), 10_000);
        }
        let now = t + Duration::from_millis(59 * 16);
        assert_eq!(m.rate(now), 60.0);
        assert_eq!(m.per_second(now), 600_000.0);
        // 2 s plus tard, plus rien dans la fenêtre
        assert_eq!(m.rate(now + Duration::from_secs(2)), 0.0);
    }

    #[test]
    fn conversions() {
        assert_eq!(jitter_ms(90, VIDEO_CLOCK_HZ), 1.0);
        assert_eq!(pts_to_90khz(10_000_000), 90_000, "1 s");
        assert_eq!(pts_to_90khz(166_667), 1_500, "≈ 1/60 s");
        assert_eq!(pts_to_90khz(-5), 0);
        assert_eq!(median_max_ms(vec![4000, 3000, 9000]), Some((4.0, 9.0)));
        assert_eq!(median_max_ms(vec![]), None);
    }
}
