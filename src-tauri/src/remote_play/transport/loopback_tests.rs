//! Phase 1c, essai réel en boucle locale : l'hôte complet (`Host` : capture WGC, encodage MF,
//! str0m, sockets UDP 127.0.0.1) face à un invité str0m dans le même processus, sur une vraie
//! socket UDP. Même horloge des deux côtés : la latence est mesurée image par image, de l'envoi
//! de l'image à l'encodeur jusqu'à l'image reconstituée chez l'invité (décodage et affichage
//! exclus : ils relèvent du WebView, mesurés à part par `remotePlayGuest.ts`).
//!
//! `#[ignore]` : bureau Windows ouvert et GPU requis. À lancer à la main :
//! `cargo test --lib remote_play::transport::loopback_tests -- --ignored --nocapture --test-threads=1`
//! Variables : `IBOX_RP_SECS` (10), `IBOX_RP_HEIGHT` (native), `IBOX_RP_KBPS` (20000), `IBOX_RP_MAX_KBPS` (50000),
//! `IBOX_RP_FPS` (60), `IBOX_RP_RESPONSIVE=1` (« Priorité à la réactivité »), `IBOX_RP_OFF=gpu,defer,hold,events,process,delay`
//! (désactive un levier pour le comparer à charge égale), `IBOX_RP_LINK=kbps=8000,delay=20,loss=1,queue=300,step=5:3000`
//! (lien simulé, `transport/link.rs`), `IBOX_RP_NOISE=1` (contenu que l'encodeur ne peut pas prédire).
//! Rien ne s'affiche pendant l'essai : la source est une fenêtre invisible (`Mover::hidden`), sans son.

use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

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

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|v| v == "1")
}

