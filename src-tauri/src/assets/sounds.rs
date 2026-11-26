//! Jingles des jeux (« soundbite » iiDB), téléchargés seulement si l'utilisateur
//! l'a accepté, rangés dans `<données>/sounds/`. Un jeu absent d'iiDB n'a
//! simplement pas de son.
//!
//! Un fichier n'est jamais rangé sous le seul identifiant local du jeu : SQLite
//! redonne l'identifiant d'un jeu retiré au jeu ajouté ensuite, et l'ancien
//! `<id>.mp3` faisait jouer le jingle d'un jeu disparu sur un autre (celui de
//! Zelda sur la fiche de « Callus »). Le jingle iiDB est donc rangé sous le jeu
//! iiDB (`iidb-<parent>.<ext>`, retrouvé par `game_links`), et le jingle
//! personnel porte la marque de l'ajout du jeu (`<id>.custom.<marque>.<ext>`).
use super::games::{resolve_links, GameSyncReport, SyncCtx};
use super::iidb;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::UNIX_EPOCH;

type Result<T> = std::result::Result<T, String>;
const EXTS: [&str; 6] = ["mp3", "ogg", "wav", "m4a", "opus", "webm"];
/// Un jingle, pas un album : 4 Mo au plus.
pub const MAX_SOUND_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SoundReport { pub downloaded: usize, pub missing: usize, pub cancelled: bool }

fn first_file(dir: &Path, stem: &str) -> Option<PathBuf> {
    EXTS.iter().map(|e| dir.join(format!("{stem}.{e}"))).find(|p| p.is_file())
}

/// Jeu iiDB associé au jeu, et date (secondes Unix) de cette correspondance.
fn link_of(conn: &Connection, game_id: i64) -> Option<(i64, i64)> {
    conn.query_row(
        "SELECT parent_id, CAST((julianday(resolved_at) - 2440587.5) * 86400 AS INTEGER) FROM game_links
         WHERE game_id = ?1 AND status IN ('matched', 'manual') AND parent_id IS NOT NULL",
        [game_id],
        |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
    )
    .optional()
    .ok()
    .flatten()
}

/// Marque de l'ajout du jeu : change quand l'identifiant est redonné à un autre jeu.
fn custom_tag(conn: &Connection, game_id: i64) -> Option<String> {
    let added: String = conn.query_row("SELECT added_at FROM games WHERE id = ?1", [game_id], |r| r.get(0)).optional().ok().flatten()?;
    // FNV-1a : stable d'une version à l'autre (contrairement au hachage de la bibliothèque standard)
    let h = added.bytes().fold(0x811c_9dc5u32, |h, b| (h ^ b as u32).wrapping_mul(0x0100_0193));
    Some(format!("{h:08x}"))
}

fn modified_secs(p: &Path) -> i64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs() as i64)
}

/// Ancien jingle iiDB `<id>.<ext>` (avant 1.0.21) : repris pour le jeu iiDB actuel
/// seulement s'il a été téléchargé après cette correspondance ; plus ancien, il
/// appartenait à un jeu retiré depuis et il est supprimé.
fn adopt_legacy(dir: &Path, game_id: i64, link: Option<(i64, i64)>) {
    let Some(old) = first_file(dir, &game_id.to_string()) else { return };
    let Some((parent, resolved)) = link else { return }; // pas encore de correspondance : gardé, jamais joué
    let ext = old.extension().and_then(|e| e.to_str()).unwrap_or("mp3").to_string();
    // le son est téléchargé juste après la correspondance, dans la même synchronisation
    if modified_secs(&old) + 2 >= resolved && first_file(dir, &format!("iidb-{parent}")).is_none() {
        let _ = std::fs::rename(&old, dir.join(format!("iidb-{parent}.{ext}")));
    } else {
        let _ = std::fs::remove_file(&old);
    }
}

