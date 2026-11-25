//! Essais sur le vrai matériel (GPU, bureau Windows ouvert) : `#[ignore]`, à lancer à la main.
//!
//! ```text
//! cargo test --lib remote_play::encode::gpu_tests -- --ignored --nocapture --test-threads=1
//! ```
//!
//! Le flux produit est relu par le décodeur H.264 de Media Foundation pour prouver qu'il est valide.

use std::time::{Duration, Instant};

use windows::core::{w, Result};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

use super::h264;
use super::mf::{process_output, sample_bytes, MfRuntime, Output};
use super::pipeline::{record, Settings};
use super::Preference;

#[derive(Debug, Default)]
struct Decoded {
    frames: u32,
    width: u32,
    height: u32,
    /// Écart-type de la luminance de la dernière image : > 0 prouve une image non uniforme.
    luma_stddev: f64,
}

unsafe fn set_nv12_output(t: &IMFTransform) -> Result<()> {
    for i in 0.. {
        let ty = t.GetOutputAvailableType(0, i)?;
        if ty.GetGUID(&MF_MT_SUBTYPE)? == MFVideoFormat_NV12 {
            return t.SetOutputType(0, &ty, 0);
        }
    }
    unreachable!()
}

/// Décode un flux Annex B complet avec le décodeur H.264 de Microsoft.
fn decode_annexb(stream: &[u8]) -> Result<Decoded> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let _mf = MfRuntime::start()?;
        let t: IMFTransform = CoCreateInstance(&CLSID_MSH264DecoderMFT, None, CLSCTX_INPROC_SERVER)?;
        let input = MFCreateMediaType()?;
        input.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        input.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
        t.SetInputType(0, &input, 0)?;
        set_nv12_output(&t)?;
        t.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        t.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;

        let mut d = Decoded::default();
        let mut last = Vec::new();
        let drain = |d: &mut Decoded, last: &mut Vec<u8>| -> Result<()> {
            loop {
                match process_output(&t, 4096 * 2304 * 3 / 2)? {
                    Output::Sample(s) => {
                        d.frames += 1;
                        *last = sample_bytes(&s)?;
                    }
                    Output::StreamChanged => set_nv12_output(&t)?,
                    Output::NeedMoreInput => return Ok(()),
                }
            }
        };
        for (i, au) in h264::access_units(stream).iter().enumerate() {
            let buffer = MFCreateMemoryBuffer(au.len() as u32)?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None)?;
            std::ptr::copy_nonoverlapping(au.as_ptr(), ptr, au.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(au.len() as u32)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(i as i64 * 166_667)?;
            loop {
                match t.ProcessInput(0, &sample, 0) {
                    Ok(()) => break,
                    Err(e) if e.code() == MF_E_NOTACCEPTING => drain(&mut d, &mut last)?,
                    Err(e) => return Err(e),
                }
            }
            drain(&mut d, &mut last)?;
        }
        t.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
        t.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
        drain(&mut d, &mut last)?;

        let size = t.GetOutputCurrentType(0)?.GetUINT64(&MF_MT_FRAME_SIZE)?;
        d.width = (size >> 32) as u32;
        d.height = size as u32;
        let luma = &last[..((d.width * d.height) as usize).min(last.len())];
        if !luma.is_empty() {
            let mean = luma.iter().map(|&v| v as f64).sum::<f64>() / luma.len() as f64;
            d.luma_stddev = (luma.iter().map(|&v| (v as f64 - mean).powi(2)).sum::<f64>() / luma.len() as f64).sqrt();
        }
        Ok(d)
    }
}

fn run_and_verify(name: &str, settings: Settings) {
    let dir = std::env::temp_dir().join("ibox-remote-play-1b");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(format!("{name}.h264"));
    let mut file = std::io::BufWriter::new(std::fs::File::create(&path).unwrap());
    let (m, attempts) = record(&settings, &mut file).expect("capture + encodage");
    drop(file);

    println!("\n=== {name} ===");
    for a in &attempts {
        println!("essai encodeur : {} [{}] → {:?}", a.name, a.vendor_id.map(|v| format!("{v:04X}")).unwrap_or_else(|| "-".into()), a.result);
    }
    println!("{m}");
    let bytes = std::fs::read(&path).unwrap();
    println!("fichier        : {} ({} octets)", path.display(), bytes.len());

    let aus = h264::access_units(&bytes);
    let t = Instant::now();
    let d = decode_annexb(&bytes).expect("décodage Media Foundation");
    println!(
        "vérification   : {} images dans le fichier, {} décodées par MS H264 Decoder en {:.0} ms, {}×{}, écart-type luminance {:.1}",
        aus.len(),
        d.frames,
        t.elapsed().as_secs_f64() * 1000.0,
        d.width,
        d.height,
        d.luma_stddev
    );
    assert!(m.encoded > 0, "aucune image encodée");
    assert_eq!(aus.len() as u32, m.encoded, "une image H.264 par paquet");
    assert!(h264::is_keyframe(&aus[0]) && h264::has_parameter_sets(&aus[0]), "le flux commence par SPS/PPS + IDR");
    assert_eq!(d.frames, m.encoded, "toutes les images se décodent");
    assert_eq!(d.width, m.output.0);
    assert!(d.height >= m.output.1 && d.height < m.output.1 + 16, "hauteur décodée {} (alignement 16 toléré)", d.height);
}

