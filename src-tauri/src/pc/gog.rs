//! Connecteur GOG Galaxy : base locale de GOG Galaxy 2.0
//! (`%ProgramData%\GOG.com\Galaxy\storage\galaxy-2.0.db`), ouverte en lecture seule.
//!
//! - `LibraryReleases` : jeux de la bibliothèque du compte (possédés, installés ou non) ;
//! - `ReleaseProperties` / `Products` : écarte les contenus additionnels et les lots ;
//! - `InstalledBaseProducts` : jeux installés et leur dossier ;
//! - `GameTimes`, `LastPlayedDates` : temps de jeu et dernière partie.
//!
//! Seuls les jeux GOG (`gog_<id>`) sont repris : ceux des autres boutiques reliées
//! à Galaxy passent par leur propre connecteur.
//! Lancement : `GalaxyClient.exe /command=runGame /gameId=<id> /path=<dossier>`
//! (méthode des raccourcis créés par Galaxy). Installation : `goggalaxy://openGameView/gog_<id>`.

use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct GogGame {
    /// Identifiant de produit GOG (chiffres).
    pub product_id: String,
    pub title: String,
    pub install_dir: Option<String>,
    pub playtime_minutes: Option<i64>,
    /// Date ISO 8601.
    pub last_played: Option<String>,
}

pub fn db_path() -> Option<PathBuf> {
    let base = std::env::var("ProgramData").ok()?;
    let p = Path::new(&base).join("GOG.com").join("Galaxy").join("storage").join("galaxy-2.0.db");
    p.is_file().then_some(p)
}

/// Client GOG Galaxy (pour lancer les jeux).
pub fn client() -> Option<PathBuf> {
    for var in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Ok(base) = std::env::var(var) {
            let p = Path::new(&base).join("GOG Galaxy").join("GalaxyClient.exe");
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// Lit la bibliothèque GOG depuis la base de Galaxy (lecture seule).
pub fn read(db: &Path) -> Result<Vec<GogGame>, String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|_| "La base de GOG Galaxy n'a pas pu être ouverte.".to_string())?;
    let _ = conn.busy_timeout(std::time::Duration::from_secs(3));
    read_conn(&conn).map_err(|e| format!("La base de GOG Galaxy n'a pas pu être lue ({e})."))
}

pub fn read_conn(conn: &Connection) -> rusqlite::Result<Vec<GogGame>> {
    let mut installed: HashMap<String, String> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT productId, installationPath FROM InstalledBaseProducts")?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)))? {
            let (id, path) = row?;
            if let Some(p) = path.filter(|p| !p.trim().is_empty()) {
                installed.insert(id.to_string(), p);
            }
        }
    }
    let piece = |kind: &str| {
        format!(
            "(SELECT p.value FROM GamePieces p JOIN GamePieceTypes t ON t.id = p.gamePieceTypeId
               WHERE p.releaseKey = lr.releaseKey AND t.type = '{kind}' LIMIT 1)"
        )
    };
    let sql = format!(
        "SELECT DISTINCT lr.releaseKey, {title}, {original},
                (SELECT max(minutesInGame) FROM GameTimes gt WHERE gt.releaseKey = lr.releaseKey),
                (SELECT max(lastPlayedDate) FROM LastPlayedDates d WHERE d.gameReleaseKey = lr.releaseKey)
         FROM LibraryReleases lr
         LEFT JOIN ReleaseProperties rp ON rp.releaseKey = lr.releaseKey
         WHERE lr.releaseKey LIKE 'gog\\_%' ESCAPE '\\'
           AND coalesce(rp.isDlc, 0) = 0
           AND coalesce(rp.isVisibleInLibrary, 1) = 1
           AND NOT EXISTS (SELECT 1 FROM LicensedReleases l WHERE l.libraryId = lr.id AND l.isOwned = 0)
           AND NOT EXISTS (SELECT 1 FROM Products pr WHERE pr.id = CAST(substr(lr.releaseKey, 5) AS INTEGER) AND pr.parentId IS NOT NULL)",
        title = piece("title"),
        original = piece("originalTitle"),
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<i64>>(3)?,
            r.get::<_, Option<String>>(4)?,
        ))
    })?;
    let mut out: Vec<GogGame> = Vec::new();
    for row in rows {
        let (key, title, original, minutes, played) = row?;
        let id = key.trim_start_matches("gog_").to_string();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) || out.iter().any(|g| g.product_id == id) {
            continue;
        }
        let title = title
            .as_deref()
            .and_then(json_title)
            .or_else(|| original.as_deref().and_then(json_title))
            .unwrap_or_else(|| format!("Jeu GOG {id}"));
        out.push(GogGame {
            install_dir: installed.get(&id).cloned(),
            playtime_minutes: minutes.filter(|m| *m > 0),
            last_played: played.as_deref().and_then(sql_date_to_iso),
            product_id: id,
            title,
        });
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

