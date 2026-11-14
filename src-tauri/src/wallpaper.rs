//! Fond d'écran personnel : une image choisie par l'utilisateur est **copiée**
//! dans le dossier de données d'iBox (le fichier d'origine n'est jamais déplacé
//! ni modifié), puis relue par l'interface.

use std::fs;
use std::path::{Path, PathBuf};

use tauri::Manager;

const MAX_BYTES: u64 = 40 * 1024 * 1024;
const NAME: &str = "wallpaper";

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
    ["png", "jpg", "webp"].iter().map(|e| d.join(format!("{NAME}.{e}"))).find(|p| p.is_file())
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
}