/// Jingle d'un jeu : celui importé par l'utilisateur d'abord, sinon celui d'iiDB.
pub fn find(dir: &Path, conn: &Connection, game_id: i64) -> Option<PathBuf> {
    find_custom(dir, conn, game_id).or_else(|| find_downloaded(dir, conn, game_id))
}
pub fn find_downloaded(dir: &Path, conn: &Connection, game_id: i64) -> Option<PathBuf> {
    let link = link_of(conn, game_id);
    adopt_legacy(dir, game_id, link);
    first_file(dir, &format!("iidb-{}", link?.0))
}
pub fn find_custom(dir: &Path, conn: &Connection, game_id: i64) -> Option<PathBuf> {
    let tag = custom_tag(conn, game_id)?;
    // jingle personnel d'avant 1.0.21, sans marque : choisi par l'utilisateur pour ce jeu, repris tel quel
    if let Some(old) = first_file(dir, &format!("{game_id}.custom")) {
        let ext = old.extension().and_then(|e| e.to_str()).unwrap_or("mp3").to_string();
        let _ = std::fs::rename(&old, dir.join(format!("{game_id}.custom.{tag}.{ext}")));
    }
    first_file(dir, &format!("{game_id}.custom.{tag}"))
}
/// Plus large qu'un jingle iiDB : un extrait choisi par l'utilisateur.
pub const MAX_CUSTOM_BYTES: u64 = 10 * 1024 * 1024;

/// Copie un son choisi par l'utilisateur (le fichier d'origine n'est pas touché).
pub fn import(dir: &Path, conn: &Connection, game_id: i64, src: &Path) -> Result<()> {
    let ext = src.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).filter(|e| EXTS.contains(&e.as_str()))
        .ok_or("Formats acceptés : mp3, ogg, wav, m4a, opus, webm.")?;
    let size = std::fs::metadata(src).map_err(|_| "Fichier introuvable.")?.len();
    if size > MAX_CUSTOM_BYTES { return Err("Fichier trop lourd (10 Mo au plus).".into()); }
    let tag = custom_tag(conn, game_id).ok_or("Jeu introuvable.")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    remove_custom(dir, game_id)?;
    std::fs::copy(src, dir.join(format!("{game_id}.custom.{tag}.{ext}"))).map_err(|e| e.to_string())?;
    Ok(())
}
/// Retire le jingle personnel du jeu, quelle que soit sa marque.
pub fn remove_custom(dir: &Path, game_id: i64) -> Result<()> {
    let prefix = format!("{game_id}.custom.");
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with(&prefix) { std::fs::remove_file(e.path()).map_err(|e| e.to_string())?; }
    }
    Ok(())
}
/// Retire les jingles iiDB ; ceux importés par l'utilisateur restent.
pub fn clear_downloaded(dir: &Path) -> Result<()> {
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        if !e.file_name().to_string_lossy().contains(".custom.") { std::fs::remove_file(e.path()).map_err(|e| e.to_string())?; }
    }
    Ok(())
}

/// Range le dossier : anciens noms repris ou supprimés, jingles des jeux retirés supprimés.
pub fn purge(dir: &Path, conn: &Connection) {
    let exists = |id: i64| conn.query_row("SELECT 1 FROM games WHERE id = ?1", [id], |_| Ok(())).optional().ok().flatten().is_some();
    let used = |parent: i64| {
        conn.query_row("SELECT 1 FROM game_links WHERE parent_id = ?1 AND status IN ('matched', 'manual') LIMIT 1", [parent], |_| Ok(()))
            .optional().ok().flatten().is_some()
    };
    for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let parts: Vec<&str> = name.split('.').collect();
        let stale = match parts.as_slice() {
            [stem, _] if stem.starts_with("iidb-") => stem[5..].parse().is_ok_and(|p| !used(p)),
            [id, _] => match id.parse::<i64>() {
                Ok(id) if exists(id) => { adopt_legacy(dir, id, link_of(conn, id)); false }
                Ok(_) => true,
                Err(_) => false,
            },
            [id, "custom", tag, _] => id.parse::<i64>().is_ok_and(|id| custom_tag(conn, id).as_deref() != Some(*tag)),
            [id, "custom", _] => id.parse::<i64>().is_ok_and(|id| !exists(id)),
            _ => false,
        };
        if stale { let _ = std::fs::remove_file(e.path()); }
    }
}

