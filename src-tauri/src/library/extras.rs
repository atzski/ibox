//! Phase 2 de la 1.0 : statistiques de jeu, collections personnelles et
//! sauvegardes de jeu (repérage + copies de sécurité, jamais de modification).

use super::commands::LibraryState;
use super::{now_iso, LibraryError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

type Res<T> = std::result::Result<T, String>;

// ——— Statistiques ———

#[derive(Debug, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total_seconds: i64,
    pub sessions: i64,
    pub games_played: i64,
    pub week_seconds: i64,
    /// Jours consécutifs avec au moins une partie, jusqu'à aujourd'hui (ou hier).
    pub streak_days: i64,
    pub by_platform: Vec<(String, i64)>,
    pub top_games: Vec<(i64, i64)>,
    /// 14 derniers jours : (AAAA-MM-JJ, secondes), du plus ancien au plus récent.
    pub days: Vec<(String, i64)>,
}

/// Parties réussies uniquement (un lancement en échec ne compte pas).
const OK: &str = "seconds > 0 AND error IS NULL";

pub fn stats(conn: &Connection, today: &str) -> Result<Stats> {
    let mut s = Stats::default();
    (s.total_seconds, s.sessions) = conn.query_row(&format!("SELECT COALESCE(SUM(seconds), 0), COUNT(*) FROM play_sessions WHERE {OK}"), [], |r| {
        Ok((r.get(0)?, r.get(1)?))
    })?;
    s.games_played = conn.query_row(&format!("SELECT COUNT(DISTINCT game_id) FROM play_sessions WHERE {OK}"), [], |r| r.get(0))?;
    s.week_seconds = conn.query_row(
        &format!("SELECT COALESCE(SUM(seconds), 0) FROM play_sessions WHERE {OK} AND date(started_at) > date(?1, '-7 day')"),
        [today],
        |r| r.get(0),
    )?;
    s.by_platform = conn
        .prepare(&format!(
            "SELECT g.platform_id, SUM(p.seconds) FROM play_sessions p JOIN games g ON g.id = p.game_id WHERE p.{OK}
             GROUP BY g.platform_id ORDER BY 2 DESC"
        ))?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    s.top_games = conn
        .prepare(&format!("SELECT game_id, SUM(seconds) FROM play_sessions WHERE {OK} GROUP BY game_id ORDER BY 2 DESC LIMIT 6"))?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    let per_day: BTreeMap<String, i64> = conn
        .prepare(&format!(
            "SELECT date(started_at), SUM(seconds) FROM play_sessions WHERE {OK} AND date(started_at) > date(?1, '-60 day') GROUP BY 1"
        ))?
        .query_map([today], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<std::result::Result<_, _>>()?;
    for back in (0..14).rev() {
        let day: String = conn.query_row("SELECT date(?1, ?2)", params![today, format!("-{back} day")], |r| r.get(0))?;
        s.days.push((day.clone(), per_day.get(&day).copied().unwrap_or(0)));
    }
    // série : on part d'aujourd'hui (ou d'hier si rien encore aujourd'hui)
    let mut back = if per_day.contains_key(today) { 0 } else { 1 };
    loop {
        let day: String = conn.query_row("SELECT date(?1, ?2)", params![today, format!("-{back} day")], |r| r.get(0))?;
        if !per_day.contains_key(&day) {
            break;
        }
        s.streak_days += 1;
        back += 1;
    }
    Ok(s)
}

#[tauri::command]
pub fn stats_overview(state: State<LibraryState>) -> Res<Stats> {
    let today = now_iso()[..10].to_string();
    state.with(|c| stats(c, &today))
}

// ——— Collections ———

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub game_ids: Vec<i64>,
}

