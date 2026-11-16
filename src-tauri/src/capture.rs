//! Captures en jeu : pendant une partie, Alt+E fige l'image du jeu et ouvre
//! l'overlay iBox par-dessus (capture d'écran, clip des dernières secondes,
//! Communauté). Les captures restent dans le dossier de données d'iBox, propre
//! à chaque profil ; rien ne part en ligne sans un partage explicite.
//!
//! Le raccourci n'est réservé que pendant qu'un jeu tourne : hors partie,
//! Alt+E reste disponible pour les autres logiciels.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "overlay";
/// Clip : 12 dernières secondes, 8 images par seconde, 480 points de large.
pub const CLIP_SECONDS: usize = 12;
const CLIP_FPS: usize = 8;
const CLIP_WIDTH: u32 = 480;

/// Image du jeu prise à l'appui sur Alt+E (PNG), en attente d'être gardée.
static PENDING: Mutex<Option<Shot>> = Mutex::new(None);
/// Images récentes du jeu (indices de palette), pour les clips.
static RING: Mutex<VecDeque<Vec<u8>>> = Mutex::new(VecDeque::new());
static RING_SIZE: Mutex<(u32, u32)> = Mutex::new((0, 0));
/// Jeu en cours (titre, console) tel que vu par la dernière vérification.
static GAME: Mutex<Option<(String, String)>> = Mutex::new(None);
/// Réglage « Clips » : la mémoire des dernières secondes est tenue pendant les parties.
static CLIPS: AtomicBool = AtomicBool::new(true);
static HOTKEY: AtomicBool = AtomicBool::new(true);

struct Shot { png: Vec<u8>, game: Option<(String, String)>, at: u64 }

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Capture { pub name: String, pub kind: String, pub game: Option<String>, pub platform_id: Option<String>, pub at: u64, pub size: u64 }

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("captures");
    let d = crate::profile::scoped_dir(&base);
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Nom de fichier sûr : horodatage + titre du jeu réduit à des caractères simples.
pub fn file_name(at: u64, game: Option<&str>, ext: &str) -> String {
    let slug: String = game.unwrap_or("ibox").chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>().split('-').filter(|s| !s.is_empty()).take(6).collect::<Vec<_>>().join("-");
    let slug = if slug.is_empty() { "ibox".into() } else { slug.chars().take(40).collect::<String>() };
    format!("{at}-{slug}.{ext}")
}

/// Nom de capture valide (rien d'autre n'est lu ni supprimé).
pub fn valid_name(name: &str) -> bool {
    name.len() <= 80 && !name.starts_with('.') && (name.ends_with(".png") || name.ends_with(".gif"))
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && name.matches('.').count() == 1
}

fn sidecar(path: &Path) -> PathBuf { path.with_extension("json") }

