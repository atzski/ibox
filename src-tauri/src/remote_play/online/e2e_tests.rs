//! Essai réel de bout en bout, sans WebView : deux comptes iNetbox **temporaires** sur un serveur
//! iNetbox local (`services/inetbox`, PGlite), clés d'appareil, invitation, acceptation, offre et
//! réponse signées par la boîte aux lettres, épinglage, code de sécurité ; puis l'hôte complet
//! (`Host`, réseau `Internet` : STUN réel, capture WGC, NVENC, str0m) face à un invité str0m qui
//! a lui aussi rassemblé ses candidats par STUN, sur de vraies sockets UDP de ce PC.
//!
//! `#[ignore]` : serveur local, réseau, bureau ouvert et GPU requis.
//! ```text
//! cd services/inetbox && set DATA_DIR=%TEMP%\inetbox-e2e && npx tsx src/main.ts
//! cargo test --release --lib remote_play::online::e2e_tests -- --ignored --nocapture --test-threads=1
//! ```
//! Variables : `IBOX_RP_SERVER` (http://127.0.0.1:4318) ; `IBOX_RP_SRFLX_ONLY=1` ne garde que les
//! candidats publics (`srflx`) des deux côtés : la connexion doit alors repasser par le routeur
//! (« hairpinning »), au plus près d'une session entre deux connexions Internet.

use std::collections::HashMap;
use std::net::{IpAddr, UdpSocket};
use std::time::{Duration, Instant};

use reqwest::blocking::Client;
use serde_json::{json, Value};
use str0m::change::SdpOffer;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event as RtcEvent, Input, Output, RtcConfig};

use super::api::Api;
use super::sides::{Event, GuestSide, HostSide};
use crate::remote_play::capture::Target;
use crate::remote_play::permissions::{Mode, Profile};
use crate::remote_play::signaling::identity::DeviceKey;
use crate::remote_play::signaling::pinning::Pins;
use crate::remote_play::transport::host::{lan_ipv4, set_socket_buffers, Host, HostOptions, Network, SOCKET_BUFFER};
use crate::remote_play::transport::stun;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64
}

struct Account {
    token: String,
    id: String,
    code: String,
}

fn register(base: &str, client: &Client, name: &str) -> Account {
    let v: Value = client
        .post(format!("{base}/v1/auth/register"))
        .json(&json!({ "username": name, "displayName": name, "password": format!("e2e-temporary-{name}-pass!") }))
        .send()
        .unwrap()
        .json()
        .unwrap();
    Account { token: v["token"].as_str().expect("compte créé").into(), id: v["user"]["id"].as_str().unwrap().into(), code: v["user"]["friendCode"].as_str().unwrap().into() }
}

/// Garde seulement les candidats `srflx` d'un SDP (essai « comme par Internet »).
fn srflx_only(sdp: &str) -> String {
    sdp.split_inclusive('\n').filter(|l| !l.starts_with("a=candidate:") || l.contains(" typ srflx")).collect()
}

