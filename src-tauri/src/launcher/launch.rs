//! Lancement d'un émulateur et suivi de la session de jeu.
//!
//! `std::process::Command` reçoit l'exécutable et une liste d'arguments :
//! aucun shell n'intervient. Un fil surveille le processus pour mesurer le
//! temps de jeu et expliquer clairement un arrêt immédiat.

use super::repo::LaunchPlan;
use super::{LaunchError, Result};
use crate::db;
use crate::library::now_iso;
use rusqlite::params;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Instant;

/// En deçà, une sortie en erreur est considérée comme un échec de lancement.
pub const QUICK_EXIT_SECONDS: u64 = 6;
/// Une session plus courte ne compte pas comme une partie jouée.
pub const MIN_PLAYED_SECONDS: u64 = 15;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Running {
    pub game_id: i64,
    pub title: String,
    pub emulator_name: String,
    pub started_at: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ended {
    pub game_id: i64,
    pub title: String,
    pub seconds: u64,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
    /// Lancé par une boutique (Steam…) : la boutique suit la partie, pas iBox.
    pub detached: bool,
}

/// Explication d'une fin de session (None : tout s'est bien passé).
pub fn diagnose(seconds: u64, exit_code: Option<i32>, stderr_tail: &str, emulator: &str) -> Option<String> {
    let failed = exit_code != Some(0);
    if seconds >= QUICK_EXIT_SECONDS || !failed {
        return None;
    }
    let detail = stderr_tail.lines().map(str::trim).rfind(|l| !l.is_empty());
    let code = exit_code.map(|c| format!(" (code {c})")).unwrap_or_default();
    Some(match detail {
        Some(d) => format!("{emulator} s'est fermé aussitôt{code} : « {} ».", d.chars().take(160).collect::<String>()),
        None => format!(
            "{emulator} s'est fermé aussitôt{code}. Vérifiez que l'émulateur se lance seul, que son BIOS ou ses fichiers système sont installés, et ses arguments de lancement."
        ),
    })
}

/// Démarre l'émulateur. Renvoie le processus et l'identifiant de session.
pub fn start(db_path: &Path, plan: &LaunchPlan) -> Result<(std::process::Child, i64)> {
    let exe = PathBuf::from(&plan.exe);
    let mut cmd = Command::new(&exe);
    cmd.args(&plan.args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    if let Some(dir) = exe.parent() {
        // les émulateurs portables cherchent leur configuration à côté de l'exécutable
        cmd.current_dir(dir);
    }
    let child = cmd.spawn().map_err(|e| LaunchError::Spawn(format!("{} : {e}", plan.emulator_name)))?;

    let conn = db::open(db_path).map_err(|e| LaunchError::Spawn(e.to_string()))?;
    let now = now_iso();
    conn.execute("UPDATE games SET last_played_at = ?2 WHERE id = ?1", params![plan.game_id, now])?;
    conn.execute(
        "INSERT INTO play_sessions (game_id, emulator_id, started_at) VALUES (?1, ?2, ?3)",
        params![plan.game_id, plan.emulator_id, now],
    )?;
    Ok((child, conn.last_insert_rowid()))
}

/// Attend la fin du processus (à appeler dans un fil dédié) et enregistre la session.
pub fn watch(db_path: &Path, plan: &LaunchPlan, mut child: std::process::Child, session_id: i64) -> Ended {
    let started = Instant::now();
    // lecture de stderr dans un fil séparé (évite tout blocage si le tampon se remplit)
    let stderr = child.stderr.take().map(|mut s| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = (&mut s).take(64 * 1024).read_to_end(&mut buf);
            let text = String::from_utf8_lossy(&buf).to_string();
            let tail: String = text.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect();
            tail
        })
    });
    let status = child.wait();
    let seconds = started.elapsed().as_secs();
    let exit_code = status.ok().and_then(|s| s.code());
    let tail = stderr.and_then(|h| h.join().ok()).unwrap_or_default();
    // lancé par une boutique : son processus rend la main tout de suite, ce n'est pas un échec
    // (l'Explorateur Windows, qui transmet les liens Epic/GOG, rend même le code 1)
    let error = if plan.detached { None } else { diagnose(seconds, exit_code, &tail, &plan.emulator_name) };

    if let Ok(conn) = db::open(db_path) {
        let _ = finish_session(&conn, plan.game_id, session_id, seconds, exit_code, error.as_deref());
    }
    Ended { game_id: plan.game_id, title: plan.title.clone(), seconds, exit_code, error, detached: plan.detached }
}

/// Clôt une session. Un échec de lancement ne compte pas comme une partie :
/// la « dernière partie » revient à la dernière session réussie.
pub fn finish_session(
    conn: &rusqlite::Connection,
    game_id: i64,
    session_id: i64,
    seconds: u64,
    exit_code: Option<i32>,
    error: Option<&str>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE play_sessions SET ended_at = ?2, seconds = ?3, exit_code = ?4, error = ?5 WHERE id = ?1",
        params![session_id, now_iso(), seconds as i64, exit_code, error],
    )?;
    if error.is_some() {
        conn.execute(
            "UPDATE games SET last_played_at = (
                 SELECT max(started_at) FROM play_sessions
                 WHERE game_id = ?1 AND error IS NULL AND ended_at IS NOT NULL)
             WHERE id = ?1",
            [game_id],
        )?;
    } else if seconds >= MIN_PLAYED_SECONDS {
        conn.execute(
            "UPDATE games SET play_count = play_count + 1, play_seconds = play_seconds + ?2 WHERE id = ?1",
            params![game_id, seconds as i64],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_echec_ne_devient_pas_la_derniere_partie() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence, last_played_at)
               VALUES (1, 'ps2', 'Okami', 'okami', 'x', 'header', 1, '2026-11-01T10:00:00Z');
             INSERT INTO play_sessions (id, game_id, started_at, ended_at, seconds) VALUES (1, 1, '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z', 3600);
             INSERT INTO play_sessions (id, game_id, started_at) VALUES (2, 1, '2026-11-12T16:00:00Z');
             UPDATE games SET last_played_at = '2026-11-12T16:00:00Z' WHERE id = 1;",
        )
        .unwrap();
        finish_session(&conn, 1, 2, 1, Some(3), Some("BIOS introuvable")).unwrap();
        let (last, count): (String, i64) =
            conn.query_row("SELECT last_played_at, play_count FROM games WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((last.as_str(), count), ("2026-11-01T10:00:00Z", 0));

        // une vraie partie compte
        conn.execute("INSERT INTO play_sessions (id, game_id, started_at) VALUES (3, 1, '2026-11-12T17:00:00Z')", []).unwrap();
        finish_session(&conn, 1, 3, 1800, Some(0), None).unwrap();
        let (count, secs): (i64, i64) = conn.query_row("SELECT play_count, play_seconds FROM games WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((count, secs), (1, 1800));
    }

    #[test]
    fn diagnostic_des_fins_de_session() {
        assert_eq!(diagnose(1200, Some(0), "", "Dolphin"), None);
        assert_eq!(diagnose(1200, Some(1), "", "Dolphin"), None, "une longue partie qui finit en erreur n'est pas un échec de lancement");
        assert_eq!(diagnose(1, Some(0), "", "Dolphin"), None);
        let e = diagnose(1, Some(3), "init\nBIOS introuvable\n\n", "PCSX2").unwrap();
        assert!(e.contains("PCSX2") && e.contains("code 3") && e.contains("BIOS introuvable"), "{e}");
        assert!(diagnose(2, None, "", "melonDS").unwrap().contains("BIOS"));
    }
}
