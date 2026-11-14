//! Jingles des jeux (« soundbite » iiDB), téléchargés seulement si l'utilisateur
//! l'a accepté, rangés dans `<données>/sounds/<id du jeu>.<ext>`. Un jeu absent
//! d'iiDB n'a simplement pas de son.
use super::games::{resolve_links, GameSyncReport, SyncCtx};
use super::iidb;
use serde::Serialize;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

type Result<T> = std::result::Result<T, String>;
const EXTS: [&str; 6] = ["mp3", "ogg", "wav", "m4a", "opus", "webm"];
/// Un jingle, pas un album : 4 Mo au plus.
pub const MAX_SOUND_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SoundReport { pub downloaded: usize, pub missing: usize, pub cancelled: bool }

/// Jingle d'un jeu : celui importé par l'utilisateur d'abord, sinon celui d'iiDB.
pub fn find(dir: &Path, game_id: i64) -> Option<PathBuf> {
    find_custom(dir, game_id).or_else(|| EXTS.iter().map(|e| dir.join(format!("{game_id}.{e}"))).find(|p| p.is_file()))
}
pub fn find_custom(dir: &Path, game_id: i64) -> Option<PathBuf> {
    EXTS.iter().map(|e| dir.join(format!("{game_id}.custom.{e}"))).find(|p| p.is_file())
}
/// Plus large qu'un jingle iiDB : un extrait choisi par l'utilisateur.
pub const MAX_CUSTOM_BYTES: u64 = 10 * 1024 * 1024;

/// Copie un son choisi par l'utilisateur (le fichier d'origine n'est pas touché).
pub fn import(dir: &Path, game_id: i64, src: &Path) -> Result<()> {
    let ext = src.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).filter(|e| EXTS.contains(&e.as_str()))
        .ok_or("Formats acceptés : mp3, ogg, wav, m4a, opus, webm.")?;
    let size = std::fs::metadata(src).map_err(|_| "Fichier introuvable.")?.len();
    if size > MAX_CUSTOM_BYTES { return Err("Fichier trop lourd (10 Mo au plus).".into()); }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    remove_custom(dir, game_id)?;
    std::fs::copy(src, dir.join(format!("{game_id}.custom.{ext}"))).map_err(|e| e.to_string())?;
    Ok(())
}
pub fn remove_custom(dir: &Path, game_id: i64) -> Result<()> {
    while let Some(p) = find_custom(dir, game_id) { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
    Ok(())
}
/// Retire les jingles iiDB ; ceux importés par l'utilisateur restent.
pub fn clear_downloaded(dir: &Path) -> Result<()> {
    for e in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        if !e.file_name().to_string_lossy().contains(".custom.") { std::fs::remove_file(e.path()).map_err(|e| e.to_string())?; }
    }
    Ok(())
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
    let todo: Vec<(i64, i64)> = {
        let mut stmt = conn.prepare("SELECT game_id, parent_id FROM game_links WHERE status IN ('matched','manual') AND parent_id IS NOT NULL ORDER BY game_id")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).filter(|(g, _)| find(dir, *g).is_none()).collect()
    };
    let mut found: Vec<(i64, iidb::Artwork)> = Vec::new();
    for (i, chunk) in todo.chunks(iidb::BATCH_MAX).enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) { rep.cancelled = true; return Ok(rep); }
        (ctx.progress)(super::games::GameSyncProgress { phase: "sounds", done: i * iidb::BATCH_MAX, total: todo.len(), current: String::new() });
        let rows: Vec<_> = chunk.iter().map(|(_, pid)| json!({ "parent_id": pid, "slots": ["soundbite"], "candidates_per_slot": 1 })).collect();
        let results = ctx.client.artwork_batch(&rows).map_err(|e| e.to_string())?;
        for ((gid, _), (_, art)) in chunk.iter().zip(results) {
            match art.into_iter().find(|(s, _)| s == "soundbite").and_then(|(_, a)| a.into_iter().next()) {
                Some(a) => found.push((*gid, a)),
                None => rep.missing += 1,
            }
        }
    }
    let total = found.len();
    for (i, (gid, a)) in found.into_iter().enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) { rep.cancelled = true; break; }
        (ctx.progress)(super::games::GameSyncProgress { phase: "sound-download", done: i, total, current: String::new() });
        if let Ok(bytes) = (ctx.download)(&a.url) {
            if bytes.len() > 512 && std::fs::write(dir.join(format!("{gid}.{}", ext_of(&a.url, a.mime_type.as_deref()))), &bytes).is_ok() {
                rep.downloaded += 1;
            }
        }
    }
    Ok(rep)
}

#[cfg(test)]
mod tests {
    #[test]
    fn extensions() {
        assert_eq!(super::ext_of("https://assets.iisu.network/a/b.OGG?x=1", None), "ogg");
        assert_eq!(super::ext_of("https://assets.iisu.network/a/b", Some("audio/wav")), "wav");
        assert_eq!(super::ext_of("https://assets.iisu.network/a/b", None), "mp3");
    }
    #[test]
    fn custom_first_and_kept() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("7.mp3"), b"x").unwrap();
        let src = d.path().join("mine.OGG");
        std::fs::write(&src, b"y").unwrap();
        super::import(d.path(), 7, &src).unwrap();
        assert!(super::find(d.path(), 7).unwrap().ends_with("7.custom.ogg"));
        assert!(super::import(d.path(), 7, &d.path().join("x.exe")).is_err());
        std::fs::remove_file(&src).unwrap();
        super::clear_downloaded(d.path()).unwrap();
        assert!(super::find(d.path(), 7).is_some() && !d.path().join("7.mp3").exists());
    }
}
