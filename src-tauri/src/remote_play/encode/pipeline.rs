//! Chaîne complète capture WGC → NV12 → H.264, enregistrée dans un flux Annex B local (Phase 1b,
//! mesures). En Phase 1c, la même boucle alimentera le transport au lieu d'un fichier.
//!
//! Cadence : une image nouvelle est encodée dès son arrivée (latence minimale, sans grille), au
//! plus ≈ `fps` fois par seconde ; sans image nouvelle, la dernière est réencodée à intervalle
//! plus lâche (WGC ne livre rien quand l'écran ne change pas).

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

/// Cadence d'encodage faible latence (comme Sunshine/Parsec) : seau à jetons de `fps` jetons par
/// seconde, réserve de 1,5. Une image nouvelle part **dès son arrivée** s'il reste un jeton —
/// jamais calée sur une grille, qui la faisait attendre jusqu'à une image entière — et le débit
/// moyen reste exactement `fps` (le budget CBR par image est tenu). Écran immobile : la dernière
/// image est réencodée au bout de 2,5 intervalles (qualité qui s'affine, pertes réparées).
#[derive(Debug, Clone)]
pub struct Cadence {
    interval: Duration,
    tokens: f64,
    at: Option<Instant>,
    last: Option<Instant>,
}

const CADENCE_RESERVE: f64 = 1.5;
const REPEAT_AFTER: f64 = 2.5;

impl Cadence {
    pub fn new(interval: Duration) -> Self {
        Cadence { interval, tokens: 1.0, at: None, last: None }
    }

    fn tokens_at(&self, now: Instant) -> f64 {
        match self.at {
            None => self.tokens,
            Some(a) => (self.tokens + now.saturating_duration_since(a).as_secs_f64() / self.interval.as_secs_f64()).min(CADENCE_RESERVE),
        }
    }

    /// Instant à partir duquel l'image courante (nouvelle ou répétée) peut partir.
    pub fn ready_at(&self, fresh: bool, now: Instant) -> Instant {
        let missing = 1.0 - self.tokens_at(now);
        // tolérance : sans elle, l'arrondi ferait boucler sur des attentes de quelques ns
        let token_at = if missing <= 1e-3 { now } else { now + self.interval.mul_f64(missing) };
        match (fresh, self.last) {
            (true, _) | (false, None) => token_at,
            (false, Some(l)) => (l + self.interval.mul_f64(REPEAT_AFTER)).max(token_at),
        }
    }

    /// Une image vient d'être envoyée à l'encodeur.
    pub fn take(&mut self, now: Instant) {
        self.tokens = self.tokens_at(now) - 1.0;
        self.at = Some(now);
        self.last = Some(now);
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
    let mut cadence = Cadence::new(interval);
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
        let timeout = if current.is_some() { cadence.ready_at(fresh, now).saturating_duration_since(now) } else { Duration::from_millis(500) };
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
        if now < cadence.ready_at(fresh, now) {
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
        cadence.take(now);
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

#[cfg(test)]
mod tests {
    use super::Cadence;
    use std::time::{Duration, Instant};

    const I: Duration = Duration::from_micros(16_667);

    #[test]
    fn image_nouvelle_part_aussitot_quel_que_soit_le_dephasage() {
        // jeu à 60 i/s décalé de 70 % d'intervalle par rapport au début : aucune attente
        let t0 = Instant::now();
        let mut c = Cadence::new(I);
        c.take(t0);
        for k in 1..200u32 {
            let at = t0 + I.mul_f64(k as f64 + 0.7);
            assert_eq!(c.ready_at(true, at), at, "image {k}");
            c.take(at);
        }
    }

    #[test]
    fn source_plus_rapide_plafonnee_a_fps() {
        // WGC à 240 i/s : au plus ≈ 60 images par seconde partent
        let t0 = Instant::now();
        let mut c = Cadence::new(I);
        let mut sent = 0;
        for k in 0..240u32 {
            let at = t0 + Duration::from_micros(4_167) * k;
            if c.ready_at(true, at) <= at {
                c.take(at);
                sent += 1;
            }
        }
        assert!((60..=62).contains(&sent), "{sent} images en 1 s");
    }

    #[test]
    fn image_repetee_seulement_apres_deux_intervalles_et_demi() {
        let t0 = Instant::now();
        let mut c = Cadence::new(I);
        c.take(t0);
        assert_eq!(c.ready_at(false, t0 + I), t0 + I.mul_f64(2.5));
        // une image nouvelle, elle, n'attend que son jeton
        assert_eq!(c.ready_at(true, t0 + I), t0 + I);
    }

    #[test]
    fn image_en_avance_attend_son_jeton() {
        let t0 = Instant::now();
        let mut c = Cadence::new(I);
        c.take(t0);
        c.take(t0); // réserve consommée
        let r = c.ready_at(true, t0 + I / 2);
        assert!(r > t0 + I / 2 && r <= t0 + I * 2, "{:?}", r - t0);
    }
}
