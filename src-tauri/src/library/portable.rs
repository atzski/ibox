use super::{commands::LibraryState, LibraryError};
use std::{
    fs,
    io::{self, Read, Write},
    path::Path,
};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_TOTAL: u64 = 1024 * 1024 * 1024;
const MAX_SETTINGS: u64 = 8 * 1024 * 1024;
const PENDING: &str = "portable-pending";
const SETTINGS: &str = "portable-settings.json";

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn allowed(name: &str) -> bool {
    if let Some(file) = name.strip_prefix("media/sounds/") {
        return file.split_once(".custom.").is_some_and(|(id, ext)| {
            id.parse::<u64>().is_ok()
                && matches!(ext, "mp3" | "ogg" | "wav" | "m4a" | "opus" | "webm")
        });
    }
    name.strip_prefix("media/collections/")
        .and_then(|file| file.split_once('-'))
        .is_some_and(|(id, kind)| {
            id.parse::<u64>().is_ok() && matches!(kind, "logo" | "hero" | "icon")
        })
}

fn validate_settings(json: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(message)?;
    if value["format"] != 1
        || !value["settings"].is_object()
        || !value["styles"].is_object()
        || json.len() as u64 > MAX_SETTINGS
    {
        return Err("Réglages de sauvegarde invalides.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn portable_export(app: AppHandle, path: String, settings: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_settings(&settings)?;
        let dir = app.path().app_data_dir().map_err(message)?;
        let snapshot = tempfile::NamedTempFile::new().map_err(message)?;
        app.state::<LibraryState>().with(|conn| {
            conn.execute(
                "VACUUM INTO ?1",
                [snapshot.path().to_string_lossy().as_ref()],
            )
            .map_err(LibraryError::from)?;
            Ok(())
        })?;
        let destination = Path::new(&path);
        let parent = destination
            .parent()
            .filter(|p| p.is_absolute())
            .ok_or("Emplacement invalide.")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(message)?;
        let mut zip = ZipWriter::new(temp.as_file_mut());
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("settings.json", options).map_err(message)?;
        zip.write_all(settings.as_bytes()).map_err(message)?;
        let mut total = settings.len() as u64;
        let mut add = |name: &str, file: &Path| -> Result<(), String> {
            let input = fs::File::open(file).map_err(message)?;
            zip.start_file(name, options).map_err(message)?;
            total += io::copy(&mut input.take(MAX_TOTAL - total + 1), &mut zip).map_err(message)?;
            if total > MAX_TOTAL {
                return Err("Sauvegarde trop volumineuse (1 Gio maximum).".into());
            }
            Ok(())
        };
        add("library.db", snapshot.path())?;
        for folder in ["media/sounds", "media/collections"] {
            let entries = match fs::read_dir(dir.join(folder)) {
                Ok(entries) => entries,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => return Err(message(error)),
            };
            for entry in entries {
                let entry = entry.map_err(message)?;
                let name = format!("{folder}/{}", entry.file_name().to_string_lossy());
                if allowed(&name) && entry.file_type().map_err(message)?.is_file() {
                    add(&name, &entry.path())?;
                }
            }
        }
        zip.finish().map_err(message)?;
        temp.persist(destination).map_err(message)?;
        Ok(())
    })
    .await
    .map_err(message)?
}

#[tauri::command]
pub async fn portable_stage(app: AppHandle, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app.path().app_data_dir().map_err(message)?;
        stage(&dir, Path::new(&path))
    })
    .await
    .map_err(message)?
}

fn stage(dir: &Path, path: &Path) -> Result<(), String> {
    let mut zip = ZipArchive::new(fs::File::open(path).map_err(message)?).map_err(message)?;
    let temp = tempfile::tempdir_in(dir).map_err(message)?;
    let mut total = 0;
    if zip.len() > 20_000 {
        return Err("Trop de fichiers dans la sauvegarde.".into());
    }
    for index in 0..zip.len() {
        let mut item = zip.by_index(index).map_err(message)?;
        let name = item.name().map_err(message)?.into_owned();
        let name = name.as_str();
        if !matches!(name, "library.db" | "settings.json") && !allowed(name) {
            return Err("Fichier inattendu dans la sauvegarde.".into());
        }
        let target = temp.path().join(name);
        let limit = if name == "settings.json" {
            MAX_SETTINGS
        } else {
            MAX_TOTAL - total
        };
        if item.size() > limit {
            return Err("Sauvegarde trop volumineuse.".into());
        }
        fs::create_dir_all(target.parent().unwrap()).map_err(message)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(target)
            .map_err(message)?;
        let bytes = io::copy(&mut item.by_ref().take(limit + 1), &mut file).map_err(message)?;
        total += bytes;
        if bytes > limit || total > MAX_TOTAL {
            return Err("Sauvegarde trop volumineuse.".into());
        }
    }
    if dir.join("restore-pending.db").exists() {
        return Err("Une restauration est déjà en attente.".into());
    }
    let db = crate::db::recovery::checked(&temp.path().join("library.db"))?;
    db.query_row("SELECT count(*) FROM collections", [], |row| {
        row.get::<_, i64>(0)
    })
    .map_err(message)?;
    drop(db);
    validate_settings(&fs::read_to_string(temp.path().join("settings.json")).map_err(message)?)?;
    fs::rename(temp.path(), dir.join(PENDING)).map_err(message)
}