fn describe(path: &Path) -> Option<Capture> {
    let name = path.file_name()?.to_str()?.to_string();
    if !valid_name(&name) { return None; }
    let meta: Value = fs::read(sidecar(path)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let at = name.split('-').next().and_then(|n| n.parse().ok()).unwrap_or(0);
    Some(Capture {
        kind: if name.ends_with(".gif") { "clip".into() } else { "screenshot".into() },
        game: meta["game"].as_str().map(String::from),
        platform_id: meta["platformId"].as_str().map(String::from),
        size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        at, name,
    })
}

fn store(app: &AppHandle, bytes: &[u8], ext: &str, game: Option<(String, String)>, at: u64) -> Result<Capture, String> {
    let d = dir(app)?;
    let path = d.join(file_name(at, game.as_ref().map(|g| g.0.as_str()), ext));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    if let Some((title, platform)) = &game {
        let _ = fs::write(sidecar(&path), serde_json::to_vec(&json!({ "game": title, "platformId": platform })).unwrap_or_default());
    }
    describe(&path).ok_or_else(|| "Capture illisible.".into())
}

// ——— Capture de l'écran (Windows GDI) ———

/// Image de l'écran principal en RGB, réduite à `max_w` de large au besoin.
#[cfg(windows)]
fn grab(max_w: Option<u32>) -> Option<(u32, u32, Vec<u8>)> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Graphics::Gdi::*;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
    unsafe {
        let (w, h) = (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
        if w <= 0 || h <= 0 { return None; }
        let (tw, th) = match max_w {
            Some(m) if (w as u32) > m => (m as i32, ((h as i64 * m as i64) / w as i64).max(1) as i32),
            _ => (w, h),
        };
        let screen = GetDC(null_mut());
        if screen.is_null() { return None; }
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, tw, th);
        let old = SelectObject(mem, bmp);
        let ok = if (tw, th) == (w, h) {
            BitBlt(mem, 0, 0, w, h, screen, 0, 0, SRCCOPY | CAPTUREBLT)
        } else {
            SetStretchBltMode(mem, HALFTONE);
            StretchBlt(mem, 0, 0, tw, th, screen, 0, 0, w, h, SRCCOPY)
        };
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = tw;
        info.bmiHeader.biHeight = -th;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;
        let mut bgra = vec![0u8; (tw * th * 4) as usize];
        let lines = GetDIBits(mem, bmp, 0, th as u32, bgra.as_mut_ptr().cast(), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(null_mut(), screen);
        if ok == 0 || lines == 0 { return None; }
        let mut rgb = Vec::with_capacity((tw * th * 3) as usize);
        for px in bgra.chunks_exact(4) { rgb.extend_from_slice(&[px[2], px[1], px[0]]); }
        Some((tw as u32, th as u32, rgb))
    }
}
#[cfg(not(windows))]
fn grab(_max_w: Option<u32>) -> Option<(u32, u32, Vec<u8>)> { None }

pub fn encode_png(w: u32, h: u32, rgb: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgb).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Palette fixe 6×7×6 (252 couleurs) : rapide, sans tramage, assez fidèle pour un clip.
pub fn palette() -> Vec<u8> {
    let mut p = Vec::with_capacity(256 * 3);
    for r in 0..6u32 { for g in 0..7u32 { for b in 0..6u32 { p.extend_from_slice(&[(r * 255 / 5) as u8, (g * 255 / 6) as u8, (b * 255 / 5) as u8]); } } }
    p.resize(256 * 3, 0);
    p
}
pub fn quantize(rgb: &[u8]) -> Vec<u8> {
    rgb.chunks_exact(3).map(|c| {
        let (r, g, b) = ((c[0] as u32 * 5 + 127) / 255, (c[1] as u32 * 6 + 127) / 255, (c[2] as u32 * 5 + 127) / 255);
        (r * 42 + g * 6 + b) as u8
    }).collect()
}
pub fn encode_gif(w: u32, h: u32, frames: &[Vec<u8>], delay_cs: u16) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, w as u16, h as u16, &palette()).map_err(|e| e.to_string())?;
        enc.set_repeat(gif::Repeat::Infinite).map_err(|e| e.to_string())?;
        for f in frames {
            let mut frame = gif::Frame::from_indexed_pixels(w as u16, h as u16, f.clone(), None);
            frame.delay = delay_cs;
            enc.write_frame(&frame).map_err(|e| e.to_string())?;
        }
    }
    Ok(out)
}

// ——— Veille : jeu en cours, raccourci, mémoire du clip ———

fn game_now(app: &AppHandle) -> Option<(String, String)> {
    crate::inetbox::activity(app).and_then(|v| Some((v["title"].as_str()?.to_string(), v["platformId"].as_str()?.to_string())))
}

