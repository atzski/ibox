//! Hôte réel : fils et sockets autour de [`HostPeer`], sans tokio.
//!
//! - un fil de lecture par socket UDP (une socket par candidat local, l'adresse de destination
//!   de chaque paquet est donc connue) ;
//! - un fil capture WGC → NV12 → H.264 (`encode::pipeline::stream`), démarré à la connexion ;
//! - un fil `remote-play-transport` qui possède le `Rtc` : il reçoit paquets, images et
//!   commandes par un seul canal `mpsc` et dort jusqu'au prochain délai de str0m.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::peer::{Datagram, HostPeer, InputHandler, PeerOptions, GUEST};
use super::stats::TransportStats;
use super::stun::{self, NatKind};
use crate::remote_play::capture::{Options as CaptureOptions, Target};
use crate::remote_play::encode::mf::Packet;
use crate::remote_play::encode::pipeline::{self, Control, Opened, Settings};
use crate::remote_play::encode::{Preference, Profile as H264Profile};
use crate::remote_play::input::{self, Area, Hotkey, Injector, LocalActivity, Pads, StopReason};
use crate::remote_play::permissions::{Mode, Permission, Profile, Session};
use crate::remote_play::protocol::Message;

/// Sans réponse ni connexion dans ce délai, la session s'arrête.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(180);
/// Réponse acceptée mais aucune paire ICE validée dans ce délai : échec expliqué.
pub const ICE_TIMEOUT: Duration = Duration::from_secs(30);
/// Durée maximale de la collecte STUN avant l'offre.
pub const STUN_TIMEOUT: Duration = Duration::from_millis(1500);

/// Où l'invité se trouve, donc quels candidats offrir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Network {
    /// 127.0.0.1 seulement (essai sur ce PC).
    Loopback,
    /// Adresse IPv4 de la route par défaut (même réseau local).
    Lan,
    /// Adresses locales IPv4 (et IPv6 si disponible) + adresses publiques obtenues des serveurs
    /// STUN donnés (`stun:hôte:port`). Jamais de relais.
    Internet { stun: Vec<String> },
}

#[derive(Debug, Clone)]
pub struct HostOptions {
    pub network: Network,
    pub port: u16,
    pub target: Target,
    pub fps: u32,
    pub max_height: Option<u32>,
    pub initial_kbps: u32,
    pub max_kbps: u32,
    pub profile: Profile,
    pub mode: Mode,
    pub hotkey: Hotkey,
    pub blocked: Vec<String>,
    /// Compte de l'invité (affichage, blocage) ; « lan » pour l'échange manuel.
    pub guest_account: String,
    /// Essais seulement : (temps RTP 90 kHz, instant d'envoi à l'encodeur) de chaque image
    /// envoyée, pour mesurer la latence image par image côté invité.
    pub frame_log: Option<FrameLog>,
    /// Envoyer le son du PC (sortie par défaut) à l'invité, s'il en a la permission.
    pub audio: bool,
    /// « Masquer l'écho Discord » : le son de Discord (voix de l'appel) n'est pas renvoyé.
    pub hide_discord_echo: bool,
}

/// (temps RTP 90 kHz, envoi à l'encodeur, remise à str0m).
pub type FrameLog = Arc<Mutex<Vec<(u64, Instant, Instant)>>>;

enum Msg {
    Udp { at: Instant, source: SocketAddr, destination: SocketAddr, data: Vec<u8> },
    Frame { packet: Packet, origin: Instant },
    Opened(Opened),
    VideoEnded(Result<(), String>),
    Audio { packet: crate::remote_play::audio::AudioPacket, origin: Instant },
    Answer(String, Sender<Result<String, String>>),
    RemoteCandidate(String),
    Rumble { pad: u8, large: u8, small: u8 },
    Emergency(StopReason),
    Stop,
}

pub struct Host {
    tx: Sender<Msg>,
    nat: (Option<NatKind>, Option<NatKind>),
    stats: Arc<Mutex<TransportStats>>,
    offer: String,
    join: Mutex<Option<JoinHandle<()>>>,
}

