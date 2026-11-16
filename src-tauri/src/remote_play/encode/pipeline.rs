//! Chaîne complète capture WGC → NV12 → H.264, enregistrée dans un flux Annex B local (Phase 1b,
//! mesures). En Phase 1c, la même boucle alimentera le transport au lieu d'un fichier.
//!
//! Cadence : une image nouvelle est encodée dès son arrivée (latence minimale), au plus `fps`
//! fois par seconde ; sans image nouvelle à l'échéance, la dernière est réencodée pour garder
//! un flux régulier (WGC ne livre rien quand l'écran ne change pas).

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use windows::core::{Error, Result};
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use crate::remote_play::capture::d3d::Device;
use crate::remote_play::capture::wgc::{Capture, Next};
use crate::remote_play::capture::{self, Options, Target};

use super::convert::Converter;
use super::mf::Encoder;
use super::stats::Measurements;
use super::{output_size_for, EncoderConfig, Preference, Profile};

#[derive(Debug, Clone, Copy)]
pub struct Settings {
    pub target: Target,
    pub capture: Options,
    pub duration: Duration,
    pub fps: u32,
    pub bitrate_kbps: u32,
    /// Hauteur maximale de l'image encodée (`None` = native, bornée à 4096×2304).
    pub max_height: Option<u32>,
    pub preference: Preference,
    pub profile: Profile,
    /// Une IDR demandée toutes les `n` images encodées (essai de l'IDR à la demande).
    pub keyframe_every: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            target: Target::PrimaryMonitor,
            capture: Options::default(),
            duration: Duration::from_secs(5),
            fps: 60,
            bitrate_kbps: 20_000,
            max_height: None,
            preference: Preference::Auto,
            profile: Profile::High,
            keyframe_every: None,
        }
    }
}

struct Com(bool);

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

/// Pilotage d'un flux en cours depuis un autre fil (transport réseau) : arrêt, débit adapté au
/// réseau, IDR demandée par l'invité (PLI/FIR).
#[derive(Debug)]
pub struct Control {
    stop: AtomicBool,
    bitrate_kbps: AtomicU32,
    keyframe: AtomicBool,
}

impl Control {
    pub fn new(bitrate_kbps: u32) -> Self {
        Control { stop: AtomicBool::new(false), bitrate_kbps: AtomicU32::new(bitrate_kbps), keyframe: AtomicBool::new(false) }
    }
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
    pub fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
    pub fn set_bitrate(&self, kbps: u32) {
        self.bitrate_kbps.store(kbps, Ordering::Relaxed);
    }
    pub fn bitrate(&self) -> u32 {
        self.bitrate_kbps.load(Ordering::Relaxed)
    }
    pub fn request_keyframe(&self) {
        self.keyframe.store(true, Ordering::Relaxed);
    }
}

/// Ce que le flux a réellement ouvert, connu dès le démarrage.
#[derive(Debug, Clone)]
pub struct Opened {
    pub encoder: String,
    pub hardware: bool,
    pub output: (u32, u32),
}

/// Capture, encode et écrit le flux H.264 dans `out`. À appeler depuis un fil dédié.
pub fn record(settings: &Settings, out: &mut dyn Write) -> Result<(Measurements, Vec<super::mf::Attempt>)> {
    let control = Control::new(settings.bitrate_kbps);
    let mut failed: Option<std::io::Error> = None;
    let (m, attempts) = stream(settings, &control, &mut |_| {}, &mut |p, _| match out.write_all(&p.data) {
        Ok(()) => true,
        Err(e) => {
            failed = Some(e);
            false
        }
    })?;
    if let Some(e) = failed {
        return Err(Error::new(windows::Win32::Foundation::E_FAIL, e.to_string()));
    }
    Ok((m, attempts))
}