pub fn start(app: AppHandle) {
    // vérification du jeu en cours toutes les 2 s
    let watch = app.clone();
    std::thread::spawn(move || loop {
        let game = game_now(&watch);
        if let Ok(mut g) = GAME.lock() { *g = game; }
        std::thread::sleep(Duration::from_secs(2));
    });
    // mémoire des dernières secondes (seulement pendant une partie)
    std::thread::spawn(move || {
        let period = Duration::from_millis((1000 / CLIP_FPS) as u64);
        loop {
            let playing = GAME.lock().map(|g| g.is_some()).unwrap_or(false);
            if !playing || !CLIPS.load(Ordering::Relaxed) {
                if let Ok(mut r) = RING.lock() { r.clear(); }
                std::thread::sleep(Duration::from_millis(800));
                continue;
            }
            let t = Instant::now();
            if let Some((w, h, rgb)) = grab(Some(CLIP_WIDTH)) {
                let frame = quantize(&rgb);
                if let (Ok(mut ring), Ok(mut size)) = (RING.lock(), RING_SIZE.lock()) {
                    if *size != (w, h) { ring.clear(); *size = (w, h); }
                    if ring.len() >= CLIP_SECONDS * CLIP_FPS { ring.pop_front(); }
                    ring.push_back(frame);
                }
            }
            std::thread::sleep(period.saturating_sub(t.elapsed()));
        }
    });
    hotkey_thread(app);
}

#[cfg(windows)]
fn hotkey_thread(app: AppHandle) {
    std::thread::spawn(move || unsafe {
        use std::ptr::null_mut;
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_NOREPEAT};
        use windows_sys::Win32::UI::WindowsAndMessaging::{PeekMessageW, MSG, PM_REMOVE, WM_HOTKEY};
        const ID: i32 = 0x1B0E;
        let mut registered = false;
        let mut msg: MSG = std::mem::zeroed();
        loop {
            // le raccourci n'est réservé que pendant une partie
            let want = HOTKEY.load(Ordering::Relaxed) && GAME.lock().map(|g| g.is_some()).unwrap_or(false);
            if want && !registered { registered = RegisterHotKey(null_mut(), ID, MOD_ALT | MOD_NOREPEAT, 'E' as u32) != 0; }
            if !want && registered { UnregisterHotKey(null_mut(), ID); registered = false; }
            while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                if msg.message == WM_HOTKEY && msg.wParam as i32 == ID { on_hotkey(&app); }
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    });
}
#[cfg(not(windows))]
fn hotkey_thread(_app: AppHandle) {}

/// Alt+E : l'overlay est déjà ouvert → il se ferme ; sinon l'image du jeu est figée puis l'overlay s'ouvre.
fn on_hotkey(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide(app);
        return;
    }
    let game = GAME.lock().ok().and_then(|g| g.clone());
    let shot = grab(None).and_then(|(w, h, rgb)| encode_png(w, h, &rgb).ok());
    if let Ok(mut p) = PENDING.lock() { *p = shot.map(|png| Shot { png, game, at: now() }); }
    show(app);
}

fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) { return Some(w); }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("iBox")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| eprintln!("iBox : overlay indisponible : {e}"))
        .ok()
}

/// Ouvre l'overlay sur tout l'écran principal. Comme pour les notifications, la fenêtre
/// est créée par la boucle d'événements depuis un autre fil (jamais dans une commande).
fn show(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            let Some(w) = window(&app) else { return };
            if let Ok(Some(m)) = w.primary_monitor() {
                let _ = w.set_position(*m.position());
                let _ = w.set_size(*m.size());
            }
            let _ = w.show();
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
            let _ = app.emit_to(LABEL, "overlay-open", ());
        });
    });
}

fn hide(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(LABEL) { let _ = w.hide(); }
        });
    });
}

// ——— Commandes ———

#[tauri::command]
pub fn overlay_state() -> Value {
    let pending = PENDING.lock().ok();
    let shot = pending.as_ref().and_then(|p| p.as_ref());
    let game = shot.and_then(|s| s.game.clone()).or_else(|| GAME.lock().ok().and_then(|g| g.clone()));
    let frames = RING.lock().map(|r| r.len()).unwrap_or(0);
    json!({
        "game": game.as_ref().map(|g| &g.0), "platformId": game.as_ref().map(|g| &g.1),
        "hasShot": shot.is_some(), "clipSeconds": frames / CLIP_FPS, "clips": CLIPS.load(Ordering::Relaxed),
    })
}