/// Petite fenêtre qui se déplace sur l'écran principal pendant l'essai : sans mouvement, WGC ne
/// livre presque aucune image et la capture ne serait pas mesurée.
pub(crate) struct Mover {
    stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Mover {
    pub(crate) fn start() -> Mover {
        use std::sync::atomic::Ordering;
        use windows::Win32::UI::WindowsAndMessaging::*;
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::spawn(move || unsafe {
            let hwnd = CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                w!("STATIC"),
                w!("iBox Remote Play — mesure"),
                WS_POPUP | WS_VISIBLE | WS_BORDER,
                200,
                200,
                320,
                180,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let mut i = 0i32;
            while !flag.load(Ordering::SeqCst) {
                i += 1;
                let _ = SetWindowPos(hwnd, None, 200 + (i * 6) % 900, 200 + (i * 2) % 300, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    DispatchMessageW(&msg);
                }
                std::thread::sleep(Duration::from_millis(4));
            }
            let _ = DestroyWindow(hwnd);
        });
        Mover { stop, thread: Some(thread) }
    }
}

impl Mover {
    /// Fenêtre de mesure **invisible** : 1920×1080, transparente, derrière toutes les autres, jamais
    /// au premier plan, jamais activée, sans son. Elle se capture elle-même (`Target::Window`), ce qui ne
    /// demande rien de visible à l'écran : l'utilisateur peut continuer à travailler pendant
    /// l'essai. Contenu : un pavé de grain qui se déplace (léger) ou, avec `IBOX_RP_NOISE=1`,
    /// toute la fenêtre remplie d'un grain tiré d'un endroit différent à chaque image, que
    /// l'encodeur ne peut pas prédire (pour remplir le débit demandé sous lien limité).
    /// Renvoie aussi l'identifiant de la fenêtre.
    pub(crate) fn hidden() -> (Mover, isize) {
        use std::sync::atomic::Ordering;
        use windows::Win32::Graphics::Gdi::*;
        use windows::Win32::UI::WindowsAndMessaging::*;
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = stop.clone();
        let (tx, rx) = std::sync::mpsc::channel::<isize>();
        let thread = std::thread::spawn(move || unsafe {
            let (width, height) = (1920i32, 1080i32);
            let hwnd = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, w!("STATIC"), w!("iBox Remote Play — mesure"), WS_POPUP, 0, 0, width, height, None, None, None, None).unwrap();
            // Essayé le 24/11/2026 : une fenêtre hors écran, même de 2 pixels près, ne livre aucune
            // image nouvelle (Windows ne dessine que la partie d'une fenêtre située dans l'écran).
            // Elle est donc à l'écran, mais transparente à 1/255, traversée par les clics et
            // derrière toutes les autres fenêtres : la capture en reçoit le contenu opaque.
            // `IBOX_RP_WINDOW` : `bottom` (opaque, derrière tout), `corner`, `offscreen`.
            let place = std::env::var("IBOX_RP_WINDOW").unwrap_or_default();
            let right = GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let low = GetSystemMetrics(SM_YVIRTUALSCREEN) + GetSystemMetrics(SM_CYVIRTUALSCREEN);
            let (x, y) = match place.as_str() {
                "offscreen" => (right + 64, low + 64),
                "corner" => (right - 2, low - 2),
                _ => (0, 0),
            };
            if place.is_empty() || place == "ghost" {
                let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                SetWindowLongW(hwnd, GWL_EXSTYLE, style | WS_EX_LAYERED.0 as i32 | WS_EX_TRANSPARENT.0 as i32);
                let _ = SetLayeredWindowAttributes(hwnd, windows::Win32::Foundation::COLORREF(0), 1, LWA_ALPHA);
            }
            let _ = SetWindowPos(hwnd, Some(HWND_BOTTOM), x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
            let _ = tx.send(hwnd.0 as isize);

            let (w, h) = (2560i32, 1440i32);
            let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: size_of::<BITMAPINFOHEADER>() as u32, biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32, ..Default::default() }, ..Default::default() };
            let mut bits = std::ptr::null_mut();
            let memory = CreateCompatibleDC(None);
            let bitmap = CreateDIBSection(Some(memory), &info, DIB_RGB_COLORS, &mut bits, None, 0).unwrap();
            let pixels = std::slice::from_raw_parts_mut(bits as *mut u32, (w * h) as usize);
            let mut seed = 0x2545_F491_4F6C_DD1Du64;
            let mut next = move || {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                seed
            };
            for px in pixels.iter_mut() {
                let v = 104 + (next() >> 40) as u32 % 48;
                *px = v | v << 8 | v << 16;
            }
            SelectObject(memory, bitmap.into());
            let noise = std::env::var("IBOX_RP_NOISE").is_ok_and(|v| v == "1");
            let mut i = 0i32;
            while !flag.load(Ordering::SeqCst) {
                i += 1;
                let dc = GetDC(Some(hwnd));
                if noise {
                    let r = next();
                    let _ = BitBlt(dc, 0, 0, width, height, Some(memory), (r % 640) as i32, ((r >> 20) % 360) as i32, SRCCOPY);
                } else {
                    let _ = BitBlt(dc, (i * 6) % (width - 320), (i * 2) % (height - 180), 320, 180, Some(memory), (i * 7) % 2000, (i * 3) % 1000, SRCCOPY);
                }
                ReleaseDC(Some(hwnd), dc);
                let mut msg = MSG::default();
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    DispatchMessageW(&msg);
                }
                std::thread::sleep(Duration::from_millis(8));
            }
            let _ = DeleteDC(memory);
            let _ = DestroyWindow(hwnd);
        });
        let hwnd = rx.recv_timeout(Duration::from_secs(5)).expect("fenêtre de mesure");
        (Mover { stop, thread: Some(thread) }, hwnd)
    }
}

