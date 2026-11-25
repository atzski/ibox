//! Essais seulement : lien simulé entre l'hôte et l'invité, pour mesurer sur un seul PC ce
//! qu'une connexion limitée change (débit, délai fixe, pertes, file bornée du goulot).
//!
//! Modèle : un goulot de débit `kbps` suivi d'un délai fixe. Un paquet attend que le goulot ait
//! écoulé les précédents (file bornée à `queue` : au-delà il est jeté, comme par un routeur), puis
//! le traverse en `taille / débit`. Seul le sens hôte → invité est simulé ; les retours de
//! l'invité (RTCP, commandes) arrivent sans retard. Le fil attend activement la dernière
//! milliseconde : précision ≈ 0,1 ms, au prix d'un cœur occupé pendant l'essai.

use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, UdpSocket};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::peer::Datagram;

#[derive(Debug, Clone, PartialEq)]
pub struct Spec {
    /// Débit du goulot (kbit/s) ; 0 = sans limite.
    pub kbps: u32,
    pub delay: Duration,
    /// Fraction de paquets perdus au hasard (0–1).
    pub loss: f64,
    /// File maximale du goulot.
    pub queue: Duration,
    /// Changement de débit en cours d'essai : (instant depuis le premier paquet, nouveau débit).
    pub step: Option<(Duration, u32)>,
}

impl Default for Spec {
    fn default() -> Self {
        Spec { kbps: 0, delay: Duration::ZERO, loss: 0.0, queue: Duration::from_millis(300), step: None }
    }
}

impl Spec {
    /// `kbps=8000,delay=20,loss=1.5,queue=300,step=5:3000` (délais en ms, pertes en %, palier en s:kbit/s).
    pub fn parse(text: &str) -> Option<Spec> {
        let mut spec = Spec::default();
        for part in text.split(',').map(str::trim).filter(|p| !p.is_empty()) {
            let (key, value) = part.split_once('=')?;
            match key.trim() {
                "kbps" => spec.kbps = value.parse().ok()?,
                "delay" => spec.delay = Duration::from_secs_f64(value.parse::<f64>().ok()? / 1000.0),
                "loss" => spec.loss = value.parse::<f64>().ok()? / 100.0,
                "queue" => spec.queue = Duration::from_secs_f64(value.parse::<f64>().ok()? / 1000.0),
                "step" => {
                    let (at, kbps) = value.split_once(':')?;
                    spec.step = Some((Duration::from_secs_f64(at.parse().ok()?), kbps.parse().ok()?));
                }
                _ => return None,
            }
        }
        Some(spec)
    }
}

/// Décision du goulot pour un paquet arrivé à `now` : instant de sortie, ou `None` s'il est jeté.
#[derive(Debug)]
pub struct Bottleneck {
    spec: Spec,
    started: Option<Instant>,
    busy_until: Option<Instant>,
    rng: u64,
    pub dropped: u64,
}

impl Bottleneck {
    pub fn new(spec: Spec) -> Self {
        Bottleneck { spec, started: None, busy_until: None, rng: 0x9E37_79B9_7F4A_7C15, dropped: 0 }
    }

    fn random(&mut self) -> f64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 11) as f64 / (1u64 << 53) as f64
    }

    pub fn admit(&mut self, now: Instant, bytes: usize) -> Option<Instant> {
        let started = *self.started.get_or_insert(now);
        if self.spec.loss > 0.0 && self.random() < self.spec.loss {
            self.dropped += 1;
            return None;
        }
        let kbps = match self.spec.step {
            Some((at, kbps)) if now.duration_since(started) >= at => kbps,
            _ => self.spec.kbps,
        };
        if kbps == 0 {
            return Some(now + self.spec.delay);
        }
        let start = self.busy_until.map_or(now, |b| b.max(now));
        if start.duration_since(now) > self.spec.queue {
            self.dropped += 1;
            return None;
        }
        let done = start + Duration::from_secs_f64(bytes as f64 * 8.0 / (kbps as f64 * 1000.0));
        self.busy_until = Some(done);
        Some(done + self.spec.delay)
    }
}

type Packet = (Arc<UdpSocket>, Datagram);

pub struct Link {
    tx: Sender<Packet>,
    sockets: Mutex<HashMap<SocketAddr, Arc<UdpSocket>>>,
}

