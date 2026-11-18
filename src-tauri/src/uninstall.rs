//! Désinstallation propre d'un jeu.
//!
//! Jeu PC : la boutique désinstalle elle-même quand elle sait le faire (Steam
//! ouvre sa fenêtre de confirmation) ; sinon le programme de désinstallation
//! officiel du jeu (inscrit dans Windows ou rangé dans son dossier) ; un jeu
//! ajouté à la main sans désinstalleur part à la Corbeille, dossier compris,
//! après vérifications. Jeu console : ses fichiers (ROM, pistes, disques)
//! partent à la Corbeille. Rien n'est jamais effacé définitivement par iBox.

use crate::library::LibraryError;
use crate::pc::{self, PcInstall};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Ce qui va se passer, montré dans la fenêtre de confirmation.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum UninstallPlan {
    /// La boutique désinstalle le jeu elle-même (Steam demande confirmation).
    Store { by: String, hint: Option<String> },
    /// Programme de désinstallation officiel du jeu.
    Uninstaller { by: String },
    /// Dossier du jeu envoyé à la Corbeille (jeu ajouté à la main).
    Trash { dir: String, size: u64 },
    /// Fichiers du jeu envoyés à la Corbeille (jeu console).
    Files { paths: Vec<String>, size: u64 },
}

/// Plan + de quoi l'exécuter.
#[derive(Debug)]
pub struct Prepared {
    pub plan: UninstallPlan,
    pub game_id: i64,
    pub install_id: Option<i64>,
    /// Programme à lancer : (exécutable, arguments) ou ligne de commande Windows brute.
    pub run: Option<Run>,
    /// Chemin dont la disparition signale la fin de la désinstallation.
    pub watch: Option<PathBuf>,
    pub manual: bool,
    pub trash: Vec<PathBuf>,
}

#[derive(Debug)]
pub enum Run {
    Exe(String, Vec<String>),
    /// Ligne `UninstallString` du registre, passée telle quelle à `cmd /S /C`.
    Shell(String),
}

/// Entrée « Programmes et fonctionnalités » de Windows.
#[derive(Debug, Clone, Default)]
pub struct RegEntry {
    pub name: String,
    pub location: Option<String>,
    pub uninstall: String,
}

// ——— Chemins ———

