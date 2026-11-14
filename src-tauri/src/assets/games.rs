//! Illustrations des jeux depuis iiDB.
//!
//! 1. Correspondance (une fois par jeu, gardée) : `POST /resolve/batch`, 25 jeux par
//!    requête, avec l'identifiant le plus fiable connu (CRC32, identifiant de titre
//!    Switch) accompagné du titre, sinon le titre seul. `needs_choice` reste en attente
//!    d'un choix ; `not_found` est retenté plus tard.
//! 2. Illustrations (jaquette, logo, fond — pas de captures d'écran) : `POST /assets/batch`
//!    pour les jeux reconnus, en préférant les
//!    images de leur console ; seuls les emplacements **vides** sont complétés — une
//!    image existante (choisie à la main ou venue d'une autre source) n'est jamais remplacée.
//! 3. Téléchargement progressif, une image à la fois, sans la clé.

use super::iidb::{self, Artwork, GameCandidate, GameMatch};
use crate::library::time::now_iso;
use crate::metadata::media::MediaStore;
use crate::metadata::MediaKind;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

pub type Result<T> = std::result::Result<T, String>;

/// Délai avant de redemander un jeu introuvable (jours).
const RETRY_NOT_FOUND_DAYS: i64 = 14;

#[derive(Debug, Clone)]
pub struct GameRow {
    pub id: i64,
    pub platform: String,
    pub title: String,
    pub serial: Option<String>,
    pub crc32: Option<String>,
}

/// Recherche iiDB d'un jeu : (identifiant fiable + titre, titre seul en repli).
/// `console` : console iiDB du jeu, pour classer sa version en tête des propositions.
pub fn lookup(g: &GameRow, console: Option<&str>) -> (Value, Option<Value>) {
    let title = g.title.trim().chars().take(500).collect::<String>();
    let mut by_title = json!({ "title": title, "max_candidates": 8 });
    if let Some(c) = console {
        by_title["preferred_console"] = json!(c);
    }
    let hex = |s: &str, n: usize| s.len() == n && s.chars().all(|c| c.is_ascii_hexdigit());
    let identity = if let Some(crc) = g.crc32.as_deref().filter(|c| hex(c, 8)) {
        Some(json!({ "kind": "crc32", "value": crc.to_ascii_lowercase() }))
    } else if let Some(s) = g.serial.as_deref().filter(|s| hex(s, 16)) {
        // identifiant de titre Nintendo Switch / Switch 2 (16 chiffres hexadécimaux)
        match g.platform.as_str() {
            "switch" => Some(json!({ "kind": "title_id", "value": s.to_ascii_uppercase(), "namespace": "nintendo-switch.title-id" })),
            "switch2" => Some(json!({ "kind": "title_id", "value": s.to_ascii_uppercase() })),
            _ => None,
        }
    } else {
        None
    };
    match identity {
        Some(id) => {
            let mut row = json!({ "identity": id, "title": title, "max_candidates": 8 });
            if let Some(c) = console {
                row["preferred_console"] = json!(c);
            }
            (row, Some(by_title))
        }
        None => (by_title, None),
    }
}

/// Mots d'un titre, sans ce qui varie d'une boutique à l'autre (symboles, éditions, année…).
pub fn title_tokens(title: &str) -> Vec<String> {
    const NOISE: [&str; 14] = [
        "the", "edition", "steam", "remastered", "definitive", "goty", "game", "of", "year", "complete", "enhanced", "deluxe", "ultimate", "collection",
    ];
    let lower = title.to_lowercase();
    // « (2013) » et autres années entre parenthèses
    let mut cleaned = String::new();
    let mut depth = 0;
    for c in lower.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => cleaned.push(if c.is_alphanumeric() { c } else { ' ' }),
            _ => {}
        }
    }
    let mut out: Vec<String> = cleaned.split_whitespace().filter(|w| !NOISE.contains(w)).map(str::to_string).collect();
    out.dedup();
    out
}

