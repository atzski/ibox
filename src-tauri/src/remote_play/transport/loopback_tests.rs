//! Phase 1c, essai réel en boucle locale : l'hôte complet (`Host` : capture WGC, encodage MF,
//! str0m, sockets UDP 127.0.0.1) face à un invité str0m dans le même processus, sur une vraie
//! socket UDP. Même horloge des deux côtés : la latence est mesurée image par image, de l'envoi
//! de l'image à l'encodeur jusqu'à l'image reconstituée chez l'invité (décodage et affichage
//! exclus : ils relèvent du WebView, mesurés à part par `remotePlayGuest.ts`).
//!
//! `#[ignore]` : bureau Windows ouvert et GPU requis. À lancer à la main :
//! `cargo test --lib remote_play::transport::loopback_tests -- --ignored --nocapture --test-threads=1`
//! Variables : `IBOX_RP_SECS` (10), `IBOX_RP_HEIGHT` (native), `IBOX_RP_KBPS` (20000), `IBOX_RP_MAX_KBPS` (50000).

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Arc;
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, RtcConfig};

use super::host::{FrameLog, Host, HostOptions};
use crate::remote_play::capture::Target;
use crate::remote_play::encode::gpu_tests::Mover;
use crate::remote_play::encode::stats::Series;
use crate::remote_play::input::Hotkey;
use crate::remote_play::permissions::{Mode, Profile};
use crate::remote_play::protocol::{decode, encode, Message};

fn env_u32(name: &str) -> Option<u32> {
    std::env::var(name).ok().and_then(|v| v.parse().ok())
}

