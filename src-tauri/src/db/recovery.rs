use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Backup {
    pub name: String,
    pub games: i64,
}

fn backup_name(name: &str) -> bool {
    name.strip_prefix("library-").and_then(|s| s.strip_suffix(".db"))
        .is_some_and(|s| s.len() == 15 && s.bytes().enumerate().all(|(i,b)| if i == 8 { b == b'-' } else { b.is_ascii_digit() }))
}

pub(crate) fn checked(path: &Path) -> Result<Connection, String> {
    if !path.symlink_metadata().is_ok_and(|m| m.file_type().is_file()) {
        return Err("Sauvegarde introuvable.".into());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let check: String = conn.query_row("PRAGMA integrity_check(1)", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    if check != "ok" || super::schema_version(&conn).map_err(|e| e.to_string())? > super::SCHEMA_VERSION {
        return Err("Sauvegarde endommagée ou incompatible.".into());
    }
    Ok(conn)
}

pub fn list(dir: &Path) -> Result<Vec<Backup>, String> {
    let entries = match std::fs::read_dir(dir.join("backups")) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let mut items = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if backup_name(&name) {
            if let Ok(games) = checked(&entry.path()).and_then(|db| {
                db.query_row("SELECT count(*) FROM games", [], |r| r.get(0)).map_err(|e| e.to_string())
            }) {
                items.push(Backup { name, games });
            }
        }
    }
    items.sort_by(|a,b| b.name.cmp(&a.name));
    Ok(items)
}

pub fn remove(dir: &Path, name: &str) -> Result<(), String> {
    if !backup_name(name) {
        return Err("Nom de sauvegarde invalide.".into());
    }
    let folder = dir.join("backups");
    let path = folder.join(name);
    if !folder.symlink_metadata().is_ok_and(|m| m.file_type().is_dir())
        || !path.symlink_metadata().is_ok_and(|m| m.file_type().is_file())
    {
        return Err("Sauvegarde introuvable.".into());
    }
    std::fs::remove_file(path).map_err(|e| format!("Impossible de supprimer la sauvegarde : {e}"))
}

pub fn stage(dir: &Path, name: &str) -> Result<(), String> {
    if !backup_name(name) {
        return Err("Nom de sauvegarde invalide.".into());
    }
    let source = checked(&dir.join("backups").join(name))?;
    let temporary = tempfile::NamedTempFile::new_in(dir).map_err(|e| e.to_string())?;
    source.execute("VACUUM INTO ?1", [temporary.path().to_string_lossy().as_ref()]).map_err(|e| e.to_string())?;
    temporary.persist(dir.join("restore-pending.db")).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn apply(dir: &Path) -> Result<(), String> {
    let pending = dir.join("restore-pending.db");
    if !pending.exists() { return Ok(()); }
    checked(&pending)?;
    let archive = tempfile::Builder::new().prefix("before-restore-").tempdir_in(dir).map_err(|e| e.to_string())?.keep();
    let mut moved = Vec::new();
    let result = (|| {
        for name in ["library.db", "library.db-wal", "library.db-shm"] {
            let path = dir.join(name);
            if path.exists() {
                std::fs::rename(&path, archive.join(name))?;
                moved.push(name);
            }
        }
        std::fs::rename(&pending, dir.join("library.db"))
    })();
    if let Err(error) = result {
        for name in moved.into_iter().rev() {
            std::fs::rename(archive.join(name), dir.join(name)).map_err(|e| format!("{error}; archive : {} ({e})", archive.display()))?;
        }
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deletes_only_the_named_backup() {
        let folder = tempfile::tempdir().unwrap();
        let dir = folder.path();
        let backups = dir.join("backups");
        std::fs::create_dir(&backups).unwrap();
        let name = "library-20261114-010000.db";
        let other = backups.join("library-20261113-010000.db");
        let library = dir.join("library.db");
        for path in [backups.join(name), other.clone(), library.clone()] {
            std::fs::write(path, b"data").unwrap();
        }
        assert!(remove(dir, "../library.db").is_err());
        remove(dir, name).unwrap();
        assert!(!backups.join(name).exists());
        assert!(other.is_file() && library.is_file());
    }
    #[test]
    fn interrupted_transaction_leaves_committed_data_readable() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("library.db");
        let db = crate::db::open(&path).unwrap();
        db.execute("INSERT INTO settings VALUES ('committed', 'yes')", []).unwrap();
        db.execute_batch("BEGIN IMMEDIATE; INSERT INTO settings VALUES ('partial', 'no');").unwrap();
        drop(db);
        let db = crate::db::open(&path).unwrap();
        assert_eq!(db.query_row("SELECT key FROM settings", [], |r| r.get::<_, String>(0)).unwrap(), "committed");
    }

    #[test]
    fn restores_a_snapshot_and_archives_the_current_library() {
        let folder = tempfile::tempdir().unwrap();
        let dir = folder.path();
        let path = dir.join("library.db");
        let db = crate::db::open(&path).unwrap();
        let snapshot = crate::db::backup(&db, &dir.join("backups")).unwrap().unwrap();
        db.execute("INSERT INTO settings (key, value) VALUES ('after', 'true')", []).unwrap();
        drop(db);
        assert!(stage(dir, "../library.db").is_err());
        assert_eq!(list(dir).unwrap().len(), 1);
        stage(dir, snapshot.file_name().unwrap().to_str().unwrap()).unwrap();
        apply(dir).unwrap();
        let restored = crate::db::open(&path).unwrap();
        assert_eq!(restored.query_row("SELECT count(*) FROM settings", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert!(std::fs::read_dir(dir).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("before-restore-")));
    }
}
