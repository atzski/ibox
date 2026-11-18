//! Connecteur Lutris (Linux, Steam Deck) : jeux installés avec Lutris, en lecture seule.
//!
//! Lutris range sa bibliothèque dans une base SQLite, `pga.db`, dans son dossier de données
//! (`GLib.get_user_data_dir()/lutris`, lutris/settings.py) : `~/.local/share/lutris/pga.db`, ou en
//! Flatpak `~/.var/app/net.lutris.Lutris/data/lutris/pga.db`. Table `games` : `id`, `name`,
//! `runner`, `directory`, `installed`, `lastplayed` (secondes Unix), `playtime` (heures).
//! Lancement : `lutris:rungameid/<id>` (page de manuel de Lutris), ouvert par le système. Les jeux
//! du runner `steam` sont laissés au connecteur Steam (pas de doublon).

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

#[derive(Debug, Clone, PartialEq)]
pub struct LutrisGame {
    pub id: i64,
    pub name: String,
    pub runner: String,
    pub directory: Option<String>,
    pub last_played: Option<i64>,
    pub playtime_minutes: Option<i64>,
}

impl LutrisGame {
    pub fn launch_uri(&self) -> String {
        format!("lutris:rungameid/{}", self.id)
    }
}

/// Bases possibles : installation classique, puis Flatpak.
pub fn db_candidates(data_home: &Path, home: &Path) -> [PathBuf; 2] {
    [
        data_home.join("lutris").join("pga.db"),
        home.join(".var/app/net.lutris.Lutris/data/lutris/pga.db"),
    ]
}

/// Base de Lutris trouvée sur cet ordinateur (Linux seulement).
pub fn db_path() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let d = crate::smartconfig::platform::UnixDirs::from_env(|k| std::env::var(k).ok())?;
    db_candidates(&d.data_home, &d.home).into_iter().find(|p| p.is_file())
}

/// Jeux installés (hors runner `steam`), lus en lecture seule.
pub fn read(db: &Path) -> Result<Vec<LutrisGame>, String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|e| format!("base de Lutris illisible : {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, name, coalesce(runner, ''), directory, lastplayed, playtime FROM games WHERE installed = 1 AND name IS NOT NULL AND trim(name) <> '' ORDER BY lower(name)")
        .map_err(|e| format!("base de Lutris inattendue : {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(LutrisGame {
                id: r.get(0)?,
                name: r.get::<_, String>(1)?.trim().to_string(),
                runner: r.get(2)?,
                directory: r.get::<_, Option<String>>(3)?.filter(|d| !d.trim().is_empty()),
                last_played: r.get::<_, Option<i64>>(4)?.filter(|t| *t > 0),
                playtime_minutes: r.get::<_, Option<f64>>(5)?.filter(|h| *h > 0.0).map(|h| (h * 60.0).round() as i64),
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().filter(|g| g.id > 0 && g.runner != "steam").collect())
}

/// Lien sûr (préfixe et identifiant numérique vérifiés) avant de le confier au système.
pub fn checked_uri(uri: &str) -> Option<&str> {
    let id = uri.strip_prefix("lutris:rungameid/")?;
    (!id.is_empty() && id.len() <= 12 && id.bytes().all(|b| b.is_ascii_digit())).then_some(uri)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jeux_installes_de_lutris() {
        let t = tempfile::tempdir().unwrap();
        let db = t.path().join("pga.db");
        let c = Connection::open(&db).unwrap();
        // schéma réel de Lutris (lutris/database/schema.py), colonnes utiles
        c.execute_batch(
            "CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT, sortname TEXT, slug TEXT, runner TEXT, directory TEXT,
               lastplayed INTEGER, installed INTEGER, playtime REAL, service TEXT);
             INSERT INTO games (id, name, runner, directory, lastplayed, installed, playtime) VALUES
               (3, 'Celeste', 'linux', '/home/deck/Games/celeste', 1763400000, 1, 2.5),
               (7, 'Diablo II', 'wine', '/home/deck/Games/diablo-ii', NULL, 1, NULL),
               (9, 'Portal 2', 'steam', NULL, NULL, 1, 4.0),
               (11, 'Pas installé', 'wine', NULL, NULL, 0, NULL),
               (12, '  ', 'wine', NULL, NULL, 1, NULL);",
        )
        .unwrap();
        drop(c);
        let games = read(&db).unwrap();
        let names: Vec<_> = games.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, ["Celeste", "Diablo II"], "installés, hors Steam, sans nom vide");
        assert_eq!(games[0].playtime_minutes, Some(150));
        assert_eq!(games[0].last_played, Some(1763400000));
        assert_eq!(games[0].launch_uri(), "lutris:rungameid/3");
        assert!(checked_uri("lutris:rungameid/3").is_some());
        assert!(checked_uri("lutris:rungameid/3;rm").is_none());
        assert!(checked_uri("lutris:rungame/celeste").is_none());
        let [classic, flatpak] = db_candidates(Path::new("/home/deck/.local/share"), Path::new("/home/deck"));
        assert_eq!(classic, PathBuf::from("/home/deck/.local/share/lutris/pga.db"));
        assert_eq!(flatpak, PathBuf::from("/home/deck/.var/app/net.lutris.Lutris/data/lutris/pga.db"));
    }
}
