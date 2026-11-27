//! Jeux et applications Android de la bibliothèque : l'équivalent Android des jeux PC.
//!
//! - **Collection** : une console « android ». Chaque application est un jeu (`games`,
//!   `serial` = nom du paquet) dont le fichier principal est `android:<paquet>` (aucun fichier
//!   sur le disque, aucun dossier de bibliothèque : le scanner ne le touche jamais).
//! - **Détection** (`android_apps_sync`) : les applications qui se déclarent comme jeux
//!   (`FLAG_IS_GAME`, `CATEGORY_GAME`, catégorie du lanceur) sont ajoutées d'office ; les autres
//!   s'ajoutent à la main (`android_apps_add`). Les émulateurs de la table du lanceur
//!   (RetroArch, PPSSPP, melonDS…) se déclarent souvent comme jeux : ils ne sont jamais ajoutés
//!   d'office (ce sont les outils qui lancent les ROM, pas des jeux), seulement à la main.
//!   Une application retirée par l'utilisateur
//!   n'est plus ajoutée d'office (`android-apps.json`, liste `ignored`). Une application
//!   désinstallée garde sa fiche (temps de jeu) avec le statut `missing`.
//! - **Images** : icône (`logo`, emplacement 1) et bannière Android TV (`hero`, emplacement 1)
//!   lues par le plugin. La bannière (petite, souvent un logo sur fond uni) habille le dos et le
//!   disque du boîtier mais ne sert jamais de « Fond » (emplacement 0 : fonds d'écran, étagère,
//!   collections, profil), où elle s'affichait étirée et pixelisée ; les jaquettes viennent ensuite des sources de métadonnées (LaunchBox, plateforme
//!   « Android », et SteamGridDB par le titre).
//! - **Lancement** : intent de lancement de l'application ; la session se termine au retour
//!   d'iBox au premier plan (`on_resumed`, même mécanisme que les émulateurs).
//! - **Désinstallation** : page d'Android, que l'utilisateur confirme.
//!
//! Les fonctions sur la base sont testées sous Windows ; les commandes n'ont d'effet que sur
//! Android (ailleurs, le plugin répond « Disponible uniquement sur Android »).

use crate::launcher::commands::LauncherState;
use crate::launcher::launch::{self, Ended, Running};
use crate::launcher::repo::LaunchPlan;
use crate::library::commands::LibraryState;
use crate::library::{now_iso, repo, LibraryError};
use crate::metadata::commands::MetadataState;
use crate::metadata::MediaKind;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_ibox_android::apps::{AndroidApp, IboxAppsExt};

pub mod update;

pub const PLATFORM: &str = "android";
/// Préfixe du « fichier » d'une application dans `game_files.path`.
pub const PATH_PREFIX: &str = "android:";
/// Source des images lues sur l'appareil.
const SOURCE: &str = "android";
/// Emplacement de l'icône parmi les logos (le 0 reste aux logos des sources de métadonnées).
pub const ICON_SLOT: i64 = 1;
/// Emplacement de la bannière Android TV parmi les fonds : le 0 est le « Fond » affiché en grand.
pub const BANNER_SLOT: i64 = 1;
/// En deçà, un retour dans iBox signale une application qui n'a pas pu s'ouvrir.
const QUICK_RETURN_SECONDS: u64 = 3;

type Result<T> = std::result::Result<T, LibraryError>;

fn invalid(msg: impl Into<String>) -> LibraryError {
    LibraryError::Media(msg.into())
}

pub fn path_of(package: &str) -> String {
    format!("{PATH_PREFIX}{package}")
}

pub fn package_of(path: &str) -> Option<&str> {
    path.strip_prefix(PATH_PREFIX).filter(|p| !p.is_empty())
}

/// Nom de paquet Android plausible (`com.exemple.jeu`).
fn valid_package(p: &str) -> bool {
    p.contains('.')
        && p.len() <= 255
        && p.split('.').all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !s.starts_with(|c: char| c.is_ascii_digit()))
}

/// Paquet d'un émulateur connu du lanceur (`launcher/android-emulators.json`) : jamais ajouté
/// d'office, même s'il se déclare comme jeu.
fn is_emulator(package: &str) -> bool {
    static PACKAGES: std::sync::OnceLock<std::collections::HashSet<String>> = std::sync::OnceLock::new();
    PACKAGES
        .get_or_init(|| {
            crate::launcher::android_table::all_components()
                .into_iter()
                .filter_map(|c| c.split('/').next().map(str::to_owned))
                .collect()
        })
        .contains(package)
}

