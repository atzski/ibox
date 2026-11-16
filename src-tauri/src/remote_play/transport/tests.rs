//! Hôte (`HostPeer`) ↔ invité simulé par un second `str0m::Rtc`, reliés en mémoire : ICE,
//! DTLS, SRTP et SCTP réels, sans réseau ni GPU. Vérifie la mise en paquets RTP de la vidéo,
//! les DataChannels et la chaîne décodage → permissions → injection.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use str0m::change::SdpOffer;
use str0m::channel::ChannelId;
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, Rtc, RtcConfig};

use super::peer::{h264_profile, network_kind, Datagram, HostPeer, PeerOptions, GUEST};
use super::router::MAX_CONTROL_LEN;
use crate::remote_play::encode::Profile as H264Profile;
use crate::remote_play::input::geometry::Rect;
use crate::remote_play::input::{Area, Engine, InjectError, Injector, LocalActivity, NoPads, OsInput, Screen, Sink};
use crate::remote_play::permissions::{Mode, Profile, Session};
use crate::remote_play::protocol::{decode, encode, Message, MAX_INPUT_LEN};

type Sent = Arc<Mutex<Vec<OsInput>>>;

struct Recorder(Sent);
impl Sink for Recorder {
    fn send(&mut self, inputs: &[OsInput]) -> Result<(), InjectError> {
        self.0.lock().unwrap().extend_from_slice(inputs);
        Ok(())
    }
}

struct FakeScreen;
impl Screen for FakeScreen {
    fn desktop(&self) -> Rect {
        Rect::new(0, 0, 1920, 1080)
    }
    fn resolve(&self, _: &Area) -> Option<Rect> {
        Some(Rect::new(0, 0, 1920, 1080))
    }
}

type TestEngine = Arc<Mutex<Engine<Recorder, FakeScreen, NoPads>>>;

fn engine(profile: Profile) -> (TestEngine, Sent) {
    let sent: Sent = Arc::default();
    let mut session = Session::new(Mode::DesktopShare, Vec::<String>::new());
    session.join(GUEST, "ami").unwrap();
    session.set_profile(GUEST, profile, false).unwrap();
    let injector = Injector::new(Recorder(sent.clone()), FakeScreen, NoPads, Area::Desktop, Arc::new(LocalActivity::new()));
    (Arc::new(Mutex::new(Engine::new(session, injector))), sent)
}

const HOST: &str = "10.0.0.1:5000";
const GUEST_ADDR: &str = "10.0.0.2:6000";

struct Pair {
    host: HostPeer<TestEngine>,
    guest: Rtc,
    now: Instant,
    guest_events: Vec<Event>,
    code: String,
}

fn addr(s: &str) -> SocketAddr {
    s.parse().unwrap()
}

impl Pair {
    fn new(profile: Profile) -> (Pair, Sent) {
        let now = Instant::now();
        let (eng, sent) = engine(profile);
        let opts = PeerOptions { initial_kbps: 4_000, max_kbps: 20_000 };
        let (mut host, offer) = HostPeer::new(opts, &[addr(HOST)], eng, now).unwrap();
        assert!(offer.contains("a=group:BUNDLE"), "offre complète");
        let mut guest = RtcConfig::new().clear_codecs().enable_h264(true).build(now);
        guest.add_local_candidate(Candidate::host(addr(GUEST_ADDR), "udp").unwrap());
        let answer = guest.sdp_api().accept_offer(SdpOffer::from_sdp_string(&offer).unwrap()).unwrap();
        let code = host.accept_answer(&answer.to_sdp_string()).unwrap();
        (Pair { host, guest, now, guest_events: Vec::new(), code }, sent)
    }

    /// Fait tourner les deux côtés pendant `ms` millisecondes simulées.
    fn run(&mut self, ms: u64) {
        let end = self.now + Duration::from_millis(ms);
        while self.now < end {
            self.step();
            self.now += Duration::from_millis(2);
            self.host.tick(self.now);
            self.guest.handle_input(Input::Timeout(self.now)).unwrap();
        }
    }

