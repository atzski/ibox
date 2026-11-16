//! Base SQLite de la collection.
//!
//! Migrations versionnées via `PRAGMA user_version` : chaque fichier de
//! `migrations/` est appliqué une seule fois, dans l'ordre, en transaction.
//! Ajouter une évolution du schéma = ajouter un fichier à `MIGRATIONS`.

pub mod recovery;

use rusqlite::Connection;
use std::path::Path;

/// Migrations dans l'ordre. L'index + 1 est la version atteinte.
const MIGRATIONS: &[&str] = &[
    include_str!("migrations/001_initial.sql"),
    include_str!("migrations/002_metadata.sql"),
    include_str!("migrations/003_launcher.sql"),
    include_str!("migrations/004_hero.sql"),
    include_str!("migrations/005_pc.sql"),
    include_str!("migrations/006_pc_sync.sql"),
    include_str!("migrations/007_pc_family.sql"),
    include_str!("migrations/008_platform_art.sql"),
    include_str!("migrations/009_game_art.sql"),
    include_str!("migrations/010_launchbox.sql"),
    include_str!("migrations/011_collections.sql"),
    include_str!("migrations/012_variants.sql"),
];

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("base de données : {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("la base (version {found}) est plus récente que l'application (version {supported})")]
    TooNew { found: usize, supported: usize },
}

/// Version de schéma attendue par cette version de l'application.
pub const SCHEMA_VERSION: usize = MIGRATIONS.len();

/// Ouvre (ou crée) la base et applique les migrations manquantes.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

/// Base en mémoire (tests).
pub fn open_in_memory() -> Result<Connection, DbError> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )
}

/// Copies de sécurité gardées.
const BACKUPS_KEPT: usize = 7;
/// Intervalle minimal entre deux copies (heures).
const BACKUP_EVERY_HOURS: u64 = 6;

/// Copie de sécurité de la base, au lancement : `backups/library-<horodatage>.db`.
/// Seulement si la base est saine (`PRAGMA quick_check`), au plus toutes les
/// 6 heures ; les 7 plus récentes sont gardées. Renvoie le chemin créé.
pub fn backup(conn: &Connection, dir: &Path) -> Result<Option<std::path::PathBuf>, String> {
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("base endommagée, aucune copie écrasée : {check}"));
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut existing: Vec<(std::time::SystemTime, std::path::PathBuf)> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("library-") && e.file_name().to_string_lossy().ends_with(".db"))
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    existing.sort();
    if let Some((newest, _)) = existing.last() {
        if newest.elapsed().map(|d| d.as_secs() < BACKUP_EVERY_HOURS * 3600).unwrap_or(false) {
            return Ok(None);
        }
    }
    let stamp = crate::library::time::now_iso().replace([':', '-'], "").replace('T', "-").trim_end_matches('Z').to_string();
    let target = dir.join(format!("library-{stamp}.db"));
    let quoted = target.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{quoted}'")).map_err(|e| e.to_string())?;
    existing.push((std::time::SystemTime::now(), target.clone()));
    while existing.len() > BACKUPS_KEPT {
        let (_, old) = existing.remove(0);
        let _ = std::fs::remove_file(old);
    }
    Ok(Some(target))
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<usize> {
    conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
        .map(|v| v as usize)
}

pub fn migrate(conn: &Connection) -> Result<(), DbError> {
    let current = schema_version(conn)?;
    if current > SCHEMA_VERSION {
        return Err(DbError::TooNew {
            found: current,
            supported: SCHEMA_VERSION,
        });
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copie_de_securite() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = open(&tmp.path().join("library.db")).unwrap();
        conn.execute("INSERT INTO folders (path, recursive, enabled, added_at) VALUES ('C:/Jeux', 1, 1, 'x')", []).unwrap();
        let dir = tmp.path().join("backups");
        let made = backup(&conn, &dir).unwrap().expect("première copie");
        let copy = Connection::open(&made).unwrap();
        let n: i64 = copy.query_row("SELECT count(*) FROM folders", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1, "la copie contient les données");
        assert!(backup(&conn, &dir).unwrap().is_none(), "pas de nouvelle copie dans les 6 heures");
    }

    #[test]
    fn cree_le_schema_et_atteint_la_derniere_version() {
        let conn = open_in_memory().unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
        for table in ["folders", "games", "game_files", "settings", "scan_runs", "media", "ref_gametdb", "ref_libretro_meta", "ref_libretro_thumbs", "ref_sources", "emulators", "platform_emulators", "play_sessions"] {
            let n: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "table {table} absente");
        }
    }

    #[test]
    fn les_migrations_sont_idempotentes() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);
    }

    #[test]
    fn refuse_une_base_plus_recente() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 99).unwrap();
        assert!(matches!(migrate(&conn), Err(DbError::TooNew { .. })));
    }

    #[test]
    fn supprimer_un_jeu_supprime_ses_fichiers_mais_pas_le_dossier() {
        let conn = open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO folders (id, path, added_at) VALUES (1, 'D:/Emulation', '2026-11-12');
             INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence)
               VALUES (1, 'gamecube', 'Test', 'test', '2026-11-12', 'header', 1.0);
             INSERT INTO game_files (game_id, folder_id, path, size, last_seen_at)
               VALUES (1, 1, 'D:/Emulation/test.iso', 10, '2026-11-12');
             DELETE FROM games WHERE id = 1;",
        )
        .unwrap();
        let files: i64 = conn
            .query_row("SELECT count(*) FROM game_files", [], |r| r.get(0))
            .unwrap();
        let folders: i64 = conn
            .query_row("SELECT count(*) FROM folders", [], |r| r.get(0))
            .unwrap();
        assert_eq!((files, folders), (0, 1));
    }
}
