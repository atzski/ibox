//! Commandes Tauri d'iBox Platforms. Le frontend ne transmet que des
//! identifiants de paquets du catalogue : sources, versions, archives et
//! exécutables sont déterminés ici.
//!
//! Événements : `emulators://progress` (Progress) et `emulators://changed`.

use super::catalog::{self, Package, Source};
use super::install::{self, InstallError, Installed, Stage, Step};
use super::requirements;
use crate::launcher::repo;
use crate::library::commands::LibraryState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

type Res<T> = Result<T, String>;

#[derive(Default)]
pub struct EmulatorsState {
    jobs: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Config {
    /// Dossier actuel des émulateurs gérés ; les anciens restent lus (installations déjà faites).
    root: Option<PathBuf>,
    #[serde(default)]
    previous: Vec<PathBuf>,
}

fn config_path(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("emulators.json"))
}

fn config(app: &AppHandle) -> Config {
    config_path(app).ok().and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn root(app: &AppHandle) -> PathBuf {
    config(app).root.unwrap_or_else(install::default_root)
}

/// Toutes les racines connues (actuelle d'abord).
fn roots(app: &AppHandle) -> Vec<PathBuf> {
    let c = config(app);
    let mut out = vec![c.root.unwrap_or_else(install::default_root)];
    for p in c.previous {
        if !out.contains(&p) {
            out.push(p);
        }
    }
    out
}

/// Racine qui contient l'installation d'un paquet (sinon la racine actuelle).
fn root_of(app: &AppHandle, package_id: &str) -> PathBuf {
    let rs = roots(app);
    rs.iter().find(|r| install::installed_dir(r, package_id).is_some()).cloned().unwrap_or_else(|| rs[0].clone())
}

fn pkg(id: &str) -> Res<&'static Package> {
    catalog::package(id).ok_or_else(|| "émulateur inconnu".to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub root: String,
    pub default_root: String,
    pub packages: Vec<Package>,
    pub installed: Vec<Installed>,
    pub backups: Vec<install::Backup>,
    /// Paquets en cours d'installation.
    pub jobs: Vec<String>,
}

#[tauri::command]
pub fn emulators_overview(app: AppHandle, state: State<EmulatorsState>) -> Overview {
    let rs = roots(&app);
    Overview {
        root: rs[0].to_string_lossy().to_string(),
        default_root: install::default_root().to_string_lossy().to_string(),
        packages: catalog::PACKAGES.to_vec(),
        installed: rs.iter().flat_map(|r| install::installed(r)).collect(),
        backups: rs.iter().flat_map(|r| install::backups(r)).collect(),
        jobs: state.jobs.lock().map(|j| j.keys().cloned().collect()).unwrap_or_default(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub package_id: String,
    /// resolving | downloading | verifying | extracting | installing | done | error | cancelled
    pub stage: String,
    pub received: u64,
    pub total: Option<u64>,
    pub speed: u64,
    pub version: Option<String>,
    pub message: Option<String>,
    pub emulator_id: Option<i64>,
}

fn stage_name(s: Stage) -> &'static str {
    match s {
        Stage::Resolving => "resolving",
        Stage::Downloading => "downloading",
        Stage::Verifying => "verifying",
        Stage::Extracting => "extracting",
        Stage::Installing => "installing",
    }
}

/// Enregistre l'installation dans la bibliothèque (profil, chemin, associations libres).
fn register(app: &AppHandle, p: &Package, inst: &Installed) -> Res<i64> {
    let lib = app.state::<LibraryState>();
    lib.with(|c| {
        let emu = match p.source {
            Source::LibretroCore { file } => repo::register_core(c, "retroarch", file, p.platforms),
            // version spécialisée pour des jeux : proposée sur leur fiche, jamais émulateur de la console
            _ => repo::register_managed(c, &inst.exe, p.id, p.name, &inst.version, if p.games.is_empty() { p.platforms } else { &[] }),
        };
        emu.map(|e| e.id).map_err(|e| crate::library::LibraryError::Media(e.to_string()))
    })
}

/// Lance l'installation (ou la mise à jour) en arrière-plan ; la progression arrive par événements.
#[tauri::command]
pub async fn emulator_install(app: AppHandle, package_id: String) -> Res<()> {
    let p = pkg(&package_id)?;
    if !p.automatic {
        return Err("Cet émulateur s'installe depuis son site officiel.".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<EmulatorsState>();
        let mut jobs = state.jobs.lock().map_err(|_| "état indisponible")?;
        if jobs.contains_key(p.id) {
            return Err(format!("{} est déjà en cours d'installation.", p.name));
        }
        if p.requires.is_some_and(|r| jobs.contains_key(r)) {
            return Err("Attendez la fin de l'installation de RetroArch.".into());
        }
        jobs.insert(p.id.to_string(), cancel.clone());
    }
    let root = if p.requires.is_some() { root_of(&app, "retroarch") } else { root_of(&app, p.id) };
    let app2 = app.clone();
    std::thread::spawn(move || {
        let emit = |pr: Progress| {
            let _ = app2.emit("emulators://progress", pr);
        };
        let base = |stage: &str| Progress { package_id: p.id.into(), stage: stage.into(), received: 0, total: None, speed: 0, version: None, message: None, emulator_id: None };
        let mut version: Option<String> = None;
        let mut stage = Stage::Resolving;
        let result = super::download::client().map_err(InstallError::Failed).and_then(|http| {
            install::install(&http, p, &root, &cancel, &mut |step| match step {
                Step::Stage(s) => {
                    stage = s;
                    emit(Progress { version: version.clone(), ..base(stage_name(s)) });
                }
                Step::Version(v) => version = Some(v),
                Step::Bytes { received, total, speed } => emit(Progress { received, total, speed, version: version.clone(), ..base(stage_name(stage)) }),
            })
        });
        let final_progress = match result {
            Ok(inst) => match register(&app2, p, &inst) {
                Ok(id) => Progress { version: Some(inst.version.clone()), emulator_id: Some(id), ..base("done") },
                Err(e) => Progress { message: Some(format!("installé, mais l'enregistrement a échoué : {e}")), ..base("error") },
            },
            Err(InstallError::Cancelled) => base("cancelled"),
            Err(InstallError::Failed(m)) => Progress { message: Some(m), version, ..base("error") },
        };
        if let Ok(mut jobs) = app2.state::<EmulatorsState>().jobs.lock() {
            jobs.remove(p.id);
        }
        emit(final_progress);
        let _ = app2.emit("emulators://changed", p.id);
    });
    Ok(())
}

#[tauri::command]
pub fn emulator_install_cancel(state: State<EmulatorsState>, package_id: String) -> bool {
    state.jobs.lock().ok().and_then(|j| j.get(&package_id).map(|c| c.store(true, Ordering::Relaxed))).is_some()
}

/// Dernière version officielle (sans rien installer).
#[tauri::command]
pub async fn emulator_latest(package_id: String) -> Res<String> {
    let p = pkg(&package_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let http = super::download::client()?;
        super::download::resolve(&http, p).map(|r| r.version)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn emulator_uninstall(app: AppHandle, package_id: String) -> Res<String> {
    let p = pkg(&package_id)?;
    let root = if p.requires.is_some() { root_of(&app, "retroarch") } else { root_of(&app, p.id) };
    let moved = tauri::async_runtime::spawn_blocking(move || install::uninstall(&root, p)).await.map_err(|e| e.to_string())??;
    app.state::<LibraryState>().with(|c| {
        let r = match p.source {
            Source::LibretroCore { file } => repo::forget_core(c, "retroarch", file),
            _ => repo::forget_managed(c, p.id),
        };
        r.map_err(|e| crate::library::LibraryError::Media(e.to_string()))
    })?;
    let _ = app.emit("emulators://changed", p.id);
    Ok(moved.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn emulator_restore(app: AppHandle, package_id: String) -> Res<i64> {
    let p = pkg(&package_id)?;
    let roots = roots(&app);
    let root = roots.iter().find(|r| install::backups(r).iter().any(|b| b.package_id == p.id)).cloned().ok_or("aucune version précédente conservée")?;
    let inst = tauri::async_runtime::spawn_blocking(move || install::restore(&root, p)).await.map_err(|e| e.to_string())??;
    let id = register(&app, p, &inst)?;
    let _ = app.emit("emulators://changed", p.id);
    Ok(id)
}

#[tauri::command]
pub async fn emulator_purge_backups(app: AppHandle, package_id: String) -> Res<u64> {
    let p = pkg(&package_id)?;
    let roots = roots(&app);
    let freed = tauri::async_runtime::spawn_blocking(move || roots.iter().map(|r| install::purge_backups(r, p.id)).sum::<Res<u64>>())
        .await
        .map_err(|e| e.to_string())??;
    let _ = app.emit("emulators://changed", p.id);
    Ok(freed)
}

/// Change le dossier des futurs émulateurs gérés (les installations existantes restent en place).
#[tauri::command]
pub fn emulators_root_set(app: AppHandle, state: State<EmulatorsState>, path: Option<String>) -> Res<String> {
    if state.jobs.lock().is_ok_and(|j| !j.is_empty()) {
        return Err("Attendez la fin des installations en cours.".into());
    }
    let new_root = match path {
        Some(p) => {
            let p = PathBuf::from(p.trim());
            if !p.is_absolute() {
                return Err("Choisissez un dossier complet (avec sa lettre de lecteur).".into());
            }
            let lower = p.to_string_lossy().to_lowercase();
            let forbidden = ["ProgramFiles", "ProgramFiles(x86)", "windir"].iter().filter_map(|v| std::env::var(v).ok()).any(|v| lower.starts_with(&v.to_lowercase()));
            let app_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.to_string_lossy().to_lowercase()));
            if forbidden || app_dir.is_some_and(|d| lower.starts_with(&d)) {
                return Err("Ce dossier est réservé à Windows ou à iBox : choisissez un dossier personnel.".into());
            }
            std::fs::create_dir_all(&p).map_err(|e| super::download::disk_message(&e))?;
            let probe = p.join(".ibox-write-test");
            std::fs::write(&probe, b"ok").map_err(|e| super::download::disk_message(&e))?;
            let _ = std::fs::remove_file(probe);
            p
        }
        None => install::default_root(),
    };
    let mut c = config(&app);
    let old = c.root.clone().unwrap_or_else(install::default_root);
    if old != new_root && !c.previous.contains(&old) {
        c.previous.push(old);
    }
    c.previous.retain(|p| p != &new_root);
    c.root = Some(new_root.clone());
    let file = config_path(&app)?;
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(file, serde_json::to_vec_pretty(&c).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(new_root.to_string_lossy().to_string())
}

fn open_in_explorer(dir: &Path) -> Res<()> {
    if !dir.is_dir() {
        return Err("dossier introuvable".into());
    }
    std::process::Command::new(crate::shell::windows_tool("explorer.exe")).arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Ouvre un dossier connu : `root`, `backups`, ou celui d'un paquet installé.
#[tauri::command]
pub fn emulators_open_folder(app: AppHandle, which: String) -> Res<()> {
    let dir = match which.as_str() {
        "root" => {
            let r = root(&app);
            std::fs::create_dir_all(&r).map_err(|e| super::download::disk_message(&e))?;
            r
        }
        "backups" => root(&app).join("_backups"),
        id => {
            let p = pkg(id)?;
            let base = if p.requires.is_some() { "retroarch" } else { p.id };
            let r = root_of(&app, base);
            let d = install::installed_dir(&r, base).ok_or("cet émulateur n'est pas installé par iBox")?;
            if p.requires.is_some() { d.join("cores") } else { d }
        }
    };
    open_in_explorer(&dir)
}

/// Ouvre dans le navigateur une page officielle connue du catalogue (site, documentation,
/// compatibilité, guide d'un prérequis). Toute autre adresse est refusée.
#[tauri::command]
pub fn emulators_open_url(url: String) -> Res<()> {
    let known = catalog::PACKAGES.iter().flat_map(|p| [Some(p.homepage), Some(p.docs), p.compatibility]).flatten().any(|u| u == url)
        || requirements::LINKS.contains(&url.as_str());
    if !known || !url.starts_with("https://") {
        return Err("adresse non autorisée".into());
    }
    std::process::Command::new(crate::shell::windows_tool("explorer.exe")).arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Ouvre l'émulateur lui-même (réglages, micrologiciel), sans jeu.
#[tauri::command]
pub fn emulator_open(lib: State<LibraryState>, emulator_id: i64) -> Res<()> {
    let exe: String = lib.with(|c| Ok(c.query_row("SELECT exe_path FROM emulators WHERE id = ?1", [emulator_id], |r| r.get(0))?))?;
    let exe = repo::validate_exe(&exe).map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(&exe);
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Ouvre le dossier où l'émulateur attend un fichier (BIOS) ; le crée au besoin.
#[tauri::command]
pub fn emulator_requirement_folder(app: AppHandle, platform_id: String, requirement_id: String) -> Res<()> {
    let ra = install::installed_dir(&root_of(&app, "retroarch"), "retroarch");
    let req = requirements::for_platform(&platform_id, ra.as_deref()).into_iter().find(|r| r.id == requirement_id).ok_or("prérequis inconnu")?;
    let dir = PathBuf::from(req.folder.ok_or("aucun dossier pour ce prérequis")?);
    std::fs::create_dir_all(&dir).map_err(|e| super::download::disk_message(&e))?;
    open_in_explorer(&dir)
}

#[tauri::command]
pub fn emulator_requirements(app: AppHandle, platform_id: String) -> Vec<requirements::Requirement> {
    let ra = install::installed_dir(&root_of(&app, "retroarch"), "retroarch");
    requirements::for_platform(&platform_id, ra.as_deref())
}

#[tauri::command]
pub fn emulator_bios_import(app: AppHandle, requirement_id: String, path: String) -> Res<String> {
    let ra = install::installed_dir(&root_of(&app, "retroarch"), "retroarch");
    requirements::import(&requirement_id, Path::new(&path), ra.as_deref()).map(|p| p.to_string_lossy().to_string())
}