    fn step(&mut self) {
        for _ in 0..50 {
            let mut out: Vec<Datagram> = Vec::new();
            self.host.poll(self.now, &mut out);
            let mut back: Vec<Datagram> = Vec::new();
            for d in &out {
                let input = Input::Receive(self.now, Receive { proto: Protocol::Udp, source: d.source, destination: d.destination, contents: d.data.as_slice().try_into().unwrap() });
                if self.guest.accepts(&input) {
                    self.guest.handle_input(input).unwrap();
                }
            }
            loop {
                match self.guest.poll_output().unwrap() {
                    Output::Timeout(_) => break,
                    Output::Transmit(t) => back.push(Datagram { source: t.source, destination: t.destination, data: t.contents.into() }),
                    Output::Event(e) => self.guest_events.push(e),
                }
            }
            for d in &back {
                self.host.receive(self.now, d.source, d.destination, &d.data);
            }
            if out.is_empty() && back.is_empty() {
                return;
            }
        }
    }

    fn connect(&mut self) {
        for _ in 0..100 {
            self.run(20);
            if self.channel("input").is_some() && self.channel("control").is_some() && self.host.stats(self.now).connected {
                return;
            }
        }
        panic!("pas de connexion : {:?}", self.host.stats(self.now));
    }

    fn channel(&self, label: &str) -> Option<ChannelId> {
        self.guest_events.iter().find_map(|e| match e {
            Event::ChannelOpen(id, l) if l == label => Some(*id),
            _ => None,
        })
    }

    fn guest_send(&mut self, label: &str, bytes: &[u8]) {
        let id = self.channel(label).unwrap();
        self.guest.channel(id).unwrap().write(true, bytes).unwrap();
        self.run(40);
    }
}

fn annexb(nals: &[&[u8]]) -> Vec<u8> {
    nals.iter().flat_map(|n| [&[0, 0, 0, 1][..], n].concat()).collect()
}

#[test]
fn video_h264_mise_en_paquets_et_reconstituee() {
    let (mut p, _) = Pair::new(Profile::Spectator);
    p.connect();
    assert_eq!(p.code.len(), 14);
    assert_eq!(p.host.profile(), Some(H264Profile::High), "High proposé et accepté");
    let effects = p.host.take_effects();
    assert!(effects.connected && effects.keyframe, "IDR demandée dès la connexion : {effects:?}");

    // IDR de 6 000 octets : plus grande qu'un paquet, donc fragmentée en FU-A
    let sps: &[u8] = &[0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40];
    let pps: &[u8] = &[0x68, 0xeb, 0xe3, 0xcb];
    let mut idr = vec![0x65u8];
    idr.extend((0..6000).map(|i| (i % 251) as u8 | 1));
    let f1 = annexb(&[sps, pps, &idr]);
    let f2 = annexb(&[&[0x41, 0x9a, 0x02, 0x03]]);
    let start = p.now;
    p.host.write_frame(p.now, start, 0, &f1, Some(Duration::from_millis(4))).unwrap();
    p.run(30);
    p.host.write_frame(p.now, start, 166_667, &f2, None).unwrap();
    p.run(100);

    let frames: Vec<_> = p
        .guest_events
        .iter()
        .filter_map(|e| match e {
            Event::MediaData(m) => Some((m.data.clone(), m.time)),
            _ => None,
        })
        .collect();
    assert_eq!(frames.len(), 2, "deux images reçues");
    assert_eq!(&*frames[0].0, &f1[..], "IDR reconstituée à l'octet près");
    assert_eq!(&*frames[1].0, &f2[..]);
    assert_eq!(frames[1].1.numer() - frames[0].1.numer(), 1_500, "1/60 s à 90 kHz");
    assert_eq!((frames[0].1.numer(), frames[0].1.denom()), (0, 90_000), "temps RTP conservé tel qu'écrit");

    let s = p.host.stats(p.now);
    assert_eq!((s.frames, s.keyframes), (2, 1));
    assert!(s.connect_ms.is_some() && s.sent_kbps > 0.0);
    // statistiques RTCP / paire ICE : émises toutes les secondes
    p.run(2_500);
    let s = p.host.stats(p.now);
    assert_eq!(s.local_candidate.as_deref(), Some("lan"));
    assert_eq!(s.remote_candidate.as_deref(), Some("lan"));
    assert!(s.rtt_ms.is_some(), "RTT mesuré : {s:?}");
    assert!(s.bwe_kbps.is_some(), "estimation TWCC reçue : {s:?}");
}