/// Le nom proposé par iiDB désigne-t-il bien ce jeu ? (correspondance obtenue par le titre seul)
pub fn plausible(ours: &str, theirs: &str) -> bool {
    let a = title_tokens(ours);
    let b = title_tokens(theirs);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a.concat() == b.concat() {
        return true; // « Half-Life » / « Half Life », « theHunter » / « TheHunter »
    }
    let inter = a.iter().filter(|w| b.contains(w)).count() as f32;
    let union = (a.len() + b.len()) as f32 - inter;
    inter / union >= 0.8
}

/// Parmi des propositions, celle qui a exactement le même nom sur la même console.
pub fn pick_candidate<'a>(ours: &str, platform: Option<&str>, cands: &'a [GameCandidate]) -> Option<&'a GameCandidate> {
    let key = title_tokens(ours).concat();
    let platform = platform?.to_lowercase();
    let same: Vec<&GameCandidate> = cands
        .iter()
        .filter(|c| title_tokens(&c.name).concat() == key && c.platform.as_deref().is_some_and(|p| p.to_lowercase() == platform))
        .collect();
    (same.len() == 1).then(|| same[0])
}

/// Contrôle une réponse iiDB obtenue par le titre seul : une correspondance douteuse
/// devient un choix à faire ; une ambiguïté évidente (même nom, même console) est levée.
pub fn review(g: &GameRow, by_identity: bool, platform_name: Option<&str>, mut m: GameMatch) -> GameMatch {
    match m.status.as_str() {
        "matched" if !by_identity => {
            if let Some((id, name)) = m.parent.clone() {
                if !plausible(&g.title, &name) {
                    if !m.candidates.iter().any(|c| c.id == id) {
                        m.candidates.insert(0, GameCandidate { id, name, year: None, platform: None });
                    }
                    m.status = "needs_choice".into();
                    m.parent = None;
                }
            }
        }
        "needs_choice" => {
            if let Some(c) = pick_candidate(&g.title, platform_name, &m.candidates) {
                m.parent = Some((c.id, c.name.clone()));
                m.status = "matched".into();
            }
        }
        _ => {}
    }
    m
}