// ——— Base ———

/// Applications de la bibliothèque : paquet → (jeu, présente).
pub fn in_library(conn: &Connection) -> Result<HashMap<String, (i64, bool)>> {
    let mut stmt = conn.prepare(
        "SELECT m.path, g.id, m.status FROM games g JOIN game_files m ON m.game_id = g.id AND m.role = 'main'
         WHERE g.platform_id = ?1",
    )?;
    let rows = stmt.query_map([PLATFORM], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?)))?;
    let mut out = HashMap::new();
    for row in rows {
        let (path, id, status) = row?;
        if let Some(p) = package_of(&path) {
            out.insert(p.to_string(), (id, status == "present"));
        }
    }
    Ok(out)
}

/// Ajoute une application ; renvoie le jeu (celui qui existe déjà le cas échéant).
pub fn add_app(conn: &mut Connection, app: &AndroidApp, manual: bool) -> Result<i64> {
    if !valid_package(&app.package_name) {
        return Err(invalid(format!("Nom d'application invalide : {}", app.package_name)));
    }
    let title = if app.label.trim().is_empty() { app.package_name.as_str() } else { app.label.trim() };
    let path = path_of(&app.package_name);
    let existing: Option<i64> = conn.query_row("SELECT game_id FROM game_files WHERE path = ?1", [&path], |r| r.get(0)).optional()?;
    if let Some(id) = existing {
        conn.execute("UPDATE game_files SET status = 'present', last_seen_at = ?2 WHERE path = ?1", params![path, now_iso()])?;
        return Ok(id);
    }
    let now = now_iso();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO games (platform_id, title, sort_title, serial, added_at, id_method, id_confidence)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1.0)",
        params![PLATFORM, title, repo::sort_title(title), app.package_name, now, if manual { "manual" } else { "database" }],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO game_files (game_id, folder_id, path, size, last_seen_at) VALUES (?1, NULL, ?2, ?3, ?4)",
        params![id, path, app.size.max(0), now],
    )?;
    tx.commit()?;
    Ok(id)
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    /// Jeux ajoutés d'office (images et jaquettes à chercher).
    pub added: Vec<i64>,
    /// Applications désinstallées depuis la dernière fois.
    pub missing: usize,
    /// Applications réinstallées.
    pub back: usize,
}

/// Rapproche la bibliothèque des applications installées : ajoute les jeux détectés (sauf ceux
/// que l'utilisateur a retirés), marque les applications désinstallées ou revenues.
pub fn sync(conn: &mut Connection, apps: &[AndroidApp], ignored: &BTreeSet<String>) -> Result<SyncSummary> {
    let known = in_library(conn)?;
    let installed: HashMap<&str, &AndroidApp> = apps.iter().map(|a| (a.package_name.as_str(), a)).collect();
    let mut summary = SyncSummary::default();
    let now = now_iso();
    for (pkg, (id, present)) in &known {
        let here = installed.contains_key(pkg.as_str());
        if here != *present {
            conn.execute(
                "UPDATE game_files SET status = ?2, last_seen_at = ?3 WHERE game_id = ?1 AND role = 'main'",
                params![id, if here { "present" } else { "missing" }, now],
            )?;
            if here { summary.back += 1 } else { summary.missing += 1 }
        }
    }
    for app in apps {
        if app.game
            && !is_emulator(&app.package_name)
            && !known.contains_key(&app.package_name)
            && !ignored.contains(&app.package_name)
            && valid_package(&app.package_name)
        {
            summary.added.push(add_app(conn, app, false)?);
        }
    }
    Ok(summary)
}

/// Retire une application de la bibliothèque (rien n'est désinstallé) ; renvoie son paquet.
pub fn remove(conn: &mut Connection, game_id: i64) -> Result<String> {
    let path: Option<String> = conn
        .query_row(
            "SELECT m.path FROM games g JOIN game_files m ON m.game_id = g.id AND m.role = 'main' WHERE g.id = ?1 AND g.platform_id = ?2",
            params![game_id, PLATFORM],
            |r| r.get(0),
        )
        .optional()?;
    let path = path.ok_or(LibraryError::NotFound)?;
    let pkg = package_of(&path).ok_or(LibraryError::NotFound)?.to_string();
    conn.execute("DELETE FROM games WHERE id = ?1", [game_id])?;
    Ok(pkg)
}