/// Adresse IPv4 de l'interface qui porte la route par défaut. `connect` sur une socket UDP
/// n'émet aucun paquet : il fait seulement choisir la route au système.
pub fn lan_ipv4() -> Result<Ipv4Addr, String> {
    let s = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|e| e.to_string())?;
    s.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).map_err(|e| format!("aucune route réseau : {e}"))?;
    match s.local_addr().map_err(|e| e.to_string())?.ip() {
        IpAddr::V4(ip) if !ip.is_unspecified() && !ip.is_loopback() => Ok(ip),
        _ => Err("aucune adresse IPv4 locale".into()),
    }
}

/// Tampons d'émission et de réception de la socket UDP. Le défaut de Windows (64 Ko) déborde
/// sous les rafales d'une IDR 4K (≈ 150–350 Ko) : paquets perdus, retransmissions, images en
/// retard. Renvoie la taille effectivement acceptée en réception.
pub fn set_socket_buffers(socket: &UdpSocket, bytes: i32) -> i32 {
    use std::os::windows::io::AsRawSocket;
    use windows_sys::Win32::Networking::WinSock::{getsockopt, setsockopt, SOL_SOCKET, SO_RCVBUF, SO_SNDBUF};
    let raw = socket.as_raw_socket() as usize;
    let value = bytes.to_ne_bytes();
    let mut got = 0i32;
    let mut len = size_of::<i32>() as i32;
    unsafe {
        setsockopt(raw, SOL_SOCKET, SO_RCVBUF, value.as_ptr(), 4);
        setsockopt(raw, SOL_SOCKET, SO_SNDBUF, value.as_ptr(), 4);
        getsockopt(raw, SOL_SOCKET, SO_RCVBUF, (&mut got as *mut i32).cast(), &mut len);
    }
    got
}

pub const SOCKET_BUFFER: i32 = 4 * 1024 * 1024;

/// Adresse IPv6 globale de la route par défaut, s'il y en a une (aucun paquet émis).
pub fn route_ipv6() -> Option<std::net::Ipv6Addr> {
    let s = UdpSocket::bind((std::net::Ipv6Addr::UNSPECIFIED, 0)).ok()?;
    s.connect(("2001:db8::1", 9)).ok()?;
    match s.local_addr().ok()?.ip() {
        // ni boucle locale, ni lien local (fe80::/10), ni adresse non spécifiée
        IpAddr::V6(ip) if !ip.is_unspecified() && !ip.is_loopback() && (ip.segments()[0] & 0xffc0) != 0xfe80 => Some(ip),
        _ => None,
    }
}

/// Explication d'un échec ICE à montrer à l'hôte, d'après ce que STUN a appris de son réseau.
/// Jamais d'adresse. iBox n'a pas de relais : on le dit, on ne bascule jamais en silence.
pub fn ice_failure_message(network: &Network, nat_v4: Option<NatKind>, nat_v6: Option<NatKind>) -> String {

    match network {
        Network::Loopback => "Aucune connexion sur ce PC.".to_string(),
        Network::Lan => "Aucune connexion : les deux PC sont-ils sur le même réseau ? Le pare-feu Windows doit autoriser iBox (réseau privé).".to_string(),
        Network::Internet { .. } => {
            let v6_open = nat_v6 == Some(NatKind::Open);
            let no_stun = [nat_v4, nat_v6].iter().all(|n| n.is_none_or(|n| n == NatKind::NoResponse));
            if no_stun {
                "Connexion impossible : aucun serveur STUN n'a répondu, l'UDP sortant semble bloqué sur ce réseau. iBox n'utilise aucun relais (TURN) : autorisez iBox dans le pare-feu ou essayez un autre réseau.".to_string()
            } else if nat_v4 == Some(NatKind::Symmetric) && !v6_open {
                "Connexion impossible : le routeur de ce PC change d'adresse publique selon le destinataire (NAT symétrique). Sans relais (TURN), qu'iBox n'utilise pas, la connexion directe échoue souvent. Essayez un autre réseau (partage de connexion d'un téléphone).".to_string()
            } else {
                "Connexion impossible : le réseau ou le pare-feu de votre ami bloque probablement l'UDP, ou son routeur est en NAT symétrique. iBox n'utilise aucun relais (TURN). Vérifiez le pare-feu Windows des deux côtés, puis essayez un autre réseau.".to_string()
            }
        }
    }
}