fn norm(p: &str) -> String {
    p.trim().trim_matches('"').replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

fn is_within(child: &str, parent: &str) -> bool {
    let (c, p) = (norm(child), norm(parent));
    !p.is_empty() && (c == p || c.starts_with(&format!("{p}\\")))
}

/// Dossiers trop larges pour être « le dossier d'un jeu ».
const BROAD: &[&str] = &[
    "program files", "program files (x86)", "programdata", "windows", "users", "games", "jeux",
    "steamlibrary", "steamapps", "common", "epic games", "gog games", "gog galaxy", "xboxgames",
    "desktop", "bureau", "documents", "downloads", "téléchargements", "appdata", "local", "roaming",
    "onedrive", "temp", "roms", "emulation", "emulators",
    // Linux (Steam Deck)
    "home", "run", "media", "mnt", "usr", "opt", "var", "etc", "tmp", ".local", "share", ".var", "app",
    "applications", "steam", ".steam", "flatpak",
];

/// Linux : racine d'un support amovible (`/run/media/<utilisateur>/<carte>`, `/media/<…>/<…>`,
/// `/mnt/<…>`) — la carte microSD du Steam Deck entière n'est jamais « le dossier d'un jeu ».
fn mount_root(p: &str) -> bool {
    let parts: Vec<&str> = p.split('\\').filter(|s| !s.is_empty()).collect();
    match parts.first().copied() {
        Some("run") => parts.get(1) == Some(&"media") && parts.len() <= 4,
        Some("media") => parts.len() <= 3,
        Some("mnt") => parts.len() <= 2,
        _ => false,
    }
}

/// Profondeur sous la racine du lecteur (`C:\A\B` → 2).
fn depth(p: &str) -> usize {
    norm(p).split('\\').filter(|s| !s.is_empty()).count().saturating_sub(1)
}

fn broad(p: &str) -> bool {
    let n = norm(p);
    depth(&n) == 0 || BROAD.contains(&n.rsplit('\\').next().unwrap_or(""))
}

/// Un dossier peut-il partir à la Corbeille sans risque ? Jamais un dossier
/// large, système ou parent d'un dossier protégé (données d'iBox, autres jeux…).
pub fn safe_to_trash(dir: &str, protected: &[String]) -> bool {
    let d = norm(dir);
    if d.len() < 4 || !Path::new(dir.trim().trim_matches('"')).is_absolute() || broad(&d) || (!cfg!(windows) && mount_root(&d)) {
        return false;
    }
    !protected.iter().any(|p| !p.trim().is_empty() && is_within(p, &d))
}

/// Dossiers système et personnels qu'aucune désinstallation ne doit englober.
fn system_dirs() -> Vec<String> {
    #[cfg(not(windows))]
    {
        let mut out: Vec<String> = ["/usr", "/etc", "/opt", "/var", "/run/media", "/media", "/mnt"].iter().map(|s| s.to_string()).collect();
        if let Some(home) = crate::paths::home() {
            for sub in ["", "Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", ".local/share", ".config", ".var/app", ".steam", "Emulation", "Applications"] {
                out.push(home.join(sub).to_string_lossy().into_owned());
            }
        }
        return out;
    }
    #[allow(unreachable_code)]
    let mut out: Vec<String> = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
        .iter()
        .filter_map(|v| std::env::var(v).ok())
        .collect();
    if let Ok(home) = std::env::var("USERPROFILE") {
        for sub in ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos", "OneDrive"] {
            out.push(format!("{home}\\{sub}"));
        }
    }
    out
}

/// Programme de désinstallation livré dans le dossier du jeu (Inno Setup, NSIS…).
fn local_uninstaller(dir: &Path) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            let stem = name.strip_suffix(".exe").unwrap_or("");
            matches!(stem, "uninstall" | "uninst" | "uninstaller" | "unins000" | "unins001")
        })
        .collect();
    found.sort();
    found.into_iter().next()
}

fn simple(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// Exécutable en tête d'une ligne de commande (`"C:\x\unins000.exe" /x` → `C:\x\unins000.exe`).
fn command_exe(cmd: &str) -> String {
    let t = cmd.trim();
    if let Some(rest) = t.strip_prefix('"') {
        return rest.split('"').next().unwrap_or("").to_string();
    }
    match t.to_lowercase().find(".exe") {
        Some(i) => t[..i + 4].to_string(),
        None => t.split(' ').next().unwrap_or("").to_string(),
    }
}

/// Entrée Windows du jeu : même dossier d'installation, désinstalleur rangé
/// dans le dossier du jeu, ou à défaut même nom exact.
pub fn match_entry<'a>(entries: &'a [RegEntry], dir: Option<&str>, title: &str) -> Option<&'a RegEntry> {
    if let Some(dir) = dir.filter(|d| !broad(d)) {
        let by_dir = entries.iter().find(|e| {
            e.location.as_deref().is_some_and(|l| !l.trim().is_empty() && !broad(l) && (is_within(dir, l) || is_within(l, dir)))
                || is_within(&command_exe(&e.uninstall), dir)
        });
        if by_dir.is_some() {
            return by_dir;
        }
    }
    let t = simple(title);
    (t.len() >= 3).then(|| entries.iter().find(|e| simple(&e.name) == t)).flatten()
}

