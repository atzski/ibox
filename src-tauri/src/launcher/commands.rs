//! Commandes Tauri des émulateurs et du lancement.
//! Événements : `launch://started` (Running) et `launch://ended` (Ended).

use super::launch::{self, Ended, Running};
use super::repo::{self, Emulator, LaunchPlan};
use super::{detect, profiles, LaunchError};
use crate::library::commands::LibraryState;
use crate::library::now_iso;
use std::collections::BTreeMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct LauncherState {
    running: Mutex<Option<Running>>,
}

type Res<T> = Result<T, String>;

fn lib_err(e: LaunchError) -> crate::library::LibraryError {
    crate::library::LibraryError::Media(e.to_string())
}

#[tauri::command]
pub fn emulators_list(lib: State<LibraryState>) -> Res<Vec<Emulator>> {
    lib.with(|c| repo::list(c).map_err(lib_err))
}

#[tauri::command]
pub fn emulator_profiles() -> Vec<profiles::Profile> {
    profiles::PROFILES.to_vec()
}

#[tauri::command]
pub fn emulator_add(lib: State<LibraryState>, exe_path: String) -> Res<Emulator> {
    lib.with(|c| repo::add(c, &exe_path).map_err(lib_err))
}

/// Provenance d'un émulateur ajouté depuis la détection (« detected ») ou à la main (« manual »).
#[tauri::command]
pub fn emulator_set_origin(lib: State<LibraryState>, id: i64, origin: String) -> Res<Emulator> {
    lib.with(|c| repo::set_origin(c, id, &origin).map_err(lib_err))
}

#[tauri::command]
pub fn emulator_update(
    lib: State<LibraryState>,
    id: i64,
    name: String,
    args: Vec<String>,
    fullscreen: bool,
    cores: BTreeMap<String, String>,
) -> Res<Emulator> {
    lib.with(|c| repo::update(c, id, &name, &args, fullscreen, &cores).map_err(lib_err))
}

#[tauri::command]
pub fn emulator_remove(lib: State<LibraryState>, id: i64) -> Res<()> {
    lib.with(|c| repo::remove(c, id).map_err(lib_err))
}

/// Cœurs libretro présents dans le dossier `cores` d'un émulateur (RetroArch).
#[tauri::command]
pub fn emulator_cores(lib: State<LibraryState>, id: i64) -> Res<Vec<String>> {
    let exe: String = lib.with(|c| Ok(c.query_row("SELECT exe_path FROM emulators WHERE id = ?1", [id], |r| r.get(0))?))?;
    let dir = super::profiles::cores_dir(std::path::Path::new(&exe));
    let ext = if cfg!(windows) { "_libretro.dll" } else { "_libretro.so" };
    let mut cores: Vec<String> = std::fs::read_dir(&dir)
        .map(|it| {
            it.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.to_lowercase().ends_with(ext))
                .collect()
        })
        .unwrap_or_default();
    cores.sort();
    Ok(cores)
}

#[tauri::command]
pub fn platform_emulator_set(lib: State<LibraryState>, platform_id: String, emulator_id: Option<i64>) -> Res<()> {
    lib.with(|c| repo::set_platform(c, &platform_id, emulator_id).map_err(lib_err))
}

#[tauri::command]
pub fn platform_emulators(lib: State<LibraryState>) -> Res<BTreeMap<String, i64>> {
    lib.with(|c| repo::platform_map(c).map_err(lib_err))
}

#[tauri::command]
pub fn game_emulator_set(lib: State<LibraryState>, game_id: i64, emulator_id: Option<i64>) -> Res<()> {
    lib.with(|c| repo::set_game(c, game_id, emulator_id).map_err(lib_err))
}

/// Découpe une saisie d'arguments (même règle que le lancement : pas de shell).
#[tauri::command]
pub fn args_split(text: String) -> Vec<String> {
    profiles::split_args(&text)
}

/// Commande qui serait exécutée (aperçu, ou erreur explicite si impossible).
#[tauri::command]
pub fn launch_plan(lib: State<LibraryState>, game_id: i64) -> Res<LaunchPlan> {
    lib.with(|c| repo::plan(c, game_id).map_err(lib_err))
}