pub fn list_collections(conn: &Connection) -> Result<Vec<Collection>> {
    let mut out: Vec<Collection> = conn
        .prepare("SELECT id, name, color FROM collections ORDER BY position, id")?
        .query_map([], |r| Ok(Collection { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, game_ids: Vec::new() }))?
        .collect::<std::result::Result<_, _>>()?;
    let mut stmt = conn.prepare("SELECT game_id FROM collection_games WHERE collection_id = ?1 ORDER BY added_at DESC")?;
    for c in &mut out {
        c.game_ids = stmt.query_map([c.id], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    }
    Ok(out)
}

fn clean_name(name: &str) -> Result<String> {
    let n: String = name.trim().chars().take(40).collect();
    if n.is_empty() {
        return Err(LibraryError::EmptyTitle);
    }
    Ok(n)
}

fn clean_color(color: &str) -> String {
    let ok = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if ok { color.to_string() } else { "#8CCDF1".to_string() }
}

#[tauri::command]
pub fn collections_list(state: State<LibraryState>) -> Res<Vec<Collection>> {
    state.with(|c| list_collections(c))
}

#[tauri::command]
pub fn collection_create(state: State<LibraryState>, name: String, color: String) -> Res<Vec<Collection>> {
    state.with(|c| {
        let pos: i64 = c.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM collections", [], |r| r.get(0))?;
        c.execute(
            "INSERT INTO collections (name, color, position, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![clean_name(&name)?, clean_color(&color), pos, now_iso()],
        )?;
        list_collections(c)
    })
}

#[tauri::command]
pub fn collection_update(state: State<LibraryState>, id: i64, name: String, color: String) -> Res<Vec<Collection>> {
    state.with(|c| {
        c.execute("UPDATE collections SET name = ?2, color = ?3 WHERE id = ?1", params![id, clean_name(&name)?, clean_color(&color)])?;
        list_collections(c)
    })
}

/// Nouvel ordre des collections (identifiants dans l'ordre voulu). Les identifiants inconnus
/// sont ignorés ; les collections absentes de la liste passent après, dans leur ordre actuel.
pub fn reorder_collections(conn: &mut Connection, ids: &[i64]) -> Result<()> {
    let tx = conn.transaction()?;
    let current: Vec<i64> = tx.prepare("SELECT id FROM collections ORDER BY position, id")?.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    let mut order: Vec<i64> = ids.iter().copied().filter(|id| current.contains(id)).collect();
    order.dedup();
    let rest: Vec<i64> = current.iter().copied().filter(|id| !order.contains(id)).collect();
    order.extend(rest);
    for (i, id) in order.iter().enumerate() {
        tx.execute("UPDATE collections SET position = ?2 WHERE id = ?1", params![id, i as i64 + 1])?;
    }
    tx.commit()?;
    Ok(())
}

#[tauri::command]
pub fn collections_reorder(state: State<LibraryState>, ids: Vec<i64>) -> Res<Vec<Collection>> {
    state.with(|c| {
        reorder_collections(c, &ids)?;
        list_collections(c)
    })
}

/// Supprime la collection (les jeux restent dans la bibliothèque).
#[tauri::command]
pub fn collection_delete(state: State<LibraryState>, id: i64) -> Res<Vec<Collection>> {
    state.with(|c| {
        c.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        list_collections(c)
    })
}

#[tauri::command]
pub fn collection_set_game(state: State<LibraryState>, id: i64, game_id: i64, member: bool) -> Res<Vec<Collection>> {
    state.with(|c| {
        if member {
            c.execute(
                "INSERT OR IGNORE INTO collection_games (collection_id, game_id, added_at) VALUES (?1, ?2, ?3)",
                params![id, game_id, now_iso()],
            )?;
        } else {
            c.execute("DELETE FROM collection_games WHERE collection_id = ?1 AND game_id = ?2", params![id, game_id])?;
        }
        list_collections(c)
    })
}

// ——— Sauvegardes de jeu ———

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveItem {
    pub path: String,
    /// Fichier ou dossier (les sauvegardes Wii et PSP sont des dossiers).
    pub folder: bool,
    pub size: u64,
    pub modified: Option<String>,
    /// D'où vient l'emplacement : « à côté du jeu », « RetroArch », « Dolphin »…
    pub source: String,
}

const SAVE_EXT: [&str; 6] = ["sav", "srm", "dsv", "sa1", "mcr", "eep"];

fn size_of(p: &Path) -> u64 {
    if p.is_dir() {
        walkdir::WalkDir::new(p).into_iter().flatten().filter(|e| e.file_type().is_file()).filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum()
    } else {
        p.metadata().map(|m| m.len()).unwrap_or(0)
    }
}

fn modified_of(p: &Path) -> Option<String> {
    let t = p.metadata().ok()?.modified().ok()?;
    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
    Some(super::time::iso_from_unix(secs))
}

fn push(out: &mut Vec<SaveItem>, p: PathBuf, source: &str) {
    if !p.exists() || out.iter().any(|s| Path::new(&s.path) == p) {
        return;
    }
    out.push(SaveItem { folder: p.is_dir(), size: size_of(&p), modified: modified_of(&p), path: p.display().to_string(), source: source.into() });
}

/// Emplacements de sauvegarde connus d'un jeu, selon son fichier, sa console,
/// son identifiant et l'émulateur utilisé. Lecture seule.
pub fn find_saves(rom: &Path, platform: &str, serial: Option<&str>, emulator_profile: Option<&str>, emulator_exe: Option<&Path>) -> Vec<SaveItem> {
    let mut out = Vec::new();
    let stem = rom.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    // à côté du jeu (melonDS, mGBA, Snes9x…)
    if let Some(dir) = rom.parent() {
        for ext in SAVE_EXT {
            push(&mut out, dir.join(format!("{stem}.{ext}")), "À côté du jeu");
        }
    }
    let exe_dir = emulator_exe.and_then(Path::parent);
    let home = std::env::var("USERPROFILE").ok().map(PathBuf::from);
    let docs = home.as_ref().map(|h| h.join("Documents"));
    match emulator_profile {
        Some("retroarch") => {
            if let Some(d) = exe_dir {
                for ext in ["srm", "sav"] {
                    push(&mut out, d.join("saves").join(format!("{stem}.{ext}")), "RetroArch");
                }
            }
        }
        Some("melonds") => {
            if let Some(d) = exe_dir {
                push(&mut out, d.join(format!("{stem}.sav")), "melonDS");
            }
        }
        _ => {}
    }
    let serial = serial.unwrap_or("");
    match platform {
        // Wii : un dossier par jeu, nommé d'après les 4 premiers caractères de l'identifiant
        "wii" if serial.len() >= 4 => {
            let hex: String = serial[..4].bytes().map(|b| format!("{b:02x}")).collect();
            let roots = [docs.as_ref().map(|d| d.join("Dolphin Emulator")), exe_dir.map(|d| d.join("User"))];
            for r in roots.into_iter().flatten() {
                push(&mut out, r.join("Wii").join("title").join("00010000").join(&hex), "Dolphin");
            }
        }
        // GameCube : fichiers .gci de la carte mémoire qui portent le code du jeu
        "gamecube" if serial.len() >= 4 => {
            let code = &serial[..4];
            let roots = [docs.as_ref().map(|d| d.join("Dolphin Emulator")), exe_dir.map(|d| d.join("User"))];
            for r in roots.into_iter().flatten() {
                for region in ["EUR", "USA", "JAP"] {
                    let card = r.join("GC").join(region).join("Card A");
                    if let Ok(entries) = std::fs::read_dir(&card) {
                        for e in entries.flatten() {
                            let n = e.file_name().to_string_lossy().to_string();
                            if n.ends_with(".gci") && n.contains(&format!("-{code}-")) {
                                push(&mut out, e.path(), "Dolphin");
                            }
                        }
                    }
                }
            }
        }
        // PSP : dossiers SAVEDATA qui commencent par l'identifiant (ULES-00151 → ULES00151)
        "psp" if !serial.is_empty() => {
            let id = serial.replace('-', "");
            let roots = [docs.as_ref().map(|d| d.join("PPSSPP")), exe_dir.map(|d| d.join("memstick"))];
            for r in roots.into_iter().flatten() {
                let dir = r.join("PSP").join("SAVEDATA");
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for e in entries.flatten() {
                        if e.file_name().to_string_lossy().starts_with(&id) {
                            push(&mut out, e.path(), "PPSSPP");
                        }
                    }
                }
            }
        }
        // PlayStation : carte mémoire propre au jeu (DuckStation)
        "ps1" if !serial.is_empty() => {
            if let Some(d) = docs.as_ref() {
                for n in 1..=2 {
                    push(&mut out, d.join("DuckStation").join("memcards").join(format!("{serial}_{n}.mcd")), "DuckStation");
                }
            }
        }
        _ => {}
    }
    out
}