pub fn apply(dir: &Path) -> Result<(), String> {
    let pending = dir.join(PENDING);
    if !pending.exists() {
        return Ok(());
    }
    if !pending.join("library.db").is_file() {
        if fs::remove_dir(&pending).is_ok() {
            return Ok(());
        }
        return Err("Sauvegarde en attente incomplète.".into());
    }
    let archive = tempfile::Builder::new()
        .prefix("before-portable-")
        .tempdir_in(dir)
        .map_err(message)?
        .keep();
    let mut old = Vec::new();
    let mut installed = Vec::new();
    let result = (|| -> io::Result<()> {
        for name in [
            "library.db",
            "library.db-wal",
            "library.db-shm",
            "media",
            SETTINGS,
        ] {
            if dir.join(name).exists() {
                fs::rename(dir.join(name), archive.join(name))?;
                old.push(name);
            }
        }
        for (source, target) in [
            ("library.db", "library.db"),
            ("media", "media"),
            ("settings.json", SETTINGS),
        ] {
            if pending.join(source).exists() {
                fs::rename(pending.join(source), dir.join(target))?;
                installed.push((source, target));
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        for (source, target) in installed.into_iter().rev() {
            fs::rename(dir.join(target), pending.join(source)).map_err(message)?;
        }
        for name in old.into_iter().rev() {
            fs::rename(archive.join(name), dir.join(name)).map_err(message)?;
        }
        return Err(message(error));
    }
    let _ = fs::remove_dir(&pending);
    Ok(())
}

#[tauri::command]
pub fn portable_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = app.path().app_data_dir().map_err(message)?.join(SETTINGS);
    match fs::read_to_string(path) {
        Ok(data) => Ok(Some(data)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(message(error)),
    }
}

#[tauri::command]
pub fn portable_ack(app: AppHandle) -> Result<(), String> {
    fs::remove_file(app.path().app_data_dir().map_err(message)?.join(SETTINGS)).map_err(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_collections_settings_and_custom_sounds() {
        let source = tempfile::tempdir().unwrap();
        let db_path = source.path().join("library.db");
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO collections (name,color,position,created_at) VALUES ('Coop','#123456',1,'2026-11-14')",
            [],
        ).unwrap();
        conn.execute("VACUUM INTO ?1", [db_path.to_str().unwrap()])
            .unwrap();
        let path = source.path().join("test.iboxbackup");
        let mut zip = ZipWriter::new(fs::File::create(&path).unwrap());
        let options = SimpleFileOptions::default();
        for (name, data) in [
            ("library.db", fs::read(db_path).unwrap()),
            (
                "settings.json",
                br#"{"format":1,"settings":{"theme":"dark"},"styles":{}}"#.to_vec(),
            ),
            ("media/sounds/2.custom.ogg", b"sound".to_vec()),
            ("media/collections/1-icon", b"icon".to_vec()),
        ] {
            zip.start_file(name, options).unwrap();
            zip.write_all(&data).unwrap();
        }
        zip.finish().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let dir = destination.path();
        stage(dir, &path).unwrap();
        apply(dir).unwrap();
        apply(dir).unwrap();
        let restored = crate::db::open(&dir.join("library.db")).unwrap();
        let title: String = restored
            .query_row("SELECT name FROM collections", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "Coop");
        assert_eq!(
            fs::read(dir.join("media/sounds/2.custom.ogg")).unwrap(),
            b"sound"
        );
        assert_eq!(
            fs::read(dir.join("media/collections/1-icon")).unwrap(),
            b"icon"
        );
        assert!(fs::read_to_string(dir.join(SETTINGS))
            .unwrap()
            .contains("dark"));
        assert!(!allowed("media/sounds/../../escape.custom.ogg"));
        assert!(!allowed("media/collections/1-hero:other"));
    }
}
