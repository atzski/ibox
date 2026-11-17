//! Plateforme PC : une seule collection, alimentée par plusieurs sources
//! (ajout manuel aujourd'hui ; boutiques connecteur par connecteur).
//!
//! Garanties : aucun jeu n'est déplacé, modifié ni supprimé sur le disque ;
//! « Retirer » n'enlève qu'une entrée de la bibliothèque. Aucun mot de passe
//! n'est demandé ni stocké ; aucune protection n'est contournée.

pub mod connectors;
pub mod epic;
pub mod gog;
pub mod running;
pub mod steam;
mod shortcuts;
mod xbox;
pub mod vdf;

use crate::library::time::now_iso;
use crate::library::{repo, LibraryError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;

pub const PLATFORM: &str = "pc";

type Result<T> = std::result::Result<T, LibraryError>;

/// Installation (ou version) d'un jeu PC, chez une source donnée.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PcInstall {
    pub id: i64,
    pub source: String,
    pub source_name: &'static str,
    pub external_id: String,
    pub launch_kind: String,
    pub launch_target: Option<String>,
    pub install_dir: Option<String>,
    pub installed: bool,
    pub preferred: bool,
    pub hidden: bool,
    pub playtime_minutes: Option<i64>,
    /// Jeu de la Famille Steam (possédé par un autre membre).
    pub family: bool,
}

fn invalid(msg: impl Into<String>) -> LibraryError {
    LibraryError::Media(msg.into())
}

/// Ajoute un jeu PC à partir d'un exécutable choisi par l'utilisateur.
pub fn add_manual(conn: &mut Connection, exe_path: &str, title: &str) -> Result<i64> {
    let title = title.trim();
    if title.is_empty() {
        return Err(LibraryError::EmptyTitle);
    }
    let p = Path::new(exe_path);
    // programme (.exe) ou fichier de commandes (.bat, .cmd) qui lance le jeu
    let runnable = p.extension().and_then(|e| e.to_str())
        .is_some_and(|e| ["exe", "bat", "cmd"].iter().any(|ok| e.eq_ignore_ascii_case(ok)));
    if !runnable {
        return Err(invalid("Choisissez un programme (.exe) ou un fichier de commandes (.bat, .cmd)."));
    }
    let meta = std::fs::metadata(p).map_err(|_| invalid(format!("Fichier introuvable : {exe_path}")))?;
    if !meta.is_file() {
        return Err(invalid(format!("Fichier introuvable : {exe_path}")));
    }
    let key = exe_path.replace('/', "\\").to_lowercase();
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM pc_installs WHERE source = 'manual' AND lower(replace(external_id, '/', '\\')) = ?1)",
        [&key],
        |r| r.get(0),
    )?;
    if exists {
        return Err(invalid("Cet exécutable est déjà dans votre bibliothèque PC."));
    }

    let now = now_iso();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO games (platform_id, title, sort_title, added_at, id_method, id_confidence, user_locked)
         VALUES (?1, ?2, ?3, ?4, 'manual', 1.0, 1)",
        params![PLATFORM, title, repo::sort_title(title), now],
    )?;
    let game_id = tx.last_insert_rowid();
    tx.execute(
        "INSERT INTO game_files (game_id, folder_id, path, size, last_seen_at) VALUES (?1, NULL, ?2, ?3, ?4)",
        params![game_id, exe_path, meta.len() as i64, now],
    )
    .map_err(|_| invalid("Ce fichier fait déjà partie de votre collection."))?;
    tx.execute(
        "INSERT INTO pc_installs (game_id, source, external_id, launch_kind, launch_target, install_dir, installed, preferred, added_at, last_seen_at)
         VALUES (?1, 'manual', ?2, 'exe', ?2, ?3, 1, 1, ?4, ?4)",
        params![game_id, exe_path, p.parent().map(|d| d.to_string_lossy().to_string()), now],
    )?;
    tx.commit()?;
    Ok(game_id)
}

