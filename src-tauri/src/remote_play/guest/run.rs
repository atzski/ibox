//! Fil réseau de l'invité natif : une socket UDP IPv4, la boucle str0m de `peer.rs`, et les
//! événements remis à l'appelant (le pont vers le WebView dans `mod.rs`, ou un test).

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use str0m::Candidate;

use super::peer::{Datagram, GuestEvent, GuestPeer, GuestStats};
use crate::remote_play::transport::stun;

/// Tampons de la socket : une IDR 4K arrive en rafale de plusieurs centaines de Ko (comme l'hôte).
pub const SOCKET_BUFFER: i32 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
pub struct Options {
    /// Serveurs `stun:` (candidats publics pour une session sur Internet).
    pub stun_servers: Vec<String>,
    /// Candidat 127.0.0.1 : hôte sur le même ordinateur (essais).
    pub loopback: bool,
}

enum Cmd {
    Send(&'static str, Vec<u8>),
    Keyframe,
    Candidate(String),
    Stop,
}

pub struct NativeGuest {
    tx: Sender<Cmd>,
    stats: Arc<Mutex<GuestStats>>,
    join: Mutex<Option<JoinHandle<()>>>,
    answer: String,
}

/// Adresse IPv4 de l'interface qui porte la route par défaut (aucun paquet émis).
pub fn lan_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    s.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() && !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

/// Agrandit les tampons d'émission et de réception. Renvoie la taille acceptée en réception.
pub fn set_socket_buffers(socket: &UdpSocket, bytes: i32) -> i32 {
    #[cfg(windows)]
    {
        crate::remote_play::transport::host::set_socket_buffers(socket, bytes)
    }
    #[cfg(unix)]
    unsafe {
        use std::os::fd::AsRawFd;
        let fd = socket.as_raw_fd();
        let value = bytes;
        let size = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVBUF, (&value as *const i32).cast(), size);
        libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_SNDBUF, (&value as *const i32).cast(), size);
        let mut got: libc::c_int = 0;
        let mut len = size;
        libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_RCVBUF, (&mut got as *mut i32).cast(), &mut len);
        got
    }
}

impl NativeGuest {
    /// Ouvre la socket, rassemble les candidats, répond à l'offre et lance le fil réseau.
    /// `sink` reçoit chaque événement depuis ce fil (il ne doit pas bloquer).
    pub fn start(offer: &str, opts: Options, sink: impl FnMut(GuestEvent) + Send + 'static) -> Result<NativeGuest, String> {
        let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|e| format!("socket UDP : {e}"))?;
        set_socket_buffers(&socket, SOCKET_BUFFER);
        let port = socket.local_addr().map_err(|e| e.to_string())?.port();
        let lan = lan_ipv4().map(|ip| SocketAddr::new(IpAddr::V4(ip), port));
        let loopback = opts.loopback.then(|| SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port));
        if lan.is_none() && loopback.is_none() {
            return Err("aucune adresse réseau locale".into());
        }
        let mut candidates: Vec<Candidate> = Vec::new();
        for addr in lan.iter().chain(loopback.iter()) {
            candidates.push(Candidate::host(*addr, "udp").map_err(|e| e.to_string())?);
        }
        if let Some(base) = lan {
            let servers = stun::resolve(&opts.stun_servers, false);
            for public in stun::gather(&socket, &servers, Duration::from_millis(1200)).reflexive() {
                if let Ok(c) = Candidate::server_reflexive(public, base, "udp") {
                    candidates.push(c);
                }
            }
        }
        let (peer, answer) = GuestPeer::new(offer, &candidates, Instant::now())?;
        let stats: Arc<Mutex<GuestStats>> = Arc::default();
        let (tx, rx) = mpsc::channel();
        let shared = stats.clone();
        let join = std::thread::Builder::new()
            .name("rp-invite".into())
            .spawn(move || {
                crate::remote_play::latency_critical_thread();
                run(peer, socket, lan, loopback, rx, shared, sink)
            })
            .map_err(|e| e.to_string())?;
        Ok(NativeGuest { tx, stats, join: Mutex::new(Some(join)), answer })
    }

    /// Réponse SDP (candidats inclus), à transmettre à l'hôte par la signalisation.
    pub fn answer(&self) -> &str {
        &self.answer
    }

    pub fn send(&self, label: &'static str, bytes: Vec<u8>) {
        let _ = self.tx.send(Cmd::Send(label, bytes));
    }

    pub fn request_keyframe(&self) {
        let _ = self.tx.send(Cmd::Keyframe);
    }

    pub fn add_remote_candidate(&self, line: String) {
        let _ = self.tx.send(Cmd::Candidate(line));
    }

    pub fn stats(&self) -> GuestStats {
        self.stats.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn stop(&self) -> GuestStats {
        let _ = self.tx.send(Cmd::Stop);
        if let Some(j) = self.join.lock().ok().and_then(|mut j| j.take()) {
            let _ = j.join();
        }
        self.stats()
    }
}

impl Drop for NativeGuest {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(
    mut peer: GuestPeer,
    socket: UdpSocket,
    lan: Option<SocketAddr>,
    loopback: Option<SocketAddr>,
    rx: Receiver<Cmd>,
    shared: Arc<Mutex<GuestStats>>,
    mut sink: impl FnMut(GuestEvent),
) {
    let mut buf = vec![0u8; 2048];
    let mut out: Vec<Datagram> = Vec::new();
    let mut events: Vec<GuestEvent> = Vec::new();
    let mut next_stats = Instant::now();
    loop {
        loop {
            match rx.try_recv() {
                Ok(Cmd::Send(label, bytes)) => {
                    peer.send(label, &bytes);
                }
                Ok(Cmd::Keyframe) => {
                    peer.request_keyframe(Instant::now());
                }
                Ok(Cmd::Candidate(line)) => {
                    let _ = peer.add_remote_candidate(&line);
                }
                Ok(Cmd::Stop) | Err(TryRecvError::Disconnected) => {
                    peer.close();
                    return;
                }
                Err(TryRecvError::Empty) => break,
            }
        }
        let now = Instant::now();
        peer.tick(now);
        let timeout = peer.poll(now, &mut out, &mut events);
        for d in out.drain(..) {
            let _ = socket.send_to(&d.data, d.destination);
        }
        for e in events.drain(..) {
            sink(e);
        }
        if now >= next_stats {
            next_stats = now + Duration::from_millis(250);
            if let Ok(mut s) = shared.lock() {
                *s = peer.stats(now);
            }
        }
        // réveil au plus tard dans 5 ms pour traiter les commandes (entrées de la manette)
        let wait = timeout.saturating_duration_since(Instant::now()).clamp(Duration::from_millis(1), Duration::from_millis(5));
        let _ = socket.set_nonblocking(false);
        let _ = socket.set_read_timeout(Some(wait));
        let mut first = true;
        while let Ok((n, source)) = socket.recv_from(&mut buf) {
            if let Some(destination) = local_for(source, lan, loopback) {
                peer.receive(Instant::now(), source, destination, &buf[..n]);
            }
            // rafale : la socket est vidée sans attendre avant de repasser par str0m
            if first {
                first = false;
                let _ = socket.set_nonblocking(true);
            }
        }
    }
}

/// Adresse locale (candidat) qui a reçu le paquet : la socket écoute sur toutes les interfaces.
fn local_for(source: SocketAddr, lan: Option<SocketAddr>, loopback: Option<SocketAddr>) -> Option<SocketAddr> {
    if source.ip().is_loopback() {
        loopback.or(lan)
    } else {
        lan.or(loopback)
    }
}