#[test]
#[ignore = "serveur iNetbox local, réseau, bureau et GPU"]
fn invitation_signature_stun_et_connexion() {
    let base = std::env::var("IBOX_RP_SERVER").unwrap_or_else(|_| "http://127.0.0.1:4318".into());
    let only_srflx = std::env::var("IBOX_RP_SRFLX_ONLY").is_ok_and(|v| v == "1");
    let client = Client::builder().timeout(Duration::from_secs(10)).build().unwrap();
    let suffix = now_ms() % 1_000_000_000;
    let alice = register(&base, &client, &format!("e2eh{suffix}"));
    let bob = register(&base, &client, &format!("e2eg{suffix}"));
    let auth = |t: &str| format!("Bearer {t}");
    let r = client.post(format!("{base}/v1/friend-requests")).header("authorization", auth(&alice.token)).json(&json!({ "friendCode": bob.code })).send().unwrap();
    assert!(r.status().is_success(), "demande d'ami : {}", r.status());
    let r = client.post(format!("{base}/v1/friend-requests/{}/accept", alice.id)).header("authorization", auth(&bob.token)).send().unwrap();
    assert!(r.status().is_success(), "acceptation : {}", r.status());

    let host_api = Api::new(&base, alice.token.clone()).unwrap();
    let guest_api = Api::new(&base, bob.token.clone()).unwrap();
    let host_key = DeviceKey::generate().unwrap();
    let guest_key = DeviceKey::generate().unwrap();
    let host_dev = host_api.register_device(&host_key, &alice.id, "Hôte e2e").unwrap();
    let guest_dev = guest_api.register_device(&guest_key, &bob.id, "Invité e2e").unwrap();

    // refus par défaut côté serveur, tant que l'ami n'accepte pas les demandes
    assert_eq!(host_api.create_invite(&bob.id, "watch").unwrap_err().code, "REQUESTS_REFUSED");
    assert!(guest_api.set_accept_requests(true).unwrap());

    // 1. invitation, réception, acceptation
    let invite = host_api.create_invite(&bob.id, "watch").unwrap();
    let incoming = guest_api.incoming().unwrap();
    let got = incoming.iter().find(|i| i.id == invite.id).expect("invitation reçue");
    assert_eq!((got.mode.as_str(), got.from_id.as_str()), ("watch", alice.id.as_str()));
    assert_eq!(host_api.poll(&invite.id, 0).unwrap().state, "pending");
    let redeemed = guest_api.redeem(&got.token).unwrap();
    assert_eq!(redeemed.session_id, invite.id);
    assert_eq!(guest_api.redeem(&got.token).unwrap_err().code, "INVITE_UNAVAILABLE", "jeton à usage unique");
    assert_eq!(host_api.poll(&invite.id, 0).unwrap().state, "open");

    // 2. hôte réel en mode Internet (STUN), offre signée
    let t0 = Instant::now();
    let host = Host::start(HostOptions {
        network: Network::Internet { stun: crate::remote_play::config::Config::default().stun_servers },
        port: 0,
        target: Target::PrimaryMonitor,
        fps: 60,
        max_height: Some(720),
        initial_kbps: 4_000,
        max_kbps: 8_000,
        profile: Profile::Spectator,
        mode: Mode::DesktopShare,
        // raccourci peu courant : la garde est obligatoire par Internet
        hotkey: "Ctrl+Alt+Shift+F11".parse().unwrap_or_default(),
        blocked: vec![],
        guest_account: bob.id.clone(),
        frame_log: None,
        audio: false,
        hide_discord_echo: false,
    })
    .expect("hôte");
    println!("hôte prêt en {} ms, NAT {:?}", t0.elapsed().as_millis(), host.nat());
    let offer_sdp = if only_srflx { srflx_only(host.offer()) } else { host.offer().to_string() };
    let srflx = offer_sdp.lines().filter(|l| l.contains(" typ srflx")).count();
    println!("offre : {} candidat(s) dont {srflx} srflx", offer_sdp.lines().filter(|l| l.starts_with("a=candidate:")).count());
    let mut hside = HostSide::new(&invite.id, &alice.id, &bob.id, &invite.token, invite.expires_at + 60_000);
    host_api.send(&invite.id, &bob.id, &host_dev, &hside.offer(&host_key, &offer_sdp, now_ms()).unwrap()).unwrap();

    // 3. invité : vérifie l'offre (signature, épinglage, jeton, empreinte)
    let mut gside = GuestSide::new(&redeemed.session_id, &bob.id, &alice.id, &redeemed.token);
    let mut guest_pins = Pins::in_memory();
    let host_devices = guest_api.friend_devices(&alice.id).unwrap();
    let mail = guest_api.poll(&redeemed.session_id, 5).unwrap().items.pop().expect("offre reçue");
    assert_eq!(mail.device_id, host_dev);
    let Event::Description(offer) = gside.on_mail(&guest_key, &host_devices, &mut guest_pins, &mail, now_ms()).unwrap() else { panic!("pas une offre") };
    assert_eq!(offer, offer_sdp);

    // invité str0m : socket locale + candidat public obtenu par STUN, comme le ferait Chromium
    let sock = UdpSocket::bind((IpAddr::V4(lan_ipv4().unwrap()), 0)).unwrap();
    let local = sock.local_addr().unwrap();
    set_socket_buffers(&sock, SOCKET_BUFFER);
    let gathered = stun::gather(&sock, &stun::resolve(&crate::remote_play::config::Config::default().stun_servers, false), Duration::from_millis(1500));
    println!("invité : NAT {:?}, {} adresse(s) publique(s)", gathered.nat(), gathered.reflexive().len());
    let mut guest = RtcConfig::new().clear_codecs().enable_h264(true).build(Instant::now());
    guest.add_local_candidate(Candidate::host(local, "udp").unwrap());
    for public in gathered.reflexive() {
        guest.add_local_candidate(Candidate::server_reflexive(public, local, "udp").unwrap());
    }
    let answer = guest.sdp_api().accept_offer(SdpOffer::from_sdp_string(&offer).unwrap()).unwrap().to_sdp_string();
    let answer = if only_srflx { srflx_only(&answer) } else { answer };
    guest_api.send(&redeemed.session_id, &alice.id, &guest_dev, &gside.answer(&guest_key, &answer, now_ms()).unwrap()).unwrap();

    // 4. hôte : vérifie la réponse, consomme le jeton, accepte
    let mut host_pins = Pins::in_memory();
    let guest_devices = host_api.friend_devices(&bob.id).unwrap();
    let mail = host_api.poll(&invite.id, 5).unwrap().items.pop().expect("réponse reçue");
    let Event::Description(answer_got) = hside.on_mail(&host_key, &guest_devices, &mut host_pins, &mail, now_ms()).unwrap() else { panic!("pas une réponse") };
    host.accept_answer(&answer_got).expect("réponse acceptée");
    let (hcode, gcode) = (hside.peer.clone().unwrap().safety_code, gside.peer.clone().unwrap().safety_code);
    assert_eq!(hcode, gcode, "même code de sécurité des deux côtés");
    println!("code de sécurité identique des deux côtés ({} groupes)", hcode.split_whitespace().count());

    // 5. connexion réelle et images reçues
    let started = Instant::now();
    let mut connected: Option<Duration> = None;
    let mut frames = 0usize;
    let mut bytes = 0usize;
    let mut buf = vec![0u8; 2048];
    let mut channels = HashMap::new();
    while started.elapsed() < Duration::from_secs(40) {
        let timeout = loop {
            match guest.poll_output().unwrap() {
                Output::Timeout(t) => break t,
                Output::Transmit(t) => {
                    let data: Vec<u8> = t.contents.into();
                    let _ = sock.send_to(&data, t.destination);
                }
                Output::Event(RtcEvent::Connected) => connected = Some(started.elapsed()),
                Output::Event(RtcEvent::ChannelOpen(id, label)) => {
                    channels.insert(label, id);
                }
                Output::Event(RtcEvent::MediaData(m)) => {
                    frames += 1;
                    bytes += m.data.len();
                }
                Output::Event(_) => {}
            }
        };
        let wait = timeout.saturating_duration_since(Instant::now()).clamp(Duration::from_millis(1), Duration::from_millis(20));
        sock.set_read_timeout(Some(wait)).unwrap();
        if let Ok((n, source)) = sock.recv_from(&mut buf) {
            let input = Input::Receive(Instant::now(), Receive { proto: Protocol::Udp, source, destination: local, contents: buf[..n].try_into().unwrap() });
            let _ = guest.handle_input(input);
        }
        let _ = guest.handle_input(Input::Timeout(Instant::now()));
        if connected.is_some_and(|c| started.elapsed() > c + Duration::from_secs(5)) {
            break;
        }
    }
    let stats = host.stats();
    println!(
        "connexion : {:?} ; {} images reçues ({} Ko) ; état {} ; type {:?} (local {:?}, distant {:?}) ; erreur {:?}",
        connected, frames, bytes / 1024, stats.state, stats.path, stats.local_candidate, stats.remote_candidate, stats.error
    );

    // 6. départ de l'invité, vu par l'hôte
    guest_api.send(&redeemed.session_id, &alice.id, &guest_dev, &gside.bye(&guest_key, now_ms()).unwrap()).unwrap();
    let mail = host_api.poll(&invite.id, 5).unwrap().items.pop().expect("au revoir reçu");
    assert_eq!(hside.on_mail(&host_key, &guest_devices, &mut host_pins, &mail, now_ms()).unwrap(), Event::Bye);
    host.stop();
    host_api.end(&invite.id).ok();

    // nettoyage : comptes temporaires supprimés
    for (who, name) in [(&alice, format!("e2eh{suffix}")), (&bob, format!("e2eg{suffix}"))] {
        let _ = client.delete(format!("{base}/v1/me")).header("authorization", auth(&who.token)).json(&json!({ "password": format!("e2e-temporary-{name}-pass!") })).send();
    }
    assert!(connected.is_some(), "aucune connexion ICE/DTLS");
    assert!(frames > 30, "trop peu d'images reçues : {frames}");
}
