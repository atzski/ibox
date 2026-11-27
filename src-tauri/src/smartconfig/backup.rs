//! Écritures sûres, sauvegardes et journal des optimisations.
//!
//! Garanties :
//! - une cible n'est écrite que si elle se trouve exactement dans le dossier
//!   autorisé par l'adaptateur (chemins canoniques comparés, aucun lien
//!   symbolique ni jonction, extension `.ini`, `.yml` ou `.cfg` seulement,
//!   taille bornée) ;
//! - l'état d'origine (contenu ou absence du fichier) est sauvegardé et son
//!   empreinte SHA-256 enregistrée *avant* l'écriture (journal `pending`) ;
//! - l'écriture est atomique (fichier temporaire + renommage) ;
//! - au démarrage, une entrée restée `pending` (crash, coupure) est résolue
//!   en comparant les empreintes ;
//! - une restauration refuse d'écraser une modification manuelle survenue
//!   depuis l'application, sauf confirmation explicite.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Component, Path, PathBuf};

use super::ini::MAX_INI_BYTES;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum BackupError {
    #[error("Emplacement refusé : {0}")]
    Forbidden(String),
    #[error("Le fichier a été modifié depuis la dernière optimisation (par vous ou par l'émulateur). Confirmez pour l'écraser.")]
    ManualChanges,
    #[error("Sauvegarde endommagée : restauration annulée pour ne rien abîmer.")]
    CorruptBackup,
    #[error("Seule la dernière optimisation de ce fichier peut être annulée ; annulez d'abord les plus récentes.")]
    NotLatest,
    #[error("{0}")]
    Io(String),
    #[error("Erreur de base de données : {0}")]
    Db(String),
}

impl From<rusqlite::Error> for BackupError {
    fn from(e: rusqlite::Error) -> Self {
        BackupError::Db(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, BackupError>;

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn io(e: std::io::Error) -> BackupError {
    BackupError::Io(e.to_string())
}

fn is_link(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

/// Vérifie qu'`target` est un fichier `.ini` situé directement dans `dir`,
/// lui-même dans `root`, sans lien ni jonction, et renvoie son chemin sûr.
/// Crée `dir` s'il manque (uniquement sous `root`).
pub fn guard_target(root: &Path, dir: &Path, target: &Path) -> Result<PathBuf> {
    let forbid = |m: &str| Err(BackupError::Forbidden(m.into()));
    if !target.extension().and_then(|e| e.to_str()).is_some_and(|e| ["ini", "yml", "cfg"].iter().any(|x| e.eq_ignore_ascii_case(x))) {
        return forbid("seuls les fichiers de réglages .ini, .yml ou .cfg peuvent être modifiés");
    }
    if target.parent() != Some(dir) {
        return forbid("fichier hors du dossier de réglages par jeu");
    }
    let rel = dir.strip_prefix(root).map_err(|_| BackupError::Forbidden("dossier hors de la configuration de l'émulateur".into()))?;
    if rel.components().any(|c| !matches!(c, Component::Normal(_))) || target.file_name().is_none_or(|n| n.to_string_lossy().contains(['/', '\\', ':'])) {
        return forbid("chemin relatif interdit");
    }
    if !root.is_dir() || is_link(root) {
        return forbid("dossier de configuration de l'émulateur introuvable");
    }
    let canon_root = fs::canonicalize(root).map_err(io)?;
    // chaque niveau intermédiaire : ni lien ni jonction
    let mut cur = root.to_path_buf();
    for c in rel.components() {
        cur.push(c);
        if is_link(&cur) {
            return forbid("lien symbolique dans le chemin");
        }
        if !cur.exists() {
            fs::create_dir(&cur).map_err(io)?;
        }
    }
    let canon_dir = fs::canonicalize(dir).map_err(io)?;
    if !canon_dir.starts_with(&canon_root) {
        return forbid("le dossier sort de la configuration de l'émulateur");
    }
    let safe = canon_dir.join(target.file_name().unwrap_or_default());
    if let Ok(m) = fs::symlink_metadata(&safe) {
        if m.file_type().is_symlink() || !m.is_file() {
            return forbid("la cible n'est pas un fichier ordinaire");
        }
        if m.len() as usize > MAX_INI_BYTES {
            return forbid("fichier de réglages trop volumineux");
        }
    }
    Ok(safe)
}

/// Contenu actuel (`None` = absent).
pub fn read_current(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(b) if b.len() > MAX_INI_BYTES => Err(BackupError::Forbidden("fichier de réglages trop volumineux".into())),
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(e)),
    }
}

/// Écriture atomique : fichier temporaire voisin, synchronisé, puis renommé.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.ibox-tmp"));
    let res = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res.map_err(io)
}

/// Une entrée du journal des optimisations.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub game_id: i64,
    pub adapter: String,
    pub emulator_version: Option<String>,
    pub target: String,
    pub source: String,
    pub source_ref: String,
    pub mode: Option<String>,
    /// JSON : liste des changements (clé, libellé, avant, après).
    pub changes: String,
    pub before_sha: Option<String>,
    pub after_sha: String,
    pub status: String,
    pub created_at: String,
    pub restored_at: Option<String>,
}