/// Application d'un jeu de la console Android : (titre, paquet, présente).
pub fn app_of(conn: &Connection, game_id: i64) -> Result<(String, String, bool)> {
    let row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT g.title, m.path, m.status FROM games g JOIN game_files m ON m.game_id = g.id AND m.role = 'main'
             WHERE g.id = ?1 AND g.platform_id = ?2",
            params![game_id, PLATFORM],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (title, path, status) = row.ok_or(LibraryError::NotFound)?;
    let pkg = package_of(&path).ok_or(LibraryError::NotFound)?.to_string();
    Ok((title, pkg, status == "present"))
}

pub fn set_present(conn: &Connection, game_id: i64, present: bool) -> Result<()> {
    conn.execute(
        "UPDATE game_files SET status = ?2, last_seen_at = ?3 WHERE game_id = ?1 AND role = 'main'",
        params![game_id, if present { "present" } else { "missing" }, now_iso()],
    )?;
    Ok(())
}

// ——— Préférences (`android-apps.json`) ———

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Prefs {
    /// Jeux détectés que l'utilisateur a retirés : plus ajoutés d'office.
    #[serde(default)]
    pub ignored: BTreeSet<String>,
}

fn prefs_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("android-apps.json"))
}

pub fn load_prefs(file: &std::path::Path) -> Prefs {
    std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save_prefs(file: &std::path::Path, prefs: &Prefs) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(file, serde_json::to_string_pretty(prefs).unwrap_or_default())
}

fn update_prefs(app: &AppHandle, f: impl FnOnce(&mut Prefs)) {
    let Some(file) = prefs_file(app) else { return };
    let mut prefs = load_prefs(&file);
    f(&mut prefs);
    let _ = save_prefs(&file, &prefs);
}

// ——— Images ———

/// Icône et bannière de l'application, enregistrées comme images du jeu (jamais à la place
/// d'une image importée par l'utilisateur).
fn save_art(app: &AppHandle, game_id: i64, package: &str) {
    let Ok(art) = app.ibox_apps().art(package) else { return };
    let b64 = base64::engine::general_purpose::STANDARD;
    let store = app.state::<MetadataState>().media.clone();
    let lib = app.state::<LibraryState>();
    let _ = lib.with(|conn| {
        if let Some(bytes) = art.icon.as_deref().and_then(|s| b64.decode(s).ok()) {
            let _ = store.save(conn, game_id, MediaKind::Logo, ICON_SLOT, &bytes, SOURCE, Some(package));
        }
        // versions précédentes : bannière rangée comme « Fond » (emplacement 0) ; une image
        // importée par l'utilisateur ou trouvée par une source de métadonnées n'est pas touchée
        if legacy_banner_as_hero(conn, game_id)? {
            let _ = store.remove(conn, game_id, MediaKind::Hero, 0);
        }
        if let Some(bytes) = art.banner.as_deref().and_then(|s| b64.decode(s).ok()) {
            let _ = store.save(conn, game_id, MediaKind::Hero, BANNER_SLOT, &bytes, SOURCE, Some(package));
        }
        Ok(())
    });
}

/// Le « Fond » (emplacement 0) du jeu est-il une bannière Android TV rangée par une version
/// précédente ? Jamais vrai pour une image importée ou trouvée par une source de métadonnées.
fn legacy_banner_as_hero(conn: &Connection, game_id: i64) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM media WHERE game_id = ?1 AND kind = 'hero' AND slot = 0 AND source = ?2)",
        params![game_id, SOURCE],
        |r| r.get(0),
    )
}

/// Applications dont le « Fond » est encore une bannière Android TV (versions précédentes).
fn legacy_banner_games(conn: &Connection) -> rusqlite::Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT game_id FROM media WHERE kind = 'hero' AND slot = 0 AND source = ?1")?;
    let ids = stmt.query_map([SOURCE], |r| r.get(0))?;
    ids.collect()
}

// ——— Lancement et session ———

struct Pending {
    running: Running,
    session_id: i64,
    started: Instant,
}

static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