/// Aperçu de l'image figée (PNG).
#[tauri::command]
pub fn overlay_preview() -> Result<tauri::ipc::Response, String> {
    let p = PENDING.lock().map_err(|_| "Indisponible.")?;
    p.as_ref().map(|s| tauri::ipc::Response::new(s.png.clone())).ok_or_else(|| "Aucune image.".into())
}

/// Garde l'image figée à l'appui sur Alt+E.
#[tauri::command]
pub async fn overlay_save_shot(app: AppHandle) -> Result<Capture, String> {
    let shot = PENDING.lock().map_err(|_| "Indisponible.")?.take().ok_or("Aucune image à garder.")?;
    tauri::async_runtime::spawn_blocking(move || store(&app, &shot.png, "png", shot.game, shot.at)).await.map_err(|e| e.to_string())?
}

/// Enregistre les dernières secondes de jeu en clip animé.
#[tauri::command]
pub async fn overlay_save_clip(app: AppHandle) -> Result<Capture, String> {
    let frames: Vec<Vec<u8>> = RING.lock().map_err(|_| "Indisponible.")?.iter().cloned().collect();
    if frames.len() < CLIP_FPS { return Err("Pas encore assez d'images : rejouez quelques secondes.".into()); }
    let (w, h) = *RING_SIZE.lock().map_err(|_| "Indisponible.")?;
    let game = PENDING.lock().ok().and_then(|p| p.as_ref().and_then(|s| s.game.clone())).or_else(|| GAME.lock().ok().and_then(|g| g.clone()));
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = encode_gif(w, h, &frames, (100 / CLIP_FPS) as u16)?;
        store(&app, &bytes, "gif", game, now())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn overlay_close(app: AppHandle) {
    if let Ok(mut p) = PENDING.lock() { *p = None; }
    hide(&app);
}

/// Ouvre la Communauté dans iBox depuis l'overlay.
#[tauri::command]
pub async fn overlay_open_community(app: AppHandle) {
    hide(&app);
    crate::shell::show_main(&app);
    let _ = app.emit_to("main", "open-community", ());
}

#[tauri::command]
pub fn capture_settings(clips: bool, hotkey: bool) {
    CLIPS.store(clips, Ordering::Relaxed);
    HOTKEY.store(hotkey, Ordering::Relaxed);
}

#[tauri::command]
pub fn captures_list(app: AppHandle) -> Result<Vec<Capture>, String> {
    let mut list: Vec<Capture> = fs::read_dir(dir(&app)?).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok()).filter_map(|e| describe(&e.path())).collect();
    list.sort_by(|a, b| b.at.cmp(&a.at));
    Ok(list)
}