pub fn installs(conn: &Connection, game_id: i64) -> Result<Vec<PcInstall>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, external_id, launch_kind, launch_target, install_dir, installed, preferred, hidden, playtime_minutes, family
         FROM pc_installs WHERE game_id = ?1 ORDER BY preferred DESC, installed DESC, id",
    )?;
    let rows = stmt.query_map([game_id], |r| {
        let source: String = r.get(1)?;
        Ok(PcInstall {
            id: r.get(0)?,
            source_name: connectors::source_name(&source),
            source,
            external_id: r.get(2)?,
            launch_kind: r.get(3)?,
            launch_target: r.get(4)?,
            install_dir: r.get(5)?,
            installed: r.get(6)?,
            preferred: r.get(7)?,
            hidden: r.get(8)?,
            playtime_minutes: r.get(9)?,
            family: r.get(10)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Choisit la version lancée par « Jouer ».
/// Regroupe deux fiches PC explicitement choisies. Les identifiants des versions
/// restent stables pour que la prochaine synchronisation retrouve le même jeu.
pub fn merge_games(conn: &mut Connection, keep: i64, other: i64) -> Result<()> {
    let tx = conn.transaction()?;
    let valid: i64 = tx.query_row(
        "SELECT count(*) FROM games WHERE id IN (?1, ?2) AND platform_id = 'pc'
         AND EXISTS (SELECT 1 FROM pc_installs WHERE game_id = games.id)",
        params![keep, other], |r| r.get(0),
    )?;
    if valid != 2 {
        return Err(LibraryError::Media("Sélectionnez deux fiches PC distinctes.".into()));
    }
    tx.execute(
        "UPDATE games SET favorite = max(favorite, (SELECT favorite FROM games WHERE id = ?2)),
         last_played_at = coalesce(max(last_played_at, (SELECT last_played_at FROM games WHERE id = ?2)),
             last_played_at, (SELECT last_played_at FROM games WHERE id = ?2)) WHERE id = ?1",
        params![keep, other],
    )?;
    tx.execute("UPDATE pc_installs SET game_id = ?1, preferred = 0 WHERE game_id = ?2", params![keep, other])?;
    tx.execute("UPDATE game_files SET game_id = ?1, role = 'track' WHERE game_id = ?2", params![keep, other])?;
    tx.execute("UPDATE play_sessions SET game_id = ?1 WHERE game_id = ?2", params![keep, other])?;
    let next_slot: i64 = tx.query_row(
        "SELECT coalesce(max(slot) + 1, 0) FROM media WHERE game_id = ?1", [keep], |r| r.get(0),
    )?;
    tx.execute("UPDATE media SET game_id = ?1, slot = slot + ?3 WHERE game_id = ?2",
        params![keep, other, next_slot])?;
    tx.execute("UPDATE OR IGNORE game_links SET game_id = ?1 WHERE game_id = ?2", params![keep, other])?;
    tx.execute("DELETE FROM games WHERE id = ?1", [other])?;
    tx.commit()?;
    Ok(())
}

pub fn split_install(conn: &mut Connection, install_id: i64, title: &str) -> Result<i64> {
    let title = title.trim();
    if title.is_empty() {
        return Err(LibraryError::EmptyTitle);
    }
    let tx = conn.transaction()?;
    let (game_id, source, external_id): (i64, String, String) = tx.query_row(
        "SELECT i.game_id, i.source, i.external_id FROM pc_installs i JOIN games g ON g.id = i.game_id
         WHERE i.id = ?1 AND g.platform_id = 'pc'
           AND (SELECT count(*) FROM pc_installs WHERE game_id = g.id) > 1",
        [install_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    ).optional()?.ok_or(LibraryError::Media("Cette fiche doit contenir plusieurs versions.".into()))?;
    tx.execute(
        "INSERT INTO games (platform_id, title, sort_title, added_at, id_method, id_confidence)
         SELECT platform_id, ?2, ?3, ?4, 'manual', 1.0 FROM games WHERE id = ?1",
        params![game_id, title, repo::sort_title(title), now_iso()],
    )?;
    let new_id = tx.last_insert_rowid();
    let path = if source == "manual" { external_id } else { format!("{source}://app/{external_id}") };
    let moved = tx.execute(
        "UPDATE game_files SET game_id = ?2, role = 'main' WHERE game_id = ?1 AND path = ?3 COLLATE NOCASE",
        params![game_id, new_id, path],
    )?;
    if moved != 1 {
        return Err(LibraryError::Media("Le fichier associé à cette version est introuvable dans la collection.".into()));
    }
    tx.execute("UPDATE pc_installs SET game_id = ?2, preferred = 1 WHERE id = ?1", params![install_id, new_id])?;
    tx.execute(
        "UPDATE game_files SET role = 'main' WHERE id = (
            SELECT f.id FROM game_files f JOIN pc_installs i ON i.game_id = f.game_id
             AND f.path = (CASE WHEN i.source = 'manual' THEN i.external_id ELSE i.source || '://app/' || i.external_id END) COLLATE NOCASE
            WHERE f.game_id = ?1 ORDER BY i.preferred DESC, i.installed DESC, i.id LIMIT 1
         ) AND NOT EXISTS (SELECT 1 FROM game_files WHERE game_id = ?1 AND role = 'main')",
        [game_id],
    )?;
    tx.execute(
        "UPDATE pc_installs SET preferred = 1 WHERE id = (
            SELECT id FROM pc_installs WHERE game_id = ?1 ORDER BY hidden, installed DESC, id LIMIT 1
         ) AND NOT EXISTS (SELECT 1 FROM pc_installs WHERE game_id = ?1 AND preferred = 1)",
        [game_id],
    )?;
    tx.commit()?;
    Ok(new_id)
}

pub fn set_preferred(conn: &Connection, install_id: i64) -> Result<()> {
    let game_id: i64 = conn
        .query_row("SELECT game_id FROM pc_installs WHERE id = ?1", [install_id], |r| r.get(0))
        .optional()?
        .ok_or(LibraryError::NotFound)?;
    conn.execute("UPDATE pc_installs SET preferred = (id = ?2) WHERE game_id = ?1", params![game_id, install_id])?;
    Ok(())
}

/// Retire une installation de la bibliothèque (rien n'est supprimé du disque).
/// Le jeu disparaît de la collection s'il n'en a plus aucune. Renvoie `true` dans ce cas.
pub fn remove_install(conn: &mut Connection, install_id: i64) -> Result<bool> {
    let tx = conn.transaction()?;
    let (game_id, target): (i64, Option<String>) = tx
        .query_row("SELECT game_id, launch_target FROM pc_installs WHERE id = ?1", [install_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or(LibraryError::NotFound)?;
    tx.execute("DELETE FROM pc_installs WHERE id = ?1", [install_id])?;
    let left: i64 = tx.query_row("SELECT count(*) FROM pc_installs WHERE game_id = ?1", [game_id], |r| r.get(0))?;
    let gone = left == 0;
    if gone {
        tx.execute("DELETE FROM games WHERE id = ?1 AND platform_id = ?2", params![game_id, PLATFORM])?;
    } else if let Some(t) = target {
        // l'entrée de fichier de cette installation n'est plus utile
        tx.execute("DELETE FROM game_files WHERE game_id = ?1 AND path = ?2 AND role = 'main'
                    AND (SELECT count(*) FROM game_files WHERE game_id = ?1 AND role = 'main') > 1", params![game_id, t])?;
    }
    tx.commit()?;
    Ok(gone)
}

/// Méthode de lancement d'un jeu PC.
#[derive(Debug)]
pub struct PcLaunch {
    pub exe: String,
    pub args: Vec<String>,
    /// Nom affiché (« Ajout manuel », « Steam »…).
    pub by: String,
    /// Lancé par une boutique : le processus rend la main aussitôt, la boutique suit la partie.
    pub detached: bool,
}

/// Ouvre un lien de boutique (`com.epicgames.launcher://…`, `goggalaxy://…`) avec
/// l'application que Windows lui associe : gestionnaire de liens de Windows
/// (`rundll32 url.dll,FileProtocolHandler`), sans ligne de commande shell.
/// (L'Explorateur ne comprend pas ces liens et ouvrait le dossier Documents.)
pub(crate) fn url_handler(uri: &str) -> (String, Vec<String>) {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let exe = Path::new(&root).join("System32").join("rundll32.exe").to_string_lossy().to_string();
    (exe, vec!["url.dll,FileProtocolHandler".into(), uri.to_string()])
}

fn digits(s: &str) -> bool {
    !s.is_empty() && s.len() <= 20 && s.chars().all(|c| c.is_ascii_digit())
}

pub fn launch_target(conn: &Connection, game_id: i64) -> std::result::Result<PcLaunch, String> {
    let list: Vec<_> = installs(conn, game_id).map_err(|e| e.to_string())?
        .into_iter().filter(|i| !i.hidden).collect();
    let Some(inst) = list.iter().find(|i| i.installed).or(list.first()) else {
        return Err("Aucune installation connue pour ce jeu.".into());
    };
    if !inst.installed {
        return Err(format!("Ce jeu n'est pas installé : utilisez « Installer » ({}).", inst.source_name));
    }
    match (inst.launch_kind.as_str(), &inst.launch_target) {
        ("protocol", _) if inst.source == "gog" => {
            // méthode des raccourcis de GOG Galaxy
            if !digits(&inst.external_id) {
                return Err("Identifiant GOG invalide.".into());
            }
            let client = gog::client().ok_or("GOG Galaxy est introuvable sur cet ordinateur.")?;
            let dir = inst.install_dir.clone().ok_or("Dossier du jeu inconnu : actualisez la bibliothèque.")?;
            Ok(PcLaunch {
                exe: client.to_string_lossy().to_string(),
                args: vec!["/command=runGame".into(), format!("/gameId={}", inst.external_id), format!("/path={dir}")],
                by: "GOG Galaxy".into(),
                detached: true,
            })
        }
        ("protocol", Some(aumid)) if inst.source == "xbox" => xbox::launch(aumid),
        ("protocol", Some(uri)) if matches!(inst.source.as_str(), "ubisoft" | "ea") => {
            if !shortcuts::game_protocol(uri).is_some_and(|(source, id)| source == inst.source && id == inst.external_id) {
                return Err("Le raccourci du jeu est invalide. Actualisez la collection PC.".into());
            }
            let (exe, args) = url_handler(uri);
            Ok(PcLaunch { exe, args, by: inst.source_name.to_string(), detached: true })
        }
        ("protocol", Some(uri)) if inst.source == "epic" => {
            let uri = epic::checked_uri(uri).ok_or("Lien Epic invalide.")?;
            let (exe, args) = url_handler(uri);
            Ok(PcLaunch { exe, args, by: "Epic Games".into(), detached: true })
        }
        ("exe", Some(exe)) => {
            let args: Vec<String> = conn
                .query_row("SELECT args FROM pc_installs WHERE id = ?1", [inst.id], |r| r.get::<_, String>(0))
                .ok()
                .and_then(|a| serde_json::from_str(&a).ok())
                .unwrap_or_default();
            Ok(PcLaunch { exe: exe.clone(), args, by: inst.source_name.to_string(), detached: shortcuts::SOURCES.contains(&inst.source.as_str()) })
        }
        ("protocol", _) if inst.source == "steam" => {
            // option documentée de Steam : steam.exe -applaunch <id> (jamais de ligne de commande shell)
            if !inst.external_id.chars().all(|c| c.is_ascii_digit()) {
                return Err("Identifiant Steam invalide.".into());
            }
            let root = steam::root().ok_or("Steam est introuvable sur cet ordinateur : installez-le ou relancez-le.")?;
            Ok(PcLaunch {
                exe: root.join("steam.exe").to_string_lossy().to_string(),
                args: vec!["-applaunch".into(), inst.external_id.clone()],
                by: "Steam".into(),
                detached: true,
            })
        }
        _ => Err(format!("Le lancement via {} arrive à une prochaine étape.", inst.source_name)),
    }
}

/// Ouvre la fenêtre d'installation de la boutique pour une version non installée.
/// iBox ne télécharge rien lui-même : la boutique s'en charge, avec le compte du joueur.
pub fn install_target(conn: &Connection, install_id: i64) -> std::result::Result<PcLaunch, String> {
    let (game_id, source): (i64, String) = conn
        .query_row("SELECT game_id, source FROM pc_installs WHERE id = ?1", [install_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|_| "Version introuvable.".to_string())?;
    let inst = installs(conn, game_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|i| i.id == install_id)
        .ok_or("Version introuvable.")?;
    match source.as_str() {
        "steam" if digits(&inst.external_id) => {
            let root = steam::root().ok_or("Steam est introuvable sur cet ordinateur.")?;
            Ok(PcLaunch {
                exe: root.join("steam.exe").to_string_lossy().to_string(),
                args: vec![format!("steam://install/{}", inst.external_id)],
                by: "Steam".into(),
                detached: true,
            })
        }
        "gog" if digits(&inst.external_id) => {
            gog::client().ok_or("GOG Galaxy est introuvable sur cet ordinateur.")?;
            let (exe, args) = url_handler(&format!("goggalaxy://openGameView/gog_{}", inst.external_id));
            Ok(PcLaunch {
                exe,
                args,
                by: "GOG Galaxy".into(),
                detached: true,
            })
        }
        "epic" => {
            let uri = inst.launch_target.as_deref().and_then(epic::install_uri).ok_or("Lien Epic invalide.")?;
            let (exe, args) = url_handler(&uri);
            Ok(PcLaunch { exe, args, by: "Epic Games".into(), detached: true })
        }
        _ => Err(format!("L'installation via {} n'est pas prise en charge.", inst.source_name)),
    }
}

/// Liste JSON des installations d'un jeu (incluse dans la liste de la bibliothèque).
pub const INSTALLS_JSON_SQL: &str = "(SELECT json_group_array(json_object(
        'id', i.id, 'source', i.source, 'externalId', i.external_id, 'launchKind', i.launch_kind,
        'launchTarget', i.launch_target, 'installDir', i.install_dir,
        'installed', json(CASE i.installed WHEN 1 THEN 'true' ELSE 'false' END),
        'preferred', json(CASE i.preferred WHEN 1 THEN 'true' ELSE 'false' END),
        'hidden', json(CASE i.hidden WHEN 1 THEN 'true' ELSE 'false' END),
        'playtimeMinutes', i.playtime_minutes,
        'family', json(CASE i.family WHEN 1 THEN 'true' ELSE 'false' END)))
      FROM pc_installs i WHERE i.game_id = g.id)";

// ——— Synchronisation des boutiques ———

/// Un jeu vu chez une source lors d'une synchronisation.
#[derive(Debug, Clone, Default)]
pub struct SourceEntry {
    pub external_id: String,
    pub title: String,
    pub install_dir: Option<String>,
    pub installed: bool,
    pub launch_target: String,
    pub shortcut_args: Option<Vec<String>>,
    /// Date ISO 8601.
    pub last_played: Option<String>,
    pub playtime_minutes: Option<i64>,
    /// Famille Steam : `Some(true)` partagé par un autre membre, `Some(false)` possédé,
    /// `None` inconnu (l'information déjà enregistrée est gardée).
    pub family: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanItem {
    pub title: String,
    pub status: &'static str,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSummary {
    pub source: String,
    pub seen: usize,
    pub added: usize,
    pub updated: usize,
    /// Jeux connus qui ne sont plus installés (gardés, marqués « non installé »).
    pub uninstalled: usize,
    /// Jeux possédés mais non installés, parmi ceux lus.
    pub not_installed: usize,
    /// Jeux de la Famille Steam, parmi ceux lus.
    pub family: usize,
    /// Identifiants des jeux ajoutés (pour chercher leurs jaquettes).
    pub new_game_ids: Vec<i64>,
    /// Partie de la lecture qui n'a pas abouti (ex. jeux possédés Steam), en clair.
    pub warning: Option<String>,
    pub items: Vec<ScanItem>,
}

/// Date ISO 8601 (UTC) depuis des secondes Unix, sans dépendance.
fn time_from_unix(secs: i64) -> Option<String> {
    if secs <= 0 {
        return None;
    }
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // algorithme de Howard Hinnant (jours civils)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    Some(format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60))
}

/// Range les jeux vus chez une source dans la collection : ajoute les nouveaux,
/// met à jour les connus, marque « non installés » ceux qui ont disparu. Rien
/// n'est jamais supprimé ; un jeu masqué le reste.
pub fn sync_source(conn: &mut Connection, source: &str, entries: &[SourceEntry]) -> Result<SyncSummary> {
    let now = now_iso();
    let mut sum = SyncSummary {
        source: source.into(),
        seen: entries.len(),
        not_installed: entries.iter().filter(|e| !e.installed).count(),
        family: entries.iter().filter(|e| e.family == Some(true)).count(),
        items: entries.iter().map(|e| ScanItem {
            title: e.title.clone(),
            status: if e.installed { "installed" } else { "unverified" },
            reason: (!e.installed && matches!(source, "ea" | "ubisoft"))
                .then(|| "Raccourci trouvé, dossier d’installation non confirmé.".into()),
        }).collect(),
        ..Default::default()
    };
    let tx = conn.transaction()?;
    for e in entries {
        let known: Option<(i64, i64)> = tx
            .query_row("SELECT id, game_id FROM pc_installs WHERE source = ?1 AND external_id = ?2", params![source, e.external_id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        let played = e.last_played.clone();
        let kind = if e.shortcut_args.is_some() { "exe" } else { "protocol" };
        let args = serde_json::to_string(e.shortcut_args.as_deref().unwrap_or_default()).expect("string array");
        match known {
            Some((install_id, game_id)) => {
                tx.execute(
                    "UPDATE pc_installs SET installed = ?2, install_dir = ?3, launch_target = ?4, playtime_minutes = ?5, last_seen_at = ?6,
                       family = coalesce(?7, family), launch_kind = ?8, args = ?9 WHERE id = ?1",
                    params![install_id, e.installed, e.install_dir, e.launch_target, e.playtime_minutes, now, e.family, kind, args],
                )?;
                if let Some(p) = &played {
                    tx.execute(
                        "UPDATE games SET last_played_at = ?2 WHERE id = ?1 AND (last_played_at IS NULL OR last_played_at < ?2)",
                        params![game_id, p],
                    )?;
                }
                sum.updated += 1;
            }
            None => {
                let title = e.title.trim();
                tx.execute(
                    "INSERT INTO games (platform_id, title, sort_title, added_at, last_played_at, id_method, id_confidence)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'database', 1.0)",
                    params![PLATFORM, title, repo::sort_title(title), now, played],
                )?;
                let game_id = tx.last_insert_rowid();
                tx.execute(
                    "INSERT INTO game_files (game_id, folder_id, path, size, last_seen_at) VALUES (?1, NULL, ?2, 0, ?3)",
                    params![game_id, format!("{source}://app/{}", e.external_id), now],
                )?;
                tx.execute(
                    "INSERT INTO pc_installs (game_id, source, external_id, launch_kind, args, launch_target, install_dir, installed, preferred, playtime_minutes, added_at, last_seen_at, family)
                     VALUES (?1, ?2, ?3, ?10, ?11, ?4, ?5, ?6, 1, ?7, ?8, ?8, ?9)",
                    params![game_id, source, e.external_id, e.launch_target, e.install_dir, e.installed, e.playtime_minutes, now, e.family.unwrap_or(false), kind, args],
                )?;
                sum.added += 1;
                sum.new_game_ids.push(game_id);
            }
        }
    }
    // jeux connus de cette source qui ne sont plus vus : gardés, marqués non installés
    let seen: Vec<&str> = entries.iter().map(|e| e.external_id.as_str()).collect();
    let mut stmt = tx.prepare("SELECT id, external_id FROM pc_installs WHERE source = ?1 AND installed = 1")?;
    let gone: Vec<i64> = stmt
        .query_map([source], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(|r| r.ok())
        .filter(|(_, ext)| !seen.contains(&ext.as_str()))
        .map(|(id, _)| id)
        .collect();
    drop(stmt);
    for id in &gone {
        tx.execute("UPDATE pc_installs SET installed = 0 WHERE id = ?1", [id])?;
    }
    sum.uninstalled = gone.len();
    tx.commit()?;
    Ok(sum)
}

/// Jeux Steam : installés (fichiers locaux) et, avec la clé de l'utilisateur,
/// possédés (API Web officielle) puis, si demandé, ceux de la Famille Steam
/// (bibliothèques publiques des autres membres). `None` si Steam n'est pas installé.
/// Lu hors de la base : aucune requête réseau ne bloque la bibliothèque.
pub fn steam_entries(include_family: bool) -> Option<(Vec<SourceEntry>, Option<String>)> {
    let root = steam::root()?;
    let apps = steam::scan(&root);
    let mut times: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    let owners: std::collections::BTreeSet<&str> = apps.iter().filter_map(|a| a.owner.as_deref()).collect();
    for owner in owners {
        for (k, v) in steam::playtimes(&root, owner) {
            times.entry(k).and_modify(|m| *m = (*m).max(v)).or_insert(v);
        }
    }
    let mut entries: Vec<SourceEntry> = apps
        .iter()
        .map(|a| SourceEntry {
            external_id: a.appid.clone(),
            title: a.name.clone(),
            install_dir: Some(a.install_dir.to_string_lossy().to_string()),
            installed: a.installed,
            launch_target: format!("steam://rungameid/{}", a.appid),
            shortcut_args: None,
            last_played: a.last_played.and_then(time_from_unix),
            playtime_minutes: times.get(&a.appid).copied(),
            family: None,
        })
        .collect();

    let mut warning = None;
    match crate::metadata::keys::get(steam::KEY) {
        Ok(None) => {}
        Err(_) => warning = Some("Coffre Windows inaccessible : jeux Steam possédés non lus.".to_string()),
        Ok(Some(key)) => match steam::account(&root, &apps) {
            None => warning = Some("Compte Steam introuvable : connectez-vous une fois à Steam sur cet ordinateur.".to_string()),
            Some(account) => match steam::owned_games(&key, &account, true) {
                Err(e) => warning = Some(e),
                Ok(owned) => {
                    merge_owned(&mut entries, owned);
                    if include_family {
                        warning = add_family(&mut entries, &root, &key, &account);
                    }
                }
            },
        },
    }
    Some((entries, warning))
}

/// Ajoute les jeux possédés non installés ; complète le temps de jeu des autres.
fn merge_owned(entries: &mut Vec<SourceEntry>, owned: Vec<steam::OwnedGame>) {
    for g in owned {
        let minutes = (g.playtime_minutes > 0).then_some(g.playtime_minutes);
        if let Some(e) = entries.iter_mut().find(|e| e.external_id == g.appid) {
            e.playtime_minutes = e.playtime_minutes.max(minutes);
            e.family = Some(false);
            continue;
        }
        entries.push(SourceEntry {
            launch_target: format!("steam://rungameid/{}", g.appid),
            external_id: g.appid,
            title: g.name,
            install_dir: None,
            installed: false,
            last_played: g.last_played.and_then(time_from_unix),
            shortcut_args: None,
            playtime_minutes: minutes,
            family: Some(false),
        });
    }
}

/// Famille Steam : jeux des autres membres (bibliothèques publiques, API Web officielle).
/// Renvoie un avertissement si des membres n'ont pas pu être lus.
fn add_family(entries: &mut Vec<SourceEntry>, root: &Path, key: &str, account: &str) -> Option<String> {
    let members = steam::family_members(root, account);
    if members.is_empty() {
        return None;
    }
    let mut unread = 0;
    let mut shared: Vec<steam::OwnedGame> = Vec::new();
    for m in &members {
        // jeux gratuits exclus : ils ne se partagent pas, chacun peut les installer
        match steam::owned_games(key, m, false) {
            Ok(games) => shared.extend(games),
            Err(_) => unread += 1,
        }
    }
    merge_family(entries, shared);
    (unread > 0).then(|| {
        format!(
            "Famille Steam : {unread} membre{s} sur {} n'a pas pu être lu (bibliothèque privée) ; ses jeux ne sont pas listés.",
            members.len(),
            s = if unread > 1 { "s" } else { "" }
        )
    })
}

/// Ajoute les jeux partagés par la famille que l'utilisateur ne possède pas.
fn merge_family(entries: &mut Vec<SourceEntry>, shared: Vec<steam::OwnedGame>) {
    for g in shared {
        if let Some(e) = entries.iter_mut().find(|e| e.external_id == g.appid) {
            // installé ici sans être à l'utilisateur : prêté par la famille
            if e.family.is_none() {
                e.family = Some(true);
            }
            continue;
        }
        entries.push(SourceEntry {
            launch_target: format!("steam://rungameid/{}", g.appid),
            external_id: g.appid,
            title: g.name,
            installed: false,
            family: Some(true),
            ..Default::default()
        });
    }
}

/// Jeux GOG Galaxy (possédés, installés ou non). `None` si Galaxy est absent.
pub fn gog_entries() -> Option<std::result::Result<Vec<SourceEntry>, String>> {
    let db = gog::db_path()?;
    Some(gog::read(&db).map(|games| {
        games
            .into_iter()
            .map(|g| SourceEntry {
                launch_target: format!("goggalaxy://openGameView/gog_{}", g.product_id),
                installed: g.install_dir.as_deref().is_some_and(|d| Path::new(d).is_dir()),
                external_id: g.product_id,
                title: g.title,
                install_dir: g.install_dir,
                last_played: g.last_played,
                shortcut_args: None,
                playtime_minutes: g.playtime_minutes,
                family: None,
            })
            .collect()
    }))
}

/// Jeux Epic installés. `None` si le lanceur Epic est absent.
pub fn epic_entries() -> Option<Vec<SourceEntry>> {
    let dir = epic::manifests_dir()?;
    Some(
        epic::scan(&dir)
            .into_iter()
            .map(|g| SourceEntry {
                external_id: g.app_name,
                title: g.title,
                installed: g.installed && g.install_dir.as_deref().is_some_and(|d| Path::new(d).is_dir()),
                install_dir: g.install_dir,
                launch_target: g.launch_uri,
                shortcut_args: None,
                last_played: None,
                playtime_minutes: None,
                family: None,
            })
            .collect(),
    )
}

/// Masque (ou réaffiche) une installation : un outil ou un logiciel qui n'est pas un jeu.
pub fn set_hidden(conn: &Connection, install_id: i64, hidden: bool) -> Result<()> {
    let n = conn.execute("UPDATE pc_installs SET hidden = ?2 WHERE id = ?1", params![install_id, hidden])?;
    if n == 0 {
        return Err(LibraryError::NotFound);
    }
    Ok(())
}

// ——— Commandes ———

pub mod commands {
    use super::*;
    use crate::library::commands::LibraryState;
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager, State};

    type Res<T> = std::result::Result<T, String>;

    /// Jeu PC en cours (même lancé hors d'iBox) : identifiant et titre.
    #[tauri::command]
    pub fn pc_running_game(lib: State<LibraryState>) -> Option<(i64, String)> {
        lib.with(|c| Ok(running::detect(c))).ok().flatten()
    }

    #[tauri::command]
    pub fn pc_connectors() -> Vec<connectors::ConnectorInfo> {
        connectors::all().iter().map(|c| c.info()).collect()
    }

    #[tauri::command]
    pub fn pc_set_steam_folder(app: AppHandle, folder: PathBuf) -> Res<()> {
        let file = app.path().app_data_dir().map_err(|e| e.to_string())?.join("steam-folder.txt");
        steam::set_manual_root(&file, folder)
    }

    #[tauri::command]
    pub fn pc_add_manual(state: State<LibraryState>, exe_path: String, title: String) -> Res<i64> {
        state.with(|c| add_manual(c, &exe_path, &title))
    }

    #[tauri::command]
    pub fn pc_installs(state: State<LibraryState>, game_id: i64) -> Res<Vec<PcInstall>> {
        state.with(|c| installs(c, game_id))
    }

    #[tauri::command]
    pub fn pc_set_preferred(state: State<LibraryState>, install_id: i64) -> Res<()> {
        state.with(|c| set_preferred(c, install_id))
    }

    #[tauri::command]
    pub fn pc_merge_games(state: State<LibraryState>, keep: i64, other: i64) -> Res<()> {
        state.with(|c| merge_games(c, keep, other))
    }

    #[tauri::command]
    pub fn pc_split_install(state: State<LibraryState>, install_id: i64, title: String) -> Res<i64> {
        state.with(|c| split_install(c, install_id, &title))
    }

    /// Synchronise les boutiques activées qui savent lister leurs jeux.
    #[tauri::command]
    pub async fn pc_sync(app: tauri::AppHandle, enabled: Vec<String>) -> Res<Vec<SyncSummary>> {
        use tauri::Manager;
        tauri::async_runtime::spawn_blocking(move || {
            let state = app.state::<LibraryState>();
            let on = |id: &str| enabled.iter().any(|e| e == id);
            let mut out = Vec::new();
            if on("steam") {
                if let Some((entries, warning)) = steam_entries(on("steam-family")) {
                    let mut s = state.with(|c| sync_source(c, "steam", &entries))?;
                    s.warning = warning;
                    out.push(s);
                }
            }
            if on("epic") {
                if let Some(entries) = epic_entries() {
                    out.push(state.with(|c| sync_source(c, "epic", &entries))?);
                }
            }
            if on("gog") {
                match gog_entries() {
                    None => {}
                    Some(Ok(entries)) => out.push(state.with(|c| sync_source(c, "gog", &entries))?),
                    // lecture impossible : rien n'est marqué désinstallé, l'erreur est dite
                    Some(Err(w)) => out.push(SyncSummary { source: "gog".into(), warning: Some(w), ..Default::default() }),
                }
            }
            if shortcuts::SOURCES.iter().any(|id| on(id)) {
                match shortcuts::scan() {
                    Ok(mut report) => {
                        for &id in shortcuts::SOURCES.iter().filter(|id| on(id)) {
                            if id == "xbox" {
                                match xbox::scan() {
                                    Ok(packaged) => report.games.entry(id).or_default().extend(packaged),
                                    Err(warning) => {
                                        out.push(SyncSummary { source: id.into(), warning: Some(warning), ..Default::default() });
                                        continue;
                                    }
                                }
                            }
                            let entries = report.games.get(id).map(Vec::as_slice).unwrap_or_default();
                            let mut summary = state.with(|c| sync_source(c, id, entries))?;
                            summary.items.extend(report.ignored.remove(id).unwrap_or_default());
                            out.push(summary);
                        }
                    }
                    Err(warning) => {
                        for &id in shortcuts::SOURCES.iter().filter(|id| on(id)) {
                            out.push(SyncSummary { source: id.into(), warning: Some(warning.clone()), ..Default::default() });
                        }
                    }
                }
            }
            Ok(out)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Empreinte de l'état des jeux Steam (`appid` entièrement installés, triés) : lecture des
    /// seuls manifestes, assez légère pour être faite toutes les quelques secondes. iBox relance
    /// la synchronisation complète quand elle change (installation finie dans Steam…).
    #[tauri::command]
    pub async fn pc_steam_installed() -> Res<Vec<String>> {
        tauri::async_runtime::spawn_blocking(|| {
            let Some(root) = steam::root() else { return Vec::new() };
            let mut ids: Vec<String> = steam::scan(&root).into_iter().filter(|a| a.installed).map(|a| a.appid).collect();
            ids.sort();
            ids.dedup();
            ids
        })
        .await
        .map_err(|e| e.to_string())
    }

    /// Ouvre la fenêtre d'installation de la boutique. Renvoie le nom de la boutique.
    #[tauri::command]
    pub fn pc_install(state: State<LibraryState>, install_id: i64) -> Res<String> {
        let plan = state.with(|c| Ok(install_target(c, install_id)))?;
        let plan = plan?;
        std::process::Command::new(&plan.exe)
            .args(&plan.args)
            .spawn()
            .map_err(|e| format!("{} n'a pas pu être ouvert : {e}", plan.by))?;
        Ok(plan.by)
    }

    /// Clé API Web Steam : vérifiée auprès de Steam, puis rangée dans le coffre Windows.
    #[tauri::command]
    pub async fn pc_steam_key_set(key: String) -> Res<usize> {
        let key = key.trim().to_string();
        if !steam::valid_key(&key) {
            return Err("Une clé API Web Steam compte 32 caractères (chiffres et lettres A à F).".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            let root = steam::root().ok_or("Steam est introuvable sur cet ordinateur.")?;
            let account = steam::account(&root, &steam::scan(&root))
                .ok_or("Compte Steam introuvable : connectez-vous une fois à Steam sur cet ordinateur.")?;
            let owned = steam::owned_games(&key, &account, true)?;
            crate::metadata::keys::set(steam::KEY, &key).map_err(|e| e.to_string())?;
            Ok(owned.len())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub fn pc_steam_key_delete() -> Res<()> {
        crate::metadata::keys::delete(steam::KEY).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn pc_set_hidden(state: State<LibraryState>, install_id: i64, hidden: bool) -> Res<()> {
        state.with(|c| set_hidden(c, install_id, hidden))
    }

    #[tauri::command]
    pub fn pc_remove_install(state: State<LibraryState>, install_id: i64) -> Res<bool> {
        state.with(|c| remove_install(c, install_id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn exe(dir: &Path, rel: &str) -> String {
        let p = dir.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"MZ").unwrap();
        p.to_string_lossy().to_string()
    }

    #[test]
    fn ajout_manuel_lancement_et_retrait() {
        let tmp = tempfile::tempdir().unwrap();
        let mut conn = db::open_in_memory().unwrap();
        let path = exe(tmp.path(), "Hollow Lantern/HollowLantern.exe");
        let id = add_manual(&mut conn, &path, "Hollow Lantern").unwrap();

        // le jeu apparaît dans la bibliothèque, console PC, avec son installation
        let games = repo::list_games(&conn).unwrap();
        let g = games.iter().find(|g| g.id == id).unwrap();
        assert_eq!(g.platform_id, "pc");
        assert_eq!(installs(&conn, id).unwrap().len(), 1);

        // lancement direct de l'exécutable
        let l = launch_target(&conn, id).unwrap();
        assert_eq!(l.exe, path);
        assert!(l.args.is_empty() && !l.detached);
        assert_eq!(l.by, "Ajout manuel");

        // pas de doublon ; un .exe obligatoire ; un titre obligatoire
        assert!(add_manual(&mut conn, &path, "Encore").is_err());
        assert!(add_manual(&mut conn, &exe(tmp.path(), "notes.txt"), "Notes").is_err());
        assert!(add_manual(&mut conn, &exe(tmp.path(), "B/b.exe"), "  ").is_err());
        // fichiers de commandes acceptés
        assert!(add_manual(&mut conn, &exe(tmp.path(), "C/start.bat"), "Avec .bat").is_ok());
        assert!(add_manual(&mut conn, &exe(tmp.path(), "D/run.CMD"), "Avec .cmd").is_ok());
        assert!(add_manual(&mut conn, &exe(tmp.path(), "E/script.ps1"), "PowerShell").is_err());

        // retirer : le fichier reste sur le disque, le jeu quitte la bibliothèque
        let inst = installs(&conn, id).unwrap()[0].id;
        assert!(remove_install(&mut conn, inst).unwrap());
        assert!(Path::new(&path).is_file());
        assert!(repo::list_games(&conn).unwrap().iter().all(|g| g.id != id));
    }

    #[test]
    fn merge_keeps_versions_and_survives_rescan() {
        let mut conn = crate::db::open_in_memory().unwrap();
        let steam = entry("105600", "Terraria", true);
        let gog = entry("123", "Terraria", true);
        let keep = sync_source(&mut conn, "steam", &[steam]).unwrap().new_game_ids[0];
        let other = sync_source(&mut conn, "gog", &[gog.clone()]).unwrap().new_game_ids[0];
        assert!(merge_games(&mut conn, keep, keep).is_err());
        merge_games(&mut conn, keep, other).unwrap();
        assert_eq!(repo::list_games(&conn).unwrap().len(), 1);
        assert_eq!(installs(&conn, keep).unwrap().len(), 2);
        let version = installs(&conn, keep).unwrap().into_iter().find(|v| v.source == "gog").unwrap();
        set_preferred(&conn, version.id).unwrap();
        assert_eq!(installs(&conn, keep).unwrap()[0].id, version.id);
        assert_eq!(sync_source(&mut conn, "gog", &[gog]).unwrap().added, 0);
    }

    #[test]
    fn split_original_version_keeps_both_games_visible_after_sync() {
        let mut conn = crate::db::open_in_memory().unwrap();
        let steam = entry("105600", "Terraria", true);
        let gog = entry("123", "Terraria", true);
        let keep = sync_source(&mut conn, "steam", &[steam.clone()]).unwrap().new_game_ids[0];
        let other = sync_source(&mut conn, "gog", &[gog.clone()]).unwrap().new_game_ids[0];
        let install = installs(&conn, keep).unwrap()[0].id;
        assert!(split_install(&mut conn, install, "Terraria").is_err());
        merge_games(&mut conn, keep, other).unwrap();
        let separate = split_install(&mut conn, install, "Terraria Steam").unwrap();
        assert_eq!(installs(&conn, separate).unwrap()[0].id, install);
        assert!(installs(&conn, keep).unwrap()[0].preferred);
        assert_eq!(repo::list_games(&conn).unwrap().len(), 2);
        assert_eq!(sync_source(&mut conn, "steam", &[steam]).unwrap().added, 0);
        assert_eq!(sync_source(&mut conn, "gog", &[gog]).unwrap().added, 0);
    }

    fn entry(id: &str, title: &str, installed: bool) -> SourceEntry {
        SourceEntry {
            external_id: id.into(),
            title: title.into(),
            install_dir: Some(format!("G:/SteamLibrary/steamapps/common/{title}")),
            installed,
            launch_target: format!("steam://rungameid/{id}"),
            shortcut_args: None,
            last_played: time_from_unix(1_791_551_557),
            playtime_minutes: Some(754),
            family: None,
        }
    }

    #[test]
    fn famille_steam_jeux_partages() {
        let mut conn = db::open_in_memory().unwrap();
        let og = |id: &str, name: &str| steam::OwnedGame { appid: id.into(), name: name.into(), playtime_minutes: 0, last_played: None };
        // installé ici : un jeu à moi, un jeu prêté par la famille
        let mut entries = vec![entry("1966720", "Lethal Company", true), entry("105600", "Terraria", true)];
        merge_owned(&mut entries, vec![og("1966720", "Lethal Company")]);
        merge_family(&mut entries, vec![og("105600", "Terraria"), og("1966720", "Lethal Company"), og("620", "Portal 2")]);
        let fam = |id: &str| entries.iter().find(|e| e.external_id == id).unwrap().family;
        assert_eq!(fam("1966720"), Some(false), "possédé : reste à l'utilisateur");
        assert_eq!(fam("105600"), Some(true), "installé, prêté par la famille");
        assert_eq!(fam("620"), Some(true), "partagé, non installé");
        let sum = sync_source(&mut conn, "steam", &entries).unwrap();
        assert_eq!((sum.added, sum.family), (3, 2));

        // sans la famille (lecture sans clé) : l'information enregistrée est gardée
        sync_source(&mut conn, "steam", &[entry("105600", "Terraria", true)]).unwrap();
        let games = repo::list_games(&conn).unwrap();
        let terraria = games.iter().find(|g| g.title == "Terraria").unwrap();
        assert!(installs(&conn, terraria.id).unwrap()[0].family);
        // installation par Steam, comme un jeu possédé
        let portal = games.iter().find(|g| g.title == "Portal 2").unwrap();
        let inst = installs(&conn, portal.id).unwrap()[0].id;
        match install_target(&conn, inst) {
            Ok(p) => assert_eq!(p.args, ["steam://install/620"]),
            Err(e) => assert!(e.contains("Steam est introuvable"), "{e}"),
        }
    }

    #[test]
    fn jeux_possedes_non_installes_et_installation() {
        let mut conn = db::open_in_memory().unwrap();
        let mut entries = vec![entry("1966720", "Lethal Company", true)];
        merge_owned(
            &mut entries,
            vec![
                steam::OwnedGame { appid: "1966720".into(), name: "Lethal Company".into(), playtime_minutes: 900, last_played: None },
                steam::OwnedGame { appid: "620".into(), name: "Portal 2".into(), playtime_minutes: 0, last_played: None },
            ],
        );
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].playtime_minutes, Some(900), "temps de jeu complété");
        let sum = sync_source(&mut conn, "steam", &entries).unwrap();
        assert_eq!((sum.added, sum.not_installed), (2, 1));

        let portal = repo::list_games(&conn).unwrap().into_iter().find(|g| g.title == "Portal 2").unwrap();
        // « Jouer » refusé avec une explication ; « Installer » ouvre Steam
        assert!(launch_target(&conn, portal.id).unwrap_err().contains("Installer"));
        let inst = installs(&conn, portal.id).unwrap()[0].id;
        match install_target(&conn, inst) {
            Ok(p) => assert_eq!(p.args, ["steam://install/620"]),
            Err(e) => assert!(e.contains("Steam est introuvable"), "{e}"),
        }
    }

    #[test]
    fn epic_et_gog_lancement_et_installation() {
        let mut conn = db::open_in_memory().unwrap();
        let uri = "com.epicgames.launcher://apps/ns%3Aitem%3ASugar?action=launch&silent=true";
        let e = SourceEntry {
            external_id: "Sugar".into(),
            title: "Rocket League".into(),
            install_dir: Some("C:/Games/rl".into()),
            installed: true,
            launch_target: uri.into(),
            shortcut_args: None,
            last_played: None,
            playtime_minutes: None,
            family: None,
        };
        sync_source(&mut conn, "epic", &[e.clone()]).unwrap();
        let rl = repo::list_games(&conn).unwrap().into_iter().find(|g| g.title == "Rocket League").unwrap();
        let l = launch_target(&conn, rl.id).unwrap();
        assert!(l.detached && l.exe.to_lowercase().ends_with("rundll32.exe"));
        assert_eq!(l.args, ["url.dll,FileProtocolHandler", uri]);
        let inst = installs(&conn, rl.id).unwrap()[0].id;
        assert_eq!(install_target(&conn, inst).unwrap().args[1], "com.epicgames.launcher://apps/ns%3Aitem%3ASugar?action=install");

        // GOG : identifiant numérique obligatoire
        let g = SourceEntry { external_id: "12; calc".into(), launch_target: String::new(), ..e };
        sync_source(&mut conn, "gog", &[g]).unwrap();
        let bad = installs(&conn, rl.id + 1).unwrap()[0].id;
        assert!(install_target(&conn, bad).is_err());
    }

    #[test]
    fn synchronisation_ajoute_met_a_jour_et_garde_les_desinstalles() {
        let mut conn = db::open_in_memory().unwrap();
        let first = sync_source(&mut conn, "steam", &[entry("1966720", "Lethal Company", true), entry("1012840", "Autre jeu", true)]).unwrap();
        assert_eq!((first.added, first.updated, first.uninstalled), (2, 0, 0));
        assert_eq!(first.new_game_ids.len(), 2);

        // deuxième passage : rien de neuf, un jeu désinstallé (gardé, marqué non installé)
        let second = sync_source(&mut conn, "steam", &[entry("1966720", "Lethal Company", true)]).unwrap();
        assert_eq!((second.added, second.updated, second.uninstalled), (0, 1, 1));
        let games = repo::list_games(&conn).unwrap();
        assert_eq!(games.iter().filter(|g| g.platform_id == "pc").count(), 2, "rien n'est supprimé");

        let lethal = games.iter().find(|g| g.title == "Lethal Company").unwrap();
        assert_eq!(lethal.last_played_at.as_deref(), Some("2026-10-09T13:12:37Z"));
        let inst = installs(&conn, lethal.id).unwrap();
        assert_eq!(inst[0].playtime_minutes, Some(754));

        // lancement par Steam (si Steam est installé sur la machine de test)
        match launch_target(&conn, lethal.id) {
            Ok(l) => assert!(l.detached && l.args == ["-applaunch", "1966720"] && l.exe.ends_with("steam.exe")),
            Err(e) => assert!(e.contains("Steam est introuvable"), "{e}"),
        }

        // masquer : la synchronisation suivante ne le réaffiche pas
        set_hidden(&conn, inst[0].id, true).unwrap();
        sync_source(&mut conn, "steam", &[entry("1966720", "Lethal Company", true)]).unwrap();
        assert!(installs(&conn, lethal.id).unwrap()[0].hidden);
    }

    #[test]
    fn dates_unix_en_iso() {
        assert_eq!(time_from_unix(0), None);
        assert_eq!(time_from_unix(1_791_551_557).as_deref(), Some("2026-10-09T13:12:37Z"));
        assert_eq!(time_from_unix(951_782_400).as_deref(), Some("2000-02-29T00:00:00Z"));
    }
}
