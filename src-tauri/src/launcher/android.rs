//! Lancement des jeux sur Android : un intent vers l'émulateur installé, puis le retour au
//! premier plan d'iBox clôt la session (temps de jeu, « jeu en cours »).
//!
//! Sur Android, iBox ne voit pas le processus de l'émulateur : la session commence quand
//! l'activité de l'émulateur est démarrée et s'arrête au premier `WindowEvent::Resumed`
//! d'iBox qui suit (`on_resumed`, appelé depuis `lib.rs`). Choix des émulateurs :
//! `android_table.rs` (table d'ES-DE), préférence par console dans `android-emulators.json`.

use super::android_catalog::{self as catalog, BiosState, Source};
use super::android_table::{self as table, Choice, Context};
use super::commands::LauncherState;
use super::launch::{self, Ended, Running};
use super::repo::LaunchPlan;
use crate::library::commands::LibraryState;
use crate::library::now_iso;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_ibox_android::{IboxAndroidExt, UriKind};

/// En deçà, un retour dans iBox signale un émulateur qui n'a pas pu ouvrir le jeu.
const QUICK_RETURN_SECONDS: u64 = 3;
/// Même chose après un cœur RetroArch (écran noir si le cœur manque, retour à la main).
const CORE_RETURN_SECONDS: u64 = 20;