fn ext_of(url: &str, mime: Option<&str>) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    if let Some(e) = EXTS.iter().find(|e| path.ends_with(&format!(".{e}"))) { return e; }
    match mime.unwrap_or("") {
        m if m.contains("ogg") => "ogg",
        m if m.contains("wav") => "wav",
        m if m.contains("mp4") || m.contains("aac") => "m4a",
        m if m.contains("webm") => "webm",
        _ => "mp3",
    }
}

pub fn sync(ctx: &SyncCtx, dir: &Path) -> Result<SoundReport> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let conn = crate::db::open(ctx.db_path).map_err(|e| e.to_string())?;
    let mut rep = SoundReport::default();
    let mut links = GameSyncReport::default();
    resolve_links(ctx, &conn, &mut links)?;
    if links.cancelled { rep.cancelled = true; return Ok(rep); }
    purge(dir, &conn);
    // un jingle par jeu iiDB : les versions d'un même jeu le partagent
    let todo: Vec<i64> = {
        let mut stmt = conn.prepare("SELECT DISTINCT parent_id FROM game_links WHERE status IN ('matched','manual') AND parent_id IS NOT NULL ORDER BY parent_id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get(0)).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).filter(|p| first_file(dir, &format!("iidb-{p}")).is_none()).collect()
    };
    let mut found: Vec<(i64, iidb::Artwork)> = Vec::new();
    for (i, chunk) in todo.chunks(iidb::BATCH_MAX).enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) { rep.cancelled = true; return Ok(rep); }
        (ctx.progress)(super::games::GameSyncProgress { phase: "sounds", done: i * iidb::BATCH_MAX, total: todo.len(), current: String::new() });
        let rows: Vec<_> = chunk.iter().map(|pid| json!({ "parent_id": pid, "slots": ["soundbite"], "candidates_per_slot": 1 })).collect();
        let results = ctx.client.artwork_batch(&rows).map_err(|e| e.to_string())?;
        for (pid, (_, art)) in chunk.iter().zip(results) {
            match art.into_iter().find(|(s, _)| s == "soundbite").and_then(|(_, a)| a.into_iter().next()) {
                Some(a) => found.push((*pid, a)),
                None => rep.missing += 1,
            }
        }
    }
    let total = found.len();
    for (i, (pid, a)) in found.into_iter().enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) { rep.cancelled = true; break; }
        (ctx.progress)(super::games::GameSyncProgress { phase: "sound-download", done: i, total, current: String::new() });
        if let Ok(bytes) = (ctx.download)(&a.url) {
            if bytes.len() > 512 && std::fs::write(dir.join(format!("iidb-{pid}.{}", ext_of(&a.url, a.mime_type.as_deref()))), &bytes).is_ok() {
                rep.downloaded += 1;
            }
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    fn db() -> (tempfile::TempDir, Connection) {
        let d = tempfile::tempdir().unwrap();
        let conn = crate::db::open(&d.path().join("lib.db")).unwrap();
        (d, conn)
    }
    fn add(conn: &Connection, id: i64, title: &str, added: &str) {
        conn.execute(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (?1, 'pc', ?2, ?2, ?3, 'manual', 1)",
            rusqlite::params![id, title, added],
        )
        .unwrap();
    }
    fn link(conn: &Connection, id: i64, parent: i64, resolved: &str) {
        conn.execute(
            "INSERT INTO game_links (game_id, status, parent_id, parent_name, resolved_at) VALUES (?1, 'matched', ?2, 'x', ?3)",
            rusqlite::params![id, parent, resolved],
        )
        .unwrap();
    }

    #[test]
    fn extensions() {
        assert_eq!(super::ext_of("https://assets.iisu.network/a/b.OGG?x=1", None), "ogg");
        assert_eq!(super::ext_of("https://assets.iisu.network/a/b", Some("audio/wav")), "wav");
        assert_eq!(super::ext_of("https://assets.iisu.network/a/b", None), "mp3");
    }

    #[test]
    fn custom_first_and_kept() {
        let (d, conn) = db();
        let dir = d.path().join("sounds");
        std::fs::create_dir_all(&dir).unwrap();
        add(&conn, 7, "Pikmin", "2026-01-01T00:00:00Z");
        link(&conn, 7, 70, "2000-01-01T00:00:00Z");
        std::fs::write(dir.join("iidb-70.mp3"), b"x").unwrap();
        let src = d.path().join("mine.OGG");
        std::fs::write(&src, b"y").unwrap();
        super::import(&dir, &conn, 7, &src).unwrap();
        assert!(super::find(&dir, &conn, 7).unwrap().to_string_lossy().ends_with(".ogg"));
        assert!(super::import(&dir, &conn, 7, &d.path().join("x.exe")).is_err());
        std::fs::remove_file(&src).unwrap();
        super::clear_downloaded(&dir).unwrap();
        assert!(super::find(&dir, &conn, 7).is_some() && !dir.join("iidb-70.mp3").exists());
        super::remove_custom(&dir, 7).unwrap();
        assert!(super::find(&dir, &conn, 7).is_none());
    }

    /// Non-régression : le jingle de Zelda jouait sur « Callus », qui avait reçu l'identifiant de Zelda retiré.
    #[test]
    fn reused_id_never_plays_the_removed_game_jingle() {
        let (d, conn) = db();
        let dir = d.path().join("sounds");
        std::fs::create_dir_all(&dir).unwrap();
        add(&conn, 5, "The Legend of Zelda", "2026-01-01T00:00:00Z");
        link(&conn, 5, 100, "2026-01-01T00:00:00Z");
        std::fs::write(dir.join("iidb-100.mp3"), b"zelda").unwrap();
        let src = d.path().join("zelda.mp3");
        std::fs::write(&src, b"perso").unwrap();
        super::import(&dir, &conn, 5, &src).unwrap();
        assert!(super::find(&dir, &conn, 5).is_some());

        conn.execute("DELETE FROM games WHERE id = 5", []).unwrap();
        add(&conn, 5, "Callus", "2026-11-20T00:00:00Z");
        assert!(super::find(&dir, &conn, 5).is_none(), "aucune correspondance : aucun son");
        link(&conn, 5, 200, "2026-11-20T00:00:00Z");
        assert!(super::find(&dir, &conn, 5).is_none(), "son de Callus pas encore téléchargé");
        super::purge(&dir, &conn);
        assert!(!dir.join("iidb-100.mp3").exists());
        assert!(std::fs::read_dir(&dir).unwrap().next().is_none(), "le jingle personnel de Zelda est retiré aussi");
    }

    /// Anciens noms `<id>.mp3` : repris seulement s'ils sont plus récents que la correspondance actuelle.
    #[test]
    fn legacy_files_are_adopted_only_when_they_belong_to_the_game() {
        let (d, conn) = db();
        let dir = d.path().join("sounds");
        std::fs::create_dir_all(&dir).unwrap();
        add(&conn, 1, "Pikmin", "2020-01-01T00:00:00Z");
        link(&conn, 1, 10, "2020-01-01T00:00:00Z");
        std::fs::write(dir.join("1.ogg"), b"pikmin").unwrap();
        assert!(super::find(&dir, &conn, 1).unwrap().ends_with("iidb-10.ogg"));

        // fichier écrit avant la correspondance du jeu actuel : celui d'un jeu retiré
        add(&conn, 2, "Callus", "2099-01-01T00:00:00Z");
        link(&conn, 2, 20, "2099-01-01T00:00:00Z");
        std::fs::write(dir.join("2.mp3"), b"zelda").unwrap();
        assert!(super::find(&dir, &conn, 2).is_none());
        assert!(!dir.join("2.mp3").exists());
    }
}