/// Socket UDP d'un candidat local.
struct Bound {
    socket: UdpSocket,
    local: SocketAddr,
}

fn bind(ip: IpAddr, port: u16) -> Result<Bound, String> {
    let socket = UdpSocket::bind((ip, port)).map_err(|e| format!("port UDP {port} indisponible : {e}"))?;
    let local = socket.local_addr().map_err(|e| e.to_string())?;
    set_socket_buffers(&socket, SOCKET_BUFFER);
    Ok(Bound { socket, local })
}

type OpenedSockets = (Vec<Bound>, Vec<(SocketAddr, SocketAddr)>, Option<NatKind>, Option<NatKind>);

/// Ouvre les sockets du réseau demandé ; en mode Internet, interroge STUN depuis chacune (en
/// parallèle, avant toute lecture) : renvoie les candidats `srflx` (public, base) et le NAT vu.
fn open_sockets(network: &Network, port: u16) -> Result<OpenedSockets, String> {
    match network {
        Network::Loopback => Ok((vec![bind(IpAddr::V4(Ipv4Addr::LOCALHOST), port)?], vec![], None, None)),
        Network::Lan => Ok((vec![bind(IpAddr::V4(lan_ipv4()?), port)?], vec![], None, None)),
        Network::Internet { stun: servers } => {
            let mut sockets = Vec::new();
            let v4 = lan_ipv4().ok();
            if let Some(ip) = v4 {
                sockets.push(bind(IpAddr::V4(ip), port)?);
            }
            if let Some(ip) = route_ipv6() {
                // le port demandé peut déjà être pris en IPv6 : on n'en fait pas un échec
                if let Ok(b) = bind(IpAddr::V6(ip), if v4.is_some() { 0 } else { port }) {
                    sockets.push(b);
                }
            }
            if sockets.is_empty() {
                return Err("aucune connexion réseau (ni IPv4 ni IPv6)".into());
            }
            let gathered: Vec<stun::Gathered> = std::thread::scope(|scope| {
                let jobs: Vec<_> = sockets
                    .iter()
                    .map(|b| {
                        let servers = servers.clone();
                        scope.spawn(move || stun::gather(&b.socket, &stun::resolve(&servers, b.local.is_ipv6()), STUN_TIMEOUT))
                    })
                    .collect();
                jobs.into_iter().map(|j| j.join().unwrap_or_default()).collect()
            });
            let mut reflexive = Vec::new();
            let (mut nat_v4, mut nat_v6) = (None, None);
            for (b, g) in sockets.iter().zip(&gathered) {
                for public in g.reflexive() {
                    reflexive.push((public, b.local));
                }
                if b.local.is_ipv4() {
                    nat_v4 = Some(g.nat());
                } else {
                    nat_v6 = Some(g.nat());
                }
            }
            Ok((sockets, reflexive, nat_v4, nat_v6))
        }
    }
}

/// Le profil et le mode de l'invité lui donnent-ils le son ?
fn peer_grants_audio(opts: &HostOptions) -> bool {
    let mut session = Session::new(opts.mode, opts.blocked.clone());
    session.join(GUEST, &opts.guest_account).is_ok() && session.set_profile(GUEST, opts.profile, false).is_ok() && session.effective(GUEST).has(Permission::Audio)
}

fn area_for(target: Target) -> Area {
    match target {
        Target::PrimaryMonitor => {
            use windows::Win32::Foundation::POINT;
            use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
            Area::Monitor(unsafe { MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) }.0 as isize)
        }
        Target::Monitor(h) => Area::Monitor(h),
        Target::Window(h) => Area::Window(h),
    }
}

