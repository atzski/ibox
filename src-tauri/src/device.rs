//! Diagnostic de l'appareil (docs/ANDROID.md) : ce que l'interface ne peut pas lire elle-même
//! (modèle, version d'Android, puce, mémoire, base SQLite) et l'enregistrement du rapport là où
//! un testeur peut le récupérer sans outil de développement.
//!
//! Rien d'identifiant : ni numéro de série, ni compte, ni chemin personnel.

use serde::Serialize;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// Propriétés système utiles (Android : `getprop`), dans l'ordre d'affichage.
    pub props: Vec<(String, String)>,
    pub cpu_count: usize,
    pub memory_mb: u64,
    /// Base de la bibliothèque : présente, taille, version du schéma.
    pub database: String,
}

/// Propriétés Android lues par `getprop` : fabricant, modèle, version, puce.
#[cfg(target_os = "android")]
const PROPS: &[(&str, &str)] = &[
    ("Fabricant", "ro.product.manufacturer"),
    ("Modèle", "ro.product.model"),
    ("Appareil", "ro.product.device"),
    ("Android", "ro.build.version.release"),
    ("API", "ro.build.version.sdk"),
    ("Puce", "ro.soc.model"),
    ("Fabricant de la puce", "ro.soc.manufacturer"),
    ("Plateforme", "ro.board.platform"),
    ("Matériel", "ro.hardware"),
    ("Version du système", "ro.build.display.id"),
];

#[cfg(target_os = "android")]
fn props() -> Vec<(String, String)> {
    PROPS
        .iter()
        .filter_map(|(label, key)| {
            let out = std::process::Command::new("/system/bin/getprop").arg(key).output().ok()?;
            let value = String::from_utf8_lossy(&out.stdout).trim().to_string();
            (!value.is_empty()).then(|| (label.to_string(), value))
        })
        .collect()
}

#[cfg(not(target_os = "android"))]
fn props() -> Vec<(String, String)> {
    vec![("Système".into(), std::env::consts::OS.into()), ("Architecture".into(), std::env::consts::ARCH.into())]
}

fn database(app: &AppHandle) -> String {
    let Ok(dir) = app.path().app_data_dir() else { return "dossier de données introuvable".into() };
    let path = dir.join("library.db");
    let Ok(meta) = std::fs::metadata(&path) else { return "absente".into() };
    let version = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|c| c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)))
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "?".into());
    format!("présente, {} Kio, schéma {version}", meta.len() / 1024)
}

#[tauri::command]
pub fn device_info(app: AppHandle) -> DeviceInfo {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    DeviceInfo {
        props: props(),
        cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
        memory_mb: sys.total_memory() / (1024 * 1024),
        database: database(&app),
    }
}

/// Dossiers où écrire le rapport, du plus facile à récupérer au plus sûr. Android : le dossier
/// public « Download » (visible par le gestionnaire de fichiers et en USB), puis le dossier de
/// l'application sur le stockage partagé (`Android/data/…`, visible en USB), puis le dossier
/// privé (toujours possible, lisible seulement avec les outils de développement).
fn report_dirs(app: &AppHandle) -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "android")]
    {
        dirs.push(std::path::PathBuf::from("/storage/emulated/0/Download"));
        if let Ok(d) = app.path().download_dir() {
            dirs.push(d);
        }
    }
    if let Ok(d) = app.path().app_data_dir() {
        dirs.push(d.join("diagnostics"));
    }
    dirs
}

/// Enregistre le rapport partout où c'est possible ; renvoie les chemins écrits.
#[tauri::command]
pub fn device_report_save(app: AppHandle, text: String) -> Result<Vec<String>, String> {
    if text.len() > 2 * 1024 * 1024 {
        return Err("Rapport trop volumineux.".into());
    }
    let stamp = crate::library::now_iso().replace([':', '-'], "").replace('T', "-").chars().take(15).collect::<String>();
    let name = format!("ibox-appareil-{stamp}.txt");
    let mut written = Vec::new();
    for dir in report_dirs(&app) {
        let path = dir.join(&name);
        if std::fs::create_dir_all(&dir).and_then(|()| std::fs::write(&path, &text)).is_ok() {
            written.push(path.display().to_string());
        }
    }
    if written.is_empty() {
        return Err("Impossible d'écrire le rapport.".into());
    }
    Ok(written)
}

/// État de la console Android (chaleur, batterie, écran, mémoire) pour les paliers de
/// performance (docs/ANDROID.md §9). Attend Kotlin : commande asynchrone, hors du fil principal.
#[tauri::command]
pub async fn android_device_state(app: AppHandle) -> Result<tauri_plugin_ibox_android::DeviceState, String> {
    use tauri_plugin_ibox_android::IboxAndroidExt;
    tauri::async_runtime::spawn_blocking(move || app.ibox_android().device_state().map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// Fréquence d'affichage voulue pour la fenêtre d'iBox (0 : choix du système) ; renvoie celle obtenue.
#[tauri::command]
pub async fn android_frame_rate(app: AppHandle, hz: u32) -> Result<u32, String> {
    use tauri_plugin_ibox_android::IboxAndroidExt;
    tauri::async_runtime::spawn_blocking(move || app.ibox_android().set_frame_rate(hz).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}