/// Ce qui sera ouvert (aperçu ; erreur si l'application a été désinstallée).
pub fn plan(conn: &Connection, game_id: i64) -> std::result::Result<LaunchPlan, String> {
    let (title, pkg, present) = app_of(conn, game_id).map_err(|e| e.to_string())?;
    if !present {
        return Err(format!("« {title} » n'est plus installé sur cet appareil."));
    }
    Ok(LaunchPlan {
        game_id,
        title,
        emulator_id: None,
        emulator_name: "Android".into(),
        exe: pkg.clone(),
        args: vec![],
        per_game: false,
        display: format!("intent de lancement · {pkg}"),
        detached: false,
    })
}

fn launch(app: &AppHandle, game_id: i64) -> std::result::Result<Running, String> {
    if let Some(p) = PENDING.lock().map_err(|_| "État de lancement indisponible.".to_string())?.as_ref() {
        return Err(crate::launcher::LaunchError::AlreadyRunning(p.running.title.clone()).to_string());
    }
    let lib = app.state::<LibraryState>();
    let p = lib.with(|c| plan(c, game_id).map_err(invalid))?;
    let plugin = app.ibox_apps();
    if !plugin.is_installed(&p.exe).unwrap_or(true) {
        let _ = lib.with(|c| set_present(c, game_id, false));
        return Err(format!("« {} » n'est plus installé sur cet appareil.", p.title));
    }
    plugin.launch(&p.exe).map_err(|e| e.to_string())?;
    let now = now_iso();
    let session_id = lib.with(|conn| {
        conn.execute("UPDATE games SET last_played_at = ?2 WHERE id = ?1", params![game_id, now])?;
        conn.execute("INSERT INTO play_sessions (game_id, started_at) VALUES (?1, ?2)", params![game_id, now])?;
        Ok(conn.last_insert_rowid())
    })?;
    let running = Running { game_id, title: p.title, emulator_name: "Android".into(), started_at: now, pid: 0 };
    if let Ok(mut pending) = PENDING.lock() {
        *pending = Some(Pending { running: running.clone(), session_id, started: Instant::now() });
    }
    if let Ok(mut r) = app.state::<LauncherState>().running.lock() {
        *r = Some(running.clone());
    }
    let _ = app.emit("launch://started", &running);
    Ok(running)
}

/// iBox revient au premier plan : la partie en cours est terminée (appelé depuis `lib.rs`).
pub fn on_resumed(app: &AppHandle) {
    let Some(p) = PENDING.lock().ok().and_then(|mut g| g.take()) else { return };
    let seconds = p.started.elapsed().as_secs();
    let error = (seconds < QUICK_RETURN_SECONDS)
        .then(|| format!("« {} » s'est fermé aussitôt. Ouvrez-le une fois depuis Android pour vérifier qu'il démarre.", p.running.title));
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

// ——— Commandes ———

async fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppHandle) -> std::result::Result<T, String> + Send + 'static) -> std::result::Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app)).await.map_err(|e| e.to_string())?
}

/// Une application qu'on peut ouvrir, et sa fiche dans la bibliothèque le cas échéant.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEntry {
    #[serde(flatten)]
    pub app: AndroidApp,
    pub game_id: Option<i64>,
}

/// Applications installées (choix des applications à ajouter), jeux d'abord.
#[tauri::command]
pub async fn android_apps_list(app: AppHandle) -> std::result::Result<Vec<AppEntry>, String> {
    blocking(app, |a| {
        let apps = a.ibox_apps().apps().map_err(|e| e.to_string())?;
        let known = a.state::<LibraryState>().with(|c| in_library(c))?;
        let mut out: Vec<AppEntry> = apps
            .into_iter()
            .map(|mut app| {
                // un émulateur n'est pas rangé avec les jeux (il n'est jamais ajouté d'office)
                app.game &= !is_emulator(&app.package_name);
                AppEntry { game_id: known.get(&app.package_name).map(|k| k.0), app }
            })
            .collect();
        out.sort_by(|x, y| y.app.game.cmp(&x.app.game).then_with(|| x.app.label.to_lowercase().cmp(&y.app.label.to_lowercase())));
        Ok(out)
    })
    .await
}