#[test]
#[ignore]
fn phase1c_loopback_host_to_str0m_guest() {
    let secs = env_u32("IBOX_RP_SECS").unwrap_or(10) as u64;
    let _mover = Mover::start();
    let log: FrameLog = Arc::default();
    let opts = HostOptions {
        network: super::host::Network::Loopback,
        port: 0,
        target: Target::PrimaryMonitor,
        fps: 60,
        max_height: env_u32("IBOX_RP_HEIGHT"),
        initial_kbps: env_u32("IBOX_RP_KBPS").unwrap_or(20_000),
        max_kbps: env_u32("IBOX_RP_MAX_KBPS").unwrap_or(50_000),
        // spectateur : les entrées envoyées doivent être refusées, rien n'est injecté sur ce PC
        profile: Profile::Spectator,
        mode: Mode::DesktopShare,
        hotkey: Hotkey::default(),
        blocked: Vec::new(),
        guest_account: "essai".into(),
        frame_log: Some(log.clone()),
        audio: false,
        hide_discord_echo: false,
    };
    let t0 = Instant::now();
    let host = Host::start(opts).expect("hôte");
    let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
    let local = sock.local_addr().unwrap();
    // comme Chromium, qui agrandit lui aussi ses tampons de réception
    let rcvbuf = super::host::set_socket_buffers(&sock, super::host::SOCKET_BUFFER);
    let mut guest = RtcConfig::new().clear_codecs().enable_h264(true).build(Instant::now());
    guest.add_local_candidate(Candidate::host(local, "udp").unwrap());
    let answer = guest.sdp_api().accept_offer(SdpOffer::from_sdp_string(host.offer()).unwrap()).unwrap();
    let code = host.accept_answer(&answer.to_sdp_string()).expect("réponse");

    let mut buf = vec![0u8; 2048];
    let mut frames: Vec<(u64, Instant, usize)> = Vec::new();
    let mut channels = HashMap::new();
    let mut connected_at: Option<Instant> = None;
    let mut pings: HashMap<u32, Instant> = HashMap::new();
    let mut ping_rtt = Series::default();
    let mut next_ping = Instant::now();
    let mut next_mouse = Instant::now();
    let mut ping_id = 0u32;
    let mut seq = 0u32;
    let end = Instant::now() + Duration::from_secs(secs + 2);
    while Instant::now() < end {
        let now = Instant::now();
        if let Some(&id) = channels.get("control") {
            if now >= next_ping {
                next_ping = now + Duration::from_millis(250);
                ping_id += 1;
                pings.insert(ping_id, now);
                let ping = encode(&Message::Ping { id: ping_id, micros: t0.elapsed().as_micros() as u64 });
                guest.channel(id).unwrap().write(true, &ping).unwrap();
            }
        }
        if let Some(&id) = channels.get("input") {
            if now >= next_mouse {
                next_mouse = now + Duration::from_millis(100);
                seq += 1;
                let mv = encode(&Message::MouseAbs { seq, x: 1000, y: 1000 });
                guest.channel(id).unwrap().write(true, &mv).unwrap();
            }
        }
        let timeout = loop {
            match guest.poll_output().unwrap() {
                Output::Timeout(t) => break t,
                Output::Transmit(t) => {
                    let data: Vec<u8> = t.contents.into();
                    let _ = sock.send_to(&data, t.destination);
                }
                Output::Event(e) => match e {
                    Event::Connected => connected_at = Some(Instant::now()),
                    Event::ChannelOpen(id, label) => {
                        channels.insert(label, id);
                    }
                    Event::MediaData(m) => frames.push((m.time.numer(), Instant::now(), m.data.len())),
                    Event::ChannelData(d) => {
                        if let Ok(Message::Pong { id, .. }) = decode(&d.data) {
                            if let Some(sent) = pings.remove(&id) {
                                ping_rtt.push(sent.elapsed());
                            }
                        }
                    }
                    _ => {}
                },
            }
        };
        let wait = timeout.saturating_duration_since(Instant::now()).clamp(Duration::from_millis(1), Duration::from_millis(20));
        sock.set_read_timeout(Some(wait)).unwrap();
        if let Ok((n, source)) = sock.recv_from(&mut buf) {
            let input = Input::Receive(Instant::now(), Receive { proto: Protocol::Udp, source, destination: local, contents: buf[..n].try_into().unwrap() });
            guest.handle_input(input).unwrap();
        }
        guest.handle_input(Input::Timeout(Instant::now())).unwrap();
        if connected_at.is_some_and(|c| c.elapsed() > Duration::from_secs(secs)) {
            break;
        }
    }
    let live = host.stats();
    let last = host.stop();

    let sent: HashMap<u64, Instant> = log.lock().unwrap().iter().map(|e| (e.0, e.1)).collect();
    let written: HashMap<u64, Instant> = log.lock().unwrap().iter().map(|e| (e.0, e.2)).collect();
    let mut to_str0m = Series::default();
    let mut in_str0m = Series::default();
    for (rtp, arrival, _) in frames.iter().skip(1) {
        if let (Some(s), Some(w)) = (sent.get(rtp), written.get(rtp)) {
            to_str0m.push(w.saturating_duration_since(*s));
            in_str0m.push(arrival.saturating_duration_since(*w));
        }
    }
    let mut latency = Series::default();
    let mut first: Option<(Duration, usize)> = None;
    let mut unmatched = 0;
    for (rtp, arrival, len) in &frames {
        match sent.get(rtp) {
            // la première image est l'IDR initiale (la plus grosse) : comptée à part
            Some(w) if first.is_none() => first = Some((arrival.saturating_duration_since(*w), *len)),
            Some(w) => latency.push(arrival.saturating_duration_since(*w)),
            None => unmatched += 1,
        }
    }
    let bytes: usize = frames.iter().map(|f| f.2).sum();
    let span = match (frames.first(), frames.last()) {
        (Some(a), Some(b)) => b.1.duration_since(a.1).as_secs_f64(),
        _ => 0.0,
    };
    println!("== Phase 1c boucle locale (UDP 127.0.0.1, invité str0m) ==");
    println!("code de vérification : {code} · tampon de réception de l'invité : {rcvbuf} octets");
    println!("encodeur : {:?}, sortie {:?}", live.encoder, live.resolution);
    println!("connexion (offre → DTLS établi côté hôte) : {:?} ms", live.connect_ms.map(|v| (v * 10.0).round() / 10.0));
    println!("images : envoyées {} (IDR {}), reçues {} sur {:.2} s = {:.1} i/s, débit utile reçu {:.1} Mbit/s", last.frames, last.keyframes, frames.len(), span, (frames.len().saturating_sub(1)) as f64 / span.max(1e-9), bytes as f64 * 8.0 / span.max(1e-9) / 1e6);
    println!("première image (IDR) : {:?} octets, latence {:?}", first.map(|f| f.1), first.map(|f| f.0));
    println!("latence envoi à l'encodeur → image reconstituée chez l'invité, images suivantes (ms) : {}", latency.summary());
    println!("  envoi à l'encodeur → remise à str0m (ms) : {}", to_str0m.summary());
    println!("  remise à str0m → image reconstituée chez l'invité (ms) : {}", in_str0m.summary());
    println!("  dont encodage seul (ms, fenêtre 2 s) : méd. {:?} max {:?}", live.encode_ms_p50, live.encode_ms_max);
    println!("images reçues sans correspondance dans le journal : {unmatched}");
    println!("RTT DataChannel control (ping/pong, ms) : {}", ping_rtt.summary());
    println!("hôte (str0m) : rtt {:?} ms, pertes {:?} %, perdus {:?}, gigue {:?} ms, BWE {:?} kbit/s, consigne {} kbit/s, {} changements, émis {:.0} kbit/s, {:.1} i/s", live.rtt_ms, live.loss_pct, live.packets_lost, live.jitter_ms, live.bwe_kbps, live.target_kbps, live.bitrate_changes, live.sent_kbps, live.fps);
    println!("NACK reçus {} · PLI {} · FIR {} (images clés envoyées {})", last.nacks, last.plis, last.firs, last.keyframes);
    println!("entrées : {:?}", last.inputs);
    println!("fin : état {} erreur {:?}", last.state, last.error);

    assert!(connected_at.is_some(), "connexion établie");
    assert!(frames.len() as u64 >= secs * 30, "au moins 30 i/s reçues");
    assert_eq!(last.inputs.injected, 0, "spectateur : rien injecté");
    assert!(last.inputs.denied > 0, "souris refusée par les permissions");
    assert!(ping_rtt.len() > 0, "pong reçu");
}