#[cfg(windows)]
fn registered() -> Vec<RegEntry> {
    use winreg::enums::*;
    use winreg::RegKey;
    const KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";
    let roots = [
        (RegKey::predef(HKEY_LOCAL_MACHINE), KEY_READ | KEY_WOW64_64KEY),
        (RegKey::predef(HKEY_LOCAL_MACHINE), KEY_READ | KEY_WOW64_32KEY),
        (RegKey::predef(HKEY_CURRENT_USER), KEY_READ),
    ];
    let mut out = Vec::new();
    for (root, flags) in roots {
        let Ok(list) = root.open_subkey_with_flags(KEY, flags) else { continue };
        for name in list.enum_keys().flatten() {
            let Ok(k) = list.open_subkey_with_flags(&name, flags) else { continue };
            if k.get_value::<u32, _>("SystemComponent").unwrap_or(0) == 1 {
                continue;
            }
            let (Ok(display), Ok(uninstall)) = (k.get_value::<String, _>("DisplayName"), k.get_value::<String, _>("UninstallString")) else { continue };
            if uninstall.trim().is_empty() {
                continue;
            }
            out.push(RegEntry { name: display, location: k.get_value::<String, _>("InstallLocation").ok(), uninstall });
        }
    }
    out
}

#[cfg(not(windows))]
fn registered() -> Vec<RegEntry> {
    Vec::new()
}