/// Réexamine les correspondances déjà enregistrées par le titre seul ; celles qui ne
/// tiennent pas redeviennent des choix et leurs images iiDB automatiques sont retirées.
pub fn review_existing(conn: &Connection, media: &MediaStore) -> Result<usize> {
    let rows: Vec<(i64, String, i64, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT l.game_id, g.title, l.parent_id, l.parent_name FROM game_links l JOIN games g ON g.id = l.game_id
                 LEFT JOIN game_files f ON f.game_id = g.id AND f.role = 'main'
                 WHERE l.status = 'matched' AND f.crc32 IS NULL AND g.serial IS NULL AND l.parent_name IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(|e| e.to_string())?;
        it.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };
    let mut fixed = 0;
    for (gid, title, pid, name) in rows {
        if plausible(&title, &name) {
            continue;
        }
        let cands = serde_json::to_string(&[GameCandidate { id: pid, name, year: None, platform: None }]).unwrap_or_default();
        conn.execute("UPDATE game_links SET status = 'needs_choice', parent_id = NULL, parent_name = NULL, candidates = ?2 WHERE game_id = ?1", params![gid, cands])
            .map_err(|e| e.to_string())?;
        let auto: Vec<(String, i64)> = {
            let mut stmt = conn.prepare("SELECT kind, slot FROM media WHERE game_id = ?1 AND source = 'iidb' AND pinned = 0").map_err(|e| e.to_string())?;
            let it = stmt.query_map([gid], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
            it.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
        };
        for (kind, slot) in auto {
            if let Some(k) = MediaKind::parse(&kind) {
                let _ = media.remove(conn, gid, k, slot);
            }
        }
        fixed += 1;
    }
    // jeux en attente : une proposition au même nom sur la même console lève l'ambiguïté
    let pending: Vec<(i64, String, Option<String>, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT l.game_id, g.title, p.remote_name, l.candidates FROM game_links l JOIN games g ON g.id = l.game_id
                 LEFT JOIN platform_links p ON p.platform_id = g.platform_id
                 WHERE l.status = 'needs_choice' AND l.candidates IS NOT NULL",
            )
            .map_err(|e| e.to_string())?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(|e| e.to_string())?;
        it.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };
    for (gid, title, pname, cands) in pending {
        let list: Vec<GameCandidate> = serde_json::from_str(&cands).unwrap_or_default();
        if let Some(c) = pick_candidate(&title, pname.as_deref(), &list) {
            conn.execute(
                "UPDATE game_links SET status = 'matched', parent_id = ?2, parent_name = ?3 WHERE game_id = ?1",
                params![gid, c.id, c.name],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    Ok(fixed)
}

/// Retire les captures d'écran téléchargées depuis iiDB (fonction abandonnée).
pub fn purge_screenshots(conn: &Connection, media: &MediaStore) -> Result<usize> {
    let rows: Vec<(i64, i64)> = {
        let mut stmt = conn
            .prepare("SELECT game_id, slot FROM media WHERE source = 'iidb' AND kind = 'screenshot' AND pinned = 0")
            .map_err(|e| e.to_string())?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        it.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };
    for (gid, slot) in &rows {
        let _ = media.remove(conn, *gid, MediaKind::Screenshot, *slot);
    }
    Ok(rows.len())
}

/// Emplacements iiDB demandés pour un type d'image iBox.
pub fn slots_for(kind: MediaKind) -> &'static [&'static str] {
    match kind {
        MediaKind::Front => &["boxart"],
        MediaKind::Logo => &["logo"],
        MediaKind::Hero => &["hero", "banner"],
        _ => &[],
    }
}

/// Taille minimale utile (pas d'image étirée sur une grande surface).
fn big_enough(kind: MediaKind, w: usize, h: usize) -> bool {
    match kind {
        MediaKind::Front => w >= 200 && h >= 200,
        MediaKind::Hero => w >= 960,
        MediaKind::Logo => w >= 150,
        _ => true,
    }
}

pub fn save_link(conn: &Connection, game_id: i64, m: &GameMatch) -> Result<()> {
    let status = match m.status.as_str() {
        "matched" | "needs_choice" => m.status.as_str(),
        _ => "not_found",
    };
    let (pid, pname) = m.parent.clone().map(|(i, n)| (Some(i), Some(n))).unwrap_or((None, None));
    let cands = (!m.candidates.is_empty()).then(|| serde_json::to_string(&m.candidates).unwrap_or_default());
    conn.execute(
        "INSERT INTO game_links (game_id, status, parent_id, parent_name, candidates, resolved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (game_id) DO UPDATE SET
           status = CASE WHEN game_links.status = 'manual' THEN 'manual' ELSE excluded.status END,
           parent_id = CASE WHEN game_links.status = 'manual' THEN game_links.parent_id ELSE excluded.parent_id END,
           parent_name = CASE WHEN game_links.status = 'manual' THEN game_links.parent_name ELSE excluded.parent_name END,
           candidates = excluded.candidates, resolved_at = excluded.resolved_at",
        params![game_id, status, pid, pname, cands, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn choose_link(conn: &Connection, game_id: i64, parent_id: i64, name: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO game_links (game_id, status, parent_id, parent_name, candidates, resolved_at) VALUES (?1, 'manual', ?2, ?3, NULL, ?4)
         ON CONFLICT (game_id) DO UPDATE SET status = 'manual', parent_id = excluded.parent_id, parent_name = excluded.parent_name,
           candidates = NULL, resolved_at = excluded.resolved_at",
        params![game_id, parent_id, name, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn parent_of(conn: &Connection, game_id: i64) -> Option<i64> {
    conn.query_row("SELECT parent_id FROM game_links WHERE game_id = ?1 AND status IN ('matched', 'manual')", [game_id], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

/// Jeux à (re)chercher : jamais cherchés, ou introuvables depuis assez longtemps.
fn games_to_resolve(conn: &Connection) -> Result<Vec<GameRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT g.id, g.platform_id, g.title, g.serial, f.crc32 FROM games g
             LEFT JOIN game_files f ON f.game_id = g.id AND f.role = 'main'
             LEFT JOIN game_links l ON l.game_id = g.id
             WHERE l.game_id IS NULL
                OR l.status = 'needs_choice'
                OR (l.status = 'not_found' AND julianday('now') - julianday(l.resolved_at) > ?1)
             GROUP BY g.id ORDER BY g.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([RETRY_NOT_FOUND_DAYS], |r| {
            Ok(GameRow { id: r.get(0)?, platform: r.get(1)?, title: r.get(2)?, serial: r.get(3)?, crc32: r.get(4)? })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())
}

fn has_media(conn: &Connection, game_id: i64, kind: MediaKind, slot: i64) -> bool {
    conn.query_row("SELECT EXISTS (SELECT 1 FROM media WHERE game_id = ?1 AND kind = ?2 AND slot = ?3)", params![game_id, kind.as_str(), slot], |r| r.get(0))
        .unwrap_or(true)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSyncReport {
    pub resolved: usize,
    pub matched: usize,
    pub needs_choice: usize,
    pub not_found: usize,
    pub downloaded: usize,
    pub failed: usize,
    pub cancelled: bool,
    /// Anciennes correspondances douteuses redevenues des choix.
    pub reviewed: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSyncProgress {
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
    pub current: String,
}

pub struct SyncCtx<'a> {
    pub db_path: &'a Path,
    pub media: &'a MediaStore,
    pub client: &'a iidb::Client,
    pub download: &'a dyn Fn(&str) -> Result<Vec<u8>>,
    pub progress: &'a dyn Fn(GameSyncProgress),
    pub cancel: &'a AtomicBool,
}

/// Correspondances iiDB des jeux pas encore reconnus (aussi utilisé pour les sons).
pub fn resolve_links(ctx: &SyncCtx, conn: &rusqlite::Connection, rep: &mut GameSyncReport) -> Result<()> {
    let consoles: std::collections::HashMap<String, String> = {
        let mut stmt = conn.prepare("SELECT platform_id, console_id FROM platform_links WHERE console_id IS NOT NULL").map_err(|e| e.to_string())?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        it.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };
    let platform_names: std::collections::HashMap<String, String> = {
        let mut stmt = conn.prepare("SELECT platform_id, remote_name FROM platform_links WHERE remote_name IS NOT NULL").map_err(|e| e.to_string())?;
        let it = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map_err(|e| e.to_string())?;
        it.collect::<rusqlite::Result<_>>().map_err(|e| e.to_string())?
    };

    // 1. Correspondances
    let todo = games_to_resolve(conn)?;
    for (i, chunk) in todo.chunks(iidb::BATCH_MAX).enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) {
            rep.cancelled = true;
            return Ok(());
        }
        (ctx.progress)(GameSyncProgress { phase: "resolve", done: i * iidb::BATCH_MAX, total: todo.len(), current: String::new() });
        let looks: Vec<_> = chunk.iter().map(|g| lookup(g, consoles.get(&g.platform).map(String::as_str))).collect();
        let rows: Vec<Value> = looks.iter().map(|(l, _)| l.clone()).collect();
        let mut results = ctx.client.resolve_games(&rows).map_err(|e| e.to_string())?;
        let mut by_identity: Vec<bool> = looks.iter().map(|(_, r)| r.is_some()).collect();
        // identifiant inconnu d'iiDB : nouvel essai avec le titre seul
        let retry: Vec<(usize, Value)> = results
            .iter()
            .enumerate()
            .filter(|(k, m)| m.status == "not_found" && looks[*k].1.is_some())
            .map(|(k, _)| (k, looks[k].1.clone().unwrap()))
            .collect();
        if !retry.is_empty() {
            let again = ctx.client.resolve_games(&retry.iter().map(|(_, v)| v.clone()).collect::<Vec<_>>()).map_err(|e| e.to_string())?;
            for ((k, _), m) in retry.into_iter().zip(again) {
                results[k] = m;
                by_identity[k] = false;
            }
        }
        for (k, (g, m)) in chunk.iter().zip(results).enumerate() {
            let m = review(g, by_identity[k], platform_names.get(&g.platform).map(String::as_str), m);
            if m.status == "invalid_request" {
                continue; // ligne refusée : rien n'est enregistré, nouvel essai la prochaine fois
            }
            save_link(conn, g.id, &m)?;
            rep.resolved += 1;
            match m.status.as_str() {
                "matched" => rep.matched += 1,
                "needs_choice" => rep.needs_choice += 1,
                _ => rep.not_found += 1,
            }
        }
    }

    Ok(())
}

pub fn sync_games(ctx: &SyncCtx) -> Result<GameSyncReport> {
    let conn = crate::db::open(ctx.db_path).map_err(|e| e.to_string())?;
    let mut rep = GameSyncReport::default();
    // captures d'écran iiDB d'une version précédente : retirées (place disque)
    purge_screenshots(&conn, ctx.media)?;
    // correspondances anciennes obtenues par le titre seul : contrôlées à nouveau
    rep.reviewed = review_existing(&conn, ctx.media)?;
    resolve_links(ctx, &conn, &mut rep)?;
    if rep.cancelled {
        return Ok(rep);
    }

    // 2. Illustrations manquantes des jeux reconnus
    let kinds: Vec<MediaKind> = vec![MediaKind::Front, MediaKind::Logo, MediaKind::Hero];
    let mut wanted: Vec<(i64, i64, Option<String>, Vec<MediaKind>)> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT l.game_id, l.parent_id, p.console_id FROM game_links l JOIN games g ON g.id = l.game_id
                 LEFT JOIN platform_links p ON p.platform_id = g.platform_id
                 WHERE l.status IN ('matched', 'manual') AND l.parent_id IS NOT NULL ORDER BY l.game_id",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<String>>(2)?)))
            .map_err(|e| e.to_string())?;
        for r in rows {
            let (gid, pid, console) = r.map_err(|e| e.to_string())?;
            let missing: Vec<MediaKind> = kinds.iter().copied().filter(|k| !has_media(&conn, gid, *k, 0)).collect();
            if !missing.is_empty() {
                wanted.push((gid, pid, console, missing));
            }
        }
    }
    let mut downloads: Vec<(i64, MediaKind, Vec<Artwork>)> = Vec::new();
    for (i, chunk) in wanted.chunks(iidb::BATCH_MAX).enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) {
            rep.cancelled = true;
            return Ok(rep);
        }
        (ctx.progress)(GameSyncProgress { phase: "artwork", done: i * iidb::BATCH_MAX, total: wanted.len(), current: String::new() });
        let rows: Vec<Value> = chunk
            .iter()
            .map(|(_, pid, console, missing)| {
                let slots: Vec<&str> = missing.iter().flat_map(|k| slots_for(*k).iter().copied()).collect();
                let mut row = json!({ "parent_id": pid, "slots": slots, "candidates_per_slot": 2 });
                if let Some(c) = console {
                    row["preferred_artwork_console"] = json!(c);
                }
                row
            })
            .collect();
        let results = ctx.client.artwork_batch(&rows).map_err(|e| e.to_string())?;
        for ((gid, _, _, missing), (_, art)) in chunk.iter().zip(results) {
            for k in missing {
                let list: Vec<Artwork> = slots_for(*k)
                    .iter()
                    .flat_map(|s| art.iter().find(|(slot, _)| slot == s).map(|(_, a)| a.clone()).unwrap_or_default())
                    .filter(|a| !a.is_animated)
                    .collect();
                if !list.is_empty() {
                    downloads.push((*gid, *k, list));
                }
            }
        }
    }

    // 3. Téléchargements, un à la fois
    let total = downloads.len();
    for (i, (gid, kind, list)) in downloads.into_iter().enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) {
            rep.cancelled = true;
            break;
        }
        (ctx.progress)(GameSyncProgress { phase: "download", done: i, total, current: kind.as_str().into() });
        let slots = 1;
        let mut slot = 0;
        let mut last_err = String::new();
        for a in &list {
            if slot as usize >= slots {
                break;
            }
            if has_media(&conn, gid, kind, slot) {
                slot += 1;
                continue;
            }
            let res = (ctx.download)(&a.url).and_then(|bytes| {
                let size = imagesize::blob_size(&bytes).map_err(|_| "image illisible".to_string())?;
                if !big_enough(kind, size.width, size.height) {
                    return Err(format!("image trop petite ({}×{})", size.width, size.height));
                }
                ctx.media.save(&conn, gid, kind, slot, &bytes, "iidb", Some(&a.url)).map_err(|e| e.to_string())
            });
            match res {
                Ok(_) => {
                    rep.downloaded += 1;
                    slot += 1;
                }
                Err(e) => last_err = e,
            }
        }
        if slot == 0 {
            rep.failed += 1;
            if rep.errors.len() < 5 && !last_err.is_empty() {
                rep.errors.push(format!("jeu {gid} ({}) : {last_err}", kind.as_str()));
            }
        } else if kind == MediaKind::Front {
            let _ = conn.execute("UPDATE games SET media_status = 'found' WHERE id = ?1", [gid]);
        }
    }
    (ctx.progress)(GameSyncProgress { phase: "done", done: total, total, current: String::new() });
    Ok(rep)
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameLinkStats {
    pub matched: i64,
    pub needs_choice: i64,
    pub not_found: i64,
    pub unresolved: i64,
    pub iidb_images: i64,
}

pub fn stats(conn: &Connection) -> Result<GameLinkStats> {
    let q = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map_err(|e| e.to_string());
    Ok(GameLinkStats {
        matched: q("SELECT count(*) FROM game_links WHERE status IN ('matched','manual')")?,
        needs_choice: q("SELECT count(*) FROM game_links WHERE status = 'needs_choice'")?,
        not_found: q("SELECT count(*) FROM game_links WHERE status = 'not_found'")?,
        unresolved: q("SELECT count(*) FROM games g WHERE NOT EXISTS (SELECT 1 FROM game_links l WHERE l.game_id = g.id)")?,
        iidb_images: q("SELECT count(*) FROM media WHERE source = 'iidb'")?,
    })
}

/// Jeu en attente de choix : propositions enregistrées.
pub fn candidates_of(conn: &Connection, game_id: i64) -> Vec<GameCandidate> {
    conn.query_row("SELECT candidates FROM game_links WHERE game_id = ?1", [game_id], |r| r.get::<_, Option<String>>(0))
        .optional()
        .ok()
        .flatten()
        .flatten()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Propositions iiDB pour le sélecteur d'images d'un jeu (galerie du jeu reconnu).
/// Un jeu jamais cherché est d'abord reconnu (une requête), et sa correspondance gardée.
pub fn iidb_candidates(conn: &Connection, game_id: i64, kind: MediaKind) -> Result<Vec<crate::metadata::Candidate>> {
    let key = crate::metadata::keys::get(iidb::KEY).map_err(|e| e.to_string())?.ok_or("clé absente")?;
    let client = iidb::Client::new(&key).map_err(|e| e.to_string())?;
    let parent = match parent_of(conn, game_id) {
        Some(p) => p,
        None => {
            let g: GameRow = conn
                .query_row(
                    "SELECT g.id, g.platform_id, g.title, g.serial, f.crc32 FROM games g
                     LEFT JOIN game_files f ON f.game_id = g.id AND f.role = 'main' WHERE g.id = ?1",
                    [game_id],
                    |r| Ok(GameRow { id: r.get(0)?, platform: r.get(1)?, title: r.get(2)?, serial: r.get(3)?, crc32: r.get(4)? }),
                )
                .map_err(|e| e.to_string())?;
            let console: Option<String> = conn
                .query_row("SELECT console_id FROM platform_links WHERE platform_id = ?1", [&g.platform], |r| r.get(0))
                .optional()
                .ok()
                .flatten();
            let (first, retry) = lookup(&g, console.as_deref());
            let mut by_identity = retry.is_some();
            let mut m = client.resolve_game(&first).map_err(|e| e.to_string())?;
            if m.status == "not_found" {
                if let Some(r) = retry {
                    m = client.resolve_game(&r).map_err(|e| e.to_string())?;
                    by_identity = false;
                }
            }
            let pname: Option<String> = conn
                .query_row("SELECT remote_name FROM platform_links WHERE platform_id = ?1", [&g.platform], |r| r.get(0))
                .optional()
                .ok()
                .flatten();
            let m = review(&g, by_identity, pname.as_deref(), m);
            save_link(conn, game_id, &m)?;
            match m.parent {
                Some((p, _)) if m.status == "matched" => p,
                _ if m.status == "needs_choice" => return Err("plusieurs jeux correspondent : associez-le dans la fiche".into()),
                _ => return Ok(Vec::new()),
            }
        }
    };
    let mut out = Vec::new();
    for t in slots_for(kind) {
        let page = client.parent_gallery(parent, t, None).map_err(|e| e.to_string())?;
        for a in page.items.into_iter().filter(|a| !a.is_animated) {
            let (w, h) = a
                .resolution
                .as_deref()
                .and_then(|r| r.split_once('x'))
                .and_then(|(w, h)| Some((w.trim().parse().ok()?, h.trim().parse().ok()?)))
                .map(|(w, h)| (Some(w), Some(h)))
                .unwrap_or((None, None));
            out.push(crate::metadata::Candidate {
                provider: "iidb",
                kind,
                thumb: a.thumbnail_url.clone().unwrap_or_else(|| a.url.clone()),
                label: a.display_name.clone().or(a.region.clone()).unwrap_or_else(|| format!("iiDB {}", t)),
                url: a.url,
                width: w,
                height: h,
                score: 1.0,
                source_game: None,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn row(platform: &str, serial: Option<&str>, crc: Option<&str>) -> GameRow {
        GameRow { id: 1, platform: platform.into(), title: "Kirby".into(), serial: serial.map(Into::into), crc32: crc.map(Into::into) }
    }

    #[test]
    fn recherche_la_plus_fiable() {
        let (l, retry) = lookup(&row("gba", None, Some("A1B2C3D4")), None);
        assert_eq!(l["identity"]["kind"], "crc32");
        assert_eq!(l["identity"]["value"], "a1b2c3d4");
        assert_eq!(l["title"], "Kirby");
        assert!(retry.is_some(), "repli sur le titre");
        let (l, _) = lookup(&row("switch", Some("01004d300c5ae000"), None), None);
        assert_eq!(l["identity"]["namespace"], "nintendo-switch.title-id");
        assert_eq!(l["identity"]["value"], "01004D300C5AE000");
        let (l, _) = lookup(&row("switch2", Some("0400486024DEC000"), None), None);
        assert!(l["identity"].get("namespace").is_none());
        let (l, retry) = lookup(&row("pc", None, None), Some("pc"));
        assert_eq!(l["preferred_console"], "pc");
        assert!(l.get("identity").is_none() && retry.is_none());
        assert_eq!(l["title"], "Kirby");
        // un « CRC » mal formé n'est pas envoyé
        assert!(lookup(&row("gba", None, Some("xyz")), None).0.get("identity").is_none());
    }

    #[test]
    fn liens_choix_et_priorite_manuelle() {
        let conn = db::open_in_memory().unwrap();
        conn.execute("INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (5, 'pc', 'Doom', 'doom', 'x', 'manual', 1)", []).unwrap();
        let m = |s: &str, p: Option<(i64, &str)>| GameMatch {
            status: s.into(),
            parent: p.map(|(i, n)| (i, n.to_string())),
            candidates: vec![GameCandidate { id: 9, name: "Doom".into(), year: Some(1993), platform: None }],
        };
        save_link(&conn, 5, &m("needs_choice", None)).unwrap();
        assert_eq!(parent_of(&conn, 5), None);
        assert_eq!(candidates_of(&conn, 5).len(), 1);
        choose_link(&conn, 5, 9, "Doom").unwrap();
        save_link(&conn, 5, &m("matched", Some((10, "Doom (2016)")))).unwrap();
        assert_eq!(parent_of(&conn, 5), Some(9), "le choix de l'utilisateur reste prioritaire");
        let s = stats(&conn).unwrap();
        assert_eq!((s.matched, s.unresolved), (1, 0));
    }

    #[test]
    fn controle_des_correspondances_par_le_titre() {
        for (a, b) in [
            ("Half-Life: Opposing Force", "Half Life - Opposing Force"),
            ("The Elder Scrolls IV: Oblivion Game of the Year Edition (2009)", "The Elder Scrolls IV - Oblivion - Game of the Year Edition"),
            ("FINAL FANTASY VII (2013)", "Final Fantasy VII"),
            ("theHunter: Call of the Wild™", "TheHunter - Call of the Wild"),
            ("GeoGuessr Steam Edition", "GeoGuessr"),
            ("The Witcher 3: Wild Hunt – Remastered", "The Witcher 3: Wild Hunt"),
            ("STAR WARS™: The Old Republic™", "Star Wars - The Old Republic"),
        ] {
            assert!(plausible(a, b), "{a} / {b}");
        }
        assert!(!plausible("Backrooms: Escape Together", "Escape the Backrooms"));
        assert!(!plausible("Deceit", "Deceit 2"));

        let g = GameRow { id: 1, platform: "pc".into(), title: "Sid Meier's Civilization VI".into(), serial: None, crc32: None };
        let c = |id, name: &str, p: &str| GameCandidate { id, name: name.into(), year: None, platform: Some(p.into()) };
        let m = GameMatch { status: "needs_choice".into(), parent: None, candidates: vec![c(1, "Sid Meier's Civilization VI", "Xbox One"), c(2, "Sid Meier's Civilization VI", "PC")] };
        let r = review(&g, false, Some("PC"), m);
        assert_eq!((r.status.as_str(), r.parent.map(|p| p.0)), ("matched", Some(2)), "même nom, même console");
        let wrong = GameMatch { status: "matched".into(), parent: Some((9, "Escape the Backrooms".into())), candidates: vec![] };
        let g2 = GameRow { title: "Backrooms: Escape Together".into(), ..g.clone() };
        let r = review(&g2, false, Some("PC"), wrong.clone());
        assert_eq!((r.status.as_str(), r.candidates.len()), ("needs_choice", 1));
        assert_eq!(review(&g2, true, Some("PC"), wrong).status, "matched", "un identifiant fiable fait foi");
    }

    #[test]
    fn emplacements_et_tailles() {
        assert_eq!(slots_for(MediaKind::Hero), ["hero", "banner"]);
        assert!(slots_for(MediaKind::Back).is_empty() && slots_for(MediaKind::Screenshot).is_empty());
        assert!(!big_enough(MediaKind::Hero, 600, 300));
        assert!(big_enough(MediaKind::Front, 600, 900));
    }
}
