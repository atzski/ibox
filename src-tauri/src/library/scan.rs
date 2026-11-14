//! « Actualiser la collection » : parcours → identification → empreintes →
//! rapprochement → écriture en une seule transaction.
//!
//! - Les empreintes ne sont recalculées que pour les fichiers nouveaux ou modifiés
//!   (taille / date) : un rescan sans changement ne relit presque rien.
//! - Les jeux corrigés à la main (`user_locked`) ne sont jamais ré-identifiés.
//! - Un fichier absent passe en « missing » ; il n'est jamais effacé de la base.
//! - Annulable à tout moment avant l'écriture : rien n'est alors modifié.

use super::{now_iso, repo, LibraryError, Result};
use crate::scanner::{
    self, fingerprint,
    identify::{self, Context, Identification},
    reconcile::{self, path_key, KnownFile, SeenFile},
    walk::{self, Entry, FoundFile},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// « walk » (parcours), « identify » (analyse), « save » (enregistrement).
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub folders: usize,
    pub files: usize,
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub moved: usize,
    pub missing: usize,
    pub reappeared: usize,
    pub duplicates: usize,
    pub needs_review: usize,
    pub errors: Vec<String>,
}

struct ScanFolder {
    id: i64,
    root: PathBuf,
    platform_id: Option<String>,
    /// Console associée modifiée depuis le dernier scan : tout ré-identifier.
    reidentify: bool,
}

struct Item {
    entry: Entry,
    folder: usize,
    fingerprint: Option<String>,
    /// Le fichier principal a changé (taille ou date) depuis le dernier scan.
    changed: bool,
}

#[derive(Clone)]
struct KnownRow {
    id: i64,
    game_id: i64,
    size: i64,
    modified: Option<i64>,
    fingerprint: Option<String>,
    missing: bool,
}