impl Link {
    pub fn start(spec: Spec) -> Link {
        let (tx, rx) = mpsc::channel::<Packet>();
        std::thread::Builder::new()
            .name("remote-play-test-link".into())
            .spawn(move || {
                let mut goulot = Bottleneck::new(spec);
                let mut queue: VecDeque<(Instant, Packet)> = VecDeque::new();
                loop {
                    let now = Instant::now();
                    while queue.front().is_some_and(|(at, _)| *at <= now) {
                        let (_, (socket, d)) = queue.pop_front().expect("file non vide");
                        let _ = socket.send_to(&d.data, d.destination);
                    }
                    let wait = queue.front().map(|(at, _)| at.saturating_duration_since(Instant::now()));
                    let received = match wait {
                        // dernière milliseconde : attente active (les attentes de Windows sont à 1 ms près)
                        Some(w) if w < Duration::from_millis(1) => rx.try_recv().map_err(|e| match e {
                            mpsc::TryRecvError::Empty => RecvTimeoutError::Timeout,
                            mpsc::TryRecvError::Disconnected => RecvTimeoutError::Disconnected,
                        }),
                        Some(w) => rx.recv_timeout(w - Duration::from_millis(1)),
                        None => rx.recv_timeout(Duration::from_millis(50)),
                    };
                    match received {
                        Ok(packet) => {
                            if let Some(at) = goulot.admit(Instant::now(), packet.1.data.len()) {
                                queue.push_back((at, packet));
                            }
                        }
                        Err(RecvTimeoutError::Timeout) => std::hint::spin_loop(),
                        Err(RecvTimeoutError::Disconnected) if queue.is_empty() => return,
                        Err(RecvTimeoutError::Disconnected) => std::hint::spin_loop(),
                    }
                }
            })
            .expect("fil du lien simulé");
        Link { tx, sockets: Mutex::new(HashMap::new()) }
    }

    /// Confie un paquet au lien ; il sortira par une copie de `socket`.
    pub fn send(&self, socket: &UdpSocket, d: Datagram) {
        let Ok(mut sockets) = self.sockets.lock() else { return };
        let shared = match sockets.get(&d.source) {
            Some(s) => s.clone(),
            None => {
                let Ok(clone) = socket.try_clone() else { return };
                sockets.entry(d.source).or_insert(Arc::new(clone)).clone()
            }
        };
        let _ = self.tx.send((shared, d));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lecture_des_reglages() {
        let s = Spec::parse("kbps=8000, delay=20,loss=1.5,queue=250,step=5:3000").unwrap();
        assert_eq!(s, Spec { kbps: 8000, delay: Duration::from_millis(20), loss: 0.015, queue: Duration::from_millis(250), step: Some((Duration::from_secs(5), 3000)) });
        assert_eq!(Spec::parse("").unwrap(), Spec::default());
        assert!(Spec::parse("debit=3").is_none());
    }

    #[test]
    fn le_goulot_etale_puis_jette() {
        // 8 Mbit/s : 1 000 octets = 1 ms ; file de 10 ms
        let t = Instant::now();
        let mut g = Bottleneck::new(Spec { kbps: 8000, delay: Duration::from_millis(20), queue: Duration::from_millis(10), ..Spec::default() });
        assert_eq!(g.admit(t, 1000), Some(t + Duration::from_millis(21)));
        // rafale : chaque paquet sort 1 ms après le précédent
        assert_eq!(g.admit(t, 1000), Some(t + Duration::from_millis(22)));
        for _ in 0..9 {
            assert!(g.admit(t, 1000).is_some());
        }
        // 11 ms de file : jeté
        assert_eq!(g.admit(t, 1000), None);
        assert_eq!(g.dropped, 1);
        // le goulot vidé, plus d'attente
        let later = t + Duration::from_millis(50);
        assert_eq!(g.admit(later, 500), Some(later + Duration::from_micros(20_500)));
    }

    #[test]
    fn palier_de_debit_et_pertes() {
        let t = Instant::now();
        let mut g = Bottleneck::new(Spec { kbps: 8000, step: Some((Duration::from_secs(1), 800)), ..Spec::default() });
        assert_eq!(g.admit(t, 1000), Some(t + Duration::from_millis(1)));
        let later = t + Duration::from_secs(2);
        assert_eq!(g.admit(later, 1000), Some(later + Duration::from_millis(10)));
        let mut g = Bottleneck::new(Spec { loss: 0.2, ..Spec::default() });
        let kept = (0..10_000).filter(|_| g.admit(t, 100).is_some()).count();
        assert!((7_700..=8_300).contains(&kept), "{kept} paquets gardés sur 10 000 à 20 % de pertes");
    }
}