/// `{"title":"Cyberpunk 2077"}` → « Cyberpunk 2077 ».
fn json_title(v: &str) -> Option<String> {
    let j: serde_json::Value = serde_json::from_str(v).ok()?;
    j.get("title")?.as_str().map(str::trim).filter(|t| !t.is_empty()).map(str::to_string)
}

/// `2026-11-11 17:26:37` (UTC) → `2026-11-11T17:26:37Z`.
fn sql_date_to_iso(s: &str) -> Option<String> {
    let s = s.trim();
    let ok = s.len() == 19 && s.as_bytes()[4] == b'-' && s.as_bytes()[10] == b' ';
    ok.then(|| format!("{}T{}Z", &s[..10], &s[11..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bibliotheque_gog_jeux_seulement() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE LibraryReleases (id INTEGER PRIMARY KEY, userId INTEGER, releaseKey TEXT);
             CREATE TABLE ReleaseProperties (releaseKey TEXT, isDlc INTEGER, isVisibleInLibrary INTEGER, gameId TEXT);
             CREATE TABLE LicensedReleases (libraryId INTEGER, isOwned INTEGER);
             CREATE TABLE Products (id INTEGER, name TEXT, parentId INTEGER);
             CREATE TABLE InstalledBaseProducts (productId INTEGER, installationPath TEXT);
             CREATE TABLE GamePieceTypes (id INTEGER, type TEXT);
             CREATE TABLE GamePieces (releaseKey TEXT, gamePieceTypeId INTEGER, userId INTEGER, value TEXT);
             CREATE TABLE GameTimes (userId INTEGER, releaseKey TEXT, minutesInGame INTEGER);
             CREATE TABLE LastPlayedDates (userId INTEGER, gameReleaseKey TEXT, lastPlayedDate TEXT);
             INSERT INTO GamePieceTypes VALUES (246, 'title'), (225, 'originalTitle');
             -- jeu installé
             INSERT INTO LibraryReleases VALUES (1, 5, 'gog_1423049311');
             INSERT INTO ReleaseProperties VALUES ('gog_1423049311', 0, 1, '1');
             INSERT INTO GamePieces VALUES ('gog_1423049311', 246, 5, '{\"title\":\"Cyberpunk 2077\"}');
             INSERT INTO InstalledBaseProducts VALUES (1423049311, 'G:\\Cyberpunk 2077');
             INSERT INTO GameTimes VALUES (5, 'gog_1423049311', 10838);
             INSERT INTO LastPlayedDates VALUES (5, 'gog_1423049311', '2026-11-11 17:26:37');
             -- jeu possédé, non installé
             INSERT INTO LibraryReleases VALUES (2, 5, 'gog_1207658924');
             INSERT INTO GamePieces VALUES ('gog_1207658924', 225, 5, '{\"title\":\"Unepic\"}');
             -- contenu additionnel, lot invisible, jeu d'une autre boutique, licence perdue
             INSERT INTO LibraryReleases VALUES (3, 5, 'gog_1256837418');
             INSERT INTO ReleaseProperties VALUES ('gog_1256837418', 1, 1, '2');
             INSERT INTO LibraryReleases VALUES (4, 5, 'gog_1274966284');
             INSERT INTO ReleaseProperties VALUES ('gog_1274966284', 0, 0, '3');
             INSERT INTO LibraryReleases VALUES (5, 5, 'steam_1091500');
             INSERT INTO LibraryReleases VALUES (6, 5, 'gog_1597316373');
             INSERT INTO Products VALUES (1597316373, NULL, 1423049311);
             INSERT INTO LibraryReleases VALUES (7, 5, 'gog_1111111111');
             INSERT INTO LicensedReleases VALUES (7, 0);",
        )
        .unwrap();
        let games = read_conn(&conn).unwrap();
        assert_eq!(games.len(), 2, "{games:?}");
        let cp = &games[0];
        assert_eq!((cp.product_id.as_str(), cp.title.as_str()), ("1423049311", "Cyberpunk 2077"));
        assert_eq!(cp.install_dir.as_deref(), Some("G:\\Cyberpunk 2077"));
        assert_eq!(cp.playtime_minutes, Some(10838));
        assert_eq!(cp.last_played.as_deref(), Some("2026-11-11T17:26:37Z"));
        let un = &games[1];
        assert_eq!((un.title.as_str(), un.install_dir.as_deref()), ("Unepic", None));
    }
}