/// Détection des jeux installés et des applications désinstallées.
#[tauri::command]
pub async fn android_apps_sync(app: AppHandle) -> std::result::Result<SyncSummary, String> {
    blocking(app, |a| {
        let apps = a.ibox_apps().apps().map_err(|e| e.to_string())?;
        let ignored = prefs_file(a).map(|f| load_prefs(&f).ignored).unwrap_or_default();
        let summary = a.state::<LibraryState>().with(|c| sync(c, &apps, &ignored))?;
        // nouvelles applications, et celles dont la bannière sert encore de « Fond »
        let legacy = a.state::<LibraryState>().with(|c| legacy_banner_games(c).map_err(Into::into)).unwrap_or_default();
        for id in summary.added.iter().chain(legacy.iter().filter(|id| !summary.added.contains(id))) {
            if let Ok((_, pkg, _)) = a.state::<LibraryState>().with(|c| app_of(c, *id)) {
                save_art(a, *id, &pkg);
            }
        }
        Ok(summary)
    })
    .await
}

/// Ajoute des applications choisies par l'utilisateur ; renvoie leurs fiches.
#[tauri::command]
pub async fn android_apps_add(app: AppHandle, packages: Vec<String>) -> std::result::Result<Vec<i64>, String> {
    blocking(app, move |a| {
        let apps = a.ibox_apps().apps().map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for pkg in &packages {
            let found = apps.iter().find(|x| &x.package_name == pkg).ok_or_else(|| format!("Application introuvable : {pkg}"))?;
            let id = a.state::<LibraryState>().with(|c| add_app(c, found, true))?;
            save_art(a, id, pkg);
            ids.push(id);
        }
        update_prefs(a, |p| packages.iter().for_each(|pkg| { p.ignored.remove(pkg); }));
        Ok(ids)
    })
    .await
}

/// Retire une application de la bibliothèque (elle reste installée) ; plus ajoutée d'office.
#[tauri::command]
pub fn android_apps_remove(app: AppHandle, game_id: i64) -> std::result::Result<(), String> {
    let pkg = app.state::<LibraryState>().with(|c| remove(c, game_id))?;
    update_prefs(&app, |p| { p.ignored.insert(pkg); });
    Ok(())
}

#[tauri::command]
pub fn android_app_plan(app: AppHandle, game_id: i64) -> std::result::Result<LaunchPlan, String> {
    app.state::<LibraryState>().with(|c| plan(c, game_id).map_err(invalid))
}

/// Ouvre l'application ; la session se termine au retour dans iBox.
#[tauri::command]
pub async fn android_app_launch(app: AppHandle, game_id: i64) -> std::result::Result<Running, String> {
    blocking(app, move |a| launch(a, game_id)).await
}