pub struct NewEntry<'a> {
    pub game_id: i64,
    pub adapter: &'a str,
    pub emulator_version: Option<&'a str>,
    pub source: &'a str,
    pub source_ref: &'a str,
    pub mode: Option<&'a str>,
    pub profile_json: &'a str,
    pub changes_json: &'a str,
}

const COLS: &str = "id, game_id, adapter, emulator_version, target, source, source_ref, mode, changes, before_sha, after_sha, status, created_at, restored_at";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Entry> {
    Ok(Entry {
        id: r.get(0)?,
        game_id: r.get(1)?,
        adapter: r.get(2)?,
        emulator_version: r.get(3)?,
        target: r.get(4)?,
        source: r.get(5)?,
        source_ref: r.get(6)?,
        mode: r.get(7)?,
        changes: r.get(8)?,
        before_sha: r.get(9)?,
        after_sha: r.get(10)?,
        status: r.get(11)?,
        created_at: r.get(12)?,
        restored_at: r.get(13)?,
    })
}

/// Dernière application encore active sur ce fichier.
pub fn latest_active(conn: &Connection, target: &Path) -> Result<Option<Entry>> {
    Ok(conn
        .query_row(&format!("SELECT {COLS} FROM sc_applications WHERE target = ?1 AND status = 'applied' ORDER BY id DESC LIMIT 1"), [target.to_string_lossy()], row)
        .optional()?)
}

