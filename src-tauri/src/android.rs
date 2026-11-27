//! Commandes du socle Android (plugin `plugins/ibox-android`, docs/ANDROID.md) : accès aux
//! fichiers, choix d'un dossier de ROM, relais de la manette, plein écran immersif.
//!
//! Compilées partout ; hors d'Android, le plugin répond « Disponible uniquement sur Android ».
//! Les appels au plugin attendent la réponse de Kotlin : jamais depuis le fil principal
//! (commandes asynchrones, travail dans `spawn_blocking`).

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_ibox_android::{IboxAndroidExt, PickedFolder, StorageStatus};

async fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppHandle) -> tauri_plugin_ibox_android::Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// Accès aux fichiers et volumes (mémoire interne, carte SD).
#[tauri::command]
pub async fn android_storage(app: AppHandle) -> Result<StorageStatus, String> {
    blocking(app, |a| a.ibox_android().storage_status()).await
}

/// Demande l'accès à tous les fichiers (page d'Android) ; répond au retour dans iBox.
#[tauri::command]
pub async fn android_storage_request(app: AppHandle) -> Result<StorageStatus, String> {
    blocking(app, |a| a.ibox_android().request_all_files()).await
}

/// Sélecteur de dossier du système, converti en chemin de fichiers. `initial` : dossier où
/// l'ouvrir (autoriser pour les émulateurs un dossier choisi dans iBox).
#[tauri::command]
pub async fn android_pick_folder(app: AppHandle, initial: Option<String>) -> Result<PickedFolder, String> {
    blocking(app, move |a| a.ibox_android().pick_folder(initial.as_deref())).await
}

/// Le dossier est dans un arbre SAF autorisé (sinon, les émulateurs qui attendent une adresse SAF
/// reçoivent celle du FileProvider d'iBox, sans les fichiers voisins).
#[tauri::command]
pub async fn android_saf_covered(app: AppHandle, path: String) -> Result<bool, String> {
    blocking(app, move |a| a.ibox_android().saf_covered(&path)).await
}

/// Un dossier dans le sélecteur d'iBox.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
}

/// Contenu d'un dossier pour le sélecteur à la manette (`components/android/FolderBrowser.tsx`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Browse {
    /// Dossier affiché ; None : la liste des volumes (mémoire interne, cartes SD).
    pub path: Option<String>,
    /// Dossier parent ; None depuis la racine d'un volume (retour à la liste des volumes).
    pub parent: Option<String>,
    pub folders: Vec<FolderEntry>,
    /// Fichiers de jeu reconnus (extensions d'iBox) directement dans ce dossier.
    pub games: usize,
    /// Volumes (à la racine seulement) : nom affiché, chemin, amovible.
    pub volumes: Vec<tauri_plugin_ibox_android::Volume>,
}

/// Sous-dossiers visibles (sans dossiers cachés), triés sans tenir compte de la casse, et nombre de
/// fichiers de jeu reconnus. Pur : testé sous Windows.
pub fn list_dir(dir: &Path) -> std::io::Result<(Vec<FolderEntry>, usize)> {
    let mut folders = Vec::new();
    let mut games = 0;
    for e in std::fs::read_dir(dir)?.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = e.path();
        if path.is_dir() {
            folders.push(FolderEntry { name, path: path.to_string_lossy().to_string() });
        } else if crate::scanner::formats::extension_of(&path).is_some_and(|ext| crate::scanner::formats::is_known_extension(&ext)) {
            games += 1;
        }
    }
    folders.sort_by_key(|f| f.name.to_lowercase());
    Ok((folders, games))
}

/// Parent d'un dossier, ou None s'il est la racine d'un volume.
pub fn parent_in(dir: &Path, roots: &[String]) -> Option<String> {
    if roots.iter().any(|r| Path::new(r) == dir) {
        return None;
    }
    dir.parent().map(|p| p.to_string_lossy().to_string())
}

/// Parcours des dossiers (accès à tous les fichiers) : volumes, puis dossiers.
#[tauri::command]
pub async fn android_browse(app: AppHandle, path: Option<String>) -> Result<Browse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let volumes: Vec<_> = app.ibox_android().storage_status().map_err(|e| e.to_string())?.volumes.into_iter().filter(|v| v.mounted).collect();
        let Some(path) = path else {
            return Ok(Browse { path: None, parent: None, folders: Vec::new(), games: 0, volumes });
        };
        let dir = PathBuf::from(&path);
        let (folders, games) = list_dir(&dir).map_err(|e| format!("Dossier illisible : {path} ({e})"))?;
        let roots: Vec<String> = volumes.iter().map(|v| v.path.clone()).collect();
        Ok(Browse { parent: parent_in(&dir, &roots), path: Some(path), folders, games, volumes: Vec::new() })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dossiers_tries_sans_caches_et_jeux_comptes() {
        let t = tempfile::tempdir().unwrap();
        for d in ["snes", "PSP", ".cache", "gba"] {
            std::fs::create_dir(t.path().join(d)).unwrap();
        }
        std::fs::write(t.path().join("jeu.sfc"), b"x").unwrap();
        std::fs::write(t.path().join("notes.txt"), b"x").unwrap();
        let (folders, games) = list_dir(t.path()).unwrap();
        assert_eq!(folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["gba", "PSP", "snes"]);
        assert_eq!(games, 1);
        assert!(list_dir(&t.path().join("absent")).is_err());
    }

    #[test]
    fn parent_jusqu_a_la_racine_du_volume() {
        let roots = vec!["/storage/emulated/0".to_string(), "/storage/1A2B-3C4D".to_string()];
        assert_eq!(parent_in(Path::new("/storage/1A2B-3C4D"), &roots), None);
        assert_eq!(parent_in(Path::new("/storage/1A2B-3C4D/Roms"), &roots).map(|p| p.replace('\\', "/")), Some("/storage/1A2B-3C4D".into()));
    }
}

/// Relais natif de la manette (événement `pad` du plugin).
#[tauri::command]
pub async fn android_pad_relay(app: AppHandle, enabled: bool) -> Result<(), String> {
    blocking(app, move |a| a.ibox_android().set_pad_relay(enabled)).await
}

/// Plein écran immersif (barres système masquées).
#[tauri::command]
pub async fn android_immersive(app: AppHandle, enabled: bool) -> Result<(), String> {
    blocking(app, move |a| a.ibox_android().set_immersive(enabled)).await
}