impl Host {
    /// Ouvre les sockets, prépare l'offre SDP et démarre la boucle. La capture ne démarre qu'à la
    /// connexion de l'invité.
    pub fn start(opts: HostOptions) -> Result<Host, String> {
        if opts.profile == Profile::FullControl {
            return Err("le Contrôle complet demande une confirmation distincte (non disponible en échange manuel)".into());
        }
        let (sockets, reflexive, nat_v4, nat_v6) = open_sockets(&opts.network, opts.port)?;
        let (tx, rx) = mpsc::channel::<Msg>();

        // permissions + injection ; la garde (arrêt d'urgence) est obligatoire dès qu'une entrée est permise
        let mut session = Session::new(opts.mode, opts.blocked.clone());
        session.join(GUEST, &opts.guest_account).map_err(|e| format!("invité refusé : {e:?}"))?;
        session.set_profile(GUEST, opts.profile, false).map_err(|e| format!("profil refusé : {e:?}"))?;
        let grants = session.effective(GUEST);
        if grants.has(Permission::Gamepad) {
            // la manette de l'invité occupe l'emplacement de session 0 : branchée en manette
            // Xbox 360 virtuelle, Windows lui donne le premier numéro libre (P2 si l'hôte joue déjà)
            session.assign_pad(GUEST, Some(0)).map_err(|e| format!("manette refusée : {e:?}"))?;
        }
        let pads: Box<dyn Pads> = if grants.has(Permission::Gamepad) {
            let rumble_tx = Mutex::new(tx.clone());
            let on_rumble: input::RumbleFn = Arc::new(move |pad, large, small| {
                let _ = rumble_tx.lock().map(|t| t.send(Msg::Rumble { pad, large, small }));
            });
            input::host_pads(on_rumble)
        } else {
            Box::new(input::NoPads)
        };
        let injector = Injector::new(input::win::WinSink::default(), input::win::WinScreen, pads, area_for(opts.target), Arc::new(LocalActivity::new()));
        let engine = Arc::new(Mutex::new(input::Engine::new(session, injector)));
        // Par Internet, la garde est toujours là, même pour un spectateur : raccourci d'arrêt
        // d'urgence et arrêt au verrouillage de Windows (une session ne doit jamais rester cachée).
        let internet = matches!(opts.network, Network::Internet { .. });
        let needs_guard = internet || [Permission::Keyboard, Permission::Mouse, Permission::Gamepad].iter().any(|p| grants.has(*p));
        let guard = if needs_guard {
            let etx = Mutex::new(tx.clone());
            Some(input::start_guard(engine.clone(), opts.hotkey, move |reason| {
                let _ = etx.lock().map(|t| t.send(Msg::Emergency(reason)));
            })?)
        } else {
            None
        };

        let now = Instant::now();
        let peer_opts = PeerOptions { initial_kbps: opts.initial_kbps.min(opts.max_kbps), max_kbps: opts.max_kbps };
        let locals: Vec<SocketAddr> = sockets.iter().map(|b| b.local).collect();
        let (mut peer, offer) = HostPeer::with_reflexive(peer_opts, &locals, &reflexive, engine, now)?;
        peer.set_network(nat_v4, nat_v6);

        let stop = Arc::new(AtomicBool::new(false));
        let mut readers = Vec::new();
        for b in &sockets {
            readers.push(spawn_reader(b.socket.try_clone().map_err(|e| e.to_string())?, b.local, tx.clone(), stop.clone())?);
        }
        let stats = Arc::new(Mutex::new(TransportStats { state: "new".into(), ..Default::default() }));
        let shared = stats.clone();
        let loop_tx = tx.clone();
        let join = std::thread::Builder::new()
            .name("remote-play-transport".into())
            .spawn(move || {
                let _guard = guard; // relâchée (raccourci désinscrit) à la fin de la session
                run(peer, rx, loop_tx, &sockets, opts, shared);
                stop.store(true, Ordering::Relaxed);
                for r in readers {
                    let _ = r.join();
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Host { tx, nat: (nat_v4, nat_v6), stats, offer, join: Mutex::new(Some(join)) })
    }

    pub fn offer(&self) -> &str {
        &self.offer
    }

    /// NAT vu par STUN (IPv4, IPv6) ; `None` hors mode Internet ou sans interface de cette famille.
    pub fn nat(&self) -> (Option<NatKind>, Option<NatKind>) {
        self.nat
    }

    /// Candidat ICE de l'invité arrivé après sa réponse (trickle par la boîte aux lettres).
    pub fn add_remote_candidate(&self, line: String) {
        let _ = self.tx.send(Msg::RemoteCandidate(line));
    }

    /// Réponse SDP de l'invité ; renvoie le code de vérification à comparer avec l'invité.
    pub fn accept_answer(&self, sdp: &str) -> Result<String, String> {
        let (reply, rx) = mpsc::channel();
        self.tx.send(Msg::Answer(sdp.to_string(), reply)).map_err(|_| "session terminée")?;
        rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "la session ne répond pas".to_string())?
    }

    pub fn stats(&self) -> TransportStats {
        self.stats.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Arrête la session (relâchements compris) et attend la fin des fils.
    pub fn stop(&self) -> TransportStats {
        let _ = self.tx.send(Msg::Stop);
        let join = self.join.lock().ok().and_then(|mut j| j.take());
        if let Some(j) = join {
            let _ = j.join();
        }
        self.stats()
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        self.stop();
    }
}

fn spawn_reader(socket: UdpSocket, local: SocketAddr, tx: Sender<Msg>, stop: Arc<AtomicBool>) -> Result<JoinHandle<()>, String> {
    socket.set_read_timeout(Some(Duration::from_millis(100))).map_err(|e| e.to_string())?;
    std::thread::Builder::new()
        .name("remote-play-udp".into())
        .spawn(move || {
            let mut buf = vec![0u8; 2048];
            while !stop.load(Ordering::Relaxed) {
                match socket.recv_from(&mut buf) {
                    Ok((n, source)) => {
                        let msg = Msg::Udp { at: Instant::now(), source, destination: local, data: buf[..n].to_vec() };
                        if tx.send(msg).is_err() {
                            return;
                        }
                    }
                    // Windows signale par WSAECONNRESET le « port injoignable » d'un envoi précédent : sans gravité
                    Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut | std::io::ErrorKind::ConnectionReset) => {}
                    Err(_) => return,
                }
            }
        })
        .map_err(|e| e.to_string())
}

struct Video {
    control: Arc<Control>,
    join: JoinHandle<()>,
}

fn start_video(opts: &HostOptions, profile: H264Profile, kbps: u32, tx: Sender<Msg>) -> Result<Video, String> {
    let control = Arc::new(Control::new(kbps));
    let settings = Settings {
        target: opts.target,
        capture: CaptureOptions::default(),
        duration: Duration::MAX,
        fps: opts.fps,
        bitrate_kbps: kbps,
        max_height: opts.max_height,
        preference: Preference::Auto,
        profile,
        keyframe_every: None,
    };
    let ctl = control.clone();
    let join = std::thread::Builder::new()
        .name("remote-play-video".into())
        .spawn(move || {
            let otx = tx.clone();
            let ptx = tx.clone();
            let result = pipeline::stream(
                &settings,
                &ctl,
                &mut |o| {
                    let _ = otx.send(Msg::Opened(o.clone()));
                },
                &mut |p, origin| ptx.send(Msg::Frame { packet: p.clone(), origin }).is_ok(),
            );
            let _ = tx.send(Msg::VideoEnded(result.map(drop).map_err(|e| format!("capture/encodage : {}", e.message()))));
        })
        .map_err(|e| e.to_string())?;
    Ok(Video { control, join })
}

struct Audio {
    stop: Arc<AtomicBool>,
    join: JoinHandle<()>,
}

/// Son du PC → paquets Opus vers la boucle. Un échec (aucune sortie audio…) n'arrête pas la
/// session : l'image continue sans le son.
fn start_audio(tx: Sender<Msg>, hide_discord_echo: bool) -> Result<Audio, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let join = std::thread::Builder::new()
        .name("remote-play-audio".into())
        .spawn(move || {
            let exclude = if hide_discord_echo { crate::remote_play::audio::find_discord() } else { None };
            let result = crate::remote_play::audio::stream(&flag, exclude, &mut |packet, origin| tx.send(Msg::Audio { packet, origin }).is_ok());
            if let Err(e) = result {
                eprintln!("[remote-play] {e}");
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(Audio { stop, join })
}

fn send_all(sockets: &[Bound], out: &mut Vec<Datagram>) {
    for d in out.drain(..) {
        // str0m émet depuis la base du candidat (la socket locale), même pour un `srflx`
        if let Some(b) = sockets.iter().find(|b| b.local == d.source) {
            let _ = b.socket.send_to(&d.data, d.destination);
        }
    }
}

/// Résolution de l'horloge système à 1 ms pendant la session : sans elle, Windows arrondit les
/// attentes courtes (délais du pacer de str0m) à ≈ 15,6 ms. Rétablie à la fin.
struct TimerResolution;

impl TimerResolution {
    fn begin() -> Self {
        unsafe { windows::Win32::Media::timeBeginPeriod(1) };
        TimerResolution
    }
}

impl Drop for TimerResolution {
    fn drop(&mut self) {
        unsafe { windows::Win32::Media::timeEndPeriod(1) };
    }
}

fn run<H: InputHandler>(mut peer: HostPeer<H>, rx: mpsc::Receiver<Msg>, tx: Sender<Msg>, sockets: &[Bound], opts: HostOptions, shared: Arc<Mutex<TransportStats>>) {
    let _timer = TimerResolution::begin();
    let started = Instant::now();
    let mut video: Option<Video> = None;
    let mut audio: Option<Audio> = None;
    let audio_allowed = opts.audio && peer_grants_audio(&opts);
    let mut out = Vec::new();
    let mut published = Instant::now();
    let mut stopped = false;
    loop {
        let now = Instant::now();
        let deadline = peer.poll(now, &mut out);
        send_all(sockets, &mut out);

        let fx = peer.take_effects();
        if fx.connected && video.is_none() {
            let profile = peer.profile().unwrap_or(H264Profile::Baseline);
            match start_video(&opts, profile, peer.current_kbps(), tx.clone()) {
                Ok(v) => video = Some(v),
                Err(e) => peer.fail_with(e),
            }
            if audio_allowed {
                audio = start_audio(tx.clone(), opts.hide_discord_echo).ok();
            }
        }
        if let Some(v) = &video {
            if fx.keyframe {
                v.control.request_keyframe();
            }
            if let Some(kbps) = fx.bitrate_kbps {
                v.control.set_bitrate(kbps);
            }
        }
        if peer.is_closed() {
            // ICE a abandonné toutes les paires avant toute connexion : jamais d'échec muet
            let s = peer.stats(now);
            if !stopped && peer.answered_at().is_some() && s.connect_ms.is_none() && s.error.is_none() {
                peer.fail_with(ice_failure_message(&opts.network, s.nat_v4, s.nat_v6));
                if let Ok(mut shared) = shared.lock() {
                    *shared = peer.stats(now);
                }
            }
            break;
        }
        if !peer.is_connected() && video.is_none() && now.duration_since(started) > CONNECT_TIMEOUT {
            peer.fail_with("délai de connexion dépassé".into());
            continue;
        }
        if !peer.is_connected() && video.is_none() && peer.answered_at().is_some_and(|t| now.duration_since(t) > ICE_TIMEOUT) {
            let s = peer.stats(now);
            peer.fail_with(ice_failure_message(&opts.network, s.nat_v4, s.nat_v6));
            continue;
        }
        if now.duration_since(published) >= Duration::from_millis(250) {
            published = now;
            if let Ok(mut s) = shared.lock() {
                *s = peer.stats(now);
            }
        }

        let wait = deadline.saturating_duration_since(Instant::now()).min(Duration::from_millis(250));
        match rx.recv_timeout(wait) {
            Ok(Msg::Udp { at, source, destination, data }) => peer.receive(at, source, destination, &data),
            Ok(Msg::Frame { packet, origin }) => {
                let wallclock = origin + Duration::from_nanos(packet.pts.max(0) as u64 * 100);
                let written = Instant::now();
                if let Err(e) = peer.write_frame(written, wallclock, packet.pts, &packet.data, packet.encode_time) {
                    peer.fail_with(e);
                }
                if let Some(log) = &opts.frame_log {
                    if let Ok(mut l) = log.lock() {
                        l.push((super::stats::pts_to_90khz(packet.pts), wallclock, written));
                    }
                }
            }
            Ok(Msg::Audio { packet, origin }) => {
                let wallclock = origin + Duration::from_micros(packet.at * 1_000_000 / crate::remote_play::audio::SAMPLE_RATE as u64);
                if let Err(e) = peer.write_audio(wallclock, packet.at, &packet.data) {
                    eprintln!("[remote-play] {e}");
                }
            }
            Ok(Msg::Opened(o)) => peer.set_encoder(format!("{}{}", o.encoder, if o.hardware { "" } else { " (logiciel)" }), o.output),
            Ok(Msg::VideoEnded(r)) => peer.fail_with(r.err().unwrap_or_else(|| "source vidéo fermée".into())),
            Ok(Msg::Answer(sdp, reply)) => {
                let _ = reply.send(peer.accept_answer(&sdp));
            }
            Ok(Msg::RemoteCandidate(line)) => {
                peer.add_remote_candidate(&line);
            }
            Ok(Msg::Rumble { pad, large, small }) => {
                peer.send_control(&Message::Rumble { pad, large, small });
            }
            Ok(Msg::Emergency(reason)) => peer.fail_with(format!("arrêt d'urgence ({reason:?})")),
            Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => {
                stopped = true;
                peer.close();
            }
            Err(RecvTimeoutError::Timeout) => {}
        }
        peer.tick(Instant::now());
    }
    // derniers paquets (DTLS close_notify) puis arrêt de la capture
    let now = Instant::now();
    peer.poll(now, &mut out);
    send_all(sockets, &mut out);
    if let Some(v) = video {
        v.control.stop();
        let _ = v.join.join();
    }
    if let Some(a) = audio {
        a.stop.store(true, Ordering::Relaxed);
        let _ = a.join.join();
    }
    if let Ok(mut s) = shared.lock() {
        *s = peer.stats(Instant::now());
    }
}

#[cfg(test)]
mod diagnosis_tests {
    use super::*;

    #[test]
    fn diagnostic_d_echec_ice() {
        let net = Network::Internet { stun: vec![] };
        let no_stun = ice_failure_message(&net, Some(NatKind::NoResponse), None);
        assert!(no_stun.contains("aucun serveur STUN"));
        assert!(ice_failure_message(&net, None, None).contains("aucun serveur STUN"));
        assert!(ice_failure_message(&net, Some(NatKind::Symmetric), None).contains("NAT symétrique"));
        // IPv6 sans NAT : le NAT symétrique IPv4 n'est pas forcément en cause
        assert!(ice_failure_message(&net, Some(NatKind::Symmetric), Some(NatKind::Open)).contains("votre ami"));
        assert!(ice_failure_message(&net, Some(NatKind::Consistent), None).contains("votre ami"));
        for m in [no_stun, ice_failure_message(&net, Some(NatKind::Consistent), None)] {
            assert!(m.contains("TURN"), "jamais de relais, et on le dit");
        }
        assert!(ice_failure_message(&Network::Lan, None, None).contains("même réseau"));
    }
}