#[tauri::command]
pub fn captures_read(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    if !valid_name(&name) { return Err("Capture inconnue.".into()); }
    fs::read(dir(&app)?.join(name)).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

pub fn read_bytes(app: &AppHandle, name: &str) -> Result<Vec<u8>, String> {
    if !valid_name(name) { return Err("Capture inconnue.".into()); }
    fs::read(dir(app)?.join(name)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn captures_delete(app: AppHandle, name: String) -> Result<(), String> {
    if !valid_name(&name) { return Err("Capture inconnue.".into()); }
    let path = dir(&app)?.join(name);
    let _ = fs::remove_file(sidecar(&path));
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Montre le dossier des captures dans l'Explorateur.
#[tauri::command]
pub fn captures_folder(app: AppHandle) -> Result<(), String> {
    let d = dir(&app)?;
    std::process::Command::new("explorer").arg(d).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Réduit une capture d'écran PNG à 1600 points de large pour le partage.
fn shareable_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("Image trop grande.")?];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    if info.color_type != png::ColorType::Rgb || info.bit_depth != png::BitDepth::Eight { return Ok(bytes.to_vec()); }
    let (w, h) = (info.width, info.height);
    const MAX: u32 = 1600;
    if w <= MAX { return Ok(bytes.to_vec()); }
    let (tw, th) = (MAX, ((h as u64 * MAX as u64) / w as u64).max(1) as u32);
    let mut out = vec![0u8; (tw * th * 3) as usize];
    // moyenne des pixels couverts (réduction douce)
    for y in 0..th {
        let (y0, y1) = ((y * h / th) as usize, (((y + 1) * h / th).max(y * h / th + 1)) as usize);
        for x in 0..tw {
            let (x0, x1) = ((x * w / tw) as usize, (((x + 1) * w / tw).max(x * w / tw + 1)) as usize);
            let mut acc = [0u32; 3];
            let mut n = 0u32;
            for sy in y0..y1.min(h as usize) { for sx in x0..x1.min(w as usize) {
                let i = (sy * w as usize + sx) * 3;
                acc[0] += buf[i] as u32; acc[1] += buf[i + 1] as u32; acc[2] += buf[i + 2] as u32; n += 1;
            } }
            let o = ((y * tw + x) * 3) as usize;
            for c in 0..3 { out[o + c] = (acc[c] / n.max(1)) as u8; }
        }
    }
    let mut png_out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut png_out, tw, th);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::High);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&out).map_err(|e| e.to_string())?;
    }
    Ok(png_out)
}

/// Partage une capture dans la Communauté iNetbox (amis, et tout le monde si le profil est public).
#[tauri::command]
pub async fn community_share(app: AppHandle, name: String, caption: Option<String>) -> Result<Value, crate::inetbox::Error> {
    let bad = |m: &str| crate::inetbox::Error::new("INVALID_INPUT", m);
    let capture = describe(&dir(&app).map_err(|e| bad(&e))?.join(&name)).filter(|_| valid_name(&name)).ok_or_else(|| bad("Capture introuvable."))?;
    let bytes = read_bytes(&app, &name).map_err(|e| bad(&e))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = if capture.kind == "screenshot" { shareable_png(&bytes).unwrap_or(bytes) } else { bytes };
        let clip = |s: &str, n: usize| s.chars().take(n).collect::<String>();
        let mut meta = vec![("kind", capture.kind.clone())];
        if let Some(g) = &capture.game { meta.push(("game", clip(g, 160))); }
        if let Some(p) = &capture.platform_id { meta.push(("platform", clip(p, 40))); }
        if let Some(c) = caption.as_deref().map(str::trim).filter(|c| !c.is_empty()) { meta.push(("caption", clip(c, 200))); }
        crate::inetbox::upload_share(&meta, bytes)
    }).await.map_err(|_| bad("Partage interrompu."))?
}

#[tauri::command]
pub async fn community_media(id: String) -> Result<tauri::ipc::Response, crate::inetbox::Error> {
    tauri::async_runtime::spawn_blocking(move || crate::inetbox::share_media(&id).map(tauri::ipc::Response::new))
        .await.map_err(|_| crate::inetbox::Error::new("INTERNAL_ERROR", "Indisponible."))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe() {
        assert_eq!(file_name(1700000000000, Some("Zelda: Link's Awakening DX"), "png"), "1700000000000-zelda-link-s-awakening-dx.png");
        assert_eq!(file_name(1, None, "gif"), "1-ibox.gif");
        assert!(valid_name("1700000000000-zelda.png"));
        assert!(!valid_name("../x.png"));
        assert!(!valid_name("a.json"));
        assert!(!valid_name("a.b.png"));
    }

    #[test]
    fn png_and_gif_encode() {
        let rgb = vec![200u8; 4 * 3 * 3];
        let png = encode_png(4, 3, &rgb).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        let frame = quantize(&rgb);
        assert_eq!(frame.len(), 12);
        let gif = encode_gif(4, 3, &[frame.clone(), frame], 12).unwrap();
        assert!(gif.starts_with(b"GIF89a"));
        assert_eq!(palette().len(), 768);
    }
}