impl Drop for Mover {
    fn drop(&mut self) {
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// Écran principal, 5 s, encodeur choisi automatiquement (matériel attendu), IDR à la demande
/// toutes les 60 images, avec une fenêtre en mouvement.
#[test]
#[ignore]
fn phase1b_primary_monitor_5s() {
    let _mover = Mover::start();
    run_and_verify("ecran-principal-auto", Settings { keyframe_every: Some(60), ..Default::default() });
}

/// Même chose sans fenêtre animée ni IDR forcée : la cadence de capture dépend alors de ce qui
/// bouge à l'écran (WGC ne livre une image que si l'écran change).
#[test]
#[ignore]
fn phase1b_primary_monitor_as_is_5s() {
    run_and_verify("ecran-principal-tel-quel", Settings::default());
}

/// Même chaîne avec l'encodeur logiciel de Microsoft (repli), en 1080p.
#[test]
#[ignore]
fn phase1b_software_fallback() {
    let _mover = Mover::start();
    run_and_verify(
        "ecran-principal-logiciel",
        Settings { preference: Preference::SoftwareOnly, max_height: Some(1080), duration: Duration::from_secs(5), ..Default::default() },
    );
}

/// Essaie réellement chaque encodeur H.264 enregistré sur ce PC.
#[test]
#[ignore]
fn phase1b_probe_encoders() {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let device = crate::remote_play::capture::d3d::Device::create().unwrap();
    println!("GPU : {} (fabricant {:04X})", device.adapter_name, device.vendor_id);
    let cfg = super::EncoderConfig { width: 1280, height: 720, ..Default::default() };
    for a in super::mf::Encoder::probe_all(&device, cfg) {
        println!("{} [{}] matériel={} → {:?}", a.name, a.vendor_id.map(|v| format!("{v:04X}")).unwrap_or_else(|| "-".into()), a.hardware, a.result);
    }
}

/// Fenêtre capturée redimensionnée puis fermée : la capture suit la taille, puis s'arrête
/// (jamais de repli sur le bureau entier).
#[test]
#[ignore]
fn phase1b_window_resize_then_close() {
    use crate::remote_play::capture::wgc::{Capture, Next};
    use crate::remote_play::capture::{windows_build, Options, Target};
    use windows::Win32::UI::WindowsAndMessaging::*;

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let pump = || {
            let mut msg = MSG::default();
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        };
        let hwnd = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            w!("STATIC"),
            w!("iBox Remote Play — essai de capture"),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            100,
            100,
            640,
            480,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        pump();
        let device = crate::remote_play::capture::d3d::Device::create().unwrap();
        let mut capture = Capture::start(&device, Target::Window(hwnd.0 as isize), Options::default(), windows_build()).unwrap();
        let first = capture.size();
        let mut frames = 0;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline && frames == 0 {
            pump();
            if let Next::Frame(_) = capture.next(Duration::from_millis(50)).unwrap() {
                frames += 1;
            }
        }
        SetWindowPos(hwnd, None, 0, 0, 900, 700, SWP_NOMOVE | SWP_NOZORDER).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut resized_frame = None;
        while Instant::now() < deadline && capture.resizes() == 0 {
            pump();
            if let Next::Frame(f) = capture.next(Duration::from_millis(50)).unwrap() {
                frames += 1;
                resized_frame = Some(f.size);
            }
        }
        // après la recréation de la réserve, les images suivantes ont la nouvelle taille
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            pump();
            let _ = InvalidateRect(Some(hwnd), None, true);
            if let Next::Frame(f) = capture.next(Duration::from_millis(50)).unwrap() {
                frames += 1;
                resized_frame = Some(f.size);
            }
        }
        println!("fenêtre : {first:?} → {:?}, {} redimensionnement(s), {frames} image(s), dernière image {resized_frame:?}", capture.size(), capture.resizes());
        assert!(frames > 0, "aucune image de la fenêtre");
        assert!(capture.resizes() >= 1, "redimensionnement non vu");

        DestroyWindow(hwnd).unwrap();
        let t = Instant::now();
        let stopped = loop {
            match capture.next(Duration::from_millis(100)).unwrap() {
                Next::Stopped(_) => break true,
                Next::Frame(_) => panic!("image reçue après la fermeture de la fenêtre"),
                Next::Timeout if t.elapsed() > Duration::from_secs(2) => break false,
                Next::Timeout => {}
            }
        };
        println!("arrêt après fermeture : {stopped} en {:.1} ms", t.elapsed().as_secs_f64() * 1000.0);
        assert!(stopped, "la capture doit s'arrêter quand la fenêtre se ferme");
    }
}