/// Page de désinstallation d'Android ; répond au retour : encore installée ?
#[tauri::command]
pub async fn android_app_uninstall(app: AppHandle, game_id: i64) -> std::result::Result<bool, String> {
    blocking(app, move |a| {
        let (_, pkg, _) = a.state::<LibraryState>().with(|c| app_of(c, game_id))?;
        let installed = a.ibox_apps().uninstall(&pkg).map_err(|e| e.to_string())?;
        if !installed {
            a.state::<LibraryState>().with(|c| set_present(c, game_id, false))?;
        }
        Ok(installed)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn app(pkg: &str, label: &str, game: bool) -> AndroidApp {
        AndroidApp { package_name: pkg.into(), label: label.into(), game, system: false, version_name: "1.0".into(), installed_at: 0, size: 42 }
    }

    #[test]
    fn paquets_et_chemins() {
        assert_eq!(package_of(&path_of("com.example.game")), Some("com.example.game"));
        assert_eq!(package_of("C:/jeux/a.iso"), None);
        assert_eq!(package_of("android:"), None);
        assert!(valid_package("com.example.game_2"));
        assert!(!valid_package("game"));
        assert!(!valid_package("com..x"));
        assert!(!valid_package("com.1x"));
        assert!(!valid_package("com.x/../y"));
    }

    #[test]
    fn detection_retrait_et_desinstallation() {
        let mut conn = db::open_in_memory().unwrap();
        let apps = vec![app("com.example.racer", "Racer", true), app("com.android.chrome", "Chrome", false)];

        // seuls les jeux déclarés sont ajoutés d'office
        let s = sync(&mut conn, &apps, &BTreeSet::new()).unwrap();
        assert_eq!(s.added.len(), 1);
        let games = repo::list_games(&conn).unwrap();
        let racer = games.iter().find(|g| g.id == s.added[0]).unwrap();
        assert_eq!(racer.platform_id, PLATFORM);
        assert_eq!(racer.title, "Racer");
        assert_eq!(racer.serial.as_deref(), Some("com.example.racer"));
        assert_eq!(racer.file_path, "android:com.example.racer");
        assert_eq!(racer.status, "present");

        // deuxième passage : rien de neuf
        assert_eq!(sync(&mut conn, &apps, &BTreeSet::new()).unwrap(), SyncSummary::default());

        // ajout à la main d'une application qui n'est pas un jeu, sans doublon
        let chrome = add_app(&mut conn, &apps[1], true).unwrap();
        assert_eq!(add_app(&mut conn, &apps[1], true).unwrap(), chrome);
        assert_eq!(in_library(&conn).unwrap().len(), 2);

        // désinstallée : la fiche reste, marquée absente ; réinstallée : présente
        let s = sync(&mut conn, &apps[1..], &BTreeSet::new()).unwrap();
        assert_eq!(s.missing, 1);
        assert!(plan(&conn, racer.id).unwrap_err().contains("plus installé"));
        let s = sync(&mut conn, &apps, &BTreeSet::new()).unwrap();
        assert_eq!(s.back, 1);
        let p = plan(&conn, racer.id).unwrap();
        assert_eq!(p.exe, "com.example.racer");
        assert_eq!(p.emulator_name, "Android");

        // retirée par l'utilisateur et ignorée : pas réajoutée d'office
        assert_eq!(remove(&mut conn, racer.id).unwrap(), "com.example.racer");
        let ignored: BTreeSet<String> = ["com.example.racer".to_string()].into();
        assert!(sync(&mut conn, &apps, &ignored).unwrap().added.is_empty());
        assert!(!in_library(&conn).unwrap().contains_key("com.example.racer"));

        // un jeu d'une autre console n'est pas une application
        assert!(matches!(app_of(&conn, 9999), Err(LibraryError::NotFound)));
    }

    #[test]
    fn emulateurs_jamais_ajoutes_d_office() {
        let mut conn = db::open_in_memory().unwrap();
        // RetroArch, PPSSPP et melonDS se déclarent comme jeux (constaté dans l'émulateur Android)
        let apps = vec![
            app("com.retroarch", "RetroArch", true),
            app("org.ppsspp.ppsspp", "PPSSPP", true),
            app("me.magnum.melonds", "melonDS", true),
            app("com.example.racer", "Racer", true),
        ];
        let s = sync(&mut conn, &apps, &BTreeSet::new()).unwrap();
        assert_eq!(s.added.len(), 1);
        assert_eq!(in_library(&conn).unwrap().keys().collect::<Vec<_>>(), vec!["com.example.racer"]);
        // à la main, un émulateur s'ajoute quand même
        add_app(&mut conn, &apps[0], true).unwrap();
        assert!(in_library(&conn).unwrap().contains_key("com.retroarch"));
    }

    #[test]
    fn banniere_jamais_en_fond() {
        let mut conn = db::open_in_memory().unwrap();
        let apps = vec![app("com.example.racer", "Racer", true), app("com.example.kart", "Kart", true)];
        let ids = sync(&mut conn, &apps, &BTreeSet::new()).unwrap().added;
        let media = |game: i64, slot: i64, source: &str| {
            conn.execute(
                "INSERT INTO media (game_id, kind, slot, source, file, added_at) VALUES (?1, 'hero', ?2, ?3, 'x.png', '2026-11-27')",
                params![game, slot, source],
            )
            .unwrap();
        };
        // ancienne version : bannière en « Fond » ; l'autre a un fond importé par l'utilisateur
        media(ids[0], 0, SOURCE);
        media(ids[1], 0, "user");
        media(ids[1], BANNER_SLOT, SOURCE);
        assert!(legacy_banner_as_hero(&conn, ids[0]).unwrap());
        assert!(!legacy_banner_as_hero(&conn, ids[1]).unwrap());
        assert_eq!(legacy_banner_games(&conn).unwrap(), vec![ids[0]]);
    }

    #[test]
    fn preferences() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sub/android-apps.json");
        assert_eq!(load_prefs(&file), Prefs::default());
        let prefs = Prefs { ignored: ["com.a.b".to_string()].into() };
        save_prefs(&file, &prefs).unwrap();
        assert_eq!(load_prefs(&file), prefs);
    }
}