pub fn scan(
    conn: &mut Connection,
    folder_ids: Option<&[i64]>,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(Progress),
) -> Result<ScanSummary> {
    let mut summary = ScanSummary::default();
    let check = || if cancel.load(Ordering::Relaxed) { Err(LibraryError::Cancelled) } else { Ok(()) };

    // 1. Dossiers concernés
    let folders: Vec<ScanFolder> = repo::list_folders(conn)?
        .into_iter()
        .filter(|f| f.enabled && folder_ids.is_none_or(|ids| ids.contains(&f.id)))
        .map(|f| ScanFolder {
            id: f.id,
            root: PathBuf::from(&f.path),
            platform_id: f.platform_id,
            reidentify: f.last_scan_at.is_none(),
        })
        .collect();
    summary.folders = folders.len();

    // 2. Parcours (lecture seule)
    let mut items: Vec<Item> = Vec::new();
    for (fi, folder) in folders.iter().enumerate() {
        check()?;
        on_progress(Progress { phase: "walk", done: fi, total: folders.len(), current: Some(folder.root.display().to_string()) });
        if !folder.root.is_dir() {
            // Disque débranché : ses jeux passeront « introuvables », sans être perdus
            summary.errors.push(format!("Dossier inaccessible : {}", folder.root.display()));
            continue;
        }
        let (files, errors) = walk::collect(&folder.root, true);
        summary.errors.extend(errors.into_iter().map(|e| format!("{} : {}", e.path.display(), e.message)));
        items.extend(
            scanner::accept(walk::group(files))
                .into_iter()
                .map(|entry| Item { entry, folder: fi, fingerprint: None, changed: true }),
        );
    }
    summary.files = items.len();

    // 3. Fichiers déjà connus dans ces dossiers
    let known = load_known(conn, &folders)?;
    let known_by_key: HashMap<String, (String, KnownRow)> =
        known.iter().map(|(path, k)| (path_key(path), (path.clone(), k.clone()))).collect();

    // 4. Empreintes (seulement si nouveau ou modifié)
    let total = items.len();
    let mut last_emit = Instant::now().checked_sub(Duration::from_secs(1)).unwrap_or_else(Instant::now);
    for (i, item) in items.iter_mut().enumerate() {
        check()?;
        let main = &item.entry.main;
        if last_emit.elapsed() >= Duration::from_millis(80) || i + 1 == total {
            on_progress(Progress { phase: "identify", done: i, total, current: file_name(&main.path) });
            last_emit = Instant::now();
        }
        let prev = known_by_key.get(&path_key(&main.path.to_string_lossy())).map(|(_, k)| k);
        let same = prev.is_some_and(|k| k.size == main.size as i64 && k.modified == main.modified && k.fingerprint.is_some());
        if same {
            item.fingerprint = prev.and_then(|k| k.fingerprint.clone());
            item.changed = false;
        } else {
            match fingerprint::fingerprint(&main.path) {
                Ok(fp) => item.fingerprint = Some(fp),
                Err(e) => summary.errors.push(format!("{} : {e}", main.path.display())),
            }
        }
    }

    // 5. Rapprochement
    let known_list: Vec<KnownFile> = known
        .iter()
        .map(|(path, k)| KnownFile { id: k.id, path: path.clone(), fingerprint: k.fingerprint.clone(), missing: k.missing })
        .collect();
    let seen: Vec<SeenFile> = items
        .iter()
        .map(|it| SeenFile { path: it.entry.main.path.to_string_lossy().to_string(), fingerprint: it.fingerprint.clone() })
        .collect();
    let plan = reconcile::reconcile(&known_list, &seen);
    let known_by_id: HashMap<i64, &KnownRow> = known.iter().map(|(_, k)| (k.id, k)).collect();
    check()?;

    // 6. Écriture atomique
    on_progress(Progress { phase: "save", done: 0, total: 1, current: None });
    let now = now_iso();
    let tx = conn.transaction()?;

    let matched: Vec<(i64, usize)> = seen
        .iter()
        .enumerate()
        .filter_map(|(i, s)| known_by_key.get(&path_key(&s.path)).map(|(_, k)| (k.id, i)))
        .collect();
    for (file_id, i) in matched {
        let k = known_by_id[&file_id];
        let item = &items[i];
        let folder = &folders[item.folder];
        update_main_file(&tx, file_id, item, folder.id, &now)?;
        replace_parts(&tx, k.game_id, item, folder.id, &now)?;
        if k.missing {
            summary.reappeared += 1;
        }
        if item.changed || folder.reidentify {
            if reidentify(&tx, k.game_id, item, folder)? {
                summary.updated += 1;
            }
        } else if !k.missing {
            summary.unchanged += 1;
        }
    }
    for &(file_id, i) in &plan.moved {
        let k = known_by_id[&file_id];
        let item = &items[i];
        let folder = &folders[item.folder];
        tx.execute(
            "UPDATE game_files SET path = ?2 WHERE id = ?1",
            params![file_id, item.entry.main.path.to_string_lossy()],
        )?;
        update_main_file(&tx, file_id, item, folder.id, &now)?;
        replace_parts(&tx, k.game_id, item, folder.id, &now)?;
        summary.moved += 1;
    }
    for &i in &plan.added {
        let item = &items[i];
        let folder = &folders[item.folder];
        if let Some(id) = identify_item(item, folder) {
            if id.needs_review() {
                summary.needs_review += 1;
            }
            insert_game(&tx, &id, item, folder.id, &now)?;
            summary.added += 1;
        }
    }
    for &file_id in &plan.missing {
        tx.execute("UPDATE game_files SET status = 'missing' WHERE id = ?1", [file_id])?;
        tx.execute(
            "UPDATE game_files SET status = 'missing' WHERE game_id = ?1 AND role <> 'main'",
            [known_by_id[&file_id].game_id],
        )?;
        summary.missing += 1;
    }
    summary.duplicates = plan.duplicates.len();

    for f in &folders {
        if f.root.is_dir() {
            tx.execute("UPDATE folders SET last_scan_at = ?2 WHERE id = ?1", params![f.id, now])?;
        }
    }
    tx.execute(
        "INSERT INTO scan_runs (started_at, finished_at, added, updated, moved, missing, duplicates, errors)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            now,
            now_iso(),
            summary.added as i64,
            summary.updated as i64,
            summary.moved as i64,
            summary.missing as i64,
            summary.duplicates as i64,
            serde_json::to_string(&summary.errors).unwrap_or_default()
        ],
    )?;
    tx.commit()?;
    on_progress(Progress { phase: "save", done: 1, total: 1, current: None });
    Ok(summary)
}

fn file_name(p: &Path) -> Option<String> {
    p.file_name().map(|n| n.to_string_lossy().to_string())
}