/// Taille d'un dossier ou d'un fichier (bornée pour rester rapide).
fn size_of(p: &Path) -> u64 {
    if p.is_file() {
        return p.metadata().map(|m| m.len()).unwrap_or(0);
    }
    walkdir::WalkDir::new(p)
        .into_iter()
        .flatten()
        .take(300_000)
        .filter_map(|e| e.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

fn steam_exe() -> Option<(String, Vec<String>)> {
    pc::steam::executable()
}

/// Chemins des autres jeux de la bibliothèque (jamais englobés par une suppression).
fn other_games_paths(conn: &Connection, game_id: i64) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(mut st) = conn.prepare("SELECT path FROM game_files WHERE game_id <> ?1 UNION ALL SELECT path FROM folders") {
        out.extend(st.query_map([game_id], |r| r.get::<_, String>(0)).into_iter().flatten().flatten());
    }
    if let Ok(mut st) = conn.prepare("SELECT coalesce(install_dir, launch_target) FROM pc_installs WHERE game_id <> ?1 AND coalesce(install_dir, launch_target) IS NOT NULL") {
        out.extend(st.query_map([game_id], |r| r.get::<_, String>(0)).into_iter().flatten().flatten());
    }
    out
}

/// Prépare la désinstallation d'une version d'un jeu PC.
pub fn plan_pc(conn: &Connection, install_id: i64, protected_extra: &[String]) -> Result<Prepared, String> {
    let game_id: i64 = conn
        .query_row("SELECT game_id FROM pc_installs WHERE id = ?1", [install_id], |r| r.get(0))
        .map_err(|_| "Version introuvable.".to_string())?;
    let title: String = conn.query_row("SELECT title FROM games WHERE id = ?1", [game_id], |r| r.get(0)).unwrap_or_default();
    let inst: PcInstall = pc::installs(conn, game_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|i| i.id == install_id)
        .ok_or("Version introuvable.")?;
    let manual = inst.source == "manual";
    if !inst.installed && !manual {
        return Err("Cette version n'est pas installée.".into());
    }
    let base = |plan| Prepared { plan, game_id, install_id: Some(install_id), run: None, watch: None, manual, trash: Vec::new() };

    // Steam désinstalle lui-même, avec sa fenêtre de confirmation
    if inst.source == "steam" && !inst.external_id.is_empty() && inst.external_id.chars().all(|c| c.is_ascii_digit()) {
        let (exe, mut args) = steam_exe().ok_or("Steam est introuvable sur cet ordinateur.")?;
        args.push(format!("steam://uninstall/{}", inst.external_id));
        return Ok(Prepared {
            run: Some(Run::Exe(exe, args)),
            ..base(UninstallPlan::Store { by: "Steam".into(), hint: Some("Steam demande une dernière confirmation, puis supprime les fichiers du jeu.".into()) })
        });
    }

    let exe = inst.launch_target.clone().filter(|_| inst.launch_kind == "exe" || manual).filter(|t| Path::new(t).is_absolute());
    let dir = inst
        .install_dir
        .clone()
        .filter(|d| !d.trim().is_empty())
        .or_else(|| exe.as_deref().and_then(|e| Path::new(e).parent()).map(|p| p.to_string_lossy().to_string()));
    let watch = exe.clone().or_else(|| dir.clone()).map(PathBuf::from);

    // Désinstalleur officiel : inscrit dans Windows, puis rangé dans le dossier du jeu
    let entries = registered();
    if let Some(e) = match_entry(&entries, dir.as_deref(), &title) {
        return Ok(Prepared { run: Some(Run::Shell(e.uninstall.clone())), watch, ..base(UninstallPlan::Uninstaller { by: e.name.clone() }) });
    }
    if let Some(u) = dir.as_deref().filter(|d| !broad(d)).and_then(|d| local_uninstaller(Path::new(d))) {
        return Ok(Prepared { run: Some(Run::Shell(format!("\"{}\"", u.display()))), watch, ..base(UninstallPlan::Uninstaller { by: title.clone() }) });
    }

    match inst.source.as_str() {
        "epic" => {
            let (exe, args) = pc::url_handler("com.epicgames.launcher://store/library");
            Ok(Prepared {
                run: Some(Run::Exe(exe, args)),
                watch,
                ..base(UninstallPlan::Store { by: "Epic Games".into(), hint: Some("Dans la bibliothèque Epic, ouvrez le menu « … » du jeu puis choisissez Désinstaller.".into()) })
            })
        }
        "gog" if !inst.external_id.is_empty() => {
            let (exe, args) = pc::url_handler(&format!("goggalaxy://openGameView/gog_{}", inst.external_id));
            Ok(Prepared {
                run: Some(Run::Exe(exe, args)),
                watch,
                ..base(UninstallPlan::Store { by: "GOG Galaxy".into(), hint: Some("Dans GOG Galaxy, ouvrez le menu de réglages du jeu puis choisissez Désinstaller.".into()) })
            })
        }
        "manual" => {
            let dir = dir.ok_or("Dossier du jeu introuvable.")?;
            if !Path::new(&dir).is_dir() {
                return Err("Le dossier du jeu n'existe plus : retirez simplement la fiche.".into());
            }
            let mut protected = system_dirs();
            protected.extend(other_games_paths(conn, game_id));
            protected.extend(protected_extra.iter().cloned());
            if !safe_to_trash(&dir, &protected) {
                return Err(format!("Par sécurité, iBox ne supprime pas « {dir} » : ce dossier est trop général ou contient d'autres jeux. Désinstallez le jeu depuis Windows (Paramètres › Applications), puis retirez la fiche."));
            }
            let size = size_of(Path::new(&dir));
            Ok(Prepared { trash: vec![PathBuf::from(&dir)], ..base(UninstallPlan::Trash { dir, size }) })
        }
        _ => {
            let (exe, args) = pc::url_handler("ms-settings:appsfeatures");
            Ok(Prepared {
                run: Some(Run::Exe(exe, args)),
                watch,
                ..base(UninstallPlan::Store {
                    by: "Windows".into(),
                    hint: Some(format!("Aucun désinstalleur trouvé pour ce jeu : désinstallez-le depuis {} ou depuis Applications installées de Windows, qui s'ouvre.", inst.source_name)),
                })
            })
        }
    }
}

/// Prépare la suppression des fichiers d'un jeu console.
pub fn plan_files(conn: &Connection, game_id: i64, protected_extra: &[String]) -> Result<Prepared, String> {
    let mut st = conn.prepare("SELECT path FROM game_files WHERE game_id = ?1").map_err(|e| e.to_string())?;
    let paths: Vec<String> = st.query_map([game_id], |r| r.get(0)).map_err(|e| e.to_string())?.flatten().collect();
    let present: Vec<String> = paths.into_iter().filter(|p| Path::new(p).exists()).collect();
    if present.is_empty() {
        return Err("Les fichiers de ce jeu sont introuvables : retirez simplement la fiche.".into());
    }
    let mut protected = system_dirs();
    if let Ok(mut st) = conn.prepare("SELECT path FROM folders") {
        protected.extend(st.query_map([], |r| r.get::<_, String>(0)).into_iter().flatten().flatten());
    }
    protected.extend(protected_extra.iter().cloned());
    for p in present.iter().filter(|p| Path::new(p).is_dir()) {
        if !safe_to_trash(p, &protected) {
            return Err(format!("Par sécurité, iBox ne supprime pas le dossier « {p} »."));
        }
    }
    let size = present.iter().map(|p| size_of(Path::new(p))).sum();
    Ok(Prepared {
        trash: present.iter().map(PathBuf::from).collect(),
        plan: UninstallPlan::Files { paths: present, size },
        game_id,
        install_id: None,
        run: None,
        watch: None,
        manual: false,
    })
}

// ——— Exécution ———

/// Envoie des fichiers ou dossiers à la Corbeille (jamais d'effacement définitif
/// silencieux : Windows prévient si un élément est trop gros pour la Corbeille).
#[cfg(windows)]
pub fn to_recycle_bin(paths: &[PathBuf]) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW};
    if paths.is_empty() {
        return Ok(());
    }
    let mut from: Vec<u16> = Vec::new();
    for p in paths {
        from.extend(p.as_os_str().encode_wide());
        from.push(0);
    }
    from.push(0);
    // SAFETY : structure C remplie à zéro puis renseignée ; `from` vit jusqu'à la fin de l'appel.
    let mut op: SHFILEOPSTRUCTW = unsafe { std::mem::zeroed() };
    op.wFunc = FO_DELETE;
    op.pFrom = from.as_ptr();
    op.fFlags = (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_WANTNUKEWARNING) as _;
    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 {
        return Err(format!("Windows n'a pas pu envoyer le jeu à la Corbeille (code {code}). Un fichier est peut-être ouvert : fermez le jeu et réessayez."));
    }
    if op.fAnyOperationsAborted != 0 {
        return Err("Suppression annulée.".into());
    }
    Ok(())
}

