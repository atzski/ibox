//! Musiques du menu choisies par l'utilisateur : copiées dans `<données>/media/music`
//! (le fichier d'origine n'est jamais touché), lues en boucle ou en playlist.
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, String>;
const EXTS: [&str; 6] = ["mp3", "ogg", "wav", "m4a", "opus", "flac"];
pub const MAX_TRACK_BYTES: u64 = 40 * 1024 * 1024;

/// Nom de fichier sûr (aucun chemin, extension audio connue).
fn safe(dir: &Path, name: &str) -> Result<PathBuf> {
    let ok = !name.is_empty() && name.len() <= 160 && !name.contains(['/', '\\', ':']) && !name.starts_with('.')
        && Path::new(name).extension().and_then(|e| e.to_str()).is_some_and(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()));
    if ok { Ok(dir.join(name)) } else { Err("Nom de musique invalide.".into()) }
}

pub fn import(dir: &Path, src: &Path) -> Result<String> {
    let name = src.file_name().and_then(|n| n.to_str()).ok_or("Fichier introuvable.")?.to_string();
    safe(dir, &name).map_err(|_| "Formats acceptés : mp3, ogg, wav, m4a, opus, flac.".to_string())?;
    if std::fs::metadata(src).map_err(|_| "Fichier introuvable.")?.len() > MAX_TRACK_BYTES { return Err("Fichier trop lourd (40 Mo au plus).".into()); }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // même nom déjà présent : suffixe numéroté
    let (stem, ext) = name.rsplit_once('.').unwrap();
    let mut final_name = name.clone();
    let mut n = 2;
    while dir.join(&final_name).exists() { final_name = format!("{stem} ({n}).{ext}"); n += 1; }
    std::fs::copy(src, dir.join(&final_name)).map_err(|e| e.to_string())?;
    Ok(final_name)
}

pub fn list(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir).map(|it| it.flatten().filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|n| safe(dir, n).is_ok()).collect()).unwrap_or_default();
    v.sort();
    v
}

pub fn remove(dir: &Path, name: &str) -> Result<()> {
    let p = safe(dir, name)?;
    if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
    Ok(())
}

pub fn read(dir: &Path, name: &str) -> Result<Vec<u8>> {
    std::fs::read(safe(dir, name)?).map_err(|_| "Musique introuvable.".to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn names_are_checked() {
        let d = tempfile::tempdir().unwrap();
        assert!(super::safe(d.path(), "../x.mp3").is_err());
        assert!(super::safe(d.path(), "a.exe").is_err());
        let src = d.path().join("Thème.MP3");
        std::fs::write(&src, b"x").unwrap();
        let m = d.path().join("m");
        assert_eq!(super::import(&m, &src).unwrap(), "Thème.MP3");
        assert_eq!(super::import(&m, &src).unwrap(), "Thème (2).MP3");
        assert_eq!(super::list(&m).len(), 2);
    }
}
