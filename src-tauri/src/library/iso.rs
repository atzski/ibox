//! Fichiers « .iso » dont la console n'a pas pu être établie.
//!
//! L'extension est partagée par huit consoles du catalogue. Quand ni l'en-tête
//! du disque ni un dossier associé ne tranchent, le fichier n'est rangé nulle
//! part au hasard : il attend ici que l'utilisateur dise de quelle console il
//! s'agit. Le scan ne s'arrête jamais pour poser la question.
//!
//! - `iso.pending` : fichiers en attente (reconstruits à chaque scan des dossiers
//!   parcourus ; ceux d'un disque débranché sont conservés) ;
//! - `iso.choices` : réponses mémorisées par empreinte de fichier. Elles survivent
//!   à un déplacement, un renommage, ou au retrait puis au rajout du dossier.
//!
//! Les deux vivent dans la table `settings` (JSON) : aucune migration.

use super::{now_iso, repo, LibraryError, Result};
use crate::scanner::{formats, reconcile::path_key};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

const KEY_PENDING: &str = "iso.pending";
const KEY_CHOICES: &str = "iso.choices";
/// Réponse « ce n'est pas un jeu » dans `iso.choices`.
const NOT_A_GAME: &str = "none";

/// Au-dessus de ce seuil la console est établie (en-tête du disque, dossier
/// associé par l'utilisateur) : aucune question.
pub const SURE: f32 = 0.9;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingIso {
    pub path: String,
    pub folder_id: i64,
    pub size: i64,
    pub modified: Option<i64>,
    pub fingerprint: Option<String>,
    /// Titre lu dans le nom du fichier.
    pub title: String,
    pub serial: Option<String>,
    pub region: Option<String>,
    pub disc: Option<u32>,
    /// Console présélectionnée, jamais appliquée sans validation.
    pub guess: Option<String>,
    /// D'où vient la présélection : « folder » (nom d'un dossier parent) ou « header ».
    pub guess_source: Option<String>,
    /// Écarté par l'utilisateur (« ce n'est pas un jeu ») : plus de question.
    #[serde(default)]
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    /// Fichiers qui attendent une réponse.
    pub pending: Vec<PendingIso>,
    /// Nombre de fichiers écartés (« ce n'est pas un jeu »).
    pub ignored: usize,
    /// Consoles du catalogue qui acceptent les .iso.
    pub candidates: Vec<String>,
}

/// Consoles du catalogue qui acceptent les .iso.
pub fn candidates() -> Vec<&'static str> {
    formats::platforms_for_extension(".iso")
}

fn read<T: serde::de::DeserializeOwned + Default>(conn: &Connection, key: &str) -> Result<T> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()?;
    // une valeur illisible (version future, édition manuelle) vaut une liste vide
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

fn write<T: Serialize>(conn: &Connection, key: &str, value: &T) -> Result<()> {
    let json = serde_json::to_string(value).unwrap_or_else(|_| "null".into());
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        params![key, json],
    )?;
    Ok(())
}

pub fn pending(conn: &Connection) -> Result<Vec<PendingIso>> {
    read(conn, KEY_PENDING)
}

fn choices(conn: &Connection) -> Result<HashMap<String, String>> {
    read(conn, KEY_CHOICES)
}

/// Réponses mémorisées, lues une fois par scan.
pub struct Choices(HashMap<String, String>);

impl Choices {
    pub fn load(conn: &Connection) -> Result<Self> {
        Ok(Self(choices(conn)?))
    }

    /// Console déjà choisie pour ce contenu, si elle accepte toujours les .iso.
    pub fn platform(&self, fingerprint: Option<&str>) -> Option<&str> {
        let choice = self.0.get(fingerprint?)?.as_str();
        candidates().contains(&choice).then_some(choice)
    }

    fn not_a_game(&self, fingerprint: Option<&str>) -> bool {
        fingerprint.and_then(|f| self.0.get(f)).is_some_and(|c| c == NOT_A_GAME)
    }
}

