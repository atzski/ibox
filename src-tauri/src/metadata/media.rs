//! Cache local des images : `<données>/media/<id du jeu>/<type>-<n>.<ext>`.
//! Chaque image est validée (format réel, dimensions) avant d'être enregistrée.

use super::{MediaKind, MetaError, Result};
use crate::library::now_iso;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Taille maximale acceptée pour une image (téléchargée ou importée).
pub const MAX_IMAGE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRow {
    pub kind: MediaKind,
    pub slot: i64,
    pub source: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub added_at: String,
}

pub struct MediaStore {
    /// Modifiable à chaud : déplacement du stockage (`crate::storage`).
    root: std::sync::RwLock<PathBuf>,
}

/// Format réel d'après les premiers octets (l'extension ne fait pas foi).
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.len() > 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        // GIF (animé ou non) : affiché tel quel, l'animation est conservée
        Some("gif")
    } else {
        None
    }
}

impl MediaStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root: std::sync::RwLock::new(root) }
    }

    pub fn root(&self) -> PathBuf {
        self.root.read().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_root(&self, root: PathBuf) {
        *self.root.write().unwrap_or_else(|e| e.into_inner()) = root;
    }

    /// Valide puis enregistre une image ; remplace l'éventuelle image précédente.
    #[allow(clippy::too_many_arguments)]
    pub fn save(
        &self,
        conn: &Connection,
        game_id: i64,
        kind: MediaKind,
        slot: i64,
        bytes: &[u8],
        source: &str,
        source_ref: Option<&str>,
    ) -> Result<MediaRow> {
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(MetaError::Invalid("image trop volumineuse (25 Mo maximum)".into()));
        }
        let ext = sniff(bytes).ok_or_else(|| MetaError::Invalid("ce n'est pas une image PNG, JPEG, WebP ou GIF".into()))?;
        let size = imagesize::blob_size(bytes).map_err(|_| MetaError::Invalid("image illisible".into()))?;
        if size.width < 16 || size.height < 16 || size.width > 12_000 || size.height > 12_000 {
            return Err(MetaError::Invalid("dimensions d'image inattendues".into()));
        }
        let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM games WHERE id = ?1)", [game_id], |r| r.get(0))?;
        if !exists {
            return Err(MetaError::NotFound);
        }

        let dir = self.root().join(game_id.to_string());
        fs::create_dir_all(&dir)?;
        let stem = format!("{}-{slot}", kind.as_str());
        let rel = format!("{game_id}/{stem}.{ext}");
        let tmp = dir.join(format!("{stem}.tmp"));
        fs::write(&tmp, bytes)?;
        // supprime une version précédente dans un autre format
        for other in ["png", "jpg", "webp", "gif"] {
            if other != ext {
                let _ = fs::remove_file(dir.join(format!("{stem}.{other}")));
            }
        }
        fs::rename(&tmp, self.root().join(&rel))?;

        let now = now_iso();
        conn.execute(
            "INSERT INTO media (game_id, kind, slot, source, source_ref, file, width, height, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT (game_id, kind, slot) DO UPDATE SET
               source = excluded.source, source_ref = excluded.source_ref, file = excluded.file,
               width = excluded.width, height = excluded.height, added_at = excluded.added_at",
            params![game_id, kind.as_str(), slot, source, source_ref, rel, size.width as i64, size.height as i64, now],
        )?;
        Ok(MediaRow {
            kind,
            slot,
            source: source.into(),
            width: Some(size.width as i64),
            height: Some(size.height as i64),
            added_at: now,
        })
    }

    pub fn read(&self, conn: &Connection, game_id: i64, kind: MediaKind, slot: i64) -> Result<Vec<u8>> {
        let rel: String = conn
            .query_row(
                "SELECT file FROM media WHERE game_id = ?1 AND kind = ?2 AND slot = ?3",
                params![game_id, kind.as_str(), slot],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(MetaError::NotFound)?;
        let path = self.safe_path(&rel)?;
        Ok(fs::read(path)?)
    }

    pub fn source_of(&self, conn: &Connection, game_id: i64, kind: MediaKind, slot: i64) -> Result<Option<String>> {
        Ok(conn
            .query_row(
                "SELECT source FROM media WHERE game_id = ?1 AND kind = ?2 AND slot = ?3",
                params![game_id, kind.as_str(), slot],
                |r| r.get(0),
            )
            .optional()?)
    }

    pub fn remove(&self, conn: &Connection, game_id: i64, kind: MediaKind, slot: i64) -> Result<()> {
        let rel: Option<String> = conn
            .query_row(
                "SELECT file FROM media WHERE game_id = ?1 AND kind = ?2 AND slot = ?3",
                params![game_id, kind.as_str(), slot],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(rel) = rel {
            let _ = fs::remove_file(self.safe_path(&rel)?);
            conn.execute(
                "DELETE FROM media WHERE game_id = ?1 AND kind = ?2 AND slot = ?3",
                params![game_id, kind.as_str(), slot],
            )?;
        }
        Ok(())
    }

    /// Supprime les images téléchargées (les images importées par l'utilisateur sont conservées).
    pub fn clear_downloaded(&self, conn: &Connection) -> Result<usize> {
        let rows: Vec<(i64, String)> = {
            let mut stmt = conn.prepare("SELECT id, file FROM media WHERE source <> 'user'")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            rows.collect::<rusqlite::Result<_>>()?
        };
        for (_, rel) in &rows {
            if let Ok(p) = self.safe_path(rel) {
                let _ = fs::remove_file(p);
            }
        }
        conn.execute("DELETE FROM media WHERE source <> 'user'", [])?;
        conn.execute("UPDATE games SET media_status = NULL WHERE id NOT IN (SELECT game_id FROM media WHERE kind = 'front')", [])?;
        Ok(rows.len())
    }

    /// Supprime les dossiers d'images de jeux qui ne sont plus dans la collection.
    pub fn collect_garbage(&self, conn: &Connection) -> Result<usize> {
        let Ok(entries) = fs::read_dir(&self.root()) else { return Ok(0) };
        let mut removed = 0;
        for e in entries.flatten() {
            let Some(id) = e.file_name().to_str().and_then(|n| n.parse::<i64>().ok()) else { continue };
            let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM games WHERE id = ?1)", [id], |r| r.get(0))?;
            if !exists && fs::remove_dir_all(e.path()).is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub fn size_bytes(&self) -> u64 {
        fn walk(p: &Path) -> u64 {
            fs::read_dir(p)
                .map(|it| {
                    it.flatten()
                        .map(|e| match e.metadata() {
                            Ok(m) if m.is_dir() => walk(&e.path()),
                            Ok(m) => m.len(),
                            Err(_) => 0,
                        })
                        .sum()
                })
                .unwrap_or(0)
        }
        walk(&self.root())
    }

    /// Chemin absolu d'un fichier du cache, sans possibilité d'en sortir.
    fn safe_path(&self, rel: &str) -> Result<PathBuf> {
        if rel.contains("..") || Path::new(rel).is_absolute() {
            return Err(MetaError::Invalid("chemin de média invalide".into()));
        }
        Ok(self.root().join(rel))
    }
}

pub fn list_for_game(conn: &Connection, game_id: i64) -> Result<Vec<MediaRow>> {
    let mut stmt = conn.prepare("SELECT kind, slot, source, width, height, added_at FROM media WHERE game_id = ?1 ORDER BY kind, slot")?;
    let rows = stmt.query_map([game_id], |r| {
        let kind: String = r.get(0)?;
        Ok((kind, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (kind, slot, source, width, height, added_at): (String, i64, String, Option<i64>, Option<i64>, String) = row?;
        if let Ok(kind) = serde_json::from_value::<MediaKind>(serde_json::Value::String(kind)) {
            out.push(MediaRow { kind, slot, source, width, height, added_at });
        }
    }
    Ok(out)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db;

    /// PNG 20×30 minimal (en-tête + IHDR suffisent à `imagesize`).
    pub fn tiny_png(w: u32, h: u32) -> Vec<u8> {
        let mut v = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR".to_vec();
        v.extend_from_slice(&w.to_be_bytes());
        v.extend_from_slice(&h.to_be_bytes());
        v.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        v
    }

    fn setup() -> (tempfile::TempDir, Connection, MediaStore) {
        let tmp = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence)
             VALUES (1, 'gba', 'Jeu', 'jeu', 'x', 'header', 1);",
        )
        .unwrap();
        let store = MediaStore::new(tmp.path().join("media"));
        (tmp, conn, store)
    }

    #[test]
    fn enregistre_relit_et_remplace() {
        let (_tmp, conn, store) = setup();
        let row = store.save(&conn, 1, MediaKind::Front, 0, &tiny_png(20, 30), "libretro", Some("u")).unwrap();
        assert_eq!((row.width, row.height), (Some(20), Some(30)));
        assert_eq!(store.read(&conn, 1, MediaKind::Front, 0).unwrap(), tiny_png(20, 30));
        store.save(&conn, 1, MediaKind::Front, 0, &tiny_png(40, 60), "user", None).unwrap();
        assert_eq!(list_for_game(&conn, 1).unwrap().len(), 1);
        assert_eq!(store.source_of(&conn, 1, MediaKind::Front, 0).unwrap().as_deref(), Some("user"));
    }

    #[test]
    fn refuse_ce_qui_n_est_pas_une_image() {
        let (_tmp, conn, store) = setup();
        assert!(store.save(&conn, 1, MediaKind::Front, 0, b"<html>captcha</html>", "libretro", None).is_err());
        assert!(store.save(&conn, 1, MediaKind::Front, 0, &tiny_png(2, 2), "libretro", None).is_err());
        assert!(store.save(&conn, 99, MediaKind::Front, 0, &tiny_png(20, 20), "libretro", None).is_err());
    }

    #[test]
    fn vider_le_cache_garde_les_imports() {
        let (_tmp, conn, store) = setup();
        store.save(&conn, 1, MediaKind::Front, 0, &tiny_png(20, 30), "libretro", None).unwrap();
        store.save(&conn, 1, MediaKind::Back, 0, &tiny_png(20, 30), "user", None).unwrap();
        assert_eq!(store.clear_downloaded(&conn).unwrap(), 1);
        let left = list_for_game(&conn, 1).unwrap();
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].kind, MediaKind::Back);
    }

    #[test]
    fn nettoie_les_jeux_supprimes() {
        let (_tmp, conn, store) = setup();
        store.save(&conn, 1, MediaKind::Front, 0, &tiny_png(20, 30), "libretro", None).unwrap();
        conn.execute("DELETE FROM games WHERE id = 1", []).unwrap();
        assert_eq!(store.collect_garbage(&conn).unwrap(), 1);
        assert!(!store.root().join("1").exists());
    }
}