fn load_known(conn: &Connection, folders: &[ScanFolder]) -> Result<Vec<(String, KnownRow)>> {
    let mut out = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT id, game_id, path, size, modified_at, fingerprint, status
         FROM game_files WHERE role = 'main' AND folder_id = ?1",
    )?;
    for f in folders {
        let rows = stmt.query_map([f.id], |r| {
            Ok((
                r.get::<_, String>(2)?,
                KnownRow {
                    id: r.get(0)?,
                    game_id: r.get(1)?,
                    size: r.get(3)?,
                    modified: r.get(4)?,
                    fingerprint: r.get(5)?,
                    missing: r.get::<_, String>(6)? == "missing",
                },
            ))
        })?;
        for row in rows {
            out.push(row?);
        }
    }
    Ok(out)
}

/// Indices de contexte : console du dossier et noms des dossiers parents (du plus proche au plus lointain).
fn identify_item(item: &Item, folder: &ScanFolder) -> Option<Identification> {
    let main = &item.entry.main.path;
    let parents: Vec<String> = main
        .ancestors()
        .skip(1)
        .take(6)
        .filter_map(|a| a.file_name().map(|n| n.to_string_lossy().to_string()))
        .collect();
    let ctx = Context {
        folder_platform: folder.platform_id.as_deref(),
        parent_dirs: parents.iter().map(String::as_str).collect(),
    };
    let header = scanner::read_header(header_target(&item.entry));
    identify::identify(main, header.as_ref(), &ctx)
}

/// Pour une feuille (.m3u, .cue, .ccd, .mds), l'en-tête se lit dans la première image de données.
fn header_target(entry: &Entry) -> &Path {
    let ext = scanner::formats::extension_of(&entry.main.path);
    if matches!(ext.as_deref(), Some(".m3u") | Some(".cue") | Some(".ccd") | Some(".mds")) {
        if let Some(part) = entry.parts.iter().find(|p| {
            matches!(
                scanner::formats::extension_of(&p.path).as_deref(),
                Some(".bin") | Some(".iso") | Some(".img") | Some(".mdf") | Some(".chd")
            )
        }) {
            return &part.path;
        }
    }
    &entry.main.path
}

fn insert_game(tx: &Transaction, id: &Identification, item: &Item, folder_id: i64, now: &str) -> Result<()> {
    tx.execute(
        "INSERT INTO games (platform_id, title, sort_title, serial, region, added_at, id_method, id_confidence, id_alternatives)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            id.platform_id,
            id.title,
            repo::sort_title(&id.title),
            id.serial,
            id.region.map(|r| r.as_str()),
            now,
            id.method.as_str(),
            ((id.confidence as f64) * 100.0).round() / 100.0,
            alternatives_json(id),
        ],
    )?;
    let game_id = tx.last_insert_rowid();
    let main = &item.entry.main;
    tx.execute(
        "INSERT INTO game_files (game_id, folder_id, path, size, modified_at, fingerprint, role, disc_number, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'main', ?7, ?8)",
        params![game_id, folder_id, main.path.to_string_lossy(), main.size as i64, main.modified, item.fingerprint, id.disc, now],
    )?;
    replace_parts(tx, game_id, item, folder_id, now)
}

fn alternatives_json(id: &Identification) -> Option<String> {
    (!id.alternatives.is_empty()).then(|| serde_json::to_string(&id.alternatives).unwrap_or_default())
}

fn update_main_file(tx: &Transaction, file_id: i64, item: &Item, folder_id: i64, now: &str) -> Result<()> {
    let main = &item.entry.main;
    tx.execute(
        "UPDATE game_files SET folder_id = ?2, size = ?3, modified_at = ?4, fingerprint = ?5,
                status = 'present', last_seen_at = ?6
         WHERE id = ?1",
        params![file_id, folder_id, main.size as i64, main.modified, item.fingerprint, now],
    )?;
    Ok(())
}