struct Pending {
    running: Running,
    /// Clé ES-DE de l'émulateur (notes du catalogue).
    emulator: String,
    /// Cœur RetroArch demandé : libellé ES-DE et fichier.
    core: Option<(String, String)>,
    session_id: i64,
    started: Instant,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

struct Game {
    title: String,
    platform: String,
    rom: PathBuf,
}

fn game(app: &AppHandle, game_id: i64) -> Result<Game, String> {
    let row: Option<(String, String, String, String)> = app.state::<LibraryState>().with(|c| {
        Ok(c.query_row(
            "SELECT g.title, g.platform_id, m.path, m.status FROM games g
             JOIN game_files m ON m.game_id = g.id AND m.role = 'main' WHERE g.id = ?1",
            [game_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?)
    })?;
    let (title, platform, rom, status) = row.ok_or("Jeu introuvable.")?;
    if status == "missing" || !Path::new(&rom).is_file() {
        return Err(format!("Le fichier du jeu est introuvable : {rom}. La carte SD est peut-être retirée."));
    }
    Ok(Game { title, platform, rom: PathBuf::from(rom) })
}

fn choices_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("android-emulators.json"))
}

fn installed(app: &AppHandle) -> Result<HashSet<String>, String> {
    let found = app.ibox_android().installed(&table::all_components()).map_err(|e| e.to_string())?;
    Ok(found.components.into_iter().collect())
}

fn choice(app: &AppHandle, platform: &str) -> Result<Choice, String> {
    let choices = choices_file(app).map(|f| table::load_choices(&f)).unwrap_or_default();
    let installed = installed(app)?;
    table::choose(platform, &installed, choices.get(platform).map(String::as_str))
        .ok_or_else(|| table::missing_message(platform, table::platform_name(platform)))
}

/// Ce qui sera lancé (aperçu, ou erreur claire : jeu absent, aucun émulateur installé).
pub fn plan(app: &AppHandle, game_id: i64) -> Result<LaunchPlan, String> {
    let g = game(app, game_id)?;
    let c = choice(app, &g.platform)?;
    let component = c.component.clone().unwrap_or_default();
    Ok(LaunchPlan {
        game_id,
        title: g.title,
        emulator_id: None,
        emulator_name: c.name.clone(),
        display: format!("{component} · {}", c.command),
        exe: component,
        args: vec![g.rom.to_string_lossy().to_string()],
        per_game: false,
        detached: false,
    })
}

/// Démarre le jeu ; la session se termine au retour dans iBox (`on_resumed`).
pub fn launch(app: &AppHandle, game_id: i64) -> Result<Running, String> {
    // le verrou n'est pas gardé pendant les appels au plugin (ils passent par le fil d'interface
    // d'Android, que `on_resumed` peut occuper au même moment)
    if let Some(p) = PENDING.lock().map_err(|_| "État de lancement indisponible.".to_string())?.as_ref() {
        return Err(super::LaunchError::AlreadyRunning(p.running.title.clone()).to_string());
    }
    let g = game(app, game_id)?;
    let c = choice(app, &g.platform)?;
    let component = c.component.clone().ok_or("Émulateur introuvable.")?;
    let template = table::parse(&c.command)?;
    let plugin = app.ibox_android();
    let rom = g.rom.to_string_lossy().to_string();
    // adresses demandées par la commande : SAF (arbre autorisé, sinon FileProvider) et FileProvider
    let saf = if template.needs_saf() { Some(plugin.rom_uri(&rom, UriKind::Saf).map_err(|e| e.to_string())?.uri) } else { None };
    let provider = if template.needs_provider() { Some(plugin.rom_uri(&rom, UriKind::Provider).map_err(|e| e.to_string())?.uri) } else { None };
    let package = component.split('/').next().unwrap_or_default().to_string();
    let ctx = Context { rom: &g.rom, package: &package, saf: saf.as_deref(), provider: provider.as_deref() };
    let mut intent = table::resolve(&template, &component, &ctx);
    // SmartConfig : fichier de réglages RetroArch du jeu à la place de CONFIGFILE, s'il y en a un
    crate::smartconfig::android::prepare_launch(app, game_id, &mut intent);
    plugin.launch(&intent).map_err(|e| {
        let e = e.to_string();
        if e.contains("introuvable") {
            format!("{} n'est plus installé ou a changé de version : réinstallez-le depuis iBox Platforms ({e}).", c.name)
        } else {
            format!("{} : {e}", c.name)
        }
    })?;

    let lib = app.state::<LibraryState>();
    let now = now_iso();
    let session_id = lib.with(|conn| {
        conn.execute("UPDATE games SET last_played_at = ?2 WHERE id = ?1", params![game_id, now])?;
        conn.execute("INSERT INTO play_sessions (game_id, started_at) VALUES (?1, ?2)", params![game_id, now])?;
        Ok(conn.last_insert_rowid())
    })?;
    let running = Running { game_id, title: g.title, emulator_name: c.name, started_at: now, pid: 0 };
    if let Ok(mut pending) = PENDING.lock() {
        let core = template.core_file().map(|f| (c.label.clone(), f));
        *pending = Some(Pending { running: running.clone(), emulator: c.emulator.clone(), core, session_id, started: Instant::now() });
    }
    if let Ok(mut r) = app.state::<LauncherState>().running.lock() {
        *r = Some(running.clone());
    }
    let _ = app.emit("launch://started", &running);
    Ok(running)
}

/// iBox revient au premier plan : la partie en cours est terminée.
pub fn on_resumed(app: &AppHandle) {
    // l'interface relit ce qui a pu changer dehors (émulateur installé depuis le Play Store…)
    let _ = app.emit("android://resumed", ());
    let Some(p) = PENDING.lock().ok().and_then(|mut g| g.take()) else { return };
    let seconds = p.started.elapsed().as_secs();
    // RetroArch sans le cœur demandé ne se ferme pas : il reste sur un écran noir et le joueur revient
    // à la main ; un retour rapide après un cœur RetroArch désigne donc le cœur
    let quick = if p.core.is_some() { CORE_RETURN_SECONDS } else { QUICK_RETURN_SECONDS };
    let error = (seconds < quick).then(|| quick_return_message(&p.running.emulator_name, &p.emulator, p.core.as_ref()));
    let lib = app.state::<LibraryState>();
    let _ = lib.with(|conn| {
        launch::finish_session(conn, p.running.game_id, p.session_id, seconds, Some(0), error.as_deref())?;
        Ok(())
    });
    if let Ok(mut r) = app.state::<LauncherState>().running.lock() {
        *r = None;
    }
    let ended = Ended { game_id: p.running.game_id, title: p.running.title, seconds, exit_code: Some(0), error, detached: false };
    let _ = app.emit("launch://ended", &ended);
}

/// Émulateur revenu aussitôt dans iBox : ce qu'il demande d'habitude (BIOS, premier démarrage).
/// `core` : cœur RetroArch demandé (libellé, fichier), qu'iBox ne peut pas voir (il est dans le
/// dossier privé de RetroArch) : le message dit lequel installer et où.
pub fn quick_return_message(name: &str, emulator: &str, core: Option<&(String, String)>) -> String {
    if let Some((label, file)) = core {
        return core_hint(name, label, file);
    }
    match catalog::info_of(emulator).and_then(|i| i.note) {
        Some(note) => format!("{name} s'est fermé sans lancer le jeu. {note}"),
        None => format!("{name} s'est fermé sans lancer le jeu. Ouvrez-le une fois seul pour vérifier qu'il démarre, que son BIOS est installé et qu'il a accès aux fichiers."),
    }
}

/// Cœur RetroArch probablement absent : quoi installer et où.
pub fn core_hint(name: &str, label: &str, file: &str) -> String {
    format!(
        "{name} n'a pas lancé le jeu ? Le cœur « {label} » ({file}) n'est sans doute pas installé. Dans RetroArch : Menu principal › Mise à jour en ligne › Télécharger des cœurs › {label}."
    )
}

/// Une console et ses émulateurs Android (dans l'ordre d'ES-DE).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformChoices {
    pub platform: String,
    pub options: Vec<Choice>,
    /// Libellé enregistré par l'utilisateur.
    pub preferred: Option<String>,
    /// Libellé réellement utilisé (premier installé à défaut de préférence).
    pub effective: Option<String>,
}