/// Pont HTTP minimal (127.0.0.1:47800, CORS) entre l'hôte réel et la page de développement
/// `remote-play-dev.html` : `GET /offer`, `POST /answer` (renvoie le code), `GET /stats`.
/// Lancer cet essai, puis ouvrir http://localhost:1430/remote-play-dev.html (`npx vite --port 1430`).
/// Variables : `IBOX_RP_SECS` (60), `IBOX_RP_HEIGHT`, `IBOX_RP_LAN=1` (candidat sur l'adresse du réseau local),
/// `IBOX_RP_INTERNET=1` (candidats locaux + publics obtenus par STUN, comme une session iNetbox).
#[test]
#[ignore]
fn phase1c_browser_bridge() {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let secs = env_u32("IBOX_RP_SECS").unwrap_or(60) as u64;
    let _mover = Mover::start();
    let opts = HostOptions {
        network: if std::env::var("IBOX_RP_INTERNET").is_ok_and(|v| v == "1") {
            super::host::Network::Internet { stun: crate::remote_play::config::Config::default().stun_servers }
        } else if std::env::var("IBOX_RP_LAN").is_ok_and(|v| v == "1") {
            super::host::Network::Lan
        } else {
            super::host::Network::Loopback
        },
        port: 0,
        target: Target::PrimaryMonitor,
        fps: 60,
        max_height: env_u32("IBOX_RP_HEIGHT"),
        initial_kbps: env_u32("IBOX_RP_KBPS").unwrap_or(20_000),
        max_kbps: env_u32("IBOX_RP_MAX_KBPS").unwrap_or(50_000),
        profile: Profile::Spectator,
        mode: Mode::DesktopShare,
        hotkey: Hotkey::default(),
        blocked: Vec::new(),
        guest_account: "navigateur".into(),
        frame_log: None,
        audio: false,
        hide_discord_echo: false,
    };
    let host = Arc::new(Host::start(opts).expect("hôte"));
    let listener = TcpListener::bind("127.0.0.1:47800").expect("port 47800");
    let served = host.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut req = Vec::new();
            let mut buf = [0u8; 8192];
            // en-têtes puis corps (Content-Length)
            loop {
                let Ok(n) = s.read(&mut buf) else { break };
                if n == 0 {
                    break;
                }
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req);
                if let Some(end) = text.find("\r\n\r\n") {
                    let len = text[..end]
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                        .unwrap_or(0);
                    if req.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let text = String::from_utf8_lossy(&req).to_string();
            let line = text.lines().next().unwrap_or("").to_string();
            let body = text.split_once("\r\n\r\n").map(|b| b.1.to_string()).unwrap_or_default();
            let (status, content) = if line.starts_with("OPTIONS") {
                ("204 No Content", String::new())
            } else if line.starts_with("GET /offer") {
                ("200 OK", served.offer().to_string())
            } else if line.starts_with("POST /answer") {
                match served.accept_answer(&body) {
                    Ok(code) => ("200 OK", code),
                    Err(e) => ("400 Bad Request", e),
                }
            } else if line.starts_with("GET /stats") {
                ("200 OK", serde_json::to_string(&served.stats()).unwrap_or_default())
            } else {
                ("404 Not Found", String::new())
            };
            let _ = write!(
                s,
                "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{content}",
                content.len()
            );
        }
    });
    println!("pont prêt : http://127.0.0.1:47800 — ouvrir remote-play-dev.html");
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(secs) {
        std::thread::sleep(Duration::from_secs(5));
        let s = host.stats();
        println!(
            "[{:>3.0} s] {} · {} i/s · émis {:.0} kbit/s · consigne {} · BWE {:?} · rtt {:?} ms · pertes {:?} % · gigue {:?} ms · NACK {} PLI {} · entrées {:?}",
            start.elapsed().as_secs_f64(), s.state, s.fps, s.sent_kbps, s.target_kbps, s.bwe_kbps, s.rtt_ms, s.loss_pct, s.jitter_ms, s.nacks, s.plis, s.inputs
        );
    }
    let last = host.stop();
    println!("fin : {} erreur {:?} · images {} · IDR {} · encodeur {:?} {:?}", last.state, last.error, last.frames, last.keyframes, last.encoder, last.resolution);
}
