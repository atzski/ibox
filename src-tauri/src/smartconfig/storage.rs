//! Accès SQLite de SmartConfig : contexte d'un jeu, cache des fournisseurs,
//! retours d'expérience. Réutilise les tables existantes (`games`,
//! `emulators`, `platform_emulators`) sans les modifier.

use super::adapters::Install;
use super::model::GameQuery;
use super::recommend::LocalFeedback;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;

/// Taille maximale du cache (lignes) : au-delà, les plus anciennes partent.
const CACHE_MAX_ROWS: i64 = 2000;

pub fn now_secs() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Jeu et émulateur effectivement utilisé (celui du jeu, sinon celui de la console).
pub fn game_context(conn: &Connection, game_id: i64) -> rusqlite::Result<Option<(GameQuery, Option<Install>)>> {
    let Some((platform, title, serial, region, conf, emu)): Option<(String, String, Option<String>, Option<String>, f64, Option<i64>)> = conn
        .query_row("SELECT platform_id, title, serial, region, id_confidence, emulator_id FROM games WHERE id = ?1", [game_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
        })
        .optional()?
    else {
        return Ok(None);
    };
    let emu = match emu {
        Some(id) => Some(id),
        None => conn.query_row("SELECT emulator_id FROM platform_emulators WHERE platform_id = ?1", [&platform], |r| r.get(0)).optional()?,
    };
    let install = match emu {
        Some(id) => conn
            .query_row("SELECT profile_id, exe_path, version, cores FROM emulators WHERE id = ?1", [id], |r| {
                // cœur libretro choisi pour cette console (RetroArch), fichier du dossier `cores`
                let cores: Option<String> = r.get(3)?;
                let core = cores.and_then(|c| serde_json::from_str::<std::collections::BTreeMap<String, String>>(&c).ok()).and_then(|m| m.get(&platform).cloned());
                Ok(Install { profile_id: r.get(0)?, exe: PathBuf::from(r.get::<_, String>(1)?), version: r.get(2)?, core })
            })
            .optional()?,
        None => None,
    };
    Ok(Some((GameQuery { game_id, platform, title, serial, region, id_confidence: conf }, install)))
}

/// Fichier principal présent du jeu (rôle `main`), lu seulement en local par
/// les adaptateurs qui identifient le jeu comme l'émulateur (CRC PCSX2).
/// Jamais transmis à un fournisseur.
pub fn main_file(conn: &Connection, game_id: i64) -> rusqlite::Result<Option<PathBuf>> {
    conn.query_row("SELECT path FROM game_files WHERE game_id = ?1 AND role = 'main' AND status = 'present' ORDER BY id LIMIT 1", [game_id], |r| r.get::<_, String>(0))
        .optional()
        .map(|p| p.map(PathBuf::from))
}

/// Entrée de cache : contenu et fraîcheur.
pub struct CacheHit {
    pub body: String,
    pub fresh: bool,
}

pub fn cache_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<CacheHit>> {
    conn.query_row("SELECT body, expires_at FROM sc_cache WHERE key = ?1", [key], |r| {
        Ok(CacheHit { body: r.get(0)?, fresh: r.get::<_, i64>(1)? > now_secs() })
    })
    .optional()
}

pub fn cache_put(conn: &Connection, key: &str, body: &str, ttl_secs: i64) -> rusqlite::Result<()> {
    let now = now_secs();
    conn.execute(
        "INSERT INTO sc_cache (key, body, fetched_at, expires_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at",
        params![key, body, now, now + ttl_secs],
    )?;
    conn.execute(
        "DELETE FROM sc_cache WHERE key IN (SELECT key FROM sc_cache ORDER BY fetched_at DESC LIMIT -1 OFFSET ?1)",
        [CACHE_MAX_ROWS],
    )?;
    Ok(())
}

/// Vide le cache (Paramètres › SmartConfig). Renvoie le nombre d'entrées supprimées.
pub fn cache_clear(conn: &Connection, prefix: Option<&str>) -> rusqlite::Result<usize> {
    match prefix {
        Some(p) => conn.execute("DELETE FROM sc_cache WHERE key LIKE ?1 || '%'", [p]),
        None => conn.execute("DELETE FROM sc_cache", []),
    }
}

