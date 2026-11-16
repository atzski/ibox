//! Fond d'écran personnel : une image choisie par l'utilisateur est **copiée**
//! dans le dossier de données d'iBox (le fichier d'origine n'est jamais déplacé
//! ni modifié), puis relue par l'interface.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

const MAX_BYTES: u64 = 40 * 1024 * 1024;
const NAME: &str = "wallpaper";
/// Fond propre à l'écran d'accueil (il remplace le fond général seulement là).
const HOME: &str = "home";

fn dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("wallpaper");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// Format reconnu d'après les premiers octets (l'extension seule ne suffit pas).
fn sniff(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

fn current(d: &Path) -> Option<PathBuf> {
    current_named(d, NAME)
}

fn current_named(d: &Path, name: &str) -> Option<PathBuf> {
    ["png", "jpg", "webp"].iter().map(|e| d.join(format!("{name}.{e}"))).find(|p| p.is_file())
}

/// Enregistre des octets d'image sous `name` (remplacement atomique, ancien fond gardé en cas d'échec).
fn store(d: &Path, name: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Image trop lourde (40 Mo au maximum).".into());
    }
    let ext = sniff(bytes).ok_or("Format non pris en charge : PNG, JPEG ou WebP.")?;
    let tmp = d.join(format!("{name}.part"));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if let Some(old) = current_named(d, name) {
        fs::remove_file(old).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, d.join(format!("{name}.{ext}"))).map_err(|e| e.to_string())
}

fn install(d: &Path, source: &Path) -> Result<(), String> {
    let meta = fs::metadata(source).map_err(|e| format!("Image illisible : {e}"))?;
    if !meta.is_file() {
        return Err("Ce n'est pas un fichier.".into());
    }
    if meta.len() > MAX_BYTES {
        return Err("Image trop lourde (40 Mo au maximum).".into());
    }
    let bytes = fs::read(source).map_err(|e| format!("Image illisible : {e}"))?;
    let ext = sniff(&bytes).ok_or("Format non pris en charge : PNG, JPEG ou WebP.")?;
    // écriture dans un fichier temporaire puis renommage : jamais d'image à moitié copiée
    let tmp = d.join(format!("{NAME}.part"));
    fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    if let Some(old) = current(d) {
        fs::remove_file(old).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, d.join(format!("{NAME}.{ext}"))).map_err(|e| e.to_string())
}

/// Copie l'image choisie comme fond d'écran personnel.
#[tauri::command]
pub fn wallpaper_set(app: tauri::AppHandle, path: String) -> Result<(), String> {
    install(&dir(&app)?, Path::new(&path))
}

/// Contenu du fond d'écran personnel.
#[tauri::command]
pub fn wallpaper_read(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let p = current(&dir(&app)?).ok_or("Aucun fond personnel.")?;
    fs::read(p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Supprime la copie du fond d'écran personnel (l'image d'origine reste en place).
#[tauri::command]
pub fn wallpaper_clear(app: tauri::AppHandle) -> Result<(), String> {
    match current(&dir(&app)?) {
        Some(p) => fs::remove_file(p).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// Fond de l'accueil choisi sur le PC (copie).
#[tauri::command]
pub fn home_wallpaper_set(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let meta = fs::metadata(&path).map_err(|e| format!("Image illisible : {e}"))?;
    if !meta.is_file() || meta.len() > MAX_BYTES {
        return Err("Image illisible ou trop lourde (40 Mo au maximum).".into());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Image illisible : {e}"))?;
    store(&dir(&app)?, HOME, &bytes)
}

/// Fond de l'accueil choisi dans la galerie en ligne (SteamGridDB, iiDB) : téléchargé une fois.
#[tauri::command]
pub async fn home_wallpaper_from_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let host_ok = reqwest::Url::parse(&url)
        .ok()
        .filter(|u| u.scheme() == "https")
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|h| h.ends_with(".iisu.network") || h.ends_with(".steamgriddb.com"));
    if !host_ok {
        return Err("Adresse d'image refusée.".into());
    }
    let http = app.state::<crate::metadata::commands::MetadataState>().http.clone();
    let d = dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let u = crate::metadata::commands::check_image_link(&url).map_err(|e| e.to_string())?;
        let bytes = http.bytes(u.as_str(), crate::metadata::media::MAX_IMAGE_BYTES, "l'image").map_err(|e| e.to_string())?;
        store(&d, HOME, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn home_wallpaper_read(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let p = current_named(&dir(&app)?, HOME).ok_or("Aucun fond d'accueil.")?;
    fs::read(p).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn home_wallpaper_clear(app: tauri::AppHandle) -> Result<(), String> {
    match current_named(&dir(&app)?, HOME) {
        Some(p) => fs::remove_file(p).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_without_touching_the_source_and_replaces_previous() {
        let base = std::env::temp_dir().join(format!("ibox-wallpaper-{}", std::process::id()));
        let d = base.join("data");
        fs::create_dir_all(&d).unwrap();
        let png = base.join("photo.png");
        fs::write(&png, [0x89, b'P', b'N', b'G', 1, 2, 3]).unwrap();
        install(&d, &png).unwrap();
        assert!(png.is_file(), "l'original reste en place");
        assert!(d.join("wallpaper.png").is_file());

        let jpg = base.join("photo.jpeg");
        fs::write(&jpg, [0xFF, 0xD8, 0xFF, 0xE0, 0]).unwrap();
        install(&d, &jpg).unwrap();
        assert!(!d.join("wallpaper.png").exists());
        assert!(d.join("wallpaper.jpg").is_file());

        let fake = base.join("faux.png");
        fs::write(&fake, b"pas une image").unwrap();
        assert!(install(&d, &fake).is_err());
        assert!(d.join("wallpaper.jpg").is_file(), "un échec garde le fond précédent");
        fs::remove_dir_all(base).ok();
    }

    #[test]
    fn home_background_is_separate_from_the_general_one() {
        let d = std::env::temp_dir().join(format!("ibox-home-{}", std::process::id()));
        fs::create_dir_all(&d).unwrap();
        store(&d, NAME, &[0x89, b'P', b'N', b'G', 1]).unwrap();
        store(&d, HOME, &[0xFF, 0xD8, 0xFF, 0xE0, 0]).unwrap();
        assert!(d.join("wallpaper.png").is_file() && d.join("home.jpg").is_file());
        assert!(store(&d, HOME, b"<html>").is_err());
        assert!(d.join("home.jpg").is_file(), "un échec garde le fond précédent");
        store(&d, HOME, b"RIFF0000WEBPVP8 ").unwrap();
        assert!(!d.join("home.jpg").exists() && d.join("home.webp").is_file());
        fs::remove_dir_all(d).ok();
    }
}
