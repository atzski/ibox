//! Émulateurs enregistrés, associations console/jeu, et résolution de la
//! commande de lancement d'un jeu.

use super::profiles::{self, build_args, ArgsError};
use super::{LaunchError, Result};
use crate::library::now_iso;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Emulator {
    pub id: i64,
    pub profile_id: String,
    pub profile_name: String,
    pub name: String,
    pub exe_path: String,
    pub args: Vec<String>,
    pub fullscreen: bool,
    /// Console → fichier de cœur (RetroArch).
    pub cores: BTreeMap<String, String>,
    pub needs_core: bool,
    /// Consoles pour lesquelles cet émulateur est celui par défaut.
    pub platforms: Vec<String>,
    /// Consoles suggérées par le profil.
    pub suggested_platforms: Vec<String>,
    /// L'exécutable existe toujours.
    pub available: bool,
    /// Provenance : « managed » (installé par iBox), « detected » (trouvé sur Windows), « manual ».
    pub origin: String,
    /// Paquet du catalogue iBox Platforms (installations gérées).
    pub package_id: Option<String>,
    pub version: Option<String>,
}

/// Vérifie qu'un chemin désigne un programme que le système sait lancer.
/// - Windows : un `.exe` existant (pas de .bat/.cmd, interprétés par cmd.exe) ;
/// - Linux (Steam Deck) : un fichier exécutable : AppImage (rendue exécutable au besoin, comme le
///   fait le gestionnaire de fichiers), lanceur Flatpak de `exports/bin`, programme natif ; un nom
///   seul (`xdg-open` des jeux PC) est cherché dans le PATH. Avant la 1.0.29, seuls les `.exe`
///   passaient : aucun émulateur ni jeu PC ne se lançait sous Linux.
pub fn validate_exe(path: &str) -> Result<PathBuf> {
    #[cfg(unix)]
    {
        unix_program(path)
    }
    #[cfg(not(unix))]
    {
        let p = Path::new(path);
        let is_exe = p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("exe"));
        if !is_exe {
            return Err(LaunchError::NotAnExe(path.into()));
        }
        if !p.is_file() {
            return Err(LaunchError::ExeMissing(path.into()));
        }
        Ok(p.to_path_buf())
    }
}

#[cfg(unix)]
fn is_executable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    // `metadata` suit les liens symboliques (lanceurs Flatpak de `exports/bin`)
    p.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[cfg(unix)]
fn unix_program(path: &str) -> Result<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let p = Path::new(path);
    // nom seul : programme du système, cherché dans le PATH
    if !path.contains('/') {
        return std::env::var_os("PATH")
            .and_then(|dirs| std::env::split_paths(&dirs).map(|d| d.join(p)).find(|c| is_executable(c)))
            .ok_or_else(|| LaunchError::ExeMissing(path.into()));
    }
    if !p.is_file() {
        return Err(LaunchError::ExeMissing(path.into()));
    }
    if is_executable(p) {
        return Ok(p.to_path_buf());
    }
    // AppImage téléchargée sans le droit d'exécution : on le lui donne, comme Discover ou Dolphin
    let appimage = p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("appimage"));
    if appimage {
        if let Ok(meta) = p.metadata() {
            let mut perms = meta.permissions();
            perms.set_mode(perms.mode() | 0o111);
            if std::fs::set_permissions(p, perms).is_ok() && is_executable(p) {
                return Ok(p.to_path_buf());
            }
        }
    }
    Err(LaunchError::NotExecutable(path.into()))
}

/// Chemin enregistré d'un émulateur. Sous Windows, forme stable (sans `\\?\`) ; ailleurs, le chemin
/// tel quel : résoudre le lien d'un lanceur Flatpak (`exports/bin`) mènerait au binaire rangé
/// dans le Flatpak, qu'on ne peut pas lancer hors de son bac à sable.
fn stored_path(exe: &Path) -> String {
    if cfg!(windows) {
        crate::library::repo::display_path(exe)
    } else {
        exe.to_string_lossy().to_string()
    }
}