#[tauri::command]
pub async fn android_emulators(app: AppHandle) -> Result<Vec<PlatformChoices>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let installed = installed(&app)?;
        let choices = choices_file(&app).map(|f| table::load_choices(&f)).unwrap_or_default();
        Ok(table::table()
            .platforms
            .keys()
            .map(|p| PlatformChoices {
                platform: p.clone(),
                options: table::options(p, &installed),
                preferred: choices.get(p).cloned(),
                effective: table::choose(p, &installed, choices.get(p).map(String::as_str)).map(|c| c.label),
            })
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Émulateur préféré d'une console (`label` d'ES-DE ; None : choix automatique).
#[tauri::command]
pub fn android_emulator_choose(app: AppHandle, platform: String, label: Option<String>) -> Result<(), String> {
    let file = choices_file(&app).ok_or("Dossier de données introuvable.")?;
    let mut choices = table::load_choices(&file);
    match label {
        Some(l) if table::table().platforms.get(&platform).is_some_and(|c| c.iter().any(|c| c.label == l)) => {
            choices.insert(platform, l);
        }
        Some(l) => return Err(format!("Émulateur inconnu : {l}")),
        None => {
            choices.remove(&platform);
        }
    }
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    table::save_choices(&file, &choices).map_err(|e| e.to_string())
}

/// Une façon de lancer les jeux d'une console, avec où installer l'émulateur.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionDetail {
    #[serde(flatten)]
    pub choice: Choice,
    pub sources: Vec<Source>,
    /// Ce que l'émulateur demande (premier démarrage, BIOS, cœur de RetroArch).
    pub note: Option<&'static str>,
    pub needs_bios: Vec<&'static str>,
    /// Cœur RetroArch demandé (fichier), à installer dans RetroArch.
    pub core: Option<String>,
}

/// Fiche Android d'une console (iBox Platforms).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformDetail {
    pub platform: String,
    pub options: Vec<OptionDetail>,
    pub preferred: Option<String>,
    pub effective: Option<String>,
    pub bios: Vec<BiosState>,
    /// Dossiers où les BIOS sont cherchés, le premier étant celui choisi par l'utilisateur.
    pub bios_dirs: Vec<String>,
    /// Dossier choisi pour cette console (sinon celui de toutes les consoles).
    pub bios_folder: Option<String>,
    /// Dossier choisi pour toutes les consoles.
    pub bios_folder_all: Option<String>,
}

/// Dossiers des BIOS choisis : console → dossier, `""` pour toutes les consoles.
fn bios_folders_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("android-bios-folders.json"))
}

fn bios_folders(app: &AppHandle) -> table::Choices {
    let mut map = bios_folders_file(app).map(|f| table::load_choices(&f)).unwrap_or_default();
    // version précédente : un seul dossier pour toutes les consoles
    if !map.contains_key("") {
        if let Some(old) = app.path().app_data_dir().ok().and_then(|d| std::fs::read_to_string(d.join("android-bios-folder.txt")).ok()) {
            if !old.trim().is_empty() {
                map.insert(String::new(), old.trim().to_string());
            }
        }
    }
    map
}