pub fn history(conn: &Connection, game_id: Option<i64>, limit: u32) -> Result<Vec<Entry>> {
    let mut st = conn.prepare(&format!("SELECT {COLS} FROM sc_applications WHERE (?1 IS NULL OR game_id = ?1) ORDER BY id DESC LIMIT ?2"))?;
    let rows = st.query_map(params![game_id, limit], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn entry(conn: &Connection, id: i64) -> Result<Option<Entry>> {
    Ok(conn.query_row(&format!("SELECT {COLS} FROM sc_applications WHERE id = ?1"), [id], row).optional()?)
}

/// Applique `after` sur `target` avec sauvegarde et journal. `force` : écraser
/// des modifications manuelles survenues depuis la dernière optimisation.
pub fn apply(conn: &Connection, backups: &Path, target: &Path, after: &[u8], e: &NewEntry, force: bool) -> Result<i64> {
    let before = read_current(target)?;
    let before_sha = before.as_deref().map(sha256);
    if let Some(last) = latest_active(conn, target)? {
        if before_sha.as_deref() != Some(last.after_sha.as_str()) && !force {
            return Err(BackupError::ManualChanges);
        }
    }
    let after_sha = sha256(after);
    fs::create_dir_all(backups).map_err(io)?;
    let now = crate::library::now_iso();
    conn.execute(
        "INSERT INTO sc_applications (game_id, adapter, emulator_version, target, source, source_ref, mode, profile, changes, before_sha, after_sha, backup_file, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, 'pending', ?12)",
        params![e.game_id, e.adapter, e.emulator_version, target.to_string_lossy(), e.source, e.source_ref, e.mode, e.profile_json, e.changes_json, before_sha, after_sha, now],
    )?;
    let id = conn.last_insert_rowid();
    if let Some(b) = &before {
        let file = backups.join(format!("{id}-{}.ini.bak", &before_sha.as_deref().unwrap_or_default()[..12]));
        atomic_write(&file, b)?;
        conn.execute("UPDATE sc_applications SET backup_file = ?2 WHERE id = ?1", params![id, file.to_string_lossy()])?;
    }
    match atomic_write(target, after) {
        Ok(()) => {
            // vérification : relu à l'identique
            let ok = read_current(target)?.as_deref().map(sha256) == Some(after_sha.clone());
            let status = if ok { "applied" } else { "failed" };
            conn.execute("UPDATE sc_applications SET status = ?2 WHERE id = ?1", params![id, status])?;
            if !ok {
                restore_bytes(target, before.as_deref())?;
                return Err(BackupError::Io("vérification après écriture échouée : état précédent rétabli".into()));
            }
            Ok(id)
        }
        Err(err) => {
            conn.execute("UPDATE sc_applications SET status = 'failed' WHERE id = ?1", [id])?;
            Err(err)
        }
    }
}

fn restore_bytes(target: &Path, before: Option<&[u8]>) -> Result<()> {
    match before {
        Some(b) => atomic_write(target, b),
        None => match fs::remove_file(target) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(io(e)),
            _ => Ok(()),
        },
    }
}

/// Annule l'application `id` (la plus récente encore active sur son fichier).
pub fn restore(conn: &Connection, id: i64, force: bool) -> Result<()> {
    let (target, before_sha, after_sha, backup_file, status): (String, Option<String>, String, Option<String>, String) = conn
        .query_row("SELECT target, before_sha, after_sha, backup_file, status FROM sc_applications WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .optional()?
        .ok_or_else(|| BackupError::Io("optimisation introuvable".into()))?;
    if status != "applied" {
        return Err(BackupError::Io("cette optimisation n'est plus active".into()));
    }
    if is_sheet(&target) {
        return Err(BackupError::Forbidden("fiche de réglages : rien n'a été écrit, retirez la fiche".into()));
    }
    let target = PathBuf::from(target);
    if latest_active(conn, &target)?.map(|e| e.id) != Some(id) {
        return Err(BackupError::NotLatest);
    }
    let current = read_current(&target)?;
    if current.as_deref().map(sha256).as_deref() != Some(after_sha.as_str()) && !force {
        return Err(BackupError::ManualChanges);
    }
    let before = match (&before_sha, &backup_file) {
        (None, _) => None,
        (Some(sha), Some(file)) => {
            let b = fs::read(file).map_err(|_| BackupError::CorruptBackup)?;
            if &sha256(&b) != sha {
                return Err(BackupError::CorruptBackup);
            }
            Some(b)
        }
        (Some(_), None) => return Err(BackupError::CorruptBackup),
    };
    restore_bytes(&target, before.as_deref())?;
    conn.execute("UPDATE sc_applications SET status = 'restored', restored_at = ?2 WHERE id = ?1", params![id, crate::library::now_iso()])?;
    Ok(())
}

/// Au démarrage : résout les entrées interrompues (`pending`).
/// Renvoie le nombre d'entrées marquées `conflict` (à signaler).
pub fn recover(conn: &Connection) -> Result<usize> {
    let pending: Vec<(i64, String, Option<String>, String)> = conn
        .prepare("SELECT id, target, before_sha, after_sha FROM sc_applications WHERE status = 'pending'")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let mut conflicts = 0;
    for (id, target, before_sha, after_sha) in pending {
        let target = PathBuf::from(&target);
        let _ = fs::remove_file(target.with_file_name(format!(".{}.ibox-tmp", target.file_name().unwrap_or_default().to_string_lossy())));
        let cur = read_current(&target).ok().flatten().map(|b| sha256(&b));
        let status = if cur.as_deref() == Some(after_sha.as_str()) {
            "applied"
        } else if cur == before_sha {
            "failed"
        } else {
            conflicts += 1;
            "conflict"
        };
        conn.execute("UPDATE sc_applications SET status = ?2 WHERE id = ?1", params![id, status])?;
    }
    Ok(conflicts)
}

/// Préfixe des cibles de fiches manuelles (aucun fichier : `android-sheet:<émulateur>:<jeu>`).
pub const SHEET_PREFIX: &str = "android-sheet:";

pub fn is_sheet(target: &str) -> bool {
    target.starts_with(SHEET_PREFIX)
}

/// Fiche à appliquer à la main (émulateurs Android autonomes) : rien n'est écrit sur le disque.
/// L'entrée, active (`applied`) et de cible `android-sheet:…` (le schéma 015 n'admet pas d'autre
/// statut), garde la liste des réglages et ce qui est fait (`changes`). Une seule fiche active
/// par cible : la précédente est retirée.
pub fn record_manual(conn: &Connection, target: &str, e: &NewEntry) -> Result<i64> {
    if !is_sheet(target) {
        return Err(BackupError::Forbidden("cible de fiche invalide".into()));
    }
    let now = crate::library::now_iso();
    conn.execute("UPDATE sc_applications SET status = 'restored', restored_at = ?2 WHERE target = ?1 AND status = 'applied'", params![target, now])?;
    conn.execute(
        "INSERT INTO sc_applications (game_id, adapter, emulator_version, target, source, source_ref, mode, profile, changes, before_sha, after_sha, backup_file, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, NULL, 'applied', ?11)",
        params![e.game_id, e.adapter, e.emulator_version, target, e.source, e.source_ref, e.mode, e.profile_json, e.changes_json, sha256(e.changes_json.as_bytes()), now],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Coche ou décoche des réglages d'une fiche active.
pub fn update_manual(conn: &Connection, id: i64, changes_json: &str) -> Result<()> {
    let n = conn.execute("UPDATE sc_applications SET changes = ?2, after_sha = ?3 WHERE id = ?1 AND status = 'applied' AND target LIKE 'android-sheet:%'", params![id, changes_json, sha256(changes_json.as_bytes())])?;
    if n == 0 {
        return Err(BackupError::NotLatest);
    }
    Ok(())
}

/// Retire une fiche (« retour arrière » : l'interface rappelle les réglages à remettre).
pub fn withdraw_manual(conn: &Connection, id: i64) -> Result<()> {
    let n = conn.execute("UPDATE sc_applications SET status = 'restored', restored_at = ?2 WHERE id = ?1 AND status = 'applied' AND target LIKE 'android-sheet:%'", params![id, crate::library::now_iso()])?;
    if n == 0 {
        return Err(BackupError::NotLatest);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fiche_manuelle_journalisee() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch("INSERT INTO games (id, platform_id, title, sort_title, id_method, id_confidence, added_at) VALUES (1, 'ps2', 'Jeu', 'jeu', 'header', 1, 'x')").unwrap();
        let e = NewEntry { game_id: 1, adapter: "android.nethersx2", emulator_version: None, source: "emuready", source_ref: "r1", mode: None, profile_json: "{}", changes_json: "[]" };
        let a = record_manual(&conn, "android-sheet:android.nethersx2:1", &e).unwrap();
        update_manual(&conn, a, r#"[{"key":"sheet.x","label":"X","before":null,"after":"2x","done":true}]"#).unwrap();
        assert!(entry(&conn, a).unwrap().unwrap().changes.contains("\"done\":true"));
        // une nouvelle fiche remplace la précédente ; retrait possible une seule fois
        let b = record_manual(&conn, "android-sheet:android.nethersx2:1", &e).unwrap();
        assert_eq!(entry(&conn, a).unwrap().unwrap().status, "restored");
        assert_eq!(update_manual(&conn, a, "[]"), Err(BackupError::NotLatest));
        withdraw_manual(&conn, b).unwrap();
        assert_eq!(withdraw_manual(&conn, b), Err(BackupError::NotLatest));
        // jamais touchée par la reprise au démarrage, jamais « restaurée » comme un fichier
        assert_eq!(recover(&conn).unwrap(), 0);
        let c = record_manual(&conn, "android-sheet:android.nethersx2:1", &e).unwrap();
        assert!(matches!(restore(&conn, c, false), Err(BackupError::Forbidden(_))));
        assert!(record_manual(&conn, "/tmp/x.ini", &e).is_err());
    }

    fn setup() -> (tempfile::TempDir, Connection, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch("INSERT INTO games (id, platform_id, title, sort_title, id_method, id_confidence, added_at) VALUES (1, 'gamecube', 'Jeu', 'jeu', 'header', 1, 'x')").unwrap();
        let root = tmp.path().join("User");
        fs::create_dir_all(&root).unwrap();
        let dir = root.join("GameSettings");
        (tmp, conn, root, dir)
    }

    fn entry_for<'a>() -> NewEntry<'a> {
        NewEntry { game_id: 1, adapter: "dolphin", emulator_version: Some("2509"), source: "emuready", source_ref: "abc", mode: Some("balanced"), profile_json: "{}", changes_json: "[]" }
    }

    #[test]
    fn chemins_interdits() {
        let (tmp, _c, root, dir) = setup();
        assert!(guard_target(&root, &dir, &dir.join("GMSE01.ini")).is_ok());
        assert!(dir.is_dir());
        // traversée, autre extension, autre dossier
        assert!(guard_target(&root, &dir, &dir.join("..").join("Dolphin.ini")).is_err());
        assert!(guard_target(&root, &dir, &dir.join("GMSE01.iso")).is_err());
        assert!(guard_target(&root, &root.join("Wii"), &root.join("Wii").join("x.ini")).is_ok());
        assert!(guard_target(&root, &tmp.path().join("ailleurs"), &tmp.path().join("ailleurs").join("x.ini")).is_err());
        assert!(guard_target(&root, &root.join("..").join("x"), &root.join("..").join("x").join("a.ini")).is_err());
        // cible qui est un dossier
        fs::create_dir_all(dir.join("D.ini")).unwrap();
        assert!(guard_target(&root, &dir, &dir.join("D.ini")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn jonction_refusee() {
        let (tmp, _c, root, _dir) = setup();
        let outside = tmp.path().join("dehors");
        fs::create_dir_all(&outside).unwrap();
        let link = root.join("GameSettings");
        // jonction (pas de privilège requis) ; ignore le test si mklink indisponible
        let ok = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&link).arg(&outside).output().map(|o| o.status.success()).unwrap_or(false);
        if ok {
            assert!(guard_target(&root, &link, &link.join("GMSE01.ini")).is_err());
        }
    }

    #[test]
    fn application_restauration_et_conflits() {
        let (_tmp, conn, root, dir) = setup();
        let backups = root.parent().unwrap().join("backups");
        let target = guard_target(&root, &dir, &dir.join("GMSE01.ini")).unwrap();
        fs::write(&target, b"[Core]\r\nCPUThread = True\r\n").unwrap();
        let id = apply(&conn, &backups, &target, b"[Core]\r\nCPUThread = False\r\n", &entry_for(), false).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"[Core]\r\nCPUThread = False\r\n");
        // modification manuelle depuis : nouvelle application et restauration refusées
        fs::write(&target, b"[Core]\r\nCPUThread = False\r\n; moi\r\n").unwrap();
        assert_eq!(apply(&conn, &backups, &target, b"x", &entry_for(), false), Err(BackupError::ManualChanges));
        assert_eq!(restore(&conn, id, false), Err(BackupError::ManualChanges));
        restore(&conn, id, true).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"[Core]\r\nCPUThread = True\r\n");
        assert_eq!(entry(&conn, id).unwrap().unwrap().status, "restored");
    }

    #[test]
    fn fichier_absent_puis_supprime_a_la_restauration() {
        let (_tmp, conn, root, dir) = setup();
        let target = guard_target(&root, &dir, &dir.join("GALE01.ini")).unwrap();
        let backups = root.join("..").join("b");
        let a = apply(&conn, &backups, &target, b"[Core]\r\nDSPHLE = True\r\n", &entry_for(), false).unwrap();
        let b = apply(&conn, &backups, &target, b"[Core]\r\nDSPHLE = False\r\n", &entry_for(), false).unwrap();
        assert_eq!(restore(&conn, a, false), Err(BackupError::NotLatest));
        restore(&conn, b, false).unwrap();
        restore(&conn, a, false).unwrap();
        assert!(!target.exists());
        assert_eq!(history(&conn, Some(1), 10).unwrap().len(), 2);
    }

    #[test]
    fn sauvegarde_alteree_refusee() {
        let (_tmp, conn, root, dir) = setup();
        let target = guard_target(&root, &dir, &dir.join("GMSE01.ini")).unwrap();
        fs::write(&target, b"[Core]\r\n").unwrap();
        let backups = root.join("..").join("b");
        let id = apply(&conn, &backups, &target, b"[Core]\r\nCPUThread = False\r\n", &entry_for(), false).unwrap();
        let file: String = conn.query_row("SELECT backup_file FROM sc_applications WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        fs::write(&file, b"altere").unwrap();
        assert_eq!(restore(&conn, id, false), Err(BackupError::CorruptBackup));
        assert_eq!(fs::read(&target).unwrap(), b"[Core]\r\nCPUThread = False\r\n");
    }

    #[test]
    fn reprise_apres_interruption() {
        let (_tmp, conn, root, dir) = setup();
        let target = guard_target(&root, &dir, &dir.join("GMSE01.ini")).unwrap();
        fs::write(&target, b"nouveau").unwrap();
        let ins = |before: Option<&str>, after: &str| {
            conn.execute(
                "INSERT INTO sc_applications (game_id, adapter, target, source, source_ref, profile, changes, before_sha, after_sha, status, created_at) VALUES (1, 'dolphin', ?1, 'emuready', 'r', '{}', '[]', ?2, ?3, 'pending', 'x')",
                params![target.to_string_lossy(), before, after],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let done = ins(None, &sha256(b"nouveau"));
        let fail = ins(Some(&sha256(b"nouveau")), &sha256(b"jamais ecrit"));
        let odd = ins(Some("aa"), "bb");
        assert_eq!(recover(&conn).unwrap(), 1);
        let st = |id| entry(&conn, id).unwrap().unwrap().status;
        assert_eq!((st(done).as_str(), st(fail).as_str(), st(odd).as_str()), ("applied", "failed", "conflict"));
    }
}