fn read(conn: &Connection, id: i64) -> Result<Emulator> {
    let row = conn
        .query_row("SELECT id, profile_id, name, exe_path, args, fullscreen, cores, origin, package_id, version FROM emulators WHERE id = ?1", [id], |r| {
            Ok((
                (r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get(2)?, r.get(3)?, r.get::<_, String>(4)?, r.get(5)?, r.get::<_, Option<String>>(6)?),
                (r.get::<_, String>(7)?, r.get::<_, Option<String>>(8)?, r.get::<_, Option<String>>(9)?),
            ))
        })
        .optional()?
        .ok_or(LaunchError::NotFound)?;
    type Head = (i64, String, String, String, String, bool, Option<String>);
    let ((id, profile_id, name, exe_path, args, fullscreen, cores), (origin, package_id, version)): (Head, (String, Option<String>, Option<String>)) = row;
    let profile = profiles::profile(&profile_id);
    let mut stmt = conn.prepare("SELECT platform_id FROM platform_emulators WHERE emulator_id = ?1 ORDER BY platform_id")?;
    let platforms = stmt.query_map([id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<String>>>()?;
    Ok(Emulator {
        id,
        profile_name: profile.name.into(),
        needs_core: profile.needs_core,
        suggested_platforms: profile.platforms.iter().map(|s| s.to_string()).collect(),
        available: Path::new(&exe_path).is_file(),
        profile_id,
        name,
        exe_path,
        args: serde_json::from_str(&args).unwrap_or_else(|_| vec!["{rom}".into()]),
        fullscreen,
        cores: cores.and_then(|c| serde_json::from_str(&c).ok()).unwrap_or_default(),
        platforms,
        origin,
        package_id,
        version,
    })
}

pub fn list(conn: &Connection) -> Result<Vec<Emulator>> {
    let ids: Vec<i64> = conn.prepare("SELECT id FROM emulators ORDER BY name COLLATE NOCASE")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    ids.into_iter().map(|id| read(conn, id)).collect()
}

/// Ajoute un émulateur ; le profil est reconnu d'après le nom de l'exécutable.
/// Les consoles du profil sans émulateur par défaut lui sont associées.
pub fn add(conn: &Connection, exe_path: &str) -> Result<Emulator> {
    let exe = validate_exe(exe_path)?;
    let file_name = exe.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let profile = profiles::detect_profile(&file_name);
    let name = if profile.id == "custom" {
        exe.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Émulateur".into())
    } else {
        profile.name.to_string()
    };
    // forme stable du chemin (voir `stored_path` : jamais le binaire caché d'un Flatpak)
    let shown = stored_path(&exe);
    let exists: Option<i64> = conn.query_row("SELECT id FROM emulators WHERE exe_path = ?1", [&shown], |r| r.get(0)).optional()?;
    if let Some(id) = exists {
        return read(conn, id);
    }
    // Cœurs RetroArch présents parmi les suggestions
    let mut cores = BTreeMap::new();
    if profile.needs_core {
        let dir = profiles::cores_dir(&exe);
        for platform in profile.platforms {
            if let Some(core) = profiles::suggested_cores(platform).iter().map(|c| profiles::core_file(c)).find(|c| dir.join(c).is_file()) {
                cores.insert(platform.to_string(), core);
            }
        }
    }
    conn.execute(
        "INSERT INTO emulators (profile_id, name, exe_path, args, fullscreen, cores, added_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)",
        params![
            profile.id,
            name,
            shown,
            serde_json::to_string(&profile.args).unwrap_or_default(),
            (!cores.is_empty()).then(|| serde_json::to_string(&cores).unwrap_or_default()),
            now_iso()
        ],
    )?;
    let id = conn.last_insert_rowid();
    for platform in profile.platforms {
        // RetroArch n'est associé qu'aux consoles dont un cœur est installé
        if profile.needs_core && !cores.contains_key(*platform) {
            continue;
        }
        conn.execute("INSERT OR IGNORE INTO platform_emulators (platform_id, emulator_id) VALUES (?1, ?2)", params![platform, id])?;
    }
    read(conn, id)
}

/// Provenance d'un émulateur ajouté (« detected » : proposé par la détection de Windows).
pub fn set_origin(conn: &Connection, id: i64, origin: &str) -> Result<Emulator> {
    if !matches!(origin, "manual" | "detected") {
        return Err(LaunchError::Invalid("Provenance inconnue.".into()));
    }
    conn.execute("UPDATE emulators SET origin = ?2 WHERE id = ?1 AND origin <> 'managed'", params![id, origin])?;
    read(conn, id)
}

/// Enregistre (ou met à jour) un émulateur installé par iBox. Les consoles sans
/// émulateur lui sont associées ; une association choisie par l'utilisateur n'est jamais remplacée.
/// `name` : nom du paquet (deux paquets peuvent partager un profil, comme Lichii et Fritchii).
/// `platforms` : consoles à associer si elles n'ont pas encore d'émulateur.
pub fn register_managed(conn: &Connection, exe_path: &str, package_id: &str, name: &str, version: &str, platforms: &[&str]) -> Result<Emulator> {
    let emu = add(conn, exe_path)?;
    conn.execute(
        "UPDATE emulators SET origin = 'managed', package_id = ?2, version = ?3, name = ?4 WHERE id = ?1",
        params![emu.id, package_id, version, name],
    )?;
    if !emu.needs_core {
        for p in platforms {
            conn.execute("INSERT OR IGNORE INTO platform_emulators (platform_id, emulator_id) VALUES (?1, ?2)", params![p, emu.id])?;
        }
    }
    read(conn, emu.id)
}

/// Cœur libretro installé dans le RetroArch géré : renseigné pour les consoles qui n'en ont pas.
pub fn register_core(conn: &Connection, package_id: &str, core: &str, platforms: &[&str]) -> Result<Emulator> {
    let id: i64 = conn
        .query_row("SELECT id FROM emulators WHERE package_id = ?1 AND origin = 'managed'", [package_id], |r| r.get(0))
        .optional()?
        .ok_or(LaunchError::NotFound)?;
    let mut emu = read(conn, id)?;
    for p in platforms {
        emu.cores.entry(p.to_string()).or_insert_with(|| core.to_string());
        conn.execute("INSERT OR IGNORE INTO platform_emulators (platform_id, emulator_id) VALUES (?1, ?2)", params![p, id])?;
    }
    conn.execute("UPDATE emulators SET cores = ?2 WHERE id = ?1", params![id, serde_json::to_string(&emu.cores).unwrap_or_default()])?;
    read(conn, id)
}

/// Retire les enregistrements d'un paquet géré (désinstallation).
pub fn forget_managed(conn: &Connection, package_id: &str) -> Result<()> {
    conn.execute("DELETE FROM emulators WHERE package_id = ?1 AND origin = 'managed'", [package_id])?;
    Ok(())
}

/// Cœur retiré : la console perd son cœur (et son association si elle passait par lui).
pub fn forget_core(conn: &Connection, retroarch_package: &str, core: &str) -> Result<()> {
    let Some(id) = conn
        .query_row("SELECT id FROM emulators WHERE package_id = ?1 AND origin = 'managed'", [retroarch_package], |r| r.get::<_, i64>(0))
        .optional()?
    else {
        return Ok(());
    };
    let mut emu = read(conn, id)?;
    let gone: Vec<String> = emu.cores.iter().filter(|(_, c)| c.eq_ignore_ascii_case(core)).map(|(p, _)| p.clone()).collect();
    for p in &gone {
        emu.cores.remove(p);
        conn.execute("DELETE FROM platform_emulators WHERE platform_id = ?1 AND emulator_id = ?2", params![p, id])?;
    }
    conn.execute("UPDATE emulators SET cores = ?2 WHERE id = ?1", params![id, serde_json::to_string(&emu.cores).unwrap_or_default()])?;
    Ok(())
}

pub fn update(conn: &Connection, id: i64, name: &str, args: &[String], fullscreen: bool, cores: &BTreeMap<String, String>) -> Result<Emulator> {
    read(conn, id)?;
    if name.trim().is_empty() {
        return Err(LaunchError::Invalid("Le nom ne peut pas être vide.".into()));
    }
    if !args.iter().any(|a| a == "{rom}") {
        return Err(LaunchError::Invalid("Les arguments doivent contenir {rom} (le fichier du jeu).".into()));
    }
    for core in cores.values() {
        if core.contains(['/', '\\']) || core.contains("..") || !core.to_lowercase().ends_with(".dll") {
            return Err(LaunchError::Invalid(format!("Cœur invalide : {core}")));
        }
    }
    conn.execute(
        "UPDATE emulators SET name = ?2, args = ?3, fullscreen = ?4, cores = ?5 WHERE id = ?1",
        params![id, name.trim(), serde_json::to_string(args).unwrap_or_default(), fullscreen, serde_json::to_string(cores).unwrap_or_default()],
    )?;
    read(conn, id)
}

pub fn remove(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM emulators WHERE id = ?1", [id])?;
    Ok(())
}

/// Émulateur par défaut d'une console (`None` : aucun).
pub fn set_platform(conn: &Connection, platform: &str, emulator_id: Option<i64>) -> Result<()> {
    match emulator_id {
        Some(id) => {
            read(conn, id)?;
            conn.execute(
                "INSERT INTO platform_emulators (platform_id, emulator_id) VALUES (?1, ?2)
                 ON CONFLICT (platform_id) DO UPDATE SET emulator_id = excluded.emulator_id",
                params![platform, id],
            )?;
        }
        None => {
            conn.execute("DELETE FROM platform_emulators WHERE platform_id = ?1", [platform])?;
        }
    }
    Ok(())
}

/// Émulateur propre à un jeu (`None` : celui de sa console).
pub fn set_game(conn: &Connection, game_id: i64, emulator_id: Option<i64>) -> Result<()> {
    if let Some(id) = emulator_id {
        read(conn, id)?;
    }
    let n = conn.execute("UPDATE games SET emulator_id = ?2 WHERE id = ?1", params![game_id, emulator_id])?;
    if n == 0 {
        return Err(LaunchError::NotFound);
    }
    Ok(())
}

pub fn platform_map(conn: &Connection) -> Result<BTreeMap<String, i64>> {
    let mut stmt = conn.prepare("SELECT platform_id, emulator_id FROM platform_emulators")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Commande prête à lancer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPlan {
    pub game_id: i64,
    pub title: String,
    /// Émulateur utilisé (None pour un jeu PC lancé directement).
    pub emulator_id: Option<i64>,
    pub emulator_name: String,
    pub exe: String,
    pub args: Vec<String>,
    /// Émulateur choisi pour ce jeu (et non celui de la console).
    pub per_game: bool,
    /// Texte affichable (transparence : la commande exacte).
    pub display: String,
    /// Lancé par une boutique (Steam…) : le processus rend la main aussitôt.
    pub detached: bool,
}

pub fn plan(conn: &Connection, game_id: i64) -> Result<LaunchPlan> {
    let (title, platform, game_emu, rom, status): (String, String, Option<i64>, String, String) = conn
        .query_row(
            "SELECT g.title, g.platform_id, g.emulator_id, m.path, m.status
             FROM games g JOIN game_files m ON m.game_id = g.id AND m.role = 'main' WHERE g.id = ?1",
            [game_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?
        .ok_or(LaunchError::NotFound)?;
    // Jeu PC : lancé par sa propre méthode (exécutable…), sans émulateur
    if platform == crate::pc::PLATFORM {
        let l = crate::pc::launch_target(conn, game_id).map_err(LaunchError::Invalid)?;
        let exe = validate_exe(&l.exe)?;
        let display = format!("\"{}\" {}", exe.display(), profiles::join_args(&l.args));
        return Ok(LaunchPlan {
            game_id,
            title,
            emulator_id: None,
            emulator_name: l.by,
            exe: exe.to_string_lossy().to_string(),
            args: l.args,
            per_game: false,
            display,
            detached: l.detached,
        });
    }
    let per_game = game_emu.is_some();
    let emulator_id = match game_emu {
        Some(id) => id,
        None => conn
            .query_row("SELECT emulator_id FROM platform_emulators WHERE platform_id = ?1", [&platform], |r| r.get(0))
            .optional()?
            .ok_or_else(|| LaunchError::NoEmulator(platform.clone()))?,
    };
    let emu = read(conn, emulator_id)?;
    if status == "missing" || !Path::new(&rom).is_file() {
        return Err(LaunchError::GameMissing(rom));
    }
    let exe = validate_exe(&emu.exe_path)?;
    let profile = profiles::profile(&emu.profile_id);
    let core_path = emu
        .cores
        .get(&platform)
        .map(|file| profiles::cores_dir(&exe).join(profiles::core_file(file)).to_string_lossy().to_string());
    if let Some(core) = &core_path {
        if !Path::new(core).is_file() {
            return Err(LaunchError::CoreMissing(core.clone()));
        }
    }
    let fullscreen = emu.fullscreen.then_some(profile.fullscreen);
    let args = build_args(&emu.args, fullscreen, &rom, core_path.as_deref()).map_err(|e| match e {
        ArgsError::MissingRom => LaunchError::Invalid("Les arguments de l'émulateur ne contiennent pas {rom}.".into()),
        ArgsError::MissingCore => LaunchError::NoCore { emulator: emu.name.clone(), platform: platform.clone() },
    })?;
    let display = format!("\"{}\" {}", exe.display(), profiles::join_args(&args));
    Ok(LaunchPlan { game_id, title, emulator_id: Some(emulator_id), emulator_name: emu.name, exe: exe.to_string_lossy().to_string(), args, per_game, display, detached: false })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::fs;

    fn setup() -> (tempfile::TempDir, Connection, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("Dolphin-x64").join("Dolphin.exe");
        fs::create_dir_all(exe.parent().unwrap()).unwrap();
        fs::write(&exe, b"MZ").unwrap();
        // Linux (CI, Steam Deck) : un programme doit avoir le droit d'exécution
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let rom = tmp.path().join("Pikmin (Europe).iso");
        fs::write(&rom, b"x").unwrap();
        let conn = db::open_in_memory().unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO folders (id, path, added_at) VALUES (1, 'x', 'x');
             INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (1, 'gamecube', 'Pikmin', 'pikmin', 'x', 'header', 1);
             INSERT INTO game_files (game_id, folder_id, path, size, last_seen_at) VALUES (1, 1, '{}', 1, 'x');",
            rom.display().to_string().replace('\'', "''")
        ))
        .unwrap();
        (tmp, conn, exe, rom)
    }

    #[test]
    fn ajout_reconnu_et_associe_puis_plan_de_lancement() {
        let (_tmp, conn, exe, rom) = setup();
        assert!(matches!(plan(&conn, 1), Err(LaunchError::NoEmulator(_))));
        let emu = add(&conn, exe.to_str().unwrap()).unwrap();
        assert_eq!((emu.profile_id.as_str(), emu.platforms.clone()), ("dolphin", vec!["gamecube".to_string(), "wii".to_string()]));
        let p = plan(&conn, 1).unwrap();
        assert_eq!(p.args, vec!["-b", "-C", "Dolphin.Display.Fullscreen=True", "-e", rom.to_str().unwrap()]);
        assert!(!p.per_game);

        // plein écran désactivé, arguments personnalisés
        update(&conn, emu.id, "Dolphin", &["-e".into(), "{rom}".into()], false, &BTreeMap::new()).unwrap();
        assert_eq!(plan(&conn, 1).unwrap().args, vec!["-e", rom.to_str().unwrap()]);
        // ajout du même exécutable : pas de doublon
        assert_eq!(add(&conn, exe.to_str().unwrap()).unwrap().id, emu.id);
    }

    #[test]
    fn emulateur_par_jeu_prioritaire() {
        let (tmp, conn, exe, _rom) = setup();
        add(&conn, exe.to_str().unwrap()).unwrap();
        let other = tmp.path().join("Mon émulateur.exe");
        fs::write(&other, b"MZ").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&other, fs::Permissions::from_mode(0o755)).unwrap();
        }
        let custom = add(&conn, other.to_str().unwrap()).unwrap();
        assert_eq!((custom.profile_id.as_str(), custom.name.as_str()), ("custom", "Mon émulateur"));
        set_game(&conn, 1, Some(custom.id)).unwrap();
        let p = plan(&conn, 1).unwrap();
        assert!(p.per_game);
        assert_eq!(p.emulator_name, "Mon émulateur");
    }

    #[test]
    fn refus_clairs() {
        let (tmp, conn, exe, rom) = setup();
        let bat = tmp.path().join("lance.bat");
        fs::write(&bat, b"echo").unwrap();
        assert!(matches!(add(&conn, bat.to_str().unwrap()), Err(LaunchError::NotAnExe(_) | LaunchError::NotExecutable(_))));
        assert!(matches!(add(&conn, "C:/introuvable/Dolphin.exe"), Err(LaunchError::ExeMissing(_))));
        let emu = add(&conn, exe.to_str().unwrap()).unwrap();
        assert!(update(&conn, emu.id, "D", &["-e".into()], true, &BTreeMap::new()).is_err());
        let mut bad = BTreeMap::new();
        bad.insert("n64".to_string(), r"..\..\evil.dll".to_string());
        assert!(update(&conn, emu.id, "D", &["{rom}".into()], true, &bad).is_err());

        fs::remove_file(&rom).unwrap();
        assert!(matches!(plan(&conn, 1), Err(LaunchError::GameMissing(_))));
        fs::write(&rom, b"x").unwrap();
        fs::remove_file(&exe).unwrap();
        assert!(matches!(plan(&conn, 1), Err(LaunchError::ExeMissing(_))));
    }

    /// Linux : AppImage, lanceur Flatpak (lien de `exports/bin`) et programme du PATH sont acceptés ;
    /// un fichier sans droit d'exécution qui n'est pas une AppImage est refusé.
    #[cfg(unix)]
    #[test]
    fn programmes_linux() {
        use std::os::unix::fs::PermissionsExt;
        let (tmp, conn, _exe, _rom) = setup();
        // AppImage téléchargée sans droit d'exécution : rendue exécutable
        let appimage = tmp.path().join("PCSX2-v2.2.AppImage");
        fs::write(&appimage, b"\x7fELF").unwrap();
        fs::set_permissions(&appimage, fs::Permissions::from_mode(0o644)).unwrap();
        let emu = add(&conn, appimage.to_str().unwrap()).unwrap();
        assert_eq!(emu.exe_path, appimage.to_string_lossy());
        assert!(fs::metadata(&appimage).unwrap().permissions().mode() & 0o111 != 0);
        // lanceur Flatpak : le lien est gardé tel quel, jamais le binaire caché du Flatpak
        let real = tmp.path().join("flatpak/app/org.DolphinEmu.dolphin-emu/files/bin/dolphin-emu");
        fs::create_dir_all(real.parent().unwrap()).unwrap();
        fs::write(&real, b"#!/bin/sh").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o755)).unwrap();
        let bin = tmp.path().join("flatpak/exports/bin");
        fs::create_dir_all(&bin).unwrap();
        let link = bin.join("org.DolphinEmu.dolphin-emu");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        assert_eq!(add(&conn, link.to_str().unwrap()).unwrap().exe_path, link.to_string_lossy());
        // un document n'est pas un programme
        let doc = tmp.path().join("notes.txt");
        fs::write(&doc, b"x").unwrap();
        assert!(matches!(add(&conn, doc.to_str().unwrap()), Err(LaunchError::NotExecutable(_))));
        // nom seul : cherché dans le PATH (`sh` existe partout)
        assert!(validate_exe("sh").unwrap().is_absolute());
        assert!(matches!(validate_exe("ibox-programme-inexistant"), Err(LaunchError::ExeMissing(_))));
    }
}