#[tauri::command]
pub async fn android_platform(app: AppHandle, platform: String) -> Result<PlatformDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let plugin = app.ibox_android();
        let mut asked = table::all_components();
        asked.extend(catalog::OBTAINIUM.iter().map(|s| s.to_string()));
        let found = plugin.installed(&asked).map_err(|e| e.to_string())?;
        let obtainium = catalog::OBTAINIUM.iter().any(|o| found.packages.iter().any(|p| o.starts_with(&format!("{p}/"))));
        let installed: HashSet<String> = found.components.into_iter().collect();
        let choices = choices_file(&app).map(|f| table::load_choices(&f)).unwrap_or_default();
        let preferred = choices.get(&platform).cloned();
        let effective = table::choose(&platform, &installed, preferred.as_deref()).map(|c| c.label);
        let options = table::options(&platform, &installed)
            .into_iter()
            .map(|c| {
                let info = catalog::info_of(&c.emulator);
                let name = if c.emulator == "RETROARCH" { "RetroArch".to_string() } else { c.name.clone() };
                OptionDetail {
                    sources: catalog::sources(&c.emulator, &name, obtainium),
                    note: info.and_then(|i| i.note),
                    needs_bios: info.map(|i| i.needs_bios.to_vec()).unwrap_or_default(),
                    core: table::parse(&c.command).ok().and_then(|t| t.core_file()),
                    choice: c,
                }
            })
            .collect();
        let folders = bios_folders(&app);
        let own = folders.get(&platform).cloned();
        let all = folders.get("").cloned();
        let chosen: Vec<&Path> = own.iter().chain(all.iter()).map(Path::new).collect();
        let dirs = catalog::bios_dirs_for(&chosen);
        Ok(PlatformDetail {
            bios: catalog::bios_for(&platform, &dirs),
            bios_dirs: dirs.iter().map(|d| d.to_string_lossy().to_string()).collect(),
            bios_folder: own,
            bios_folder_all: all,
            platform,
            options,
            preferred,
            effective,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Dossier des BIOS d'une console (`platform`), ou de toutes les consoles (None). `path` None :
/// on oublie ce choix (dossiers par défaut).
#[tauri::command]
pub fn android_bios_folder_set(app: AppHandle, platform: Option<String>, path: Option<String>) -> Result<(), String> {
    let file = bios_folders_file(&app).ok_or("Dossier de données introuvable.")?;
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let mut map = bios_folders(&app);
    let key = platform.unwrap_or_default();
    match path {
        Some(p) if Path::new(&p).is_dir() => {
            map.insert(key, p);
        }
        Some(p) => return Err(format!("Dossier introuvable : {p}")),
        None => {
            map.remove(&key);
        }
    }
    table::save_choices(&file, &map).map_err(|e| e.to_string())
}

/// Ouvre une page d'installation (Play Store, versions GitHub, site, Obtainium). Android montre la
/// page ; l'utilisateur confirme lui-même l'installation.
#[tauri::command]
pub async fn android_open(app: AppHandle, url: String) -> Result<(), String> {
    if !catalog::openable(&url) {
        return Err("Adresse refusée.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let plugin = app.ibox_android();
        let view = |data: &str| tauri_plugin_ibox_android::Intent {
            action: Some("android.intent.action.VIEW".into()),
            data: Some(data.into()),
            flags: vec!["newTask".into()],
            ..Default::default()
        };
        // Play Store : l'application du store si elle existe, sinon la page web
        if let Some(id) = url.strip_prefix("https://play.google.com/store/apps/details?id=") {
            if plugin.launch(&view(&format!("market://details?id={id}"))).is_ok() {
                return Ok(());
            }
        }
        plugin.launch(&view(&url)).map_err(|e| {
            if url.starts_with("obtainium://") {
                "Obtainium n'a pas pu s'ouvrir.".to_string()
            } else {
                format!("Aucune application ne peut ouvrir cette page : {e}")
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn message_de_retour_rapide() {
        let m = super::quick_return_message("Azahar", "AZAHAR", None);
        assert!(m.starts_with("Azahar s'est fermé sans lancer le jeu.") && m.contains("dossier utilisateur"), "{m}");
        assert!(super::quick_return_message("SkyEmu", "SKYEMU", None).contains("BIOS"));
        let core = ("Gambatte".to_string(), "gambatte_libretro_android.so".to_string());
        let m = super::quick_return_message("RetroArch (Gambatte)", "RETROARCH", Some(&core));
        assert!(m.contains("« Gambatte » (gambatte_libretro_android.so)") && m.contains("Télécharger des cœurs › Gambatte"), "{m}");
    }
}