/// Linux (Steam Deck) : Corbeille standard (freedesktop) par `gio trash`, fourni par GLib.
/// `gio` gère aussi la carte microSD (Corbeille `.Trash-<uid>` du support) ; jamais d'effacement définitif.
#[cfg(not(windows))]
pub fn to_recycle_bin(paths: &[PathBuf]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let out = std::process::Command::new("gio")
        .arg("trash")
        .arg("--")
        .args(paths)
        .output()
        .map_err(|e| format!("La Corbeille est indisponible sur ce système (gio : {e})."))?;
    if !out.status.success() {
        let why = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Le jeu n'a pas pu aller à la Corbeille : {}", why.trim()));
    }
    Ok(())
}

fn spawn(run: &Run) -> Result<(), String> {
    let mut cmd = match run {
        Run::Exe(exe, args) => {
            let mut c = std::process::Command::new(exe);
            c.args(args);
            c
        }
        Run::Shell(line) => {
            // `cmd` accepte les lignes du registre telles quelles (guillemets, MsiExec /X{…})
            // et demande l'élévation Windows quand le désinstalleur l'exige.
            let mut c = std::process::Command::new(crate::shell::windows_tool(r"System32\cmd.exe"));
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                c.raw_arg("/S /C").raw_arg(format!("\"{line}\""));
                c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW : pas de console noire
            }
            #[cfg(not(windows))]
            c.arg(line);
            c
        }
    };
    cmd.spawn().map(|_| ()).map_err(|e| format!("Le désinstalleur n'a pas pu être lancé : {e}"))
}