pub fn feedback_add(conn: &Connection, game_id: i64, application_id: Option<i64>, worked: Option<bool>, performance_ok: Option<bool>, graphics_issues: Option<bool>) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO sc_feedback (application_id, game_id, worked, performance_ok, graphics_issues, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![application_id, game_id, worked, performance_ok, graphics_issues, crate::library::now_iso()],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Dernier retour (avec au moins une réponse) sur chaque profil appliqué à ce
/// jeu par cet adaptateur, du plus récent au plus ancien. Exploité par le
/// moteur pour exclure ou rétrograder un profil jugé « ne fonctionne pas ».
pub fn local_feedback(conn: &Connection, game_id: i64, adapter: &str) -> rusqlite::Result<Vec<LocalFeedback>> {
    let mut stmt = conn.prepare(
        "SELECT a.source, a.source_ref, a.emulator_version, f.worked, f.performance_ok, f.graphics_issues
         FROM sc_feedback f JOIN sc_applications a ON a.id = f.application_id
         WHERE f.game_id = ?1 AND a.game_id = ?1 AND a.adapter = ?2 AND a.status IN ('applied', 'restored')
           AND (f.worked IS NOT NULL OR f.performance_ok IS NOT NULL OR f.graphics_issues IS NOT NULL)
         ORDER BY f.id DESC",
    )?;
    let rows = stmt.query_map(params![game_id, adapter], |r| {
        Ok(LocalFeedback { source: r.get(0)?, source_ref: r.get(1)?, emulator_version: r.get(2)?, worked: r.get(3)?, performance_ok: r.get(4)?, graphics_issues: r.get(5)? })
    })?;
    let mut out: Vec<LocalFeedback> = Vec::new();
    for f in rows {
        let f = f?;
        if !out.iter().any(|o| o.source == f.source && o.source_ref == f.source_ref) {
            out.push(f);
        }
    }
    Ok(out)
}

/// Questionnaire après session : au plus une fois par optimisation, jamais
/// deux fois en une semaine pour un même jeu.
pub fn should_ask_feedback(conn: &Connection, game_id: i64) -> rusqlite::Result<Option<i64>> {
    let app: Option<i64> = conn
        .query_row("SELECT id FROM sc_applications WHERE game_id = ?1 AND status = 'applied' ORDER BY id DESC LIMIT 1", [game_id], |r| r.get(0))
        .optional()?;
    let Some(app) = app else { return Ok(None) };
    let already: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sc_feedback WHERE game_id = ?1 AND (application_id = ?2 OR created_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')))",
        params![game_id, app],
        |r| r.get(0),
    )?;
    Ok((!already).then_some(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contexte_cache_et_questionnaire() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO games (id, platform_id, title, sort_title, serial, id_method, id_confidence, added_at) VALUES (1, 'gamecube', 'Super Mario Sunshine', 'super', 'GMSE01', 'header', 1, 'x');
             INSERT INTO emulators (id, profile_id, name, exe_path, args, added_at, version) VALUES (7, 'dolphin', 'Dolphin', 'C:\\E\\Dolphin.exe', '[]', 'x', '2509');
             INSERT INTO platform_emulators VALUES ('gamecube', 7);",
        )
        .unwrap();
        let (g, inst) = game_context(&conn, 1).unwrap().unwrap();
        assert_eq!(g.serial.as_deref(), Some("GMSE01"));
        assert_eq!(inst.unwrap().version.as_deref(), Some("2509"));
        assert!(game_context(&conn, 2).unwrap().is_none());

        cache_put(&conn, "emuready:a", "[]", 60).unwrap();
        cache_put(&conn, "emuready:b", "[1]", -1).unwrap();
        assert!(cache_get(&conn, "emuready:a").unwrap().unwrap().fresh);
        assert!(!cache_get(&conn, "emuready:b").unwrap().unwrap().fresh);
        assert_eq!(cache_clear(&conn, Some("emuready:")).unwrap(), 2);

        assert_eq!(should_ask_feedback(&conn, 1).unwrap(), None);
        conn.execute_batch("INSERT INTO sc_applications (id, game_id, adapter, target, source, source_ref, profile, changes, after_sha, status, created_at) VALUES (3, 1, 'dolphin', 't', 'emuready', 'r', '{}', '[]', 'h', 'applied', 'x')").unwrap();
        assert_eq!(should_ask_feedback(&conn, 1).unwrap(), Some(3));
        feedback_add(&conn, 1, Some(3), Some(true), Some(true), Some(false)).unwrap();
        assert_eq!(should_ask_feedback(&conn, 1).unwrap(), None);

        // retours locaux : le plus récent par profil ; sans réponse, sans optimisation ou autre adaptateur → ignorés
        conn.execute_batch(
            "INSERT INTO sc_applications (id, game_id, adapter, emulator_version, target, source, source_ref, profile, changes, after_sha, status, created_at) VALUES
               (4, 1, 'dolphin', '2509', 't', 'community', 'v1', '{}', '[]', 'h', 'restored', 'x'),
               (5, 1, 'pcsx2', NULL, 't', 'emuready', 'r', '{}', '[]', 'h', 'applied', 'x'),
               (6, 1, 'dolphin', NULL, 't', 'emuready', 'z', '{}', '[]', 'h', 'failed', 'x');",
        )
        .unwrap();
        feedback_add(&conn, 1, Some(4), Some(false), None, None).unwrap();
        feedback_add(&conn, 1, Some(5), Some(false), None, None).unwrap();
        feedback_add(&conn, 1, Some(6), Some(false), None, None).unwrap();
        feedback_add(&conn, 1, Some(3), None, None, None).unwrap();
        feedback_add(&conn, 1, None, Some(false), None, None).unwrap();
        let local = local_feedback(&conn, 1, "dolphin").unwrap();
        assert_eq!(local.len(), 2);
        assert_eq!((local[0].source.as_str(), local[0].source_ref.as_str(), local[0].worked), ("community", "v1", Some(false)));
        assert_eq!(local[0].emulator_version.as_deref(), Some("2509"));
        assert_eq!((local[1].source_ref.as_str(), local[1].worked, local[1].graphics_issues), ("r", Some(true), Some(false)));
    }
}