/// Les fichiers rattachés (pistes, disques) sont réécrits à chaque scan.
fn replace_parts(tx: &Transaction, game_id: i64, item: &Item, folder_id: i64, now: &str) -> Result<()> {
    tx.execute("DELETE FROM game_files WHERE game_id = ?1 AND role <> 'main'", [game_id])?;
    for part in &item.entry.parts {
        let role = part_role(part);
        // Un fichier peut déjà être enregistré ailleurs comme jeu principal : on ne le duplique pas.
        let taken: Option<i64> = tx
            .query_row("SELECT id FROM game_files WHERE path = ?1", [part.path.to_string_lossy()], |r| r.get(0))
            .optional()?;
        if taken.is_some() {
            continue;
        }
        tx.execute(
            "INSERT INTO game_files (game_id, folder_id, path, size, modified_at, role, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![game_id, folder_id, part.path.to_string_lossy(), part.size as i64, part.modified, role, now],
        )?;
    }
    Ok(())
}

fn part_role(part: &FoundFile) -> &'static str {
    match scanner::formats::extension_of(&part.path).as_deref() {
        Some(".cue") | Some(".chd") | Some(".iso") => "disc",
        _ => "track",
    }
}

/// Ré-identifie un jeu existant (fichier modifié ou console du dossier changée),
/// sauf s'il a été corrigé à la main. Renvoie true si quelque chose a changé.
fn reidentify(tx: &Transaction, game_id: i64, item: &Item, folder: &ScanFolder) -> Result<bool> {
    let locked: bool = tx.query_row("SELECT user_locked FROM games WHERE id = ?1", [game_id], |r| r.get(0))?;
    if locked {
        return Ok(false);
    }
    let Some(id) = identify_item(item, folder) else { return Ok(false) };
    let n = tx.execute(
        "UPDATE games SET platform_id = ?2, title = ?3, sort_title = ?4, serial = ?5, region = ?6,
                id_method = ?7, id_confidence = ?8, id_alternatives = ?9
         WHERE id = ?1 AND (platform_id IS NOT ?2 OR title IS NOT ?3 OR serial IS NOT ?5 OR region IS NOT ?6
                            OR id_method IS NOT ?7 OR id_confidence IS NOT ?8)",
        params![
            game_id,
            id.platform_id,
            id.title,
            repo::sort_title(&id.title),
            id.serial,
            id.region.map(|r| r.as_str()),
            id.method.as_str(),
            ((id.confidence as f64) * 100.0).round() / 100.0,
            alternatives_json(&id),
        ],
    )?;
    Ok(n > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::fs;

    fn gc_iso(id: &[u8; 6], title: &str) -> Vec<u8> {
        let mut h = vec![0u8; 0x2000];
        h[..6].copy_from_slice(id);
        h[0x1C..0x20].copy_from_slice(&0xC233_9F3Du32.to_be_bytes());
        h[0x20..0x20 + title.len()].copy_from_slice(title.as_bytes());
        h
    }

    fn run(conn: &mut Connection) -> ScanSummary {
        scan(conn, None, &AtomicBool::new(false), |_| {}).unwrap()
    }

    fn games(conn: &Connection) -> Vec<repo::GameRow> {
        repo::list_games(conn).unwrap()
    }

    #[test]
    fn cycle_complet_ajout_deplacement_doublon_disparition() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        fs::create_dir_all(root.join("GameCube")).unwrap();
        fs::create_dir_all(root.join("GBA")).unwrap();
        fs::write(root.join("GameCube/Zelda (Europe).iso"), gc_iso(b"GZLP01", "ZELDA")).unwrap();
        fs::write(root.join("GBA/Advance Wars (Europe).gba"), b"rom").unwrap();
        fs::write(root.join("notes.txt"), b"pas un jeu").unwrap();

        let mut conn = db::open_in_memory().unwrap();
        repo::add_folder(&conn, root.to_str().unwrap(), None).unwrap();

        // 1er scan : deux jeux
        let s = run(&mut conn);
        assert_eq!((s.added, s.files), (2, 2));
        let g = games(&conn);
        let zelda = g.iter().find(|g| g.title == "Zelda").unwrap();
        assert_eq!((zelda.platform_id.as_str(), zelda.serial.as_deref(), zelda.id_method.as_str()), ("gamecube", Some("GZLP01"), "header"));
        assert_eq!(zelda.region.as_deref(), Some("PAL"));
        repo::set_favorite(&conn, zelda.id, true).unwrap();

        // Rescan sans changement
        let s = run(&mut conn);
        assert_eq!((s.added, s.unchanged, s.missing), (0, 2, 0));

        // Déplacement + renommage : même jeu, favori conservé
        fs::create_dir_all(root.join("Archives")).unwrap();
        fs::rename(root.join("GameCube/Zelda (Europe).iso"), root.join("Archives/Wind Waker.iso")).unwrap();
        let s = run(&mut conn);
        assert_eq!((s.moved, s.added, s.missing), (1, 0, 0));
        let moved = games(&conn).into_iter().find(|g| g.id == zelda.id).unwrap();
        assert!(moved.favorite && moved.file_path.ends_with("Wind Waker.iso"));

        // Doublon
        fs::copy(root.join("Archives/Wind Waker.iso"), root.join("GameCube/copie.iso")).unwrap();
        let s = run(&mut conn);
        assert_eq!((s.added, s.duplicates), (1, 1));
        assert_eq!(games(&conn).iter().filter(|g| g.duplicate).count(), 2);

        // Disparition : marqué introuvable, jamais effacé
        fs::remove_file(root.join("GBA/Advance Wars (Europe).gba")).unwrap();
        let s = run(&mut conn);
        assert_eq!(s.missing, 1);
        let aw = games(&conn).into_iter().find(|g| g.title == "Advance Wars").unwrap();
        assert_eq!(aw.status, "missing");

        // Réapparition
        fs::write(root.join("GBA/Advance Wars (Europe).gba"), b"rom").unwrap();
        let s = run(&mut conn);
        assert_eq!(s.reappeared, 1);
        assert_eq!(games(&conn).iter().filter(|g| g.status == "missing").count(), 0);
    }

    #[test]
    fn correction_manuelle_conservee_et_console_du_dossier_appliquee() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("Okami.iso"), vec![1u8; 4096]).unwrap();
        fs::write(tmp.path().join("Mystere.iso"), vec![2u8; 4096]).unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let folder = repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();

        let s = run(&mut conn);
        assert_eq!(s.needs_review, 2, "un .iso illisible sans indice doit être vérifié");

        let okami = games(&conn).into_iter().find(|g| g.title == "Okami").unwrap();
        repo::update_game(
            &conn,
            okami.id,
            &repo::GamePatch { platform_id: Some("ps2".into()), title: Some("Ōkami".into()), region: Some(Some("PAL".into())) },
        )
        .unwrap();

        // Associer le dossier à la GameCube ré-identifie tout… sauf la correction manuelle
        repo::update_folder(&conn, folder.id, Some("gamecube"), true).unwrap();
        let s = run(&mut conn);
        assert_eq!(s.updated, 1);
        let all = games(&conn);
        let okami = all.iter().find(|g| g.id == okami.id).unwrap();
        assert_eq!((okami.platform_id.as_str(), okami.title.as_str(), okami.id_method.as_str()), ("ps2", "Ōkami", "manual"));
        let mystere = all.iter().find(|g| g.title == "Mystere").unwrap();
        assert_eq!((mystere.platform_id.as_str(), mystere.id_method.as_str()), ("gamecube", "folder"));
    }

    #[test]
    fn retirer_un_dossier_ne_touche_pas_au_disque() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("Jeu.gba");
        fs::write(&file, b"rom").unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let f = repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        run(&mut conn);
        repo::remove_folder(&mut conn, f.id).unwrap();
        assert!(games(&conn).is_empty());
        assert_eq!(fs::read(&file).unwrap(), b"rom");
    }

    #[test]
    fn disque_debranche_et_annulation() {
        let tmp = tempfile::tempdir().unwrap();
        let sub = tmp.path().join("Externe");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("Jeu.gba"), b"rom").unwrap();
        let mut conn = db::open_in_memory().unwrap();
        repo::add_folder(&conn, sub.to_str().unwrap(), None).unwrap();
        run(&mut conn);

        // Annulation : aucune écriture
        fs::write(sub.join("Autre.gba"), b"rom2").unwrap();
        let cancelled = scan(&mut conn, None, &AtomicBool::new(true), |_| {});
        assert!(matches!(cancelled, Err(LibraryError::Cancelled)));
        assert_eq!(games(&conn).len(), 1);

        // Dossier inaccessible : jeux introuvables, pas supprimés
        fs::remove_dir_all(&sub).unwrap();
        let s = run(&mut conn);
        assert_eq!((s.missing, s.errors.len()), (1, 1));
        assert_eq!(games(&conn)[0].status, "missing");
    }
}