fn remember(conn: &Connection, fingerprint: Option<&str>, choice: &str) -> Result<()> {
    let Some(fp) = fingerprint else { return Ok(()) };
    let mut all = choices(conn)?;
    if all.insert(fp.to_string(), choice.to_string()).as_deref() != Some(choice) {
        write(conn, KEY_CHOICES, &all)?;
    }
    Ok(())
}

/// Corriger la console d'un jeu .iso depuis sa fiche met la mémoire à jour.
pub fn remember_game(conn: &Connection, game_id: i64, platform_id: &str) -> Result<()> {
    let main: Option<(String, Option<String>)> = conn
        .query_row(
            "SELECT path, fingerprint FROM game_files WHERE game_id = ?1 AND role = 'main'",
            [game_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match main {
        Some((path, fp)) if crate::scanner::is_iso(Path::new(&path)) && candidates().contains(&platform_id) => {
            remember(conn, fp.as_deref(), platform_id)
        }
        _ => Ok(()),
    }
}

pub fn queue(conn: &Connection) -> Result<Queue> {
    let all = pending(conn)?;
    let ignored = all.iter().filter(|p| p.ignored).count();
    Ok(Queue {
        pending: all.into_iter().filter(|p| !p.ignored).collect(),
        ignored,
        candidates: candidates().into_iter().map(str::to_string).collect(),
    })
}

/// Fin d'un scan : remplace les fichiers en attente des dossiers parcourus
/// (`refreshed`) par ceux qui viennent d'être trouvés. Renvoie le nombre de
/// nouvelles questions (fichiers jamais vus en attente, non écartés).
pub fn store_scan(conn: &Connection, refreshed: &[i64], found: Vec<PendingIso>, known: &Choices) -> Result<usize> {
    let old = pending(conn)?;
    if old.is_empty() && found.is_empty() {
        return Ok(0);
    }
    let mut next: Vec<PendingIso> = old.iter().filter(|p| !refreshed.contains(&p.folder_id)).cloned().collect();
    let mut fresh = 0;
    for mut p in found {
        let key = path_key(&p.path);
        let before = old
            .iter()
            .find(|o| path_key(&o.path) == key || (o.fingerprint.is_some() && o.fingerprint == p.fingerprint));
        p.ignored = before.is_some_and(|o| o.ignored) || known.not_a_game(p.fingerprint.as_deref());
        if before.is_none() && !p.ignored {
            fresh += 1;
        }
        next.push(p);
    }
    if next != old {
        write(conn, KEY_PENDING, &next)?;
    }
    Ok(fresh)
}

/// Dossier retiré de la collection : ses fichiers en attente partent avec lui
/// (les réponses déjà données restent mémorisées).
pub fn drop_folder(conn: &Connection, folder_id: i64) -> Result<()> {
    let old = pending(conn)?;
    let next: Vec<&PendingIso> = old.iter().filter(|p| p.folder_id != folder_id).collect();
    if next.len() != old.len() {
        write(conn, KEY_PENDING, &next)?;
    }
    Ok(())
}

/// Répond pour un ou plusieurs fichiers en attente : `Some(console)` les ajoute
/// à la collection, `None` les écarte (« ce n'est pas un jeu »). Le choix est
/// mémorisé. Seuls des chemins déjà en attente (donc issus d'un scan) sont
/// acceptés. Renvoie les identifiants des jeux créés.
pub fn assign(conn: &mut Connection, paths: &[String], platform_id: Option<&str>) -> Result<Vec<i64>> {
    if let Some(p) = platform_id {
        if !candidates().contains(&p) {
            return Err(LibraryError::Media(format!("La console « {p} » n'accepte pas les fichiers .iso.")));
        }
    }
    let wanted: HashSet<String> = paths.iter().map(|p| path_key(p)).collect();
    let tx = conn.transaction()?;
    let mut all = pending(&tx)?;
    let now = now_iso();
    let mut created = Vec::new();
    let mut memo = choices(&tx)?;
    for p in all.iter_mut().filter(|p| wanted.contains(&path_key(&p.path))) {
        if let Some(fp) = &p.fingerprint {
            memo.insert(fp.clone(), platform_id.unwrap_or(NOT_A_GAME).to_string());
        }
        let Some(platform) = platform_id else {
            p.ignored = true;
            continue;
        };
        let taken: bool =
            tx.query_row("SELECT EXISTS (SELECT 1 FROM game_files WHERE path = ?1)", [&p.path], |r| r.get(0))?;
        if !taken {
            created.push(insert(&tx, p, platform, &now)?);
        }
    }
    if platform_id.is_some() {
        all.retain(|p| !wanted.contains(&path_key(&p.path)));
    }
    write(&tx, KEY_PENDING, &all)?;
    write(&tx, KEY_CHOICES, &memo)?;
    tx.commit()?;
    Ok(created)
}

/// Jeu ajouté sur réponse de l'utilisateur : identifié « à la main » et
/// verrouillé, comme une correction — les scans suivants n'y touchent plus.
fn insert(conn: &Connection, p: &PendingIso, platform: &str, now: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO games (platform_id, title, sort_title, serial, region, added_at, id_method, id_confidence, user_locked)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual', 1.0, 1)",
        params![platform, p.title, repo::sort_title(&p.title), p.serial, p.region, now],
    )?;
    let game_id = conn.last_insert_rowid();
    // le dossier peut avoir été retiré entre-temps : le fichier reste rattaché au jeu seul
    let folder: Option<i64> =
        conn.query_row("SELECT id FROM folders WHERE id = ?1", [p.folder_id], |r| r.get(0)).optional()?;
    conn.execute(
        "INSERT INTO game_files (game_id, folder_id, path, size, modified_at, fingerprint, role, disc_number, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'main', ?7, ?8)",
        params![game_id, folder, p.path, p.size, p.modified, p.fingerprint, p.disc, now],
    )?;
    Ok(game_id)
}

/// Repose la question pour les fichiers écartés. Renvoie leur nombre.
pub fn restore_ignored(conn: &mut Connection) -> Result<usize> {
    let tx = conn.transaction()?;
    let mut all = pending(&tx)?;
    let mut memo = choices(&tx)?;
    let mut restored = 0;
    for p in all.iter_mut().filter(|p| p.ignored) {
        p.ignored = false;
        restored += 1;
    }
    memo.retain(|_, c| c != NOT_A_GAME);
    write(&tx, KEY_PENDING, &all)?;
    write(&tx, KEY_CHOICES, &memo)?;
    tx.commit()?;
    Ok(restored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::library::scan::{scan, ScanSummary};
    use std::fs;
    use std::sync::atomic::AtomicBool;

    fn run(conn: &mut Connection) -> ScanSummary {
        scan(conn, None, &AtomicBool::new(false), |_| {}).unwrap()
    }

    /// Contenu sans signature, différent d'un fichier à l'autre (empreintes distinctes).
    fn opaque(seed: u8) -> Vec<u8> {
        vec![seed; 4096]
    }

    fn gc_iso(id: &[u8; 6]) -> Vec<u8> {
        let mut h = vec![0u8; 0x2000];
        h[..6].copy_from_slice(id);
        h[0x1C..0x20].copy_from_slice(&0xC233_9F3Du32.to_be_bytes());
        h
    }

    fn titles(conn: &Connection) -> Vec<(String, String)> {
        let mut v: Vec<_> = repo::list_games(conn).unwrap().into_iter().map(|g| (g.title, g.platform_id)).collect();
        v.sort();
        v
    }

    #[test]
    fn un_iso_inconnu_attend_sans_bloquer_le_scan() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("Mystere (Europe).iso"), opaque(1)).unwrap();
        fs::write(tmp.path().join("Zelda.iso"), gc_iso(b"GZLP01")).unwrap();
        fs::write(tmp.path().join("Advance Wars.gba"), b"rom").unwrap();
        let mut conn = db::open_in_memory().unwrap();
        repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();

        let s = run(&mut conn);
        // le scan va au bout : les deux jeux reconnus sont ajoutés, l'inconnu attend
        assert_eq!((s.added, s.iso_new, s.needs_review), (2, 1, 0));
        assert_eq!(titles(&conn), vec![("Advance Wars".into(), "gba".into()), ("Zelda".into(), "gamecube".into())]);
        let q = queue(&conn).unwrap();
        assert_eq!(q.pending.len(), 1);
        assert_eq!((q.pending[0].title.as_str(), q.pending[0].region.as_deref(), q.pending[0].guess.as_deref()), ("Mystere", Some("PAL"), None));
        assert!(q.candidates.iter().any(|c| c == "ps2") && !q.candidates.iter().any(|c| c == "saturn"));

        // scan suivant : toujours en attente, mais ce n'est plus une nouvelle question
        let s = run(&mut conn);
        assert_eq!((s.added, s.iso_new), (0, 0));
        assert_eq!(queue(&conn).unwrap().pending.len(), 1);
    }

    #[test]
    fn la_reponse_range_le_jeu_et_reste_memorisee() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("Okami.iso");
        fs::write(&file, opaque(2)).unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let folder = repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        run(&mut conn);
        let path = queue(&conn).unwrap().pending[0].path.clone();

        let created = assign(&mut conn, &[path], Some("ps2")).unwrap();
        assert_eq!(created.len(), 1);
        assert!(queue(&conn).unwrap().pending.is_empty());
        let game = repo::list_games(&conn).unwrap().remove(0);
        assert_eq!((game.platform_id.as_str(), game.id_method.as_str(), game.user_locked), ("ps2", "manual", true));

        // scan suivant : aucune question, le jeu reste où l'utilisateur l'a mis
        let s = run(&mut conn);
        assert_eq!((s.added, s.iso_new, s.unchanged), (0, 0, 1));

        // dossier retiré puis rajouté, fichier renommé : la réponse est retrouvée par l'empreinte
        repo::remove_folder(&mut conn, folder.id).unwrap();
        assert!(repo::list_games(&conn).unwrap().is_empty());
        fs::rename(&file, tmp.path().join("Okami HD.iso")).unwrap();
        repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        let s = run(&mut conn);
        assert_eq!((s.added, s.iso_new), (1, 0));
        assert_eq!(titles(&conn), vec![("Okami HD".into(), "ps2".into())]);
        assert!(repo::list_games(&conn).unwrap()[0].user_locked);
    }

    #[test]
    fn meme_console_pour_plusieurs_fichiers_et_console_refusee() {
        let tmp = tempfile::tempdir().unwrap();
        for (i, name) in ["A.iso", "B.iso", "C.iso"].iter().enumerate() {
            fs::write(tmp.path().join(name), opaque(10 + i as u8)).unwrap();
        }
        let mut conn = db::open_in_memory().unwrap();
        repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        assert_eq!(run(&mut conn).iso_new, 3);
        let paths: Vec<String> = queue(&conn).unwrap().pending.into_iter().map(|p| p.path).collect();

        // la Saturn n'accepte pas les .iso ; un chemin jamais scanné est ignoré
        assert!(assign(&mut conn, &paths, Some("saturn")).is_err());
        assert!(assign(&mut conn, &["C:/ailleurs/Autre.iso".to_string()], Some("psp")).unwrap().is_empty());
        assert_eq!(queue(&conn).unwrap().pending.len(), 3);

        assert_eq!(assign(&mut conn, &paths[..2], Some("psp")).unwrap().len(), 2);
        assert_eq!(titles(&conn), vec![("A".into(), "psp".into()), ("B".into(), "psp".into())]);
        assert_eq!(queue(&conn).unwrap().pending.len(), 1);
    }

    #[test]
    fn fichier_ecarte_puis_question_reposee() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("Windows.iso"), opaque(3)).unwrap();
        let mut conn = db::open_in_memory().unwrap();
        repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        run(&mut conn);
        let path = queue(&conn).unwrap().pending[0].path.clone();

        assert!(assign(&mut conn, &[path], None).unwrap().is_empty());
        let q = queue(&conn).unwrap();
        assert_eq!((q.pending.len(), q.ignored), (0, 1));
        // écarté : ni jeu, ni nouvelle question aux scans suivants
        let s = run(&mut conn);
        assert_eq!((s.added, s.iso_new), (0, 0));
        assert!(repo::list_games(&conn).unwrap().is_empty());

        assert_eq!(restore_ignored(&mut conn).unwrap(), 1);
        let q = queue(&conn).unwrap();
        assert_eq!((q.pending.len(), q.ignored), (1, 0));
    }

    #[test]
    fn indices_dossier_parent_et_dossier_associe() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("PS2")).unwrap();
        fs::write(tmp.path().join("PS2/Ico.iso"), opaque(4)).unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let folder = repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();

        // dossier parent nommé « PS2 » : console présélectionnée, mais l'utilisateur valide
        assert_eq!(run(&mut conn).iso_new, 1);
        let p = queue(&conn).unwrap().pending.remove(0);
        assert_eq!((p.guess.as_deref(), p.guess_source.as_deref()), (Some("ps2"), Some("folder")));
        assert!(repo::list_games(&conn).unwrap().is_empty());

        // dossier associé à une console par l'utilisateur : plus de question
        repo::update_folder(&conn, folder.id, Some("xbox"), true).unwrap();
        let s = run(&mut conn);
        assert_eq!((s.added, s.iso_new), (1, 0));
        assert!(queue(&conn).unwrap().pending.is_empty());
        assert_eq!(titles(&conn), vec![("Ico".into(), "xbox".into())]);
    }

    #[test]
    fn corriger_la_fiche_met_la_memoire_a_jour() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("Jeu.iso"), opaque(5)).unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let folder = repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        run(&mut conn);
        let path = queue(&conn).unwrap().pending[0].path.clone();
        let id = assign(&mut conn, &[path], Some("ps2")).unwrap()[0];

        // l'utilisateur s'est trompé : il corrige depuis la fiche
        repo::update_game(&conn, id, &repo::GamePatch { platform_id: Some("psp".into()), title: None, region: None }).unwrap();
        repo::remove_folder(&mut conn, folder.id).unwrap();
        repo::add_folder(&conn, tmp.path().to_str().unwrap(), None).unwrap();
        run(&mut conn);
        assert_eq!(titles(&conn), vec![("Jeu".into(), "psp".into())]);
    }

    #[test]
    fn dossier_retire_ou_debranche() {
        let tmp = tempfile::tempdir().unwrap();
        let (a, b) = (tmp.path().join("A"), tmp.path().join("B"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("Un.iso"), opaque(6)).unwrap();
        fs::write(b.join("Deux.iso"), opaque(7)).unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let fa = repo::add_folder(&conn, a.to_str().unwrap(), None).unwrap();
        repo::add_folder(&conn, b.to_str().unwrap(), None).unwrap();
        assert_eq!(run(&mut conn).iso_new, 2);

        // disque débranché : sa question n'est pas perdue
        fs::remove_dir_all(&b).unwrap();
        run(&mut conn);
        assert_eq!(queue(&conn).unwrap().pending.len(), 2);

        // dossier retiré de la collection : ses fichiers en attente partent avec lui
        repo::remove_folder(&mut conn, fa.id).unwrap();
        let left = queue(&conn).unwrap().pending;
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].title, "Deux");
    }
}
