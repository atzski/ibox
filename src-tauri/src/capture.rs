//! Captures en jeu : pendant une partie, le raccourci de capture (Alt+X par défaut) fige l'image du jeu et ouvre
//! l'overlay iBox par-dessus (capture d'écran, clip des dernières secondes,
//! Communauté). Les captures restent dans le dossier de données d'iBox, propre
//! à chaque profil ; rien ne part en ligne sans un partage explicite.
//!
//! Le raccourci marche aussi hors partie (capture de tout l'écran) ; le clip vidéo des
//! dernières secondes (MP4 avec son, voir `clips.rs`), lui, n'est tenu que
//! pendant un jeu. Les clips restent sur le PC : la Communauté n'accepte que
//! les images (0.1.72).

use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const LABEL: &str = "overlay";

/// Image du jeu prise à l'appui sur le raccourci de capture (PNG), en attente d'être gardée.
static PENDING: Mutex<Option<Shot>> = Mutex::new(None);
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
    name.len() <= 80 && !name.starts_with('.') && (name.ends_with(".png") || name.ends_with(".gif") || name.ends_with(".mp4"))
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
        kind: if name.ends_with(".gif") || name.ends_with(".mp4") { "clip".into() } else { "screenshot".into() },
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

/// Image de l'écran principal par Windows Graphics Capture (celle des clips) : elle voit aussi
/// les jeux en plein écran exclusif, que GDI rend noirs. `None` si WGC est indisponible.
#[cfg(windows)]
fn grab_wgc() -> Option<(u32, u32, Vec<u8>)> {
    use crate::remote_play::capture::{d3d::Device, wgc::{Capture as Wgc, Next}, windows_build, Options, Target};
    use windows::Win32::Graphics::Direct3D11::{D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING};
    let device = Device::create().ok()?;
    let options = Options { cursor: false, borderless: true, require_borderless: false };
    let mut capture = Wgc::start(&device, Target::PrimaryMonitor, options, windows_build()).ok()?;
    let deadline = std::time::Instant::now() + Duration::from_millis(700);
    let frame = loop {
        match capture.next(Duration::from_millis(150)).ok()? {
            Next::Frame(frame) => break frame,
            Next::Timeout if std::time::Instant::now() < deadline => continue,
            _ => return None,
        }
    };
    let (w, h) = frame.size;
    unsafe {
        // copie vers une texture lisible par le processeur, puis BGRA → RGB
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        frame.texture.GetDesc(&mut desc);
        desc.MipLevels = 1;
        desc.ArraySize = 1;
        desc.SampleDesc.Count = 1;
        desc.SampleDesc.Quality = 0;
        desc.Usage = D3D11_USAGE_STAGING;
        desc.BindFlags = 0;
        desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        desc.MiscFlags = 0;
        let mut staging = None;
        device.device.CreateTexture2D(&desc, None, Some(&mut staging)).ok()?;
        let staging = staging?;
        device.context.CopyResource(&staging, &frame.texture);
        let mut map = D3D11_MAPPED_SUBRESOURCE::default();
        device.context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut map)).ok()?;
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for y in 0..h as usize {
            let row = std::slice::from_raw_parts((map.pData as *const u8).add(y * map.RowPitch as usize), w as usize * 4);
            for px in row.chunks_exact(4) { rgb.extend_from_slice(&[px[2], px[1], px[0]]); }
        }
        device.context.Unmap(&staging, 0);
        Some((w, h, rgb))
    }
}
#[cfg(not(windows))]
fn grab_wgc() -> Option<(u32, u32, Vec<u8>)> { None }