/// Base mise à jour une fois le jeu parti. Renvoie `true` si la fiche a disparu.
pub fn forget(conn: &mut Connection, p: &Prepared) -> Result<bool, LibraryError> {
    match p.install_id {
        Some(id) if p.manual => pc::remove_install(conn, id),
        Some(id) => {
            conn.execute("UPDATE pc_installs SET installed = 0 WHERE id = ?1", [id])?;
            Ok(false)
        }
        None => {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM game_files WHERE game_id = ?1", [p.game_id])?;
            tx.execute("DELETE FROM games WHERE id = ?1", params![p.game_id])?;
            tx.commit()?;
            Ok(true)
        }
    }
}

/// Résultat renvoyé à l'interface.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallDone {
    /// Les fichiers sont partis (Corbeille) et la base est à jour.
    pub done: bool,
    /// La fiche a quitté la bibliothèque.
    pub removed: bool,
}

pub mod commands {
    use super::*;
    use crate::library::commands::LibraryState;
    use tauri::{AppHandle, Emitter, Manager};

    type Res<T> = Result<T, String>;

    fn data_dir(app: &AppHandle) -> Vec<String> {
        app.path().app_data_dir().map(|d| vec![d.to_string_lossy().to_string()]).unwrap_or_default()
    }

    async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
        tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
    }

    fn prepare(app: &AppHandle, install_id: Option<i64>, game_id: Option<i64>) -> Res<Prepared> {
        let extra = data_dir(app);
        let state = app.state::<LibraryState>();
        let prepared = state.with(|c| {
            Ok(match (install_id, game_id) {
                (Some(i), _) => plan_pc(c, i, &extra),
                (None, Some(g)) => plan_files(c, g, &extra),
                _ => Err("Rien à désinstaller.".into()),
            })
        })?;
        prepared
    }

    /// Ce que fera la désinstallation (pour la fenêtre de confirmation).
    #[tauri::command]
    pub async fn uninstall_plan(app: AppHandle, install_id: Option<i64>, game_id: Option<i64>) -> Res<UninstallPlan> {
        blocking(move || prepare(&app, install_id, game_id).map(|p| p.plan)).await
    }

    /// Désinstalle : Corbeille (base mise à jour aussitôt) ou désinstalleur
    /// lancé, surveillé jusqu'à la disparition du jeu (événement `uninstall://done`).
    #[tauri::command]
    pub async fn uninstall_run(app: AppHandle, install_id: Option<i64>, game_id: Option<i64>) -> Res<UninstallDone> {
        blocking(move || {
            let p = prepare(&app, install_id, game_id)?;
            if !p.trash.is_empty() {
                to_recycle_bin(&p.trash)?;
                let state = app.state::<LibraryState>();
                let removed = state.with(|c| forget(c, &p))?;
                if let Some(meta) = app.try_state::<crate::metadata::commands::MetadataState>() {
                    let _ = state.with(|c| Ok(meta.media.collect_garbage(c)));
                }
                return Ok(UninstallDone { done: true, removed });
            }
            let run = p.run.as_ref().ok_or("Rien à lancer pour ce jeu.")?;
            spawn(run)?;
            if let Some(watch) = p.watch.clone() {
                let app = app.clone();
                std::thread::spawn(move || {
                    // jusqu'à deux heures : le joueur peut laisser la fenêtre ouverte
                    for _ in 0..2400 {
                        std::thread::sleep(std::time::Duration::from_secs(3));
                        if !watch.exists() {
                            let removed = app.state::<LibraryState>().with(|c| forget(c, &p)).unwrap_or(false);
                            let _ = app.emit("uninstall://done", serde_json::json!({ "gameId": p.game_id, "removed": removed }));
                            return;
                        }
                    }
                });
            }
            Ok(UninstallDone { done: false, removed: false })
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, loc: Option<&str>, un: &str) -> RegEntry {
        RegEntry { name: name.into(), location: loc.map(Into::into), uninstall: un.into() }
    }

    #[test]
    #[cfg(windows)]
    fn trash_refuses_broad_or_protected_folders() {
        let protected = vec![r"D:\Jeux\Autre\autre.exe".to_string(), r"C:\Users\x\AppData\Roaming\app.ibox".to_string()];
        assert!(!safe_to_trash(r"C:\", &protected));
        assert!(!safe_to_trash(r"D:\Jeux", &protected));
        assert!(!safe_to_trash(r"C:\Program Files", &protected));
        assert!(!safe_to_trash(r"C:\Users\x\AppData", &protected));
        assert!(!safe_to_trash(r"D:\Jeux\Autre", &protected));
        assert!(safe_to_trash(r"D:\Jeux\Celeste", &protected));
        assert!(safe_to_trash(r"D:\Celeste\", &protected));
    }

    #[test]
    #[cfg(not(windows))]
    fn corbeille_linux_refuse_les_dossiers_larges_et_les_cartes() {
        let protected = vec!["/home/deck/Games/Autre/autre.sh".to_string(), "/home/deck/.local/share/app.ibox.desktop".to_string()];
        assert!(!safe_to_trash("/", &protected));
        assert!(!safe_to_trash("/home", &protected));
        assert!(!safe_to_trash("/home/deck/Games", &protected));
        assert!(!safe_to_trash("/home/deck/.local/share", &protected));
        assert!(!safe_to_trash("/home/deck/Games/Autre", &protected));
        // carte microSD entière, ou son dossier de bibliothèque Steam
        assert!(!safe_to_trash("/run/media/deck/SD", &protected));
        assert!(!safe_to_trash("/run/media/deck/SD/steamapps", &protected));
        assert!(!safe_to_trash("relatif/Celeste", &protected));
        assert!(safe_to_trash("/home/deck/Games/Celeste", &protected));
        assert!(safe_to_trash("/run/media/deck/SD/Jeux/Celeste", &protected));
    }

    #[test]
    fn registry_match_by_folder_then_name() {
        let list = vec![
            entry("Outil", Some(r"C:\Program Files"), r"C:\Program Files\outil\un.exe"),
            entry("Hollow Knight", Some(r"D:\GOG Games\Hollow Knight\"), r#""D:\GOG Games\Hollow Knight\unins000.exe""#),
            entry("Celeste", None, r#""E:\Celeste\uninstall.exe" /S"#),
            entry("Hades II", None, "MsiExec.exe /X{0000}"),
        ];
        assert_eq!(match_entry(&list, Some(r"d:\gog games\hollow knight"), "HK").unwrap().name, "Hollow Knight");
        assert_eq!(match_entry(&list, Some(r"E:\Celeste"), "x").unwrap().name, "Celeste");
        assert_eq!(match_entry(&list, Some(r"F:\Ailleurs"), "Hades II").unwrap().name, "Hades II");
        // « Program Files » est trop large pour désigner un jeu
        assert!(match_entry(&list, Some(r"C:\Program Files\Jeu"), "Jeu").is_none());
    }

    #[test]
    fn command_exe_reads_quoted_and_plain() {
        assert_eq!(command_exe(r#""C:\a b\unins000.exe" /x"#), r"C:\a b\unins000.exe");
        assert_eq!(command_exe(r"C:\a\uninstall.exe /S"), r"C:\a\uninstall.exe");
    }

    #[test]
    fn forget_removes_console_game() {
        let mut c = crate::db::open_in_memory().unwrap();
        c.execute("INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (7, 'snes', 'Test', 'test', '', 'manual', 1)", []).unwrap();
        let p = Prepared { plan: UninstallPlan::Files { paths: vec![], size: 0 }, game_id: 7, install_id: None, run: None, watch: None, manual: false, trash: vec![] };
        assert!(forget(&mut c, &p).unwrap());
        let n: i64 = c.query_row("SELECT count(*) FROM games WHERE id = 7", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
}
