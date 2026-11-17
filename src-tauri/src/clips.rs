//! Clips vidéo (0.1.72) : pendant une partie, iBox garde en mémoire les dernières secondes de
//! l'écran principal, déjà encodées en H.264 (même chaîne que Remote Play : capture Windows
//! Graphics Capture → NV12 → encodeur Media Foundation matériel), avec le son de Windows et/ou
//! le micro en PCM 48 kHz. « Garder le clip » assemble un MP4 (H.264 + AAC) par le Sink Writer
//! de Media Foundation : aucun codec livré par iBox, rien n'est réencodé côté image.
//!
//! Réglages (Paramètres › Captures) : qualité, durée (5 à 30 s), son de Windows, micro.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const MIN_SECONDS: u32 = 5;
pub const MAX_SECONDS: u32 = 30;
const RATE: u64 = 48_000;
/// Marge gardée en plus de la durée demandée (une image clé par seconde).
const SLACK: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    Low,
    Medium,
    High,
}

impl Quality {
    /// Hauteur maximale, images par seconde, débit (kbit/s).
    pub fn params(self) -> (u32, u32, u32) {
        match self {
            Quality::Low => (480, 30, 2_500),
            Quality::Medium => (720, 30, 6_000),
            Quality::High => (1080, 60, 12_000),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSettings {
    pub quality: Quality,
    pub seconds: u32,
    pub system_audio: bool,
    pub microphone: bool,
}

impl Default for ClipSettings {
    fn default() -> Self {
        ClipSettings { quality: Quality::Medium, seconds: 15, system_audio: true, microphone: false }
    }
}

impl ClipSettings {
    pub fn sanitized(self) -> Self {
        ClipSettings { seconds: self.seconds.clamp(MIN_SECONDS, MAX_SECONDS), ..self }
    }
    fn keep(&self) -> Duration {
        Duration::from_secs(self.seconds as u64) + SLACK
    }
}

#[derive(Clone)]
struct VideoPacket {
    at: Instant,
    data: Vec<u8>,
    key: bool,
}

struct Video {
    packets: VecDeque<VideoPacket>,
    size: (u32, u32),
    fps: u32,
    kbps: u32,
}

/// Son reçu : l'échantillon stéréo n° `dropped + i` date de `origin + n / 48 000`.
#[derive(Default)]
struct Audio {
    origin: Option<Instant>,
    dropped: u64,
    samples: VecDeque<f32>,
}

impl Audio {
    fn push(&mut self, pcm: &[f32], keep: Duration) {
        if self.origin.is_none() {
            self.origin = Some(Instant::now() - Duration::from_secs_f64(pcm.len() as f64 / 2.0 / RATE as f64));
        }
        self.samples.extend(pcm.iter().copied());
        let max = (keep.as_secs_f64() * RATE as f64) as usize * 2;
        if self.samples.len() > max {
            let extra = (self.samples.len() - max) & !1;
            self.samples.drain(..extra);
            self.dropped += extra as u64 / 2;
        }
    }

    /// `frames` échantillons stéréo à partir de l'instant `from` (silence là où rien n'est connu).
    fn slice(&self, from: Instant, frames: usize) -> Vec<f32> {
        let mut out = vec![0f32; frames * 2];
        let Some(origin) = self.origin else { return out };
        let start = if from >= origin { ((from - origin).as_secs_f64() * RATE as f64) as i64 } else { -(((origin - from).as_secs_f64() * RATE as f64) as i64) };
        let first = start - self.dropped as i64;
        let have = (self.samples.len() / 2) as i64;
        for i in 0..frames as i64 {
            let k = first + i;
            if k >= 0 && k < have {
                out[i as usize * 2] = self.samples[k as usize * 2];
                out[i as usize * 2 + 1] = self.samples[k as usize * 2 + 1];
            }
        }
        out
    }
}

/// Retire les paquets trop anciens en gardant toujours une image clé en tête.
fn prune(packets: &mut VecDeque<VideoPacket>, limit: Instant) {
    loop {
        let Some(k) = packets.iter().skip(1).position(|p| p.key).map(|i| i + 1) else { break };
        if packets[k].at <= limit {
            packets.drain(..k);
        } else {
            break;
        }
    }
}

/// Paquets d'un clip de `seconds` s se terminant à `end` : depuis la dernière image clé
/// antérieure au début voulu (sinon la première disponible).
fn select(packets: &VecDeque<VideoPacket>, end: Instant, seconds: u32) -> Vec<VideoPacket> {
    let from = end.checked_sub(Duration::from_secs(seconds as u64)).unwrap_or(end);
    let start = packets.iter().rposition(|p| p.key && p.at <= from).or_else(|| packets.iter().position(|p| p.key));
    match start {
        Some(i) => packets.iter().skip(i).filter(|p| p.at <= end).cloned().collect(),
        None => Vec::new(),
    }
}

/// Mélange son de Windows et micro en PCM 16 bits.
fn mix(sources: &[Vec<f32>], len: usize) -> Vec<i16> {
    (0..len)
        .map(|i| {
            let s: f32 = sources.iter().map(|v| v.get(i).copied().unwrap_or(0.0)).sum();
            (s.clamp(-1.0, 1.0) * 32767.0) as i16
        })
        .collect()
}

static SETTINGS: Mutex<Option<ClipSettings>> = Mutex::new(None);
static ACTIVE: AtomicBool = AtomicBool::new(false);
static VIDEO: Mutex<Option<Video>> = Mutex::new(None);
static SYSTEM: Mutex<Option<Audio>> = Mutex::new(None);
static MIC: Mutex<Option<Audio>> = Mutex::new(None);

pub fn settings() -> ClipSettings {
    SETTINGS.lock().ok().and_then(|s| *s).unwrap_or_default()
}

pub fn configure(s: ClipSettings) {
    if let Ok(mut g) = SETTINGS.lock() {
        *g = Some(s.sanitized());
    }
}

/// Enregistrement voulu (partie en cours et clips activés).
pub fn set_active(active: bool) {
    ACTIVE.store(active, Ordering::Relaxed);
}

/// Secondes déjà disponibles pour un clip.
pub fn available_seconds() -> u32 {
    let v = VIDEO.lock().ok();
    let Some(Some(video)) = v.as_deref() else { return 0 };
    match (video.packets.front(), video.packets.back()) {
        (Some(a), Some(b)) => ((b.at - a.at).as_secs() as u32).min(settings().seconds),
        _ => 0,
    }
}

fn clear() {
    if let Ok(mut v) = VIDEO.lock() { *v = None; }
    if let Ok(mut a) = SYSTEM.lock() { *a = None; }
    if let Ok(mut a) = MIC.lock() { *a = None; }
}

/// Veille : démarre ou arrête l'enregistrement selon la partie et les réglages.
pub fn start() {
    std::thread::spawn(|| {
        let mut running: Option<(ClipSettings, Arc<AtomicBool>, Vec<std::thread::JoinHandle<()>>)> = None;
        loop {
            let want = ACTIVE.load(Ordering::Relaxed);
            let current = settings();
            let stale = running.as_ref().is_some_and(|(s, _, _)| !want || *s != current);
            if stale {
                if let Some((_, stop, threads)) = running.take() {
                    stop.store(true, Ordering::Relaxed);
                    for t in threads { let _ = t.join(); }
                }
                clear();
            }
            if want && running.is_none() {
                let stop = Arc::new(AtomicBool::new(false));
                running = Some((current, stop.clone(), session(current, stop)));
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

#[cfg(windows)]
fn session(s: ClipSettings, stop: Arc<AtomicBool>) -> Vec<std::thread::JoinHandle<()>> {
    let mut threads = Vec::new();
    let v = stop.clone();
    threads.push(std::thread::spawn(move || video_loop(s, &v)));
    for (enabled, mic) in [(s.system_audio, false), (s.microphone, true)] {
        if !enabled { continue; }
        let a = stop.clone();
        threads.push(std::thread::spawn(move || audio_loop(s, mic, &a)));
    }
    threads
}

#[cfg(not(windows))]
fn session(_s: ClipSettings, _stop: Arc<AtomicBool>) -> Vec<std::thread::JoinHandle<()>> {
    Vec::new()
}

/// Attente interruptible.
fn pause(stop: &AtomicBool, d: Duration) {
    let end = Instant::now() + d;
    while !stop.load(Ordering::Relaxed) && Instant::now() < end {
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(windows)]
fn video_loop(s: ClipSettings, stop: &AtomicBool) {
    use crate::remote_play::capture::{Options, Target};
    use crate::remote_play::encode::pipeline::{stream, Control, Settings};
    use crate::remote_play::encode::{Preference, Profile};
    let (max_height, fps, kbps) = s.quality.params();
    let keep = s.keep();
    while !stop.load(Ordering::Relaxed) {
        let settings = Settings {
            target: Target::PrimaryMonitor,
            capture: Options { cursor: false, borderless: true },
            duration: Duration::from_secs(60 * 60 * 24 * 365),
            fps,
            bitrate_kbps: kbps,
            max_height: Some(max_height),
            preference: Preference::Auto,
            profile: Profile::High,
            keyframe_every: Some(fps),
        };
        let control = Control::new(kbps);
        let result = stream(
            &settings,
            &control,
            &mut |opened| {
                if let Ok(mut v) = VIDEO.lock() {
                    *v = Some(Video { packets: VecDeque::new(), size: opened.output, fps, kbps });
                }
            },
            &mut |p, origin| {
                let at = origin + Duration::from_nanos(p.pts.max(0) as u64 * 100);
                if let Ok(mut v) = VIDEO.lock() {
                    if let Some(video) = v.as_mut() {
                        video.packets.push_back(VideoPacket { at, data: p.data.clone(), key: p.keyframe });
                        if let Some(limit) = at.checked_sub(keep) { prune(&mut video.packets, limit); }
                    }
                }
                !stop.load(Ordering::Relaxed)
            },
        );
        if let Err(e) = result {
            eprintln!("[clips] image : {e}");
        }
        pause(stop, Duration::from_secs(3));
    }
}

#[cfg(windows)]
fn audio_loop(s: ClipSettings, mic: bool, stop: &AtomicBool) {
    let ring = if mic { &MIC } else { &SYSTEM };
    let keep = s.keep();
    let mut warned = false;
    while !stop.load(Ordering::Relaxed) {
        if let Ok(mut a) = ring.lock() { *a = Some(Audio::default()); }
        let r = crate::remote_play::audio::pcm(stop, mic, &mut |pcm| {
            if let Ok(mut a) = ring.lock() {
                if let Some(a) = a.as_mut() { a.push(pcm, keep); }
            }
            !stop.load(Ordering::Relaxed)
        });
        if let Err(e) = r {
            if !warned { eprintln!("[clips] {e}"); warned = true; }
        }
        pause(stop, Duration::from_secs(5));
    }
}

/// Écrit le clip des dernières secondes dans `path` (MP4).
pub fn save(path: &std::path::Path) -> Result<(), String> {
    let s = settings();
    let end = Instant::now();
    let (packets, size, fps, kbps) = {
        let v = VIDEO.lock().map_err(|_| "Indisponible.")?;
        let video = v.as_ref().ok_or("Les clips démarrent avec la partie : rejouez quelques secondes.")?;
        (select(&video.packets, end, s.seconds), video.size, video.fps, video.kbps)
    };
    let (Some(first), Some(last)) = (packets.first(), packets.last()) else {
        return Err("Pas encore assez d'images : rejouez quelques secondes.".into());
    };
    let span = last.at - first.at + Duration::from_secs_f64(1.0 / fps as f64);
    if span < Duration::from_secs(1) {
        return Err("Pas encore assez d'images : rejouez quelques secondes.".into());
    }
    let frames = (span.as_secs_f64() * RATE as f64) as usize;
    let mut sources = Vec::new();
    for (on, ring) in [(s.system_audio, &SYSTEM), (s.microphone, &MIC)] {
        if !on { continue; }
        if let Some(a) = ring.lock().ok().as_ref().and_then(|a| a.as_ref()) {
            sources.push(a.slice(first.at, frames));
        }
    }
    let audio = if sources.is_empty() { None } else { Some(mix(&sources, frames * 2)) };
    write_mp4(path, &packets, size, fps, kbps, audio.as_deref())
}

#[cfg(windows)]
fn write_mp4(path: &std::path::Path, packets: &[VideoPacket], size: (u32, u32), fps: u32, kbps: u32, audio: Option<&[i16]>) -> Result<(), String> {
    unsafe { mux::write(path, packets, size, fps, kbps, audio) }.map_err(|e| format!("Clip impossible à écrire : {e}"))
}

#[cfg(not(windows))]
fn write_mp4(_: &std::path::Path, _: &[VideoPacket], _: (u32, u32), _: u32, _: u32, _: Option<&[i16]>) -> Result<(), String> {
    Err("Clips disponibles sur Windows seulement.".into())
}

#[cfg(windows)]
mod mux {
    use super::{VideoPacket, RATE};
    use crate::remote_play::encode::h264;
    use crate::remote_play::encode::mf::MfRuntime;
    use windows::core::{Result, HSTRING};
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    struct Com(bool);
    impl Drop for Com {
        fn drop(&mut self) {
            if self.0 { unsafe { CoUninitialize() }; }
        }
    }

    unsafe fn sample(bytes: &[u8], time: i64, duration: i64) -> Result<IMFSample> {
        let buffer = MFCreateMemoryBuffer(bytes.len() as u32)?;
        let mut ptr: *mut u8 = std::ptr::null_mut();
        buffer.Lock(&mut ptr, None, None)?;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        buffer.Unlock()?;
        buffer.SetCurrentLength(bytes.len() as u32)?;
        let s = MFCreateSample()?;
        s.AddBuffer(&buffer)?;
        s.SetSampleTime(time)?;
        s.SetSampleDuration(duration)?;
        Ok(s)
    }

    unsafe fn audio_type(subtype: &windows::core::GUID, aac: bool) -> Result<IMFMediaType> {
        let t = MFCreateMediaType()?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 2)?;
        t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, RATE as u32)?;
        t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        if aac {
            t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 24_000)?; // 192 kbit/s
        } else {
            t.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 4)?;
            t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, RATE as u32 * 4)?;
        }
        Ok(t)
    }

    pub unsafe fn write(path: &std::path::Path, packets: &[VideoPacket], size: (u32, u32), fps: u32, kbps: u32, audio: Option<&[i16]>) -> Result<()> {
        let _com = Com(CoInitializeEx(None, COINIT_MULTITHREADED).is_ok());
        let _mf = MfRuntime::start()?;
        let mut attrs: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut attrs, 2)?;
        let attrs = attrs.ok_or_else(|| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
        attrs.SetGUID(&MF_TRANSCODE_CONTAINERTYPE, &MFTranscodeContainerType_MPEG4)?;
        attrs.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1)?;
        let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attrs)?;

        let video = MFCreateMediaType()?;
        video.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        video.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
        video.SetUINT64(&MF_MT_FRAME_SIZE, ((size.0 as u64) << 32) | size.1 as u64)?;
        video.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
        video.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
        video.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        video.SetUINT32(&MF_MT_AVG_BITRATE, kbps * 1000)?;
        let header = h264::parameter_sets(&packets[0].data);
        if !header.is_empty() {
            video.SetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &header)?;
        }
        let vs = writer.AddStream(&video)?;
        writer.SetInputMediaType(vs, &video, None)?;

        let stream_audio = match audio {
            Some(_) => {
                let s = writer.AddStream(&audio_type(&MFAudioFormat_AAC, true)?)?;
                writer.SetInputMediaType(s, &audio_type(&MFAudioFormat_PCM, false)?, None)?;
                Some(s)
            }
            None => None,
        };
        writer.BeginWriting()?;

        let t0 = packets[0].at;
        let frame = 10_000_000 / fps as i64;
        for (i, p) in packets.iter().enumerate() {
            let time = (p.at - t0).as_nanos() as i64 / 100;
            let duration = packets.get(i + 1).map(|n| (n.at - p.at).as_nanos() as i64 / 100).filter(|d| *d > 0).unwrap_or(frame);
            let s = sample(&p.data, time, duration)?;
            if p.key {
                s.SetUINT32(&MFSampleExtension_CleanPoint, 1)?;
            }
            writer.WriteSample(vs, &s)?;
        }
        if let (Some(stream), Some(pcm)) = (stream_audio, audio) {
            const CHUNK: usize = 1024; // échantillons stéréo par paquet
            for (k, chunk) in pcm.chunks(CHUNK * 2).enumerate() {
                let bytes: Vec<u8> = chunk.iter().flat_map(|v| v.to_le_bytes()).collect();
                let time = (k * CHUNK) as i64 * 10_000_000 / RATE as i64;
                let duration = (chunk.len() / 2) as i64 * 10_000_000 / RATE as i64;
                writer.WriteSample(stream, &sample(&bytes, time, duration)?)?;
            }
        }
        writer.Finalize()
    }

    /// Relit un MP4 (essais) : nombre d'images vidéo et de paquets audio décodables.
    #[cfg(test)]
    pub unsafe fn read_back(path: &std::path::Path) -> Result<(usize, usize)> {
        let _com = Com(CoInitializeEx(None, COINIT_MULTITHREADED).is_ok());
        let _mf = MfRuntime::start()?;
        let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path.as_os_str()), None)?;
        let (mut video, mut audio) = (0, 0);
        let mut streams = 0u32;
        for i in 0..4u32 {
            if reader.GetStreamSelection(i).is_err() { break; }
            let _ = reader.SetStreamSelection(i, true);
            streams += 1;
        }
        let mut ended = std::collections::HashSet::new();
        while ended.len() < streams as usize {
            let mut index = 0u32;
            let mut flags = 0u32;
            let mut s: Option<IMFSample> = None;
            reader.ReadSample(MF_SOURCE_READER_ANY_STREAM.0 as u32, 0, Some(&mut index), Some(&mut flags), None, Some(&mut s))?;
            if s.is_some() {
                let t = reader.GetCurrentMediaType(index)?;
                if t.GetGUID(&MF_MT_MAJOR_TYPE)? == MFMediaType_Video { video += 1 } else { audio += 1 }
            }
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                ended.insert(index);
            }
        }
        Ok((video, audio))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(at: Instant, key: bool) -> VideoPacket {
        VideoPacket { at, data: vec![key as u8], key }
    }

    #[test]
    fn reglages_bornes() {
        let s = ClipSettings { seconds: 90, ..Default::default() }.sanitized();
        assert_eq!(s.seconds, 30);
        assert_eq!(ClipSettings { seconds: 1, ..Default::default() }.sanitized().seconds, 5);
        let json = serde_json::to_string(&ClipSettings::default()).unwrap();
        assert!(json.contains("\"quality\":\"medium\"") && json.contains("\"systemAudio\":true"), "{json}");
    }

    #[test]
    fn tampon_video_garde_une_image_cle_en_tete() {
        let t0 = Instant::now();
        let mut q: VecDeque<VideoPacket> = (0..100).map(|i| pk(t0 + Duration::from_millis(100 * i), i % 10 == 0)).collect();
        prune(&mut q, t0 + Duration::from_millis(5_050));
        assert!(q[0].key);
        assert_eq!(q[0].at, t0 + Duration::from_millis(5_000));
        let clip = select(&q, t0 + Duration::from_millis(9_900), 3);
        assert!(clip[0].key && clip[0].at <= t0 + Duration::from_millis(6_900));
        assert_eq!(clip[0].at, t0 + Duration::from_millis(6_000));
        assert_eq!(clip.len(), 40);
    }

    #[test]
    fn son_aligne_sur_l_image() {
        let mut a = Audio::default();
        let keep = Duration::from_secs(2);
        a.push(&vec![0.5; 48_000 * 2], keep); // 1 s
        a.push(&vec![0.25; 48_000 * 2 * 2], keep); // 2 s de plus : la première seconde sort
        assert_eq!(a.dropped, 48_000);
        let origin = a.origin.unwrap();
        let s = a.slice(origin + Duration::from_millis(1_500), 10);
        assert!(s.iter().all(|v| (*v - 0.25).abs() < 1e-6));
        let before = a.slice(origin, 4);
        assert!(before.iter().all(|v| *v == 0.0), "seconde déjà sortie : silence");
        let m = mix(&[vec![0.8, 0.8], vec![0.8, -0.1]], 2);
        assert_eq!(m, vec![32767, 22936]);
    }

    /// Enregistrement réel (écran principal, son de Windows) puis relecture du MP4 :
    /// `cargo test --lib clips::tests::clip_reel -- --ignored --nocapture`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn clip_reel() {
        configure(ClipSettings { quality: Quality::Medium, seconds: 5, system_audio: true, microphone: std::env::var("IBOX_MICRO").is_ok() });
        let stop = Arc::new(AtomicBool::new(false));
        let threads = session(settings(), stop.clone());
        std::thread::sleep(Duration::from_secs(7));
        println!("disponible : {} s", available_seconds());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("essai clip é.mp4");
        save(&path).unwrap();
        stop.store(true, Ordering::Relaxed);
        for t in threads { t.join().unwrap(); }
        let size = std::fs::metadata(&path).unwrap().len();
        let (video, audio) = unsafe { mux::read_back(&path) }.unwrap();
        println!("{size} octets, {video} images, {audio} paquets audio");
        if let Ok(out) = std::env::var("IBOX_CLIP_OUT") { std::fs::copy(&path, out).unwrap(); }
        assert!(video >= 5 * 25, "au moins 5 s d'images");
        assert!(audio > 100, "son présent");
    }
}