#[tauri::command]
pub async fn emulators_detect(app: AppHandle) -> Res<Vec<detect::Suggestion>> {
    let (folders, known): (Vec<String>, Vec<String>) = app.state::<LibraryState>().with(|c| {
        let folders = c.prepare("SELECT path FROM folders")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        let known = c.prepare("SELECT exe_path FROM emulators")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        Ok((folders, known))
    })?;
    tauri::async_runtime::spawn_blocking(move || detect::scan(&detect::default_roots(&folders), &known))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn launch_status(state: State<LauncherState>) -> Option<Running> {
    state.running.lock().ok().and_then(|r| r.clone())
}

/// Lance un jeu. La fin de session est signalée par `launch://ended`.
#[tauri::command]
pub fn game_launch(app: AppHandle, game_id: i64) -> Res<Running> {
    let state = app.state::<LauncherState>();
    let mut running = state.running.lock().map_err(|_| "État de lancement indisponible.".to_string())?;
    if let Some(r) = running.as_ref() {
        return Err(LaunchError::AlreadyRunning(r.title.clone()).to_string());
    }
    let lib = app.state::<LibraryState>();
    let plan = lib.with(|c| repo::plan(c, game_id).map_err(lib_err))?;
    let db_path = lib.db_path().to_path_buf();
    let (child, session_id) = launch::start(&db_path, &plan).map_err(|e| e.to_string())?;

    let info = Running {
        game_id,
        title: plan.title.clone(),
        emulator_name: plan.emulator_name.clone(),
        started_at: now_iso(),
        pid: child.id(),
    };
    *running = Some(info.clone());
    drop(running);
    let _ = app.emit("launch://started", &info);
    crate::shell::game_started(&app);

    let app2 = app.clone();
    std::thread::spawn(move || {
        let ended: Ended = launch::watch(&db_path, &plan, child, session_id);
        if let Ok(mut r) = app2.state::<LauncherState>().running.lock() {
            *r = None;
        }
        let _ = app2.emit("launch://ended", &ended);
        crate::shell::game_ended(&app2);
    });
    Ok(info)
}

/// Jeu PC déjà ouvert au moment où il entre dans la bibliothèque : iBox le suit comme
/// s'il l'avait lancé (session, temps de jeu, capture au raccourci réglable), sans relancer le jeu.
#[tauri::command]
pub fn game_adopt_running(app: AppHandle) -> Option<Running> {
    let state = app.state::<LauncherState>();
    let mut running = state.running.lock().ok()?;
    if running.is_some() {
        return None;
    }
    crate::pc::running::forget();
    let lib = app.state::<LibraryState>();
    let (game_id, title, pid) = lib.with(|c| Ok(crate::pc::running::find_process(c))).ok().flatten()?;
    let db_path = lib.db_path().to_path_buf();
    let started_at = now_iso();
    let session_id = {
        let conn = crate::db::open(&db_path).ok()?;
        conn.execute("UPDATE games SET last_played_at = ?2 WHERE id = ?1", rusqlite::params![game_id, started_at]).ok()?;
        conn.execute("INSERT INTO play_sessions (game_id, started_at) VALUES (?1, ?2)", rusqlite::params![game_id, started_at]).ok()?;
        conn.last_insert_rowid()
    };
    let info = Running { game_id, title: title.clone(), emulator_name: "PC".into(), started_at, pid };
    *running = Some(info.clone());
    drop(running);
    let _ = app.emit("launch://started", &info);
    crate::shell::game_started(&app);

    let app2 = app.clone();
    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        while crate::pc::running::alive(pid) {
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
        let seconds = started.elapsed().as_secs();
        if let Ok(conn) = crate::db::open(&db_path) {
            let _ = launch::finish_session(&conn, game_id, session_id, seconds, Some(0), None);
        }
        if let Ok(mut r) = app2.state::<LauncherState>().running.lock() {
            *r = None;
        }
        let ended = Ended { game_id, title, seconds, exit_code: Some(0), error: None, detached: false };
        let _ = app2.emit("launch://ended", &ended);
        crate::shell::game_ended(&app2);
    });
    Some(info)
}