use windows::Win32::Graphics::Gdi::InvalidateRect;

/// Adaptateurs DXGI et écrans qu'ils pilotent (quel GPU compose l'écran capturé).
#[test]
#[ignore]
fn phase1b_list_outputs() {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    unsafe {
        let primary = MonitorFromPoint(windows::Win32::Foundation::POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY);
        let factory: IDXGIFactory1 = CreateDXGIFactory1().unwrap();
        let mut i = 0;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            let d = adapter.GetDesc1().unwrap();
            let end = d.Description.iter().position(|&c| c == 0).unwrap_or(0);
            println!("adaptateur {i} : {} (fabricant {:04X})", String::from_utf16_lossy(&d.Description[..end]), d.VendorId);
            let mut j = 0;
            while let Ok(output) = adapter.EnumOutputs(j) {
                let o = output.GetDesc().unwrap();
                let r = o.DesktopCoordinates;
                println!("  écran {j} : {}×{} à ({},{}){}", r.right - r.left, r.bottom - r.top, r.left, r.top, if o.Monitor == primary { " ← écran principal" } else { "" });
                j += 1;
            }
            i += 1;
        }
        let mut mode = windows::Win32::Graphics::Gdi::DEVMODEW { dmSize: std::mem::size_of::<windows::Win32::Graphics::Gdi::DEVMODEW>() as u16, ..Default::default() };
        if windows::Win32::Graphics::Gdi::EnumDisplaySettingsW(None, windows::Win32::Graphics::Gdi::ENUM_CURRENT_SETTINGS, &mut mode).as_bool() {
            println!("écran principal : {}×{} à {} Hz", mode.dmPelsWidth, mode.dmPelsHeight, mode.dmDisplayFrequency);
        }
    }
}

/// Sans IDR périodique (gop = 0), une IDR n'apparaît qu'aux images demandées.
#[test]
#[ignore]
fn phase1b_idr_on_demand() {
    use windows::Win32::Graphics::Direct3D11::D3D11_BIND_RENDER_TARGET;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_NV12;
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let device = crate::remote_play::capture::d3d::Device::create().unwrap();
    let cfg = super::EncoderConfig { width: 1280, height: 720, gop: 0, ..Default::default() };
    for preference in [Preference::HardwareOnly, Preference::SoftwareOnly] {
        let mut enc = super::mf::Encoder::new(&device, cfg, preference).unwrap();
        let info = enc.info().clone();
        let texture = super::convert::texture(&device.device, (1280, 720), DXGI_FORMAT_NV12, D3D11_BIND_RENDER_TARGET).unwrap();
        let mut keys = Vec::new();
        let mut n = 0u32;
        for i in 0..150u32 {
            enc.submit(&texture, i as i64 * cfg.frame_duration_100ns(), i == 37 || i == 101).unwrap();
            while let Some(p) = enc.receive(Duration::from_millis(if i == 149 { 0 } else { 100 })).unwrap() {
                if p.keyframe {
                    keys.push(n);
                }
                n += 1;
            }
        }
        for p in enc.finish().unwrap() {
            if p.keyframe {
                keys.push(n);
            }
            n += 1;
        }
        println!("{} : CBR={} bas délai={} GOP={} → {n} paquets, IDR aux images {keys:?}", info.name, info.cbr, info.low_latency, info.gop);
        assert_eq!(n, 150);
        assert_eq!(keys, vec![0, 37, 101], "{}", info.name);
    }
}