/// Capture en pleine taille : WGC d'abord, GDI en repli (Windows anciens, pilote sans WGC).
fn grab_screen() -> Option<(u32, u32, Vec<u8>)> {
    grab_wgc().or_else(|| grab(None))
}

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
        let clips = CLIPS.load(Ordering::Relaxed);
        let before = GAME.lock().ok().and_then(|g| g.clone());
        // fin de partie : le clip est gardé avant que la mémoire ne se vide
        if before.is_some() && game.is_none() && clips {
            crate::clips_auto::on_game_end(&watch);
        }
        // clip vidéo tenu pendant une partie (ou partout, si demandé), si les clips sont activés
        let active = clips && (game.is_some() || crate::clips::settings().everywhere);
        crate::clips::set_active(active);
        crate::clips_auto::tick(&watch, active);
        if let Ok(mut g) = GAME.lock() { *g = game; }
        std::thread::sleep(Duration::from_secs(2));
    });
    crate::clips::start();
}


/// Raccourci de capture : l'overlay est déjà ouvert → il se ferme ; sinon l'image du jeu est figée puis l'overlay s'ouvre.
/// Raccourci activé dans Paramètres › Système (la combinaison elle-même : `shortcut.rs`).
pub(crate) fn hotkey_enabled() -> bool {
    HOTKEY.load(Ordering::Relaxed)
}

pub(crate) fn on_hotkey(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide(app);
        return;
    }
    // iClips activé : son panneau remplace l'overlay de capture (l'image est figée à l'ouverture)
    if crate::plugins::panel::takes_capture(app) {
        crate::plugins::panel::toggle(app);
        return;
    }
    let game = GAME.lock().ok().and_then(|g| g.clone());
    let shot = grab_screen().and_then(|(w, h, rgb)| encode_png(w, h, &rgb).ok());
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
            crate::music::diag::after_show(&app, LABEL);
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
    json!({
        "game": game.as_ref().map(|g| &g.0), "platformId": game.as_ref().map(|g| &g.1),
        "hasShot": shot.is_some(), "clipSeconds": crate::clips::available_seconds(), "clipMax": crate::clips::settings().seconds, "clips": CLIPS.load(Ordering::Relaxed),
    })
}

/// Aperçu de l'image figée (PNG).
#[tauri::command]
pub fn overlay_preview() -> Result<tauri::ipc::Response, String> {
    let p = PENDING.lock().map_err(|_| "Indisponible.")?;
    p.as_ref().map(|s| tauri::ipc::Response::new(s.png.clone())).ok_or_else(|| "Aucune image.".into())
}

/// Garde l'image figée à l'appui sur le raccourci de capture.
#[tauri::command]
pub async fn overlay_save_shot(app: AppHandle) -> Result<Capture, String> {
    let shot = PENDING.lock().map_err(|_| "Indisponible.")?.take().ok_or("Aucune image à garder.")?;
    tauri::async_runtime::spawn_blocking(move || store(&app, &shot.png, "png", shot.game, shot.at)).await.map_err(|e| e.to_string())?
}

/// Enregistre les dernières secondes de jeu en clip vidéo (MP4, son selon les réglages).
#[tauri::command]
pub async fn overlay_save_clip(app: AppHandle) -> Result<Capture, String> {
    save_clip(app).await
}

/// Garde les dernières secondes de jeu (overlay de capture, panneau d'iClips).
pub async fn save_clip(app: AppHandle) -> Result<Capture, String> {
    save_clip_as(app, None).await
}

