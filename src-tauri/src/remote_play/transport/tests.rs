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

pub(crate) type Sent = Arc<Mutex<Vec<OsInput>>>;

pub(crate) struct Recorder(Sent);
impl Sink for Recorder {
    fn send(&mut self, inputs: &[OsInput]) -> Result<(), InjectError> {
        self.0.lock().unwrap().extend_from_slice(inputs);
        Ok(())
    }
}

pub(crate) struct FakeScreen;
impl Screen for FakeScreen {
    fn desktop(&self) -> Rect {
        Rect::new(0, 0, 1920, 1080)
    }
    fn resolve(&self, _: &Area) -> Option<Rect> {
        Some(Rect::new(0, 0, 1920, 1080))
    }
}

pub(crate) type TestEngine = Arc<Mutex<Engine<Recorder, FakeScreen, NoPads>>>;

pub(crate) fn engine(profile: Profile) -> (TestEngine, Sent) {
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
        let opts = PeerOptions { initial_kbps: 4_000, max_kbps: 20_000, responsive: false };
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

pub(crate) fn annexb(nals: &[&[u8]]) -> Vec<u8> {
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
    p.host.write_frame(p.now, start, 0, f1.clone(), Some(Duration::from_millis(4)), Duration::from_millis(3)).unwrap();
    p.run(30);
    p.host.write_frame(p.now, start, 166_667, f2.clone(), None, Duration::ZERO).unwrap();
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

fn control_messages(p: &Pair) -> Vec<Message> {
    let control = p.channel("control").unwrap();
    p.guest_events
        .iter()
        .filter_map(|e| match e {
            Event::ChannelData(d) if d.id == control => decode(&d.data).ok(),
            _ => None,
        })
        .collect()
}

#[test]
fn chaque_image_est_suivie_jusqu_au_reseau_et_mesuree_pour_l_invite() {
    let (mut p, _) = Pair::new(Profile::Spectator);
    p.connect();
    let start = p.now;
    let idr = annexb(&[&[0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40], &[0x68, 0xeb, 0xe3, 0xcb], &[0x65, 1, 2, 3]]);
    // image capturée 3 ms avant son envoi à l'encodeur, encodée en 4 ms
    let written = p.now + Duration::from_millis(4);
    p.host.write_frame(written, start, 0, idr, Some(Duration::from_millis(4)), Duration::from_millis(3)).unwrap();
    assert_eq!(p.host.backlog(written).0, 1, "en file tant que son dernier paquet n'est pas parti");
    p.run(40);
    assert_eq!(p.host.backlog(p.now), (0, Duration::ZERO), "partie");

    let s = p.host.stats(p.now);
    assert_eq!(s.capture_wait_ms_p50, Some(3.0));
    let host_ms = s.host_ms_p50.expect("capture → réseau mesuré");
    assert!(host_ms >= 7.0, "au moins l'attente et l'encodage : {host_ms}");
    assert!(s.send_queue_ms_p50.is_some());

    // l'invité reçoit la mesure de cette image, datée par son temps RTP
    let rtp = p.guest_events.iter().find_map(|e| match e {
        Event::MediaData(m) => Some(m.time.numer() as u32),
        _ => None,
    });
    let timing = control_messages(&p).into_iter().find_map(|m| match m {
        Message::Timing { rtp, capture_micros, sent_micros, host_micros } => Some((rtp, capture_micros, sent_micros, host_micros)),
        _ => None,
    });
    let (t_rtp, capture, sent, host) = timing.expect("Timing reçu");
    assert_eq!(Some(t_rtp), rtp);
    assert!((host as f64 / 1000.0 - host_ms).abs() < 0.01, "même mesure des deux côtés");
    assert!(sent > capture, "envoyé après la capture");
}

#[test]
fn rapport_de_l_invite_affiche_borne_et_timing_refuse_dans_ce_sens() {
    let (mut p, sent) = Pair::new(Profile::Spectator);
    p.connect();
    p.guest_send("control", &encode(&Message::Report { total_micros: 23_400, guest_micros: 9_100 }));
    let s = p.host.stats(p.now);
    assert_eq!((s.guest_latency_ms, s.guest_display_ms), (Some(23.4), Some(9.1)));
    assert_eq!((s.inputs.rejected, s.inputs.denied), (0, 0), "un rapport n'est pas une entrée refusée");
    // valeur absurde : non affichée
    p.guest_send("control", &encode(&Message::Report { total_micros: u32::MAX, guest_micros: 1 }));
    assert_eq!(p.host.stats(p.now).guest_latency_ms, None);
    // une mesure d'hôte ne peut pas venir de l'invité, ni par le canal non fiable
    let timing = encode(&Message::Timing { rtp: 1, capture_micros: 2, sent_micros: 3, host_micros: 4 });
    p.guest_send("control", &timing);
    p.guest_send("input", &timing);
    let s = p.host.stats(p.now);
    assert_eq!((s.inputs.rejected, s.inputs.denied), (1, 1), "{:?}", s.inputs);
    assert!(sent.lock().unwrap().is_empty());
}

#[test]
fn en_tete_rtp_des_paquets_sortants() {
    use super::peer::rtp_header;
    // V=2, marqueur, type 102, temps RTP 0x01020304
    let mut rtp = vec![0x80, 0x80 | 102, 0, 1, 1, 2, 3, 4, 0, 0, 0, 9];
    assert_eq!(rtp_header(&rtp), Some((102, true, 0x0102_0304)));
    rtp[1] = 102;
    assert_eq!(rtp_header(&rtp), Some((102, false, 0x0102_0304)));
    // bourrage, RTCP (types 192–223), STUN, DTLS, trop court
    rtp[0] = 0xa0;
    assert_eq!(rtp_header(&rtp), None);
    assert_eq!(rtp_header(&[0x80, 200, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]), None);
    assert_eq!(rtp_header(&[0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), None);
    assert_eq!(rtp_header(&[22, 254, 253, 0, 0, 0, 0, 0, 0, 0, 0, 0]), None);
    assert_eq!(rtp_header(&[0x80, 102]), None);
}

#[test]
fn une_image_cle_par_intervalle_meme_si_l_invite_en_redemande() {
    use str0m::media::{KeyframeRequestKind, MediaKind};
    let (mut p, _) = Pair::new(Profile::Spectator);
    p.connect();
    p.host.take_effects();
    let mid = p
        .guest_events
        .iter()
        .find_map(|e| match e {
            Event::MediaAdded(m) if m.kind == MediaKind::Video => Some(m.mid),
            _ => None,
        })
        .expect("piste vidéo chez l'invité");
    let start = p.now;
    let idr = annexb(&[&[0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40], &[0x68, 0xeb, 0xe3, 0xcb], &[0x65, 1, 2, 3]]);
    p.host.write_frame(p.now, start, 0, idr, None, Duration::ZERO).unwrap();
    p.run(20);
    // l'invité redemande une image clé alors qu'une vient de partir : ignorée
    p.guest.writer(mid).unwrap().request_keyframe(None, KeyframeRequestKind::Pli).unwrap();
    p.run(60);
    assert!(!p.host.take_effects().keyframe, "l'image clé partie il y a 80 ms répond déjà à la demande");
    assert_eq!(p.host.stats(p.now).keyframes_throttled, 1);
    // plus tard, la demande est honorée
    p.run(400);
    p.guest.writer(mid).unwrap().request_keyframe(None, KeyframeRequestKind::Pli).unwrap();
    p.run(60);
    assert!(p.host.take_effects().keyframe);
}