/// Centiles d'une série de durées (ms) : médiane, p95, p99, max.
fn centiles(mut v: Vec<f64>) -> String {
    if v.is_empty() {
        return "aucune mesure".into();
    }
    v.sort_by(|a, b| a.total_cmp(b));
    let rank = |p: f64| v[((p * v.len() as f64).ceil() as usize).clamp(1, v.len()) - 1];
    format!("méd. {:.2} · p95 {:.2} · p99 {:.2} · max {:.2} ({} images)", rank(0.5), rank(0.95), rank(0.99), v[v.len() - 1], v.len())
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// Une image suivie de bout en bout sur la même horloge.
struct Traced {
    /// Depuis la connexion.
    at: Duration,
    wait: f64,
    encode: f64,
    transit: f64,
    total: f64,
    /// Remise à str0m → premier paquet reçu par l'invité (attente avant le départ).
    first_packet: f64,
    bytes: usize,
}

#[test]
#[ignore]
fn phase1c_loopback_host_to_str0m_guest() {
    let secs = env_u32("IBOX_RP_SECS").unwrap_or(10) as u64;
    // l'invité de l'essai partage ce PC avec l'hôte : prioritaire, pour ne pas mesurer sa propre attente
    crate::remote_play::latency_critical_thread();
    // fenêtre hors écran, capturée elle-même : rien ne s'affiche ni ne bouge sur l'écran de travail
    let (_mover, window) = Mover::hidden();
    let log: FrameLog = Arc::default();
    let link = std::env::var("IBOX_RP_LINK").ok().map(|t| super::link::Spec::parse(&t).expect("IBOX_RP_LINK illisible"));
    *super::host::TEST_LINK.lock().unwrap() = link.clone();
    let opts = HostOptions {
        network: super::host::Network::Loopback,
        port: 0,
        target: Target::Window(window),
        fps: env_u32("IBOX_RP_FPS").unwrap_or(60),
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
        responsive: env_flag("IBOX_RP_RESPONSIVE"),
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
    // (temps RTP, arrivée monotone, arrivée murale, octets, arrivée du premier paquet)
    let mut frames: Vec<(u64, Instant, SystemTime, usize, Instant)> = Vec::new();
    let mut timings: Vec<(u32, u64, u64, u32, SystemTime)> = Vec::new();
    let mut channels = HashMap::new();
    let mut connected_at: Option<Instant> = None;
    let mut pings: HashMap<u32, Instant> = HashMap::new();
    let mut ping_rtt = Series::default();
    let mut next_ping = Instant::now();
    let mut next_mouse = Instant::now();
    let mut ping_id = 0u32;
    let mut seq = 0u32;
    let mut reported = false;
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
                // un invité récent renvoie sa mesure dès que l'hôte a envoyé les siennes
                if !timings.is_empty() && !reported {
                    reported = true;
                    let report = encode(&Message::Report { total_micros: 23_400, guest_micros: 9_100 });
                    guest.channel(id).unwrap().write(true, &report).unwrap();
                }
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
                    Event::MediaData(m) => frames.push((m.time.numer(), Instant::now(), SystemTime::now(), m.data.len(), m.network_time)),
                    Event::ChannelData(d) => match decode(&d.data) {
                        Ok(Message::Pong { id, .. }) => {
                            if let Some(sent) = pings.remove(&id) {
                                ping_rtt.push(sent.elapsed());
                            }
                        }
                        Ok(Message::Timing { rtp, capture_micros, sent_micros, host_micros }) => timings.push((rtp, capture_micros, sent_micros, host_micros, SystemTime::now())),
                        _ => {}
                    },
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
    // le fil de l'hôte a lu le lien simulé à son démarrage : on ne l'efface qu'ici
    *super::host::TEST_LINK.lock().unwrap() = None;

    // journal de l'hôte : temps RTP → (capture, envoi à l'encodeur, remise à str0m)
    let sent: HashMap<u64, (Instant, Instant, Instant)> = log.lock().unwrap().iter().map(|e| (e.0, (e.1, e.2, e.3))).collect();
    let origin = connected_at.unwrap_or(t0);
    let mut traced: Vec<Traced> = Vec::new();
    let mut first: Option<(Duration, usize)> = None;
    let mut unmatched = 0;
    for (rtp, arrival, _, len, first_packet) in &frames {
        match sent.get(rtp) {
            // la première image est l'IDR initiale (la plus grosse) : comptée à part
            Some((_, submitted, _)) if first.is_none() => first = Some((arrival.saturating_duration_since(*submitted), *len)),
            Some((captured, submitted, written)) => traced.push(Traced {
                at: arrival.saturating_duration_since(origin),
                wait: ms(submitted.saturating_duration_since(*captured)),
                encode: ms(written.saturating_duration_since(*submitted)),
                transit: ms(arrival.saturating_duration_since(*written)),
                total: ms(arrival.saturating_duration_since(*captured)),
                first_packet: ms(first_packet.saturating_duration_since(*written)),
                bytes: *len,
            }),
            None => unmatched += 1,
        }
    }
    let bytes: usize = frames.iter().map(|f| f.3).sum();
    let span = match (frames.first(), frames.last()) {
        (Some(a), Some(b)) => b.1.duration_since(a.1).as_secs_f64(),
        _ => 0.0,
    };
    let column = |f: fn(&Traced) -> f64, from: f64| traced.iter().filter(|t| t.at.as_secs_f64() >= from).map(f).collect::<Vec<f64>>();
    println!("== Phase 1c boucle locale (UDP 127.0.0.1, invité str0m) ==");
    println!("leviers désactivés : {:?} · lien simulé : {link:?} · réactivité : {}", std::env::var("IBOX_RP_OFF").unwrap_or_default(), env_flag("IBOX_RP_RESPONSIVE"));
    println!("code de vérification : {code} · tampon de réception de l'invité : {rcvbuf} octets");
    println!("encodeur : {:?}, sortie {:?}", live.encoder, live.resolution);
    println!("connexion (offre → DTLS établi côté hôte) : {:?} ms", live.connect_ms.map(|v| (v * 10.0).round() / 10.0));
    println!("images : envoyées {} (IDR {}), reçues {} sur {:.2} s = {:.1} i/s, débit utile reçu {:.1} Mbit/s", last.frames, last.keyframes, frames.len(), span, (frames.len().saturating_sub(1)) as f64 / span.max(1e-9), bytes as f64 * 8.0 / span.max(1e-9) / 1e6);
    println!("première image (IDR) : {:?} octets, envoi à l'encodeur → reconstituée {:?}", first.map(|f| f.1), first.map(|f| f.0));
    println!(
        "démarrage : capture et encodeur ouverts en {:?} ms · connexion → première image reçue {:?} ms",
        live.video_start_ms.map(f64::round),
        frames.first().map(|f| ms(f.1.saturating_duration_since(origin)).round())
    );
    let mut sizes: Vec<usize> = traced.iter().map(|t| t.bytes).collect();
    sizes.sort_unstable();
    if !sizes.is_empty() {
        let mean = sizes.iter().sum::<usize>() as f64 / sizes.len() as f64;
        let big = sizes.iter().filter(|s| **s >= 63_000).count();
        println!(
            "taille des images (hors IDR initiale) : moy {:.1} Ko · p95 {:.1} · max {:.1} · au-dessus de 63 Ko (rafale maximale du lissage d'envoi) : {} sur {} ({:.1} %)",
            mean / 1000.0,
            sizes[(sizes.len() * 95 / 100).min(sizes.len() - 1)] as f64 / 1000.0,
            sizes[sizes.len() - 1] as f64 / 1000.0,
            big,
            sizes.len(),
            big as f64 * 100.0 / sizes.len() as f64
        );
    }
    println!("CHAÎNE mesurée image par image, même horloge (ms) :");
    println!("  capture → envoi à l'encodeur        : {}", centiles(column(|t| t.wait, 0.0)));
    println!("  encodeur → remise à str0m           : {}", centiles(column(|t| t.encode, 0.0)));
    println!("  str0m → reconstituée chez l'invité  : {}", centiles(column(|t| t.transit, 0.0)));
    println!("    dont attente du premier paquet    : {}", centiles(column(|t| t.first_packet, 0.0)));
    for (label, lo, hi) in [("< 40 Ko", 0, 40_000), ("40–63 Ko", 40_000, 63_000), ("≥ 63 Ko", 63_000, usize::MAX)] {
        let v: Vec<f64> = traced.iter().filter(|t| t.bytes >= lo && t.bytes < hi).map(|t| t.transit).collect();
        println!("    images {label:<9}                 : {}", centiles(v));
    }
    println!("  TOTAL capture → reconstituée        : {}", centiles(column(|t| t.total, 0.0)));
    println!("  TOTAL après les 2 premières secondes: {}", centiles(column(|t| t.total, 2.0)));
    println!("  par seconde (médiane / max du total) :");
    for second in 0..secs {
        let v: Vec<f64> = traced.iter().filter(|t| t.at.as_secs() == second).map(|t| t.total).collect();
        if v.is_empty() {
            println!("    {second:>2} s : aucune image");
            continue;
        }
        let mut sorted = v.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        println!("    {second:>2} s : {:>6.1} / {:>6.1} ms · {} images", sorted[sorted.len() / 2], sorted[sorted.len() - 1], v.len());
    }
    println!("images reçues sans correspondance dans le journal : {unmatched}");
    // Les mesures envoyées à l'invité (`Timing`) valent-elles la vérité de l'horloge commune ?
    let mut timing_error = Vec::new();
    let mut timing_host = Vec::new();
    for (rtp, capture_micros, _, host_micros, _) in &timings {
        let Some((_, arrival, arrival_wall, _, _)) = frames.iter().find(|f| f.0 as u32 == *rtp) else { continue };
        let Some((captured, _, _)) = sent.get(&frames.iter().find(|f| f.0 as u32 == *rtp).map(|f| f.0).unwrap_or(0)) else { continue };
        let by_wall = arrival_wall.duration_since(SystemTime::UNIX_EPOCH).unwrap().as_micros() as f64 / 1000.0 - *capture_micros as f64 / 1000.0;
        timing_error.push((by_wall - ms(arrival.saturating_duration_since(*captured))).abs());
        timing_host.push(*host_micros as f64 / 1000.0);
    }
    println!("messages Timing reçus : {} · part de l'hôte annoncée (ms) : {}", timings.len(), centiles(timing_host));
    println!("  écart entre la latence par horloges murales (Timing) et la vérité monotone (ms) : {}", centiles(timing_error.clone()));
    println!("RTT DataChannel control (ping/pong, ms) : {}", ping_rtt.summary());
    println!(
        "hôte (2 dernières s) : capture → réseau méd. {:?} max {:?} ms · attente {:?} · encodage {:?} · file d'envoi méd. {:?} max {:?} · images écartées {} · IDR refusées {}",
        live.host_ms_p50, live.host_ms_max, live.capture_wait_ms_p50, live.encode_ms_p50, live.send_queue_ms_p50, live.send_queue_ms_max, last.frames_skipped, last.keyframes_throttled
    );
    println!("hôte : commande reçue → traitée méd. {:?} max {:?} ms · latence rapportée par l'invité {:?} / {:?} ms", live.input_ms_p50, live.input_ms_max, live.guest_latency_ms, live.guest_display_ms);
    println!("hôte (str0m) : rtt {:?} ms, pertes {:?} %, perdus {:?}, gigue {:?} ms, BWE {:?} kbit/s, consigne {} kbit/s, {} changements, émis {:.0} kbit/s, {:.1} i/s", live.rtt_ms, live.loss_pct, live.packets_lost, live.jitter_ms, live.bwe_kbps, live.target_kbps, live.bitrate_changes, live.sent_kbps, live.fps);
    println!("NACK reçus {} · PLI {} · FIR {} (images clés envoyées {}) · baisses pour délai {} · aller-retour RTCP {:?} ms", last.nacks, last.plis, last.firs, last.keyframes, last.delay_backoffs, live.media_rtt_ms);
    println!("entrées : {:?}", last.inputs);
    println!("fin : état {} erreur {:?}", last.state, last.error);

    assert!(connected_at.is_some(), "connexion établie");
    assert!(frames.len() as u64 >= secs * 30 || link.is_some(), "au moins 30 i/s reçues");
    assert_eq!(last.inputs.injected, 0, "spectateur : rien injecté");
    assert!(last.inputs.denied > 0, "souris refusée par les permissions");
    assert!(ping_rtt.len() > 0, "pong reçu");
    assert!(!timings.is_empty(), "mesures de l'hôte reçues par l'invité");
    assert!(timing_error.iter().all(|e| *e < 5.0), "Timing fidèle à l'horloge commune");
    assert_eq!(live.guest_latency_ms, Some(23.4), "mesure de l'invité affichée à l'hôte");
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
    // fenêtre hors écran, capturée elle-même : rien ne s'affiche ni ne bouge sur l'écran de travail
    let (_mover, window) = Mover::hidden();
    let link = std::env::var("IBOX_RP_LINK").ok().map(|t| super::link::Spec::parse(&t).expect("IBOX_RP_LINK illisible"));
    *super::host::TEST_LINK.lock().unwrap() = link;
    let opts = HostOptions {
        network: if std::env::var("IBOX_RP_INTERNET").is_ok_and(|v| v == "1") {
            super::host::Network::Internet { stun: crate::remote_play::config::Config::default().stun_servers }
        } else if std::env::var("IBOX_RP_LAN").is_ok_and(|v| v == "1") {
            super::host::Network::Lan
        } else {
            super::host::Network::Loopback
        },
        port: 0,
        target: Target::Window(window),
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
        responsive: env_flag("IBOX_RP_RESPONSIVE"),
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
            "[{:>3.0} s] {} · {} i/s · émis {:.0} kbit/s · consigne {} · BWE {:?} · rtt {:?} ms · pertes {:?} % · gigue {:?} ms · NACK {} PLI {} · hôte {:?}/{:?} ms · file {:?}/{:?} ms · écartées {} · invité {:?}/{:?} ms · entrées {:?}",
            start.elapsed().as_secs_f64(), s.state, s.fps, s.sent_kbps, s.target_kbps, s.bwe_kbps, s.rtt_ms, s.loss_pct, s.jitter_ms, s.nacks, s.plis, s.host_ms_p50, s.host_ms_max, s.send_queue_ms_p50, s.send_queue_ms_max, s.frames_skipped, s.guest_latency_ms, s.guest_display_ms, s.inputs
        );
    }
    let last = host.stop();
    *super::host::TEST_LINK.lock().unwrap() = None;
    println!("fin : {} erreur {:?} · images {} · IDR {} · encodeur {:?} {:?}", last.state, last.error, last.frames, last.keyframes, last.encoder, last.resolution);
}
