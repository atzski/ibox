//! Profil local actif (« Qui joue ? »). Les jeux sont communs au PC, mais chaque
//! profil a son propre compte iNetbox (session dans le coffre Windows) et ses
//! propres fonds d'écran. Le premier profil (`p1`) garde les emplacements
//! d'origine, pour que les installations existantes ne perdent rien.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use tauri::Manager;

static ACTIVE: RwLock<String> = RwLock::new(String::new());
const FIRST: &str = "p1";

/// Identifiant sûr pour un nom de fichier ou d'identifiant (lettres, chiffres, 32 au plus).
pub fn sanitize(raw: &str) -> String {
    let clean: String = raw.chars().filter(|c| c.is_ascii_alphanumeric()).take(32).collect();
    if clean.is_empty() { FIRST.into() } else { clean }
}

/// Profil actif (`p1` par défaut).
pub fn active() -> String {
    ACTIVE.read().ok().map(|s| s.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| FIRST.into())
}

/// Suffixe propre au profil actif : vide pour le premier profil.
pub fn suffix() -> String {
    let id = active();
    if id == FIRST { String::new() } else { format!("-{id}") }
}

/// Dossier propre au profil actif sous `base` (le premier profil garde `base`).
pub fn scoped_dir(base: &Path) -> PathBuf {
    let id = active();
    if id == FIRST { base.to_path_buf() } else { base.join("profiles").join(id) }
}

fn file(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("profile.txt"))
}

/// Relit le profil choisi au dernier lancement (avant toute session iNetbox).
pub fn load(app: &tauri::AppHandle) {
    if let Some(raw) = file(app).and_then(|p| fs::read_to_string(p).ok()) {
        set(&sanitize(raw.trim()));
    }
}

fn set(id: &str) {
    if let Ok(mut guard) = ACTIVE.write() { *guard = id.to_string(); }
}

/// Active un profil : la session iNetbox et les fonds suivent.
#[tauri::command]
pub fn profile_activate(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let id = sanitize(&id);
    let changed = active() != id;
    set(&id);
    if let Some(p) = file(&app) {
        if let Some(d) = p.parent() { let _ = fs::create_dir_all(d); }
        fs::write(p, &id).map_err(|e| e.to_string())?;
    }
    if changed { crate::inetbox::forget_session(); }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_safe_and_first_profile_keeps_paths() {
        assert_eq!(sanitize("p../..\\x"), "px");
        assert_eq!(sanitize(""), "p1");
        set("p1");
        assert_eq!(suffix(), "");
        assert_eq!(scoped_dir(Path::new("w")), PathBuf::from("w"));
        set("pabc");
        assert_eq!(suffix(), "-pabc");
        assert_eq!(scoped_dir(Path::new("w")), Path::new("w").join("profiles").join("pabc"));
        set("p1");
    }
}