/// Comme `save_clip` ; `auto` dit ce qui l'a déclenché sans l'utilisateur devant iBox
/// (`voice`, `pad`, `end` : `clips_auto.rs`), gardé à côté du clip.
pub async fn save_clip_as(app: AppHandle, auto: Option<&'static str>) -> Result<Capture, String> {
    let game = PENDING.lock().ok().and_then(|p| p.as_ref().and_then(|s| s.game.clone())).or_else(|| GAME.lock().ok().and_then(|g| g.clone()));
    tauri::async_runtime::spawn_blocking(move || {
        let d = dir(&app)?;
        let at = now();
        let path = d.join(file_name(at, game.as_ref().map(|g| g.0.as_str()), "mp4"));
        // nom de travail hors liste (`valid_name` refuse « _ ») puis renommage
        let work = d.join(format!("_clip-{at}.mp4"));
        let written = crate::clips::save(&work).and_then(|tracks| {
            fs::rename(&work, &path).map_err(|e| e.to_string())?;
            for name in tracks.iter().skip(1) {
                let _ = fs::rename(crate::clips::track_file(&work, name), crate::clips::track_file(&path, name));
            }
            Ok(tracks)
        });
        let tracks = match written {
            Ok(t) => t,
            Err(e) => {
                let _ = fs::remove_file(&work);
                return Err(e);
            }
        };
        let mut meta = json!({});
        if let Some((title, platform)) = &game {
            meta = json!({ "game": title, "platformId": platform });
        }
        if let Some(a) = auto { meta["auto"] = a.into(); }
        // pistes séparées : leur nom, pour le réglage des volumes au montage
        if tracks.len() > 1 { meta["tracks"] = tracks.into(); }
        if meta.as_object().is_some_and(|m| !m.is_empty()) {
            let _ = fs::write(sidecar(&path), serde_json::to_vec(&meta).unwrap_or_default());
        }
        crate::plugins::host::notify(&app, "clips://changed", Value::Null);
        describe(&path).ok_or_else(|| "Clip illisible.".to_string())
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
pub fn capture_settings(clips: bool, hotkey: bool, clip: Option<crate::clips::ClipSettings>, output_device: Option<String>, mic_device: Option<String>) {
    CLIPS.store(clips, Ordering::Relaxed);
    if let Some(c) = clip { crate::clips::configure(c); }
    crate::clips::set_devices(output_device, mic_device);
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
    remove_companions(&path);
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Montre le dossier des captures dans l'Explorateur.
#[tauri::command]
pub fn captures_folder(app: AppHandle) -> Result<(), String> {
    let d = dir(&app)?;
    crate::shell::open_target(d)
}

// ——— Clips pour les plugins (permission `clips`, plugins/host.rs) ———

/// Chemin d'un clip existant du profil (MP4, ou GIF fait par le montage) ; rien d'autre
/// (ni capture d'écran, ni fichier de travail).
pub fn clip_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    if !valid_name(name) || !(name.ends_with(".mp4") || name.ends_with(".gif") || name.ends_with(".png")) { return None; }
    let p = dir(app).ok()?.join(name);
    p.is_file().then_some(p)
}

/// Clips vidéo du profil, du plus récent au plus ancien, avec leur titre et leur favori.
pub fn clip_list(app: &AppHandle) -> Result<Vec<Value>, String> {
    let d = dir(app)?;
    let mut list: Vec<(u64, Value)> = fs::read_dir(&d).map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            let c = describe(&path).filter(|c| c.name.ends_with(".mp4") || c.name.ends_with(".gif") || c.name.ends_with(".png"))?;
            let meta: Value = fs::read(sidecar(&path)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
            Some((c.at, json!({
                "name": c.name, "kind": if c.name.ends_with(".gif") { "gif" } else if c.name.ends_with(".png") { "image" } else { "video" },
                "game": c.game, "platformId": c.platform_id, "at": c.at, "size": c.size,
                "title": meta["title"].as_str(), "favorite": meta["favorite"].as_bool().unwrap_or(false),
                "duration": meta["duration"].as_f64(), "auto": meta["auto"].as_str(),
                "link": meta["link"].as_str(), "linkUntil": meta["linkUntil"].as_u64(),
                "tracks": meta["tracks"].as_array().cloned().unwrap_or_default(),
                "src": format!("__clips/{}", c.name),
                "thumb": thumb(&path).is_file().then(|| format!("__thumbs/{}", c.name)),
            })))
        })
        .collect();
    list.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(list.into_iter().map(|(_, v)| v).collect())
}

/// Ajoute ou remplace des champs du json d'un clip (lien de partage…).
pub fn clip_set_meta(app: &AppHandle, name: &str, fields: &[(&str, Value)]) -> Result<(), String> {
    let path = clip_path(app, name).ok_or("Clip introuvable.")?;
    let mut meta: Value = fs::read(sidecar(&path)).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
    for (k, v) in fields { meta[*k] = v.clone(); }
    fs::write(sidecar(&path), serde_json::to_vec(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Titre (80 caractères au plus, vide : retiré) et favori d'un clip, gardés à côté du fichier.
pub fn clip_update(app: &AppHandle, name: &str, title: Option<&str>, favorite: Option<bool>) -> Result<(), String> {
    let path = clip_path(app, name).ok_or("Clip introuvable.")?;
    let mut meta: Value = fs::read(sidecar(&path)).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
    if let Some(t) = title {
        let t: String = t.trim().chars().filter(|c| !c.is_control()).take(80).collect();
        if t.is_empty() { meta.as_object_mut().map(|m| m.remove("title")); } else { meta["title"] = t.into(); }
    }
    if let Some(f) = favorite { meta["favorite"] = f.into(); }
    fs::write(sidecar(&path), serde_json::to_vec(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Fichiers qui accompagnent un clip : json, vignette, pistes de son séparées.
fn remove_companions(path: &Path) {
    let _ = fs::remove_file(sidecar(path));
    let _ = fs::remove_file(thumb(path));
    for t in ["game", "mic"] {
        let _ = fs::remove_file(crate::clips::track_file(path, t));
    }
}

pub fn clip_delete(app: &AppHandle, name: &str) -> Result<(), String> {
    let path = clip_path(app, name).ok_or("Clip introuvable.")?;
    remove_companions(&path);
    fs::remove_file(path).map_err(|e| e.to_string())
}

/// Vignette d'un clip (`<clip>.jpg`, invisible de la liste des captures : `valid_name` ne
/// prend pas les .jpg). Faite par le plugin à partir de la vidéo, que WebView2 décode déjà.
fn thumb(path: &Path) -> PathBuf { path.with_extension("jpg") }

pub fn clip_thumb_path(app: &AppHandle, name: &str) -> Option<PathBuf> {
    clip_path(app, name).map(|p| thumb(&p)).filter(|t| t.is_file())
}

/// Données du clip gardées à côté de lui (jeu, titre, favori…).
pub fn clip_meta(app: &AppHandle, name: &str) -> Value {
    clip_path(app, name).and_then(|p| fs::read(sidecar(&p)).ok()).and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}))
}

/// Nouveau fichier de montage : nom de travail (hors liste) et nom final.
pub(crate) fn new_capture(app: &AppHandle, game: Option<&str>, ext: &str) -> Result<(PathBuf, PathBuf), String> {
    let d = dir(app)?;
    let at = now();
    Ok((d.join(format!("_edit-{at}.{ext}")), d.join(file_name(at, game, ext))))
}

/// Termine un montage : nom final et données du clip (jeu, titre, clips d'origine), sans favori
/// ni vignette ni durée hérités. Rend le nom du nouveau fichier.
pub(crate) fn finish_capture(work: &Path, path: &Path, meta: &Value) -> Result<String, String> {
    fs::rename(work, path).map_err(|e| e.to_string())?;
    // pistes séparées : seulement si le rendu en a écrit (rendu `mix`)
    let mut kept = Vec::new();
    for t in ["game", "mic"] {
        if fs::rename(crate::clips::track_file(work, t), crate::clips::track_file(path, t)).is_ok() {
            kept.push(t);
        }
    }
    let mut meta = meta.clone();
    if let Some(m) = meta.as_object_mut() {
        for k in ["favorite", "duration", "auto", "link", "linkUntil", "tracks"] { m.remove(k); }
    }
    if !kept.is_empty() {
        let mut names = vec!["mix"];
        names.extend(kept);
        meta["tracks"] = names.into();
    }
    fs::write(sidecar(path), serde_json::to_vec(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    path.file_name().and_then(|n| n.to_str()).map(String::from).ok_or_else(|| "Nom invalide.".into())
}

/// Garde la vignette (JPEG de 300 Ko au plus) et la durée d'un clip.
pub fn clip_thumb(app: &AppHandle, name: &str, jpeg: &[u8], duration: Option<f64>) -> Result<(), String> {
    let path = clip_path(app, name).ok_or("Clip introuvable.")?;
    if jpeg.len() > 300 * 1024 || !jpeg.starts_with(&[0xFF, 0xD8, 0xFF]) { return Err("Vignette invalide.".into()); }
    fs::write(thumb(&path), jpeg).map_err(|e| e.to_string())?;
    if let Some(d) = duration.filter(|d| d.is_finite() && *d > 0.0 && *d < 86_400.0) {
        let mut meta: Value = fs::read(sidecar(&path)).ok().and_then(|b| serde_json::from_slice(&b).ok()).filter(Value::is_object).unwrap_or_else(|| json!({}));
        meta["duration"] = ((d * 10.0).round() / 10.0).into();
        fs::write(sidecar(&path), serde_json::to_vec(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Fige l'image de l'écran (ouverture du panneau d'iClips, qui remplace l'overlay).
pub(crate) fn freeze(app: &AppHandle) {
    let _ = app;
    let game = GAME.lock().ok().and_then(|g| g.clone());
    let shot = grab_screen().and_then(|(w, h, rgb)| encode_png(w, h, &rgb).ok());
    if let Ok(mut p) = PENDING.lock() { *p = shot.map(|png| Shot { png, game, at: now() }); }
}

/// Image figée (PNG), pour le panneau d'iClips.
pub(crate) fn frozen_png() -> Option<Vec<u8>> {
    PENDING.lock().ok().and_then(|p| p.as_ref().map(|s| s.png.clone()))
}

/// `shot.save` : garde l'image figée (dossier des captures, visible dans la Communauté et iClips).
pub fn save_frozen(app: &AppHandle) -> Result<Value, String> {
    let shot = PENDING.lock().map_err(|_| "Indisponible.")?.take().ok_or("Aucune image à garder.")?;
    let c = store(app, &shot.png, "png", shot.game, shot.at)?;
    crate::plugins::host::notify(app, "clips://changed", Value::Null);
    Ok(json!({ "name": c.name }))
}

/// `community.open` : ouvre la Communauté dans iBox depuis le panneau d'iClips.
pub fn open_community(app: &AppHandle) {
    crate::shell::show_main(app);
    let _ = app.emit_to("main", "open-community", ());
}

/// `capture.get` : réglages des clips, place prise par les captures du profil.
pub fn capture_state(app: &AppHandle) -> Value {
    let s = crate::clips::settings();
    let (mut count, mut bytes) = (0u64, 0u64);
    if let Ok(entries) = dir(app).and_then(|d| fs::read_dir(d).map_err(|e| e.to_string())) {
        for e in entries.flatten() {
            if let Some(c) = describe(&e.path()) { count += 1; bytes += c.size; }
        }
    }
    let (height, fps, kbps) = s.quality.params();
    // mémoire tenue en jeu : la vidéo à son débit, plus 48 kHz stéréo en f32 par source de son
    let sources = s.system_audio as u64 + s.microphone as u64;
    let memory = (kbps as u64 * 125 + sources * 48_000 * 8) * (s.seconds as u64 + 3);
    json!({
        "enabled": CLIPS.load(Ordering::Relaxed), "quality": s.quality, "seconds": s.seconds,
        "systemAudio": s.system_audio, "microphone": s.microphone, "systemVolume": s.system_volume, "micVolume": s.mic_volume, "tracks": s.tracks,
        "everywhere": s.everywhere,
        "height": height, "fps": fps, "kbps": kbps, "memory": memory,
        "min": crate::clips::MIN_SECONDS, "max": crate::clips::MAX_SECONDS,
        "count": count, "bytes": bytes,
        // appareils de son : choisis (null : celui par défaut) et branchés
        "outputDevice": crate::clips::devices().0, "micDevice": crate::clips::devices().1,
        "outputs": crate::remote_play::audio::endpoints(false), "inputs": crate::remote_play::audio::endpoints(true),
        // raccourci de l'overlay d'iBox : il ouvre le panneau d'iClips
        "overlayKeys": if HOTKEY.load(Ordering::Relaxed) { crate::shortcut::capture_keys() } else { None },
    })
}

/// `capture.set` : change les réglages des clips ; iBox les garde (Paramètres › Captures suit).
pub fn capture_apply(app: &AppHandle, patch: &Value) -> Result<Value, String> {
    let mut s = crate::clips::settings();
    if let Some(q) = patch.get("quality") { s.quality = serde_json::from_value(q.clone()).map_err(|_| "Qualité inconnue.")?; }
    if let Some(n) = patch["seconds"].as_u64() { s.seconds = n as u32; }
    if let Some(b) = patch["systemAudio"].as_bool() { s.system_audio = b; }
    if let Some(b) = patch["microphone"].as_bool() { s.microphone = b; }
    if let Some(v) = patch["systemVolume"].as_f64() { s.system_volume = v as f32; }
    if let Some(v) = patch["micVolume"].as_f64() { s.mic_volume = v as f32; }
    if let Some(b) = patch["tracks"].as_bool() { s.tracks = b; }
    if let Some(b) = patch["everywhere"].as_bool() { s.everywhere = b; }
    // appareils : identifiant de Windows, ou null pour revenir à celui par défaut
    let (mut output, mut mic) = crate::clips::devices();
    if let Some(v) = patch.get("outputDevice") { output = v.as_str().map(String::from); }
    if let Some(v) = patch.get("micDevice") { mic = v.as_str().map(String::from); }
    crate::clips::set_devices(output, mic);
    let s = s.sanitized();
    crate::clips::configure(s);
    if let Some(b) = patch["enabled"].as_bool() { CLIPS.store(b, Ordering::Relaxed); }
    // la fenêtre principale garde les réglages (et les renvoie au démarrage)
    let mut changed = json!({
        "clipQuality": s.quality, "clipSeconds": s.seconds,
        "clipSystemAudio": s.system_audio, "clipMicrophone": s.microphone,
        "clipSystemVolume": s.system_volume, "clipMicVolume": s.mic_volume, "clipTracks": s.tracks, "clipEverywhere": s.everywhere,
        "clipOutputDevice": crate::clips::devices().0, "clipMicDevice": crate::clips::devices().1,
    });
    // la mémoire des clips ne suit que la demande explicite (`enabled`) : jamais recopiée par ricochet
    if let Some(b) = patch["enabled"].as_bool() { changed["captureClips"] = b.into(); }
    let _ = app.emit_to("main", "clip-settings", changed);
    Ok(capture_state(app))
}

/// `capture.folder` : ouvre le dossier des clips du profil.
pub fn open_folder(app: &AppHandle) -> Result<Value, String> {
    let d = dir(app)?;
    std::process::Command::new("explorer.exe").arg(&d).spawn().map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// Ce que le panneau d'iClips doit savoir pour proposer « Garder le clip ».
pub fn clip_status() -> Value {
    let game = GAME.lock().ok().and_then(|g| g.clone());
    json!({
        "game": game.as_ref().map(|g| &g.0), "platformId": game.as_ref().map(|g| &g.1),
        "enabled": CLIPS.load(Ordering::Relaxed), "seconds": crate::clips::available_seconds(), "max": crate::clips::settings().seconds,
        "listening": crate::clips_auto::listening(),
        "hasShot": PENDING.lock().map(|p| p.is_some()).unwrap_or(false),
    })
}

/// Réduction douce (moyenne des pixels couverts) d'une image RGB.
pub(crate) fn shrink(buf: &[u8], w: u32, h: u32, tw: u32, th: u32) -> Vec<u8> {
    let mut out = vec![0u8; (tw * th * 3) as usize];
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
    out
}

/// Pixels RGB d'une capture : PNG RGB/RGBA 8 bits, ou première image d'un GIF.
fn decode_rgb(bytes: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    if bytes.starts_with(b"GIF8") {
        let mut opts = gif::DecodeOptions::new();
        opts.set_color_output(gif::ColorOutput::RGBA);
        let mut dec = opts.read_info(std::io::Cursor::new(bytes)).ok()?;
        let (w, h) = (dec.width() as u32, dec.height() as u32);
        let frame = dec.read_next_frame().ok()??;
        if frame.width as u32 != w || frame.height as u32 != h { return None; }
        return Some((w, h, frame.buffer.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect()));
    }
    let mut reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    if info.bit_depth != png::BitDepth::Eight { return None; }
    buf.truncate(info.buffer_size());
    let rgb = match info.color_type {
        png::ColorType::Rgb => buf,
        png::ColorType::Rgba => buf.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect(),
        _ => return None,
    };
    Some((info.width, info.height, rgb))
}

/// Réduit une capture d'écran PNG à 1600 points de large pour le partage.
fn shareable_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    const MAX: u32 = 1600;
    let Some((w, h, buf)) = decode_rgb(bytes) else { return Ok(bytes.to_vec()) };
    if w <= MAX { return Ok(bytes.to_vec()); }
    let (tw, th) = (MAX, ((h as u64 * MAX as u64) / w as u64).max(1) as u32);
    let out = shrink(&buf, w, h, tw, th);
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

/// Miniature JPEG (480 points de large) affichée dans le fil : quelques dizaines de Ko
/// au lieu de l'image entière.
pub fn thumbnail(bytes: &[u8]) -> Option<Vec<u8>> {
    const MAX: u32 = 480;
    let (w, h, buf) = decode_rgb(bytes)?;
    let (tw, th) = if w > MAX { (MAX, ((h as u64 * MAX as u64) / w as u64).max(1) as u32) } else { (w, h) };
    let small = if (tw, th) == (w, h) { buf } else { shrink(&buf, w, h, tw, th) };
    let mut out = Vec::new();
    jpeg_encoder::Encoder::new(&mut out, 72).encode(&small, tw as u16, th as u16, jpeg_encoder::ColorType::Rgb).ok()?;
    (out.len() <= 256 * 1024).then_some(out)
}

/// Cache disque des images de la Communauté : un partage ne change jamais, il n'est
/// téléchargé qu'une fois. Les plus anciens fichiers partent au-delà de 200 Mo.
const SHARE_CACHE_BYTES: u64 = 200 * 1024 * 1024;

fn share_cache_file(app: &AppHandle, id: &str, thumb: bool) -> Option<PathBuf> {
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') { return None; }
    let dir = app.path().app_data_dir().ok()?.join("community-cache");
    Some(dir.join(format!("{id}.{}", if thumb { "thumb" } else { "media" })))
}

fn prune_share_cache(dir: &Path) {
    let Ok(items) = fs::read_dir(dir) else { return };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = items.flatten()
        .filter_map(|e| { let m = e.metadata().ok()?; m.is_file().then(|| (m.modified().unwrap_or(UNIX_EPOCH), m.len(), e.path())) })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= SHARE_CACHE_BYTES { return; }
    files.sort_by_key(|f| f.0);
    for (_, len, path) in files {
        if total <= SHARE_CACHE_BYTES { break; }
        if fs::remove_file(&path).is_ok() { total = total.saturating_sub(len); }
    }
}

/// Partage une capture dans la Communauté iNetbox (amis, et tout le monde si le profil est public).
#[tauri::command]
pub async fn community_share(app: AppHandle, name: String, caption: Option<String>, mentions: Option<Vec<String>>) -> Result<Value, crate::inetbox::Error> {
    let bad = |m: &str| crate::inetbox::Error::new("INVALID_INPUT", m);
    let capture = describe(&dir(&app).map_err(|e| bad(&e))?.join(&name)).filter(|_| valid_name(&name)).ok_or_else(|| bad("Capture introuvable."))?;
    // 0.1.72 : la Communauté n'accepte que les images ; les clips restent sur ce PC
    if capture.kind != "screenshot" {
        return Err(bad("Les clips ne se partagent pas dans la Communauté pour le moment : seules les images sont acceptées."));
    }
    let bytes = read_bytes(&app, &name).map_err(|e| bad(&e))?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = if capture.kind == "screenshot" { shareable_png(&bytes).unwrap_or(bytes) } else { bytes };
        let thumb = thumbnail(&bytes);
        let clip = |s: &str, n: usize| s.chars().take(n).collect::<String>();
        let mut meta = vec![("kind", capture.kind.clone())];
        if let Some(g) = &capture.game { meta.push(("game", clip(g, 160))); }
        if let Some(p) = &capture.platform_id { meta.push(("platform", clip(p, 40))); }
        if let Some(c) = caption.as_deref().map(str::trim).filter(|c| !c.is_empty()) { meta.push(("caption", clip(c, 200))); }
        // amis mentionnés dans la légende : identifiants seulement (36 caractères hexadécimaux et tirets)
        let ids: Vec<String> = mentions.unwrap_or_default().into_iter()
            .filter(|id| id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
            .take(10).collect();
        if !ids.is_empty() { meta.push(("mentions", ids.join(","))); }
        crate::inetbox::upload_share(&meta, bytes, thumb)
    }).await.map_err(|_| bad("Partage interrompu."))?
}

/// Image d'un partage (ou sa miniature), lue d'abord dans le cache disque.
#[tauri::command]
pub async fn community_media(app: AppHandle, id: String, thumb: Option<bool>) -> Result<tauri::ipc::Response, crate::inetbox::Error> {
    let thumb = thumb.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        let file = share_cache_file(&app, &id, thumb);
        if let Some(bytes) = file.as_ref().and_then(|f| fs::read(f).ok()).filter(|b| b.len() > 16) {
            return Ok(tauri::ipc::Response::new(bytes));
        }
        let bytes = crate::inetbox::share_media(&id, thumb)?;
        if let Some(f) = file {
            if let Some(dir) = f.parent() {
                let _ = fs::create_dir_all(dir);
                if fs::write(&f, &bytes).is_ok() { prune_share_cache(dir); }
            }
        }
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(|_| crate::inetbox::Error::new("INTERNAL_ERROR", "Indisponible."))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vraie capture WGC de l'écran principal (demande une session graphique) :
    /// `cargo test --lib capture::tests::ecran_par_wgc -- --ignored --nocapture`
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn ecran_par_wgc() {
        let (w, h, rgb) = grab_wgc().expect("WGC indisponible");
        assert!(w >= 640 && h >= 480, "taille {w}×{h}");
        assert_eq!(rgb.len(), (w * h * 3) as usize);
        let lit = rgb.iter().filter(|v| **v > 8).count();
        println!("WGC : {w}×{h}, {} % d'octets non noirs", lit * 100 / rgb.len());
        assert!(lit > 0, "image entièrement noire");
    }

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
    fn thumbnails_are_small_jpegs() {
        let (w, h) = (1600u32, 900u32);
        let rgb: Vec<u8> = (0..w * h).flat_map(|i| [(i % 251) as u8, (i % 13) as u8 * 9, 120]).collect();
        let png = encode_png(w, h, &rgb).unwrap();
        let t = thumbnail(&png).unwrap();
        assert!(t.starts_with(&[0xff, 0xd8, 0xff]));
        assert!(t.len() < png.len() / 4);
        let frames = vec![quantize(&rgb[..(480 * 270 * 3) as usize]); 2];
        let gif = encode_gif(480, 270, &frames, 12).unwrap();
        assert!(thumbnail(&gif).unwrap().starts_with(&[0xff, 0xd8, 0xff]));
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