/// Boucle capture → NV12 → H.264. Chaque paquet est remis à `on_packet` avec l'origine des
/// horodatages (`origin + pts` = instant d'envoi de l'image à l'encodeur) ; `on_packet` renvoie
/// `false` pour arrêter. S'arrête aussi à `settings.duration`, à [`Control::stop`] ou quand la
/// source se ferme. `on_open` est appelé une fois l'encodeur ouvert.
pub fn stream(
    settings: &Settings,
    control: &Control,
    on_open: &mut dyn FnMut(&Opened),
    on_packet: &mut dyn FnMut(&super::mf::Packet, Instant) -> bool,
) -> Result<(Measurements, Vec<super::mf::Attempt>)> {
    let _com = Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok());
    let device = Device::create()?;
    let mut capture = Capture::start(&device, settings.target, settings.capture, capture::windows_build())?;
    let source = capture.size();
    let output = output_size_for(source, settings.max_height);
    let cfg = EncoderConfig {
        width: output.0,
        height: output.1,
        fps: settings.fps,
        bitrate_kbps: control.bitrate(),
        gop: 0,
        profile: settings.profile,
    }
    .sanitized();
    let mut converter = Converter::new(&device, (cfg.width, cfg.height), cfg.fps)?;
    let mut encoder = Encoder::new(&device, cfg, settings.preference)?;
    on_open(&Opened { encoder: encoder.info().name.clone(), hardware: encoder.info().hardware, output: (cfg.width, cfg.height) });

    let mut m = Measurements {
        adapter: device.adapter_name.clone(),
        encoder: encoder.info().name.clone(),
        hardware: encoder.info().hardware,
        source,
        output: (cfg.width, cfg.height),
        target_fps: cfg.fps,
        bitrate_kbps: cfg.bitrate_kbps,
        borderless: capture.borderless,
        ..Default::default()
    };
    let start = Instant::now();
    let mut go_on = true;
    let mut deliver = |m: &mut Measurements, p: super::mf::Packet, go_on: &mut bool| {
        m.encoded += 1;
        m.bytes += p.data.len() as u64;
        m.keyframes += p.keyframe as u32;
        if let Some(t) = p.encode_time {
            m.encode.push(t);
        }
        if *go_on && !on_packet(&p, start) {
            *go_on = false;
        }
    };

    let interval = Duration::from_secs_f64(1.0 / cfg.fps as f64);
    let mut current: Option<ID3D11Texture2D> = None;
    let mut fresh = false;
    let mut due: Option<Instant> = None;
    let mut submitted = 0u32;
    let mut last_frame: Option<Instant> = None;

    while go_on && !control.stopped() && start.elapsed() < settings.duration {
        let wanted = control.bitrate();
        if wanted != encoder.config().bitrate_kbps && encoder.set_bitrate(wanted) {
            m.bitrate_changes += 1;
        }
        if control.keyframe.swap(false, Ordering::Relaxed) {
            encoder.request_keyframe();
        }
        let now = Instant::now();
        let timeout = match (current.is_some(), due) {
            (false, _) => Duration::from_millis(500),
            (true, Some(d)) => d.saturating_duration_since(now),
            (true, None) => Duration::ZERO,
        };
        match capture.next(timeout)? {
            Next::Frame(frame) => {
                m.captured += 1;
                let arrived = Instant::now();
                // la première image date de l'ouverture de l'encodeur : hors mesure
                if let Some(prev) = last_frame.replace(arrived) {
                    m.capture_interval.push(arrived - prev);
                    m.wgc_timestamp_offset.push_ms(frame.timestamp_offset_ms);
                }
                let t = Instant::now();
                current = Some(converter.convert(&frame.texture, frame.size)?);
                m.convert.push(t.elapsed());
                fresh = true;
                // l'image WGC est rendue ici : la copie privée suffit à l'encodeur
            }
            Next::Timeout => {}
            Next::Stopped(_) => {
                m.source_closed = true;
                break;
            }
        }
        let now = Instant::now();
        let Some(texture) = &current else { continue };
        if due.is_some_and(|d| now < d) {
            continue; // trop tôt : on garde l'image, la plus récente partira à l'échéance
        }
        let pts = (now - start).as_nanos() as i64 / 100;
        let keyframe = settings.keyframe_every.is_some_and(|n| n > 0 && submitted > 0 && submitted % n == 0);
        encoder.submit(texture, pts, keyframe)?;
        submitted += 1;
        if !fresh {
            m.repeated += 1;
        }
        fresh = false;
        // échéance suivante : sur la grille, sauf retard de plus d'une image (on repart de maintenant)
        due = Some(match due {
            Some(d) if now < d + interval => d + interval,
            _ => now + interval,
        });
        // attendre le paquet de cette image : il part aussitôt
        if let Some(p) = encoder.receive(Duration::from_millis(200))? {
            deliver(&mut m, p, &mut go_on);
        }
        while let Some(p) = encoder.receive(Duration::ZERO)? {
            deliver(&mut m, p, &mut go_on);
        }
    }
    for p in encoder.finish()? {
        deliver(&mut m, p, &mut go_on);
    }
    m.elapsed = start.elapsed();
    m.skipped = capture.skipped;
    m.resizes = capture.resizes();
    let attempts = encoder.info().attempts.clone();
    Ok((m, attempts))
}