struct GameSaveInfo {
    title: String,
    rom: PathBuf,
    platform: String,
    serial: Option<String>,
    profile: Option<String>,
    exe: Option<PathBuf>,
}

fn game_save_info(conn: &Connection, game_id: i64) -> Result<GameSaveInfo> {
    conn.query_row(
        "SELECT g.title, f.path, g.platform_id, g.serial,
                COALESCE(e1.profile_id, e2.profile_id), COALESCE(e1.exe_path, e2.exe_path)
         FROM games g JOIN game_files f ON f.game_id = g.id AND f.role = 'main'
         LEFT JOIN emulators e1 ON e1.id = g.emulator_id
         LEFT JOIN platform_emulators pe ON pe.platform_id = g.platform_id
         LEFT JOIN emulators e2 ON e2.id = pe.emulator_id
         WHERE g.id = ?1",
        [game_id],
        |r| {
            Ok(GameSaveInfo {
                title: r.get(0)?,
                rom: PathBuf::from(r.get::<_, String>(1)?),
                platform: r.get(2)?,
                serial: r.get(3)?,
                profile: r.get(4)?,
                exe: r.get::<_, Option<String>>(5)?.map(PathBuf::from),
            })
        },
    )
    .map_err(Into::into)
}

fn saves_of(conn: &Connection, game_id: i64) -> Result<(GameSaveInfo, Vec<SaveItem>)> {
    let g = game_save_info(conn, game_id)?;
    let list = find_saves(&g.rom, &g.platform, g.serial.as_deref(), g.profile.as_deref(), g.exe.as_deref());
    Ok((g, list))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavesReport {
    pub items: Vec<SaveItem>,
    /// Copies de sécurité déjà faites (dates), la plus récente d'abord.
    pub backups: Vec<String>,
}

/// Copies de sécurité gardées par jeu : les plus anciennes sont supprimées au-delà.
const SAVE_BACKUPS_KEPT: usize = 5;

/// Garde les `keep` copies les plus récentes d'un dossier de copies (noms horodatés).
fn prune_backups(root: &Path, keep: usize) {
    let mut dirs: Vec<PathBuf> = std::fs::read_dir(root)
        .map(|d| d.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    dirs.sort();
    let extra = dirs.len().saturating_sub(keep);
    for old in dirs.into_iter().take(extra) {
        let _ = std::fs::remove_dir_all(old);
    }
}

fn backup_root(app: &AppHandle, game_id: i64) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("save-backups").join(game_id.to_string()))
}

