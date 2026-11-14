//! Commandes Tauri de la bibliothèque. Les erreurs remontent sous forme de
//! messages français lisibles, affichés tels quels par l'interface.
//!
//! Sécurité : aucune commande n'accepte de chemin de fichier de jeu. Seuls des
//! dossiers sont enregistrés (et listés en lecture seule) ; tous les fichiers
//! lus par le scanner proviennent du parcours de ces dossiers.

use super::{repo, scan, LibraryError};
use crate::db;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct LibraryState {
    db_path: PathBuf,
    conn: Mutex<Result<Connection, String>>,
    _instance_lock: std::fs::File,
    scanning: AtomicBool,
    cancel: Arc<AtomicBool>,
}

impl LibraryState {
    /// Ouvre `library.db` dans le dossier de données de l'application.
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("Impossible de créer {} : {e}", dir.display()))?;
        let db_path = dir.join("library.db");
        let lock = std::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true)
            .open(dir.join("library.lock")).map_err(|e| e.to_string())?;
        lock.try_lock().map_err(|e| format!("La bibliothèque iBox est déjà ouverte ou verrouillée : {e}"))?;
        let conn = super::portable::apply(&dir).and_then(|()| db::recovery::apply(&dir)).and_then(|()| db::open(&db_path).map_err(|e| e.to_string()))
            .and_then(|conn| {
                let check: String = conn.query_row("PRAGMA quick_check(1)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
                if check != "ok" { return Err(format!("Bibliothèque SQLite endommagée : {check}")); }
                if let Err(e) = db::backup(&conn, &dir.join("backups")) {
                    eprintln!("iBox : copie de sécurité impossible — {e}");
                }
                Ok(conn)
            });
        Ok(Self { db_path, conn: Mutex::new(conn), _instance_lock: lock, scanning: AtomicBool::new(false), cancel: Arc::new(AtomicBool::new(false)) })
    }

    pub fn db_path(&self) -> &std::path::Path {
        &self.db_path
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, LibraryError>) -> Result<T, String> {
        let mut conn = self.conn.lock().map_err(|_| "Base de données indisponible.".to_string())?;
        f(conn.as_mut().map_err(|e| e.clone())?).map_err(|e| e.to_string())
    }
}

type Res<T> = Result<T, String>;

#[tauri::command]
pub async fn library_backups(app: AppHandle) -> Res<Vec<db::recovery::Backup>> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || db::recovery::list(&dir)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_delete_backup(app: AppHandle, name: String) -> Res<()> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || db::recovery::remove(&dir, &name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_restore(app: AppHandle, name: String) -> Res<()> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || db::recovery::stage(&dir, &name)).await.map_err(|e| e.to_string())?
}


#[tauri::command]
pub fn folders_list(state: State<LibraryState>) -> Res<Vec<repo::Folder>> {
    state.with(|c| repo::list_folders(c))
}

#[tauri::command]
pub fn folder_add(state: State<LibraryState>, path: String, platform_id: Option<String>) -> Res<repo::Folder> {
    state.with(|c| repo::add_folder(c, &path, platform_id.as_deref()))
}

#[tauri::command]
pub fn folder_update(state: State<LibraryState>, id: i64, platform_id: Option<String>, enabled: bool) -> Res<repo::Folder> {
    state.with(|c| repo::update_folder(c, id, platform_id.as_deref(), enabled))
}

/// Retire un dossier (base uniquement) et libère les images en cache de ses jeux.
#[tauri::command]
pub fn folder_remove(state: State<LibraryState>, meta: State<crate::metadata::commands::MetadataState>, id: i64) -> Res<()> {
    state.with(|c| {
        repo::remove_folder(c, id)?;
        let _ = meta.media.collect_garbage(c);
        Ok(())
    })
}

/// Retire un jeu introuvable de la collection (base uniquement) et libère ses images en cache.
#[tauri::command]
pub fn library_remove_missing(state: State<LibraryState>, meta: State<crate::metadata::commands::MetadataState>, id: i64) -> Res<()> {
    state.with(|c| {
        repo::remove_missing_game(c, id)?;
        let _ = meta.media.collect_garbage(c);
        Ok(())
    })
}

#[tauri::command]
pub fn library_list(state: State<LibraryState>) -> Res<Vec<repo::GameRow>> {
    state.with(|c| repo::list_games(c))
}

#[tauri::command]
pub fn game_set_favorite(state: State<LibraryState>, id: i64, favorite: bool) -> Res<()> {
    state.with(|c| repo::set_favorite(c, id, favorite))
}

#[tauri::command]
pub fn game_update(state: State<LibraryState>, id: i64, patch: repo::GamePatch) -> Res<()> {
    state.with(|c| repo::update_game(c, id, &patch))
}

/// Lance une actualisation dans un fil dédié ; la progression est émise sur
/// l'événement `scan://progress`. Une seule actualisation à la fois.
#[tauri::command]
pub async fn library_scan(app: AppHandle, folder_ids: Option<Vec<i64>>) -> Res<scan::ScanSummary> {
    let state = app.state::<LibraryState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err(LibraryError::ScanRunning.to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let db_path = state.db_path.clone();
    let cancel = state.cancel.clone();
    let emitter = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        // Connexion dédiée : l'interface reste réactive pendant le scan (WAL)
        let mut conn = db::open(&db_path).map_err(|e| e.to_string())?;
        scan::scan(&mut conn, folder_ids.as_deref(), &cancel, |p| {
            let _ = emitter.emit("scan://progress", p);
        })
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("L'actualisation s'est interrompue : {e}"))
    .and_then(|r| r);

    app.state::<LibraryState>().scanning.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn library_scan_cancel(state: State<LibraryState>) {
    state.cancel.store(true, Ordering::SeqCst);
}
