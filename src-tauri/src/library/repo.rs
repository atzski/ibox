//! Accès SQLite : dossiers surveillés, jeux et corrections manuelles.

use super::{now_iso, LibraryError, Result};
use crate::scanner::{formats, reconcile::path_key};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

// ——— Dossiers ———

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub path: String,
    pub platform_id: Option<String>,
    pub recursive: bool,
    pub enabled: bool,
    pub added_at: String,
    pub last_scan_at: Option<String>,
    pub game_count: i64,
    /// Le dossier est-il accessible en ce moment (disque branché…) ?
    pub available: bool,
}

const FOLDER_SELECT: &str = "SELECT f.id, f.path, f.platform_id, f.recursive, f.enabled, f.added_at, f.last_scan_at,
        (SELECT count(DISTINCT gf.game_id) FROM game_files gf WHERE gf.folder_id = f.id)
     FROM folders f";

fn folder_from_row(r: &rusqlite::Row) -> rusqlite::Result<Folder> {
    let path: String = r.get(1)?;
    Ok(Folder {
        id: r.get(0)?,
        available: Path::new(&path).is_dir(),
        path,
        platform_id: r.get(2)?,
        recursive: r.get(3)?,
        enabled: r.get(4)?,
        added_at: r.get(5)?,
        last_scan_at: r.get(6)?,
        game_count: r.get(7)?,
    })
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>> {
    let mut stmt = conn.prepare(&format!("{FOLDER_SELECT} ORDER BY f.path COLLATE NOCASE"))?;
    let rows = stmt.query_map([], folder_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn get_folder(conn: &Connection, id: i64) -> Result<Folder> {
    conn.query_row(&format!("{FOLDER_SELECT} WHERE f.id = ?1"), [id], folder_from_row)
        .optional()?
        .ok_or(LibraryError::NotFound)
}

fn check_platform(platform_id: Option<&str>) -> Result<()> {
    match platform_id {
        Some(p) if !formats::table().iter().any(|(id, _)| id == p) => Err(LibraryError::UnknownPlatform(p.into())),
        _ => Ok(()),
    }
}

/// Forme d'affichage stable d'un chemin Windows (sans préfixe « \\?\ », sans séparateur final).
pub fn display_path(path: &Path) -> String {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let s = canonical.to_string_lossy().to_string();
    let s = s.strip_prefix(r"\\?\UNC\").map(|r| format!(r"\\{r}")).unwrap_or(s);
    let s = s.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(s);
    let trimmed = s.trim_end_matches(['\\', '/']);
    // conserve « D:\ » pour une racine de disque
    if trimmed.ends_with(':') { format!("{trimmed}\\") } else { trimmed.to_string() }
}

pub fn add_folder(conn: &Connection, path: &str, platform_id: Option<&str>) -> Result<Folder> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err(LibraryError::FolderNotFound(path.into()));
    }
    check_platform(platform_id)?;
    let shown = display_path(p);
    let key = path_key(&shown);

    for existing in list_folders(conn)? {
        let other = path_key(&existing.path);
        if key == other || key.starts_with(&format!("{other}/")) {
            return Err(LibraryError::AlreadyIncluded(existing.path));
        }
        if other.starts_with(&format!("{key}/")) {
            return Err(LibraryError::ContainsExisting(existing.path));
        }
    }
    conn.execute(
        "INSERT INTO folders (path, platform_id, added_at) VALUES (?1, ?2, ?3)",
        params![shown, platform_id, now_iso()],
    )?;
    get_folder(conn, conn.last_insert_rowid())
}

/// Modifie la console associée et/ou l'activation. Changer de console force
/// une ré-identification complète du dossier au prochain scan.
pub fn update_folder(conn: &Connection, id: i64, platform_id: Option<&str>, enabled: bool) -> Result<Folder> {
    check_platform(platform_id)?;
    let current = get_folder(conn, id)?;
    let platform_changed = current.platform_id.as_deref() != platform_id;
    conn.execute(
        "UPDATE folders SET platform_id = ?2, enabled = ?3,
            last_scan_at = CASE WHEN ?4 THEN NULL ELSE last_scan_at END
         WHERE id = ?1",
        params![id, platform_id, enabled, platform_changed],
    )?;
    get_folder(conn, id)
}

/// Retire un dossier de la collection. Les jeux qu'il contenait sont retirés
/// de la base — aucun fichier n'est touché sur le disque.
pub fn remove_folder(conn: &mut Connection, id: i64) -> Result<()> {
    get_folder(conn, id)?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM game_files WHERE folder_id = ?1", [id])?;
    tx.execute("DELETE FROM games WHERE id NOT IN (SELECT game_id FROM game_files)", [])?;
    tx.execute("DELETE FROM folders WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Retire de la collection un jeu dont le fichier est introuvable (déplacé,
/// supprimé, disque débranché). Base uniquement : aucun fichier n'est touché.
/// Refusé si le fichier principal est encore présent.
pub fn remove_missing_game(conn: &mut Connection, id: i64) -> Result<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM game_files WHERE game_id = ?1 AND role = 'main' AND status = 'present'",
        [id],
        |r| r.get(0),
    )?;
    if present > 0 {
        return Err(LibraryError::Media("Ce jeu est toujours présent sur le disque : il ne peut pas être retiré ici.".into()));
    }
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM game_files WHERE game_id = ?1", [id])?;
    tx.execute("DELETE FROM games WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

// ——— Jeux ———

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRow {
    pub id: i64,
    pub platform_id: String,
    pub title: String,
    pub serial: Option<String>,
    pub region: Option<String>,
    pub year: Option<i64>,
    pub publisher: Option<String>,
    pub developer: Option<String>,
    pub genre: Option<String>,
    pub players: Option<String>,
    pub description: Option<String>,
    pub favorite: bool,
    pub added_at: String,
    pub last_played_at: Option<String>,
    pub id_method: String,
    pub id_confidence: f64,
    pub alternatives: Vec<String>,
    pub user_locked: bool,
    pub file_path: String,
    pub file_size: i64,
    /// « present » ou « missing ».
    pub status: String,
    /// Un autre fichier présent a exactement le même contenu.
    pub duplicate: bool,
    pub disc_count: i64,
    pub folder_id: Option<i64>,
    /// Images en cache (type, emplacement, source, dimensions, date).
    pub media: serde_json::Value,
    /// NULL : jamais cherché · found · ambiguous · none
    pub media_status: Option<String>,
    pub meta_source: Option<String>,
    /// Émulateur propre à ce jeu (sinon celui de la console).
    pub emulator_id: Option<i64>,
    pub play_count: i64,
    pub play_seconds: i64,
    /// Jeux PC : installations connues (source, lancement, statut).
    pub pc_installs: serde_json::Value,
    /// Version regroupée sous une autre fiche (régions, révisions, doublons).
    pub variant_of: Option<i64>,
}

pub fn list_games(conn: &Connection) -> Result<Vec<GameRow>> {
    let sql = format!(
        "SELECT g.id, g.platform_id, g.title, g.serial, g.region, g.year, g.publisher, g.developer, g.genre,
                g.players, g.description, g.favorite, g.added_at, g.last_played_at, g.id_method,
                g.id_confidence, g.id_alternatives, g.user_locked,
                m.path, m.size, m.status, m.folder_id,
                EXISTS (SELECT 1 FROM game_files o
                        WHERE o.fingerprint = m.fingerprint AND o.id <> m.id
                          AND o.role = 'main' AND o.status = 'present' AND m.status = 'present'),
                (SELECT count(*) FROM game_files d WHERE d.game_id = g.id AND d.role = 'disc'),
                (SELECT json_group_array(json_object('kind', kind, 'slot', slot, 'source', source,
                                                     'width', width, 'height', height, 'addedAt', added_at))
                   FROM media WHERE game_id = g.id),
                g.media_status, g.meta_source, g.emulator_id, g.play_count, g.play_seconds,
                {pc}, g.variant_of
         FROM games g
         JOIN game_files m ON m.game_id = g.id AND m.role = 'main'
         ORDER BY g.sort_title",
        pc = crate::pc::INSTALLS_JSON_SQL
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        let alternatives: Option<String> = r.get(16)?;
        Ok(GameRow {
            id: r.get(0)?,
            platform_id: r.get(1)?,
            title: r.get(2)?,
            serial: r.get(3)?,
            region: r.get(4)?,
            year: r.get(5)?,
            publisher: r.get(6)?,
            developer: r.get(7)?,
            genre: r.get(8)?,
            players: r.get(9)?,
            description: r.get(10)?,
            favorite: r.get(11)?,
            added_at: r.get(12)?,
            last_played_at: r.get(13)?,
            id_method: r.get(14)?,
            id_confidence: r.get(15)?,
            alternatives: alternatives.and_then(|a| serde_json::from_str(&a).ok()).unwrap_or_default(),
            user_locked: r.get(17)?,
            file_path: r.get(18)?,
            file_size: r.get(19)?,
            status: r.get(20)?,
            folder_id: r.get(21)?,
            duplicate: r.get(22)?,
            disc_count: r.get(23)?,
            media: serde_json::from_str(&r.get::<_, String>(24)?).unwrap_or(serde_json::Value::Array(vec![])),
            media_status: r.get(25)?,
            meta_source: r.get(26)?,
            emulator_id: r.get(27)?,
            play_count: r.get(28)?,
            play_seconds: r.get(29)?,
            pc_installs: serde_json::from_str(&r.get::<_, String>(30)?).unwrap_or(serde_json::Value::Array(vec![])),
            variant_of: r.get(31)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Regroupe `other` (et ses propres versions) sous la fiche `keep`, de la même console.
/// Si `keep` est déjà une version, le regroupement se fait sous sa fiche principale.
/// Rien n'est supprimé : chaque version garde son fichier et peut être séparée.
pub fn link_variant(conn: &mut Connection, keep: i64, other: i64) -> Result<i64> {
    let tx = conn.transaction()?;
    let root: i64 = tx
        .query_row("SELECT coalesce(variant_of, id) FROM games WHERE id = ?1", [keep], |r| r.get(0))
        .optional()?
        .ok_or(LibraryError::NotFound)?;
    let platforms: Vec<String> = tx
        .prepare("SELECT platform_id FROM games WHERE id IN (?1, ?2)")?
        .query_map(params![root, other], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    if root == other || platforms.len() != 2 {
        return Err(LibraryError::Media("Choisissez deux jeux distincts.".into()));
    }
    if platforms[0] != platforms[1] {
        return Err(LibraryError::Media("Les deux jeux doivent être sur la même console.".into()));
    }
    if platforms[0] == "pc" {
        return Err(LibraryError::Media("Les jeux PC se regroupent depuis leur fiche (« Regrouper une version »).".into()));
    }
    tx.execute("UPDATE games SET variant_of = ?1 WHERE id = ?2 OR variant_of = ?2", params![root, other])?;
    tx.execute(
        "UPDATE games SET favorite = max(favorite, (SELECT favorite FROM games WHERE id = ?2)) WHERE id = ?1",
        params![root, other],
    )?;
    tx.commit()?;
    Ok(root)
}

/// Sépare une version : elle redevient une fiche à part entière.
pub fn unlink_variant(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute("UPDATE games SET variant_of = NULL WHERE id = ?1 AND variant_of IS NOT NULL", [id])?;
    if n == 0 {
        return Err(LibraryError::NotFound);
    }
    Ok(())
}

/// Choisit la version principale d'un groupe (celle affichée dans la bibliothèque).
pub fn promote_variant(conn: &mut Connection, id: i64) -> Result<()> {
    let tx = conn.transaction()?;
    let root: i64 = tx
        .query_row("SELECT variant_of FROM games WHERE id = ?1 AND variant_of IS NOT NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or(LibraryError::NotFound)?;
    tx.execute("UPDATE games SET variant_of = ?1 WHERE variant_of = ?2 AND id <> ?1", params![id, root])?;
    tx.execute("UPDATE games SET variant_of = ?1 WHERE id = ?2", params![id, root])?;
    tx.execute("UPDATE games SET variant_of = NULL WHERE id = ?1", [id])?;
    tx.execute(
        "UPDATE games SET favorite = max(favorite, (SELECT favorite FROM games WHERE id = ?2)) WHERE id = ?1",
        params![id, root],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn set_favorite(conn: &Connection, id: i64, favorite: bool) -> Result<()> {
    let n = conn.execute("UPDATE games SET favorite = ?2 WHERE id = ?1", params![id, favorite])?;
    if n == 0 {
        return Err(LibraryError::NotFound);
    }
    Ok(())
}

/// Correction manuelle (étape 6 de la reconnaissance). Verrouille le jeu :
/// les scans suivants ne remplaceront plus ces informations.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamePatch {
    pub platform_id: Option<String>,
    pub title: Option<String>,
    /// `Some(None)` efface la région.
    #[serde(default, with = "double_option")]
    pub region: Option<Option<String>>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
        Ok(Some(Option::deserialize(d)?))
    }
}

pub fn update_game(conn: &Connection, id: i64, patch: &GamePatch) -> Result<()> {
    check_platform(patch.platform_id.as_deref())?;
    if let Some(t) = &patch.title {
        if t.trim().is_empty() {
            return Err(LibraryError::EmptyTitle);
        }
    }
    if let Some(Some(r)) = &patch.region {
        if !["PAL", "NTSC-U", "NTSC-J"].contains(&r.as_str()) {
            return Err(LibraryError::InvalidRegion(r.clone()));
        }
    }
    let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM games WHERE id = ?1)", [id], |r| r.get(0))?;
    if !exists {
        return Err(LibraryError::NotFound);
    }
    if let Some(p) = &patch.platform_id {
        conn.execute("UPDATE games SET platform_id = ?2 WHERE id = ?1", params![id, p])?;
    }
    if let Some(t) = &patch.title {
        let t = t.trim();
        conn.execute("UPDATE games SET title = ?2, sort_title = ?3 WHERE id = ?1", params![id, t, sort_title(t)])?;
    }
    if let Some(r) = &patch.region {
        conn.execute("UPDATE games SET region = ?2 WHERE id = ?1", params![id, r])?;
    }
    conn.execute(
        "UPDATE games SET id_method = 'manual', id_confidence = 1.0, id_alternatives = NULL, user_locked = 1
         WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// Clé de tri côté base (l'interface recalcule la sienne, plus complète).
pub fn sort_title(title: &str) -> String {
    let lower = title.trim().to_lowercase();
    let stripped = ["the ", "a ", "an ", "le ", "la ", "les ", "l'", "l’"]
        .iter()
        .find_map(|a| lower.strip_prefix(a))
        .unwrap_or(&lower);
    stripped.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>().trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn dossiers_imbriques_refuses() {
        let tmp = tempfile::tempdir().unwrap();
        let inner = tmp.path().join("GameCube");
        std::fs::create_dir_all(&inner).unwrap();
        let conn = db::open_in_memory().unwrap();

        let f = add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        assert!(f.available);
        assert!(matches!(add_folder(&conn, inner.to_str().unwrap(), None), Err(LibraryError::AlreadyIncluded(_))));
        assert!(matches!(add_folder(&conn, tmp.path().to_str().unwrap(), None), Err(LibraryError::AlreadyIncluded(_))));

        let conn2 = db::open_in_memory().unwrap();
        add_folder(&conn2, inner.to_str().unwrap(), Some("gamecube")).unwrap();
        assert!(matches!(add_folder(&conn2, tmp.path().to_str().unwrap(), None), Err(LibraryError::ContainsExisting(_))));
    }

    #[test]
    fn dossier_absent_ou_console_inconnue() {
        let conn = db::open_in_memory().unwrap();
        assert!(matches!(add_folder(&conn, "Z:/n/existe/pas", None), Err(LibraryError::FolderNotFound(_))));
        let tmp = tempfile::tempdir().unwrap();
        assert!(matches!(
            add_folder(&conn, tmp.path().to_str().unwrap(), Some("virtualboy")),
            Err(LibraryError::UnknownPlatform(_))
        ));
    }

    #[test]
    fn changer_de_console_force_une_reidentification() {
        let tmp = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory().unwrap();
        let f = add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        conn.execute("UPDATE folders SET last_scan_at = 'x' WHERE id = ?1", [f.id]).unwrap();
        let same = update_folder(&conn, f.id, None, false).unwrap();
        assert_eq!((same.last_scan_at.as_deref(), same.enabled), (Some("x"), false));
        let changed = update_folder(&conn, f.id, Some("ps2"), true).unwrap();
        assert_eq!(changed.last_scan_at, None);
    }

    #[test]
    fn cle_de_tri() {
        assert_eq!(sort_title("The Legend of Zelda"), "legend of zelda");
        assert_eq!(sort_title("L'Odyssée"), "odyssée");
    }
}

#[cfg(test)]
mod retrait_tests {
    use super::*;

    #[test]
    fn versions_regroupees_puis_separees() {
        let mut conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence, favorite) VALUES
               (1, 'wii', 'Zelda (Europe)', 'zelda', '2026-01-01', 'filename', 1, 0),
               (2, 'wii', 'Zelda (USA)', 'zelda', '2026-01-01', 'filename', 1, 1),
               (3, 'wii', 'Zelda (Japan)', 'zelda', '2026-01-01', 'filename', 1, 0),
               (4, 'gamecube', 'Autre', 'autre', '2026-01-01', 'filename', 1, 0);",
        )
        .unwrap();
        let parent = |c: &Connection, id: i64| -> Option<i64> {
            c.query_row("SELECT variant_of FROM games WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert_eq!(link_variant(&mut conn, 1, 2).unwrap(), 1);
        assert_eq!(parent(&conn, 2), Some(1));
        // favori repris par la fiche principale
        let fav: bool = conn.query_row("SELECT favorite FROM games WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert!(fav);
        // regrouper sous une version remonte à la fiche principale
        assert_eq!(link_variant(&mut conn, 2, 3).unwrap(), 1);
        assert_eq!(parent(&conn, 3), Some(1));
        assert!(link_variant(&mut conn, 1, 4).is_err(), "consoles différentes");
        assert!(link_variant(&mut conn, 1, 1).is_err());
        // la version 3 devient principale : 1 et 2 passent dessous
        promote_variant(&mut conn, 3).unwrap();
        assert_eq!((parent(&conn, 1), parent(&conn, 2), parent(&conn, 3)), (Some(3), Some(3), None));
        unlink_variant(&conn, 2).unwrap();
        assert_eq!(parent(&conn, 2), None);
        assert!(unlink_variant(&conn, 2).is_err());
        // supprimer la fiche principale libère ses versions
        conn.execute("DELETE FROM games WHERE id = 3", []).unwrap();
        assert_eq!(parent(&conn, 1), None);
    }

    #[test]
    fn retrait_seulement_si_introuvable() {
        let mut conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO folders (id, path, enabled, added_at) VALUES (1, 'D:/Jeux', 1, '2026-01-01');
             INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (1, 'wii', 'A', 'a', '2026-01-01', 'filename', 1);
             INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (2, 'wii', 'B', 'b', '2026-01-01', 'filename', 1);",
        )
        .unwrap();
        for (id, g, status) in [(1, 1, "present"), (2, 2, "missing")] {
            conn.execute(
                "INSERT INTO game_files (id, game_id, folder_id, path, role, size, status, last_seen_at) VALUES (?1, ?2, 1, ?3, 'main', 1, ?4, '2026-01-01')",
                params![id, g, format!("D:/Jeux/{g}.iso"), status],
            )
            .unwrap();
        }
        assert!(remove_missing_game(&mut conn, 1).is_err());
        remove_missing_game(&mut conn, 2).unwrap();
        let left: Vec<i64> = conn.prepare("SELECT id FROM games").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(left, vec![1]);
    }
}
