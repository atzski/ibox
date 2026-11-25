//! Invité natif : format des trames vers le WebView, et (Windows) session complète en mémoire face
//! au vrai `HostPeer` : ICE, DTLS, SRTP, SCTP réels, sans réseau.

use std::time::Instant;

use super::peer::GuestEvent;
use super::{frame, HEADER};

#[test]
fn trame_binaire_vers_le_webview() {
    let t0 = Instant::now();
    let e = GuestEvent::Video { data: vec![0, 0, 0, 1, 0x65, 7], rtp_time: 0x0102_0304_0506, keyframe: true, arrived: t0 + std::time::Duration::from_micros(1234) };
    let f = frame(&e, t0);
    assert_eq!(f.len(), HEADER + 6);
    assert_eq!(&f[..4], &[1, 1, 0, 0]);
    assert_eq!(u64::from_le_bytes(f[4..12].try_into().unwrap()), 0x0102_0304_0506);
    assert_eq!(u32::from_le_bytes(f[12..16].try_into().unwrap()), 1234);
    assert_eq!(&f[HEADER..], &[0, 0, 0, 1, 0x65, 7]);
    assert_eq!(frame(&GuestEvent::Connected, t0), [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(frame(&GuestEvent::Control(vec![9]), t0)[0], 3);
}

/// Hôte str0m minimal (offre vidéo H.264 en envoi seul + `input`/`control`) face à l'invité
/// natif : vérifie la poignée de main DTLS et SRTP avec la cryptographie de chaque système
/// (`rust-crypto` sous Linux, `wincrypto` sous Windows).
#[test]
fn poignee_de_main_et_image_avec_la_cryptographie_du_systeme() {
    use std::net::SocketAddr;
    use std::time::Duration;
    use str0m::change::SdpAnswer;
    use str0m::format::Codec;
    use str0m::media::{Direction, MediaKind, MediaTime};
    use str0m::net::{Protocol, Receive};
    use str0m::{Candidate, Input, Output, RtcConfig};

    use super::peer::{Datagram, GuestPeer};

    let host_addr: SocketAddr = "10.0.0.1:5000".parse().unwrap();
    let guest_addr: SocketAddr = "10.0.0.2:6000".parse().unwrap();
    let mut now = Instant::now();
    let mut host = RtcConfig::new().clear_codecs().enable_h264(true).build(now);
    host.add_local_candidate(Candidate::host(host_addr, "udp").unwrap());
    let mut change = host.sdp_api();
    let mid = change.add_media(MediaKind::Video, Direction::SendOnly, Some("ibox".into()), None, None);
    change.add_channel("input".into());
    change.add_channel("control".into());
    let (offer, pending) = change.apply().unwrap();
    let (mut guest, answer) = GuestPeer::new(&offer.to_sdp_string(), &[Candidate::host(guest_addr, "udp").unwrap()], now).unwrap();
    host.sdp_api().accept_answer(pending, SdpAnswer::from_sdp_string(&answer).unwrap()).unwrap();

    let mut events = Vec::new();
    let mut sent = false;
    let idr = [0u8, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0, 0, 0, 1, 0x68, 0xce, 0, 0, 0, 1, 0x65, 0x88, 0x84];
    for _ in 0..1500 {
        for _ in 0..50 {
            let mut to_guest = Vec::new();
            loop {
                match host.poll_output().unwrap() {
                    Output::Timeout(_) => break,
                    Output::Transmit(t) => to_guest.push(Datagram { source: t.source, destination: t.destination, data: t.contents.into() }),
                    Output::Event(_) => {}
                }
            }
            for d in &to_guest {
                guest.receive(now, d.source, d.destination, &d.data);
            }
            let mut back = Vec::new();
            guest.poll(now, &mut back, &mut events);
            for d in &back {
                let input = Input::Receive(now, Receive { proto: Protocol::Udp, source: d.source, destination: d.destination, contents: d.data.as_slice().try_into().unwrap() });
                host.handle_input(input).unwrap();
            }
            if to_guest.is_empty() && back.is_empty() {
                break;
            }
        }
        if guest.channels_open() && !sent {
            let w = host.writer(mid).unwrap();
            let pt = w.payload_params().find(|p| p.spec().codec == Codec::H264).unwrap().pt();
            w.write(pt, now, MediaTime::from_90khz(0), idr.to_vec()).unwrap();
            sent = true;
        }
        if events.iter().any(|e| matches!(e, GuestEvent::Video { .. })) {
            break;
        }
        now += Duration::from_millis(2);
        host.handle_input(Input::Timeout(now)).unwrap();
        guest.tick(now);
    }
    assert!(events.contains(&GuestEvent::Connected), "ICE + DTLS établis");
    let video = events.iter().find_map(|e| match e {
        GuestEvent::Video { data, keyframe, .. } => Some((data.clone(), *keyframe)),
        _ => None,
    });
    assert_eq!(video, Some((idr.to_vec(), true)), "image clé reçue via SRTP");
}

#[cfg(windows)]
mod face_a_l_hote {
    use std::net::SocketAddr;
    use std::time::{Duration, Instant};

    use str0m::Candidate;

    use crate::remote_play::guest::peer::{Datagram as GDatagram, GuestEvent, GuestPeer};
    use crate::remote_play::permissions::Profile;
    use crate::remote_play::protocol::{encode, Message};
    use crate::remote_play::transport::peer::{Datagram, HostPeer, PeerOptions};
    use crate::remote_play::transport::tests::{annexb, engine, TestEngine};

    const HOST: &str = "10.0.0.1:5000";
    const GUEST_ADDR: &str = "10.0.0.2:6000";

    struct Pair {
        host: HostPeer<TestEngine>,
        guest: GuestPeer,
        now: Instant,
        events: Vec<GuestEvent>,
    }

    fn addr(s: &str) -> SocketAddr {
        s.parse().unwrap()
    }

    impl Pair {
        fn new(profile: Profile) -> (Pair, crate::remote_play::transport::tests::Sent) {
            let now = Instant::now();
            let (eng, sent) = engine(profile);
            let (mut host, offer) = HostPeer::new(PeerOptions { initial_kbps: 4_000, max_kbps: 20_000, responsive: false }, &[addr(HOST)], eng, now).unwrap();
            let local = Candidate::host(addr(GUEST_ADDR), "udp").unwrap();
            let (guest, answer) = GuestPeer::new(&offer, &[local], now).unwrap();
            assert!(answer.contains("H264"), "H.264 accepté dans la réponse");
            host.accept_answer(&answer).unwrap();
            (Pair { host, guest, now, events: Vec::new() }, sent)
        }

        fn run(&mut self, ms: u64) {
            let end = self.now + Duration::from_millis(ms);
            while self.now < end {
                for _ in 0..50 {
                    let mut out: Vec<Datagram> = Vec::new();
                    self.host.poll(self.now, &mut out);
                    for d in &out {
                        self.guest.receive(self.now, d.source, d.destination, &d.data);
                    }
                    let mut back: Vec<GDatagram> = Vec::new();
                    self.guest.poll(self.now, &mut back, &mut self.events);
                    for d in &back {
                        self.host.receive(self.now, d.source, d.destination, &d.data);
                    }
                    if out.is_empty() && back.is_empty() {
                        break;
                    }
                }
                self.now += Duration::from_millis(2);
                self.host.tick(self.now);
                self.guest.tick(self.now);
            }
        }

        fn connect(&mut self) {
            for _ in 0..100 {
                self.run(20);
                if self.guest.channels_open() && self.host.stats(self.now).connected {
                    return;
                }
            }
            panic!("pas de connexion");
        }

        fn videos(&self) -> Vec<(Vec<u8>, u64, bool)> {
            self.events
                .iter()
                .filter_map(|e| match e {
                    GuestEvent::Video { data, rtp_time, keyframe, .. } => Some((data.clone(), *rtp_time, *keyframe)),
                    _ => None,
                })
                .collect()
        }
    }

    #[test]
    fn invite_natif_recoit_les_images_et_envoie_ses_entrees() {
        let (mut p, sent) = Pair::new(Profile::Collaborator);
        p.connect();
        assert!(p.events.contains(&GuestEvent::Connected));
        let sps: &[u8] = &[0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40];
        let pps: &[u8] = &[0x68, 0xeb, 0xe3, 0xcb];
        let mut idr = vec![0x65u8];
        idr.extend((0..6000).map(|i| (i % 251) as u8 | 1));
        let f1 = annexb(&[sps, pps, &idr]);
        let f2 = annexb(&[&[0x41, 0x9a, 0x02, 0x03]]);
        let start = p.now;
        p.host.write_frame(p.now, start, 0, f1.clone(), None, Duration::ZERO).unwrap();
        p.run(30);
        p.host.write_frame(p.now, start, 166_667, f2.clone(), None, Duration::ZERO).unwrap();
        p.run(100);

        let v = p.videos();
        assert_eq!(v.len(), 2, "deux images reçues : {:?}", v.iter().map(|x| x.0.len()).collect::<Vec<_>>());
        assert_eq!(v[0].0, f1, "IDR reconstituée à l'octet près");
        assert!(v[0].2 && !v[1].2, "image clé repérée");
        assert_eq!(v[1].1 - v[0].1, 1_500, "1/60 s à 90 kHz");
        let s = p.guest.stats(p.now);
        assert_eq!((s.frames, s.keyframes, s.gaps), (2, 1, 0));
        assert!(s.connected && s.connect_ms.is_some());

        // entrée envoyée par l'invité natif : décodée, autorisée et injectée par l'hôte
        assert!(p.guest.send("input", &encode(&Message::MouseAbs { seq: 1, x: 1000, y: 1000 })));
        p.run(60);
        assert!(!sent.lock().unwrap().is_empty(), "entrée injectée côté hôte");

        // image clé redemandée (PLI) : l'hôte la reçoit, au plus une fois par délai
        assert!(p.guest.request_keyframe(p.now));
        assert!(!p.guest.request_keyframe(p.now), "délai entre deux demandes");
        p.run(60);
        assert!(p.host.take_effects().keyframe, "l'hôte doit produire une IDR");

        // statistiques RTCP (RTT, gigue) disponibles après quelques secondes
        p.run(2_500);
        let s = p.guest.stats(p.now);
        assert!(s.jitter_ms.is_some(), "{s:?}");
    }

    #[test]
    fn images_non_decodables_jetees_jusqu_a_l_image_cle() {
        let (mut p, _) = Pair::new(Profile::Spectator);
        p.connect();
        // l'hôte commence par une image P (décodeur pas encore amorcé) : jetée, IDR redemandée
        let start = p.now;
        p.host.write_frame(p.now, start, 0, annexb(&[&[0x41, 0x9a, 1]]), None, Duration::ZERO).unwrap();
        p.run(60);
        assert!(p.videos().is_empty(), "image P sans image clé : jetée");
        assert_eq!(p.guest.stats(p.now).keyframe_requests, 1);
    }
}

/// Essai réel (Windows, bureau et GPU requis) : l'hôte complet (capture WGC, encodage MF, UDP
/// 127.0.0.1) face à l'invité natif et à son fil réseau (`run.rs`). Mesure ce que verra le WebView :
/// images par seconde, débit, images clés, interruptions.
/// `cargo test --lib remote_play::guest::tests::boucle_locale_reelle -- --ignored --nocapture`
#[cfg(windows)]
#[test]
#[ignore]
fn boucle_locale_reelle() {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use crate::remote_play::capture::Target;
    use crate::remote_play::encode::gpu_tests::Mover;
    use crate::remote_play::guest::run::{NativeGuest, Options};
    use crate::remote_play::input::Hotkey;
    use crate::remote_play::permissions::{Mode, Profile};
    use crate::remote_play::transport::host::{Host, HostOptions, Network};

    let secs = std::env::var("IBOX_RP_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(8u64);
    let _mover = Mover::start();
    let host = Host::start(HostOptions {
        network: Network::Loopback,
        port: 0,
        target: Target::PrimaryMonitor,
        fps: 60,
        max_height: Some(1080),
        initial_kbps: 20_000,
        max_kbps: 50_000,
        profile: Profile::Spectator,
        mode: Mode::DesktopShare,
        hotkey: Hotkey::default(),
        blocked: Vec::new(),
        guest_account: "essai".into(),
        frame_log: None,
        audio: false,
        hide_discord_echo: false,
        responsive: false,
    })
    .expect("hôte");
    let frames: Arc<Mutex<Vec<(usize, bool)>>> = Arc::default();
    let seen = frames.clone();
    let t0 = Instant::now();
    let guest = NativeGuest::start(host.offer(), Options { stun_servers: Vec::new(), loopback: true }, move |e| {
        if let GuestEvent::Video { data, keyframe, .. } = e {
            seen.lock().unwrap().push((data.len(), keyframe));
        }
    })
    .expect("invité");
    host.accept_answer(guest.answer()).expect("réponse");
    std::thread::sleep(Duration::from_secs(secs));
    let s = guest.stop();
    let hs = host.stop();
    let f = frames.lock().unwrap();
    let bytes: usize = f.iter().map(|x| x.0).sum();
    println!(
        "invité natif : {} images en {:.1} s ({:.0} im/s), {} images clés, {:.1} Mbit/s, connexion {:?} ms, interruptions {}, demandes d'IDR {}, NACK {}",
        f.len(),
        t0.elapsed().as_secs_f64(),
        f.len() as f64 / secs as f64,
        s.keyframes,
        bytes as f64 * 8.0 / secs as f64 / 1e6,
        s.connect_ms,
        s.gaps,
        s.keyframe_requests,
        s.nacks
    );
    println!("hôte : {} images envoyées", hs.frames);
    assert!(s.connected || s.frames > 0, "connexion établie");
    assert!(f.len() as u64 > secs * 20, "au moins 20 images par seconde reçues");
    assert!(f.first().is_some_and(|x| x.1), "la première image remise est une image clé");
}

/// Hôte d'essai pour le banc de l'aperçu Steam Deck (`scripts/deck-preview.ps1 -RemotePlay`) :
/// hôte complet sur le réseau local, offre déposée dans `%TEMP%\ibox-rp\offer.sdp`, réponse de
/// l'invité natif (WSL) attendue dans `answer.sdp`. Lancer ce test, puis l'aperçu.
/// `cargo test --lib remote_play::guest::tests::hote_pour_apercu -- --ignored --nocapture`
/// Variables : `IBOX_RP_SECS` (30), `IBOX_RP_HEIGHT` (720).
#[cfg(windows)]
#[test]
#[ignore]
fn hote_pour_apercu() {
    use std::time::Duration;

    use crate::remote_play::capture::Target;
    use crate::remote_play::input::Hotkey;
    use crate::remote_play::permissions::{Mode, Profile};
    use crate::remote_play::transport::host::{Host, HostOptions, Network};

    let env = |k: &str, d: u32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
    let dir = std::env::temp_dir().join("ibox-rp");
    std::fs::create_dir_all(&dir).unwrap();
    let (offer_file, answer_file) = (dir.join("offer.sdp"), dir.join("answer.sdp"));
    let _ = std::fs::remove_file(&answer_file);
    // pas de fenêtre animée au premier plan : l'aperçu affiche lui-même l'écran capturé, qui bouge
    let host = Host::start(HostOptions {
        network: Network::Lan,
        port: 0,
        target: Target::PrimaryMonitor,
        fps: 60,
        max_height: Some(env("IBOX_RP_HEIGHT", 720)),
        initial_kbps: 10_000,
        max_kbps: 30_000,
        profile: Profile::Spectator,
        mode: Mode::DesktopShare,
        hotkey: Hotkey::default(),
        blocked: Vec::new(),
        guest_account: "apercu".into(),
        frame_log: None,
        audio: false,
        hide_discord_echo: false,
        responsive: false,
    })
    .expect("hôte");
    std::fs::write(&offer_file, host.offer()).unwrap();
    println!("offre déposée : {} — lancez scripts/deck-preview.ps1 -RemotePlay", offer_file.display());
    let deadline = Instant::now() + Duration::from_secs(180);
    let answer = loop {
        if let Ok(a) = std::fs::read_to_string(&answer_file) {
            if a.starts_with("v=0") {
                break a;
            }
        }
        assert!(Instant::now() < deadline, "aucune réponse de l'aperçu en 3 minutes");
        std::thread::sleep(Duration::from_millis(200));
    };
    println!("code de vérification : {}", host.accept_answer(&answer).expect("réponse"));
    let secs = env("IBOX_RP_SECS", 30) as u64;
    for _ in 0..secs / 5 {
        std::thread::sleep(Duration::from_secs(5));
        let s = host.stats();
        println!("hôte : connecté {} · {} images · {:.1} Mbit/s · RTT {:?} ms", s.connected, s.frames, s.sent_kbps / 1000.0, s.rtt_ms);
    }
    let _ = std::fs::remove_file(&offer_file);
    let s = host.stop();
    assert!(s.connected || s.frames > 0, "session établie avec l'aperçu");
}

/// Extrait du vrai flux de l'hôte (capture WGC, encodage MF, transport UDP en boucle locale, reçu
/// par l'invité natif), enregistré pour le banc de l'aperçu : `%TEMP%\ibox-rp\sample.bin`, trames
/// `[u32 longueur][u8 image clé][u64 temps RTP][données]` (petit-boutiste). Sans fenêtre animée :
/// le flux suit ce qui bouge à l'écran. Variables : `IBOX_RP_SECS` (6), `IBOX_RP_HEIGHT` (720).
/// `cargo test --lib remote_play::guest::tests::enregistre_un_extrait -- --ignored --nocapture`
#[cfg(windows)]
#[test]
#[ignore]
fn enregistre_un_extrait() {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use crate::remote_play::capture::Target;
    use crate::remote_play::guest::run::{NativeGuest, Options};
    use crate::remote_play::input::Hotkey;
    use crate::remote_play::permissions::{Mode, Profile};
    use crate::remote_play::transport::host::{Host, HostOptions, Network};

    let env = |k: &str, d: u32| std::env::var(k).ok().and_then(|v| v.parse().ok()).unwrap_or(d);
    let host = Host::start(HostOptions {
        network: Network::Loopback,
        port: 0,
        target: Target::PrimaryMonitor,
        fps: 60,
        max_height: Some(env("IBOX_RP_HEIGHT", 720)),
        initial_kbps: 10_000,
        max_kbps: 30_000,
        profile: Profile::Spectator,
        mode: Mode::DesktopShare,
        hotkey: Hotkey::default(),
        blocked: Vec::new(),
        guest_account: "extrait".into(),
        frame_log: None,
        audio: false,
        hide_discord_echo: false,
        responsive: false,
    })
    .expect("hôte");
    let out: Arc<Mutex<Vec<u8>>> = Arc::default();
    let (sink, count) = (out.clone(), Arc::new(Mutex::new(0usize)));
    let n = count.clone();
    let guest = NativeGuest::start(host.offer(), Options { stun_servers: Vec::new(), loopback: true }, move |e| {
        if let GuestEvent::Video { data, rtp_time, keyframe, .. } = e {
            let mut b = sink.lock().unwrap();
            b.extend_from_slice(&(data.len() as u32).to_le_bytes());
            b.push(keyframe as u8);
            b.extend_from_slice(&rtp_time.to_le_bytes());
            b.extend_from_slice(&data);
            *n.lock().unwrap() += 1;
        }
    })
    .expect("invité");
    host.accept_answer(guest.answer()).expect("réponse");
    std::thread::sleep(Duration::from_secs(env("IBOX_RP_SECS", 6) as u64));
    guest.stop();
    host.stop();
    let dir = std::env::temp_dir().join("ibox-rp");
    std::fs::create_dir_all(&dir).unwrap();
    let bytes = out.lock().unwrap().clone();
    std::fs::write(dir.join("sample.bin"), &bytes).unwrap();
    println!("extrait : {} images, {} Ko", count.lock().unwrap(), bytes.len() / 1024);
    assert!(*count.lock().unwrap() > 0, "au moins une image");
}