#[test]
fn messages_hors_limites_ou_refuses_sans_effet() {
    let (mut p, sent) = Pair::new(Profile::Spectator);
    p.connect();
    // trop long pour `input`, puis un appui de touche sur le canal non fiable
    p.guest_send("input", &vec![0x10; MAX_INPUT_LEN + 1]);
    p.guest_send("input", &encode(&Message::Key { scancode: 0x1e, down: true }));
    p.guest_send("control", &vec![0x40; MAX_CONTROL_LEN + 1]);
    p.guest_send("control", &[0x77, 1, 2]);
    // bien formé mais refusé : un spectateur n'a pas la souris
    p.guest_send("input", &encode(&Message::MouseAbs { seq: 1, x: 10, y: 10 }));
    // une vibration ne peut venir que de l'hôte
    p.guest_send("control", &encode(&Message::Rumble { pad: 0, large: 255, small: 255 }));
    let s = p.host.stats(p.now);
    assert_eq!((s.inputs.received, s.inputs.rejected, s.inputs.denied, s.inputs.injected), (6, 4, 2, 0), "{:?}", s.inputs);
    assert!(sent.lock().unwrap().is_empty(), "rien injecté");
}

#[test]
fn ping_renvoye_et_entrees_autorisees_injectees_puis_relachees() {
    let (mut p, sent) = Pair::new(Profile::Collaborator);
    p.connect();
    p.guest_send("control", &encode(&Message::Ping { id: 42, micros: 123_456 }));
    let control = p.channel("control").unwrap();
    let pong = p.guest_events.iter().find_map(|e| match e {
        Event::ChannelData(d) if d.id == control => decode(&d.data).ok(),
        _ => None,
    });
    assert_eq!(pong, Some(Message::Pong { id: 42, micros: 123_456 }));

    p.guest_send("control", &encode(&Message::Key { scancode: 0x1e, down: true }));
    p.guest_send("input", &encode(&Message::MouseAbs { seq: 1, x: 32768, y: 32768 }));
    assert_eq!(sent.lock().unwrap().len(), 2, "touche + mouvement injectés");
    // fermeture : la touche encore tenue est relâchée
    p.host.close();
    let log = sent.lock().unwrap().clone();
    assert_eq!(log.last(), Some(&OsInput::Key { scan: 0x1e, extended: false, up: true }));
    assert!(p.host.take_effects().closed);
}

#[test]
fn profils_h264_et_reseaux() {
    assert_eq!(h264_profile(0x64001f), Some(H264Profile::High));
    assert_eq!(h264_profile(0x4d001f), Some(H264Profile::Main));
    assert_eq!(h264_profile(0x42e01f), Some(H264Profile::Baseline));
    assert_eq!(h264_profile(0x42001f), None, "Baseline non contraint : FMO/ASO possibles");
    assert_eq!(h264_profile(0xf4001f), None);
    assert_eq!(network_kind(&addr("127.0.0.1:1")), "loopback");
    assert_eq!(network_kind(&addr("192.168.1.2:1")), "lan");
    assert_eq!(network_kind(&addr("[fe80::1]:1")), "lan");
    assert_eq!(network_kind(&addr("8.8.8.8:1")), "internet");
}