#[tauri::command]
pub fn saves_list(app: AppHandle, state: State<LibraryState>, game_id: i64) -> Res<SavesReport> {
    let items = state.with(|c| saves_of(c, game_id).map(|(_, l)| l))?;
    let mut backups: Vec<String> = std::fs::read_dir(backup_root(&app, game_id)?)
        .map(|d| d.flatten().filter(|e| e.path().is_dir()).map(|e| e.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default();
    backups.sort_by(|a, b| b.cmp(a));
    Ok(SavesReport { items, backups })
}

fn copy_into(src: &Path, dst_dir: &Path) -> std::io::Result<()> {
    let name = src.file_name().unwrap_or_default();
    if src.is_dir() {
        for e in walkdir::WalkDir::new(src).into_iter().flatten() {
            let rel = e.path().strip_prefix(src).unwrap_or(Path::new(""));
            let target = dst_dir.join(name).join(rel);
            if e.file_type().is_dir() {
                std::fs::create_dir_all(&target)?;
            } else {
                if let Some(p) = target.parent() {
                    std::fs::create_dir_all(p)?;
                }
                std::fs::copy(e.path(), &target)?;
            }
        }
        Ok(())
    } else {
        std::fs::create_dir_all(dst_dir)?;
        std::fs::copy(src, dst_dir.join(name)).map(|_| ())
    }
}

/// Copie de sécurité des sauvegardes trouvées, dans le dossier de données
/// d'iBox (horodatée). Les fichiers d'origine ne sont jamais modifiés.
#[tauri::command]
pub fn saves_backup(app: AppHandle, state: State<LibraryState>, game_id: i64) -> Res<usize> {
    let (g, items) = state.with(|c| saves_of(c, game_id))?;
    if items.is_empty() {
        return Err("Aucune sauvegarde trouvée pour ce jeu.".into());
    }
    let stamp: String = now_iso().replace([':', '-'], "").replace('T', "-").chars().take(15).collect();
    let dir = backup_root(&app, game_id)?.join(stamp);
    for s in &items {
        copy_into(Path::new(&s.path), &dir).map_err(|e| format!("copie impossible : {e}"))?;
    }
    let _ = std::fs::write(dir.join("jeu.txt"), format!("{}\n", g.title));
    prune_backups(&backup_root(&app, game_id)?, SAVE_BACKUPS_KEPT);
    Ok(items.len())
}

/// Montre une sauvegarde (ou le dossier des copies) dans l'Explorateur.
/// Seuls les emplacements trouvés par iBox sont acceptés.
#[tauri::command]
pub fn saves_reveal(app: AppHandle, state: State<LibraryState>, game_id: i64, path: Option<String>) -> Res<()> {
    let target = match path {
        Some(p) => {
            let items = state.with(|c| saves_of(c, game_id).map(|(_, l)| l))?;
            if !items.iter().any(|s| s.path == p) {
                return Err("Emplacement inconnu.".into());
            }
            format!("/select,{p}")
        }
        None => {
            let d = backup_root(&app, game_id)?;
            std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
            d.display().to_string()
        }
    };
    std::process::Command::new(crate::shell::windows_tool("explorer.exe")).arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_de_sauvegardes_limitees() {
        let root = tempfile::tempdir().unwrap();
        for day in 1..=7 {
            std::fs::create_dir_all(root.path().join(format!("2026110{day}-100000"))).unwrap();
        }
        prune_backups(root.path(), 5);
        let mut left: Vec<String> = std::fs::read_dir(root.path()).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        left.sort();
        assert_eq!(left, ["20261103-100000", "20261104-100000", "20261105-100000", "20261106-100000", "20261107-100000"]);
    }

    #[test]
    fn statistiques_parties_reussies() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (1, 'wii', 'A', 'a', '2026-01-01', 'filename', 1);
             INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (2, 'ds', 'B', 'b', '2026-01-01', 'filename', 1);
             INSERT INTO play_sessions (game_id, started_at, seconds) VALUES (1, '2026-11-13T10:00:00Z', 3600);
             INSERT INTO play_sessions (game_id, started_at, seconds) VALUES (1, '2026-11-12T10:00:00Z', 600);
             INSERT INTO play_sessions (game_id, started_at, seconds) VALUES (2, '2026-11-10T10:00:00Z', 1200);
             INSERT INTO play_sessions (game_id, started_at, seconds, error) VALUES (2, '2026-11-13T11:00:00Z', 2, 'crash');",
        )
        .unwrap();
        let s = stats(&conn, "2026-11-13").unwrap();
        assert_eq!((s.total_seconds, s.sessions, s.games_played), (5400, 3, 2));
        assert_eq!(s.streak_days, 2);
        assert_eq!(s.by_platform[0], ("wii".to_string(), 4200));
        assert_eq!(s.top_games[0], (1, 4200));
        assert_eq!(s.days.len(), 14);
        assert_eq!(s.days[13], ("2026-11-13".to_string(), 3600));
    }

    #[test]
    fn collections_reordonnees() {
        let mut conn = crate::db::open_in_memory().unwrap();
        for (i, n) in ["Zelda", "Mario", "Lego"].iter().enumerate() {
            conn.execute("INSERT INTO collections (name, color, position, created_at) VALUES (?1, '#ffffff', ?2, '2026')", params![n, i as i64 + 1]).unwrap();
        }
        let names = |c: &Connection| list_collections(c).unwrap().into_iter().map(|c| c.name).collect::<Vec<_>>();
        reorder_collections(&mut conn, &[3, 1, 2]).unwrap();
        assert_eq!(names(&conn), ["Lego", "Zelda", "Mario"]);
        // identifiant inconnu ignoré, collection oubliée gardée à la fin
        reorder_collections(&mut conn, &[2, 99]).unwrap();
        assert_eq!(names(&conn), ["Mario", "Lego", "Zelda"]);
    }

    #[test]
    fn collections_et_jeux() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch("INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (1, 'wii', 'A', 'a', '2026-01-01', 'filename', 1);").unwrap();
        conn.execute("INSERT INTO collections (name, color, created_at) VALUES ('Coop', '#ffffff', '2026')", []).unwrap();
        conn.execute("INSERT INTO collection_games VALUES (1, 1, '2026')", []).unwrap();
        let l = list_collections(&conn).unwrap();
        assert_eq!(l[0].game_ids, vec![1]);
        assert!(clean_name("   ").is_err());
        assert_eq!(clean_color("red"), "#8CCDF1");
        conn.execute("DELETE FROM games WHERE id = 1", []).unwrap();
        assert!(list_collections(&conn).unwrap()[0].game_ids.is_empty());
    }

    #[test]
    fn sauvegardes_a_cote_du_jeu() {
        let dir = tempfile::tempdir().unwrap();
        let rom = dir.path().join("Jeu.nds");
        std::fs::write(&rom, b"x").unwrap();
        std::fs::write(dir.path().join("Jeu.sav"), b"save").unwrap();
        let l = find_saves(&rom, "ds", None, Some("melonds"), None);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].size, 4);
        assert_eq!(l[0].source, "À côté du jeu");
    }
}
