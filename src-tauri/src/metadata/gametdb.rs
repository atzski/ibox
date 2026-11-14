//! Bases de titres GameTDB (GameCube, Wii, DS, 3DS) : correspondance exacte
//! par identifiant interne, titres et synopsis localisés.
//! Fichiers « for anyone to use » — crédit affiché dans l'interface.

use super::http::Http;
use super::text::{attr, locale, tag, unescape};
use super::{MetaError, Result};
use crate::library::now_iso;
use rusqlite::{params, Connection, OptionalExtension};
use std::io::{Cursor, Read};

const MAX_AGE_DAYS: i64 = 30;

/// (base, URL, consoles couvertes)
const DATABASES: [(&str, &str, &[&str]); 4] = [
    ("wii", "https://www.gametdb.com/wiitdb.zip", &["gamecube", "wii"]),
    ("ds", "https://www.gametdb.com/dstdb.zip", &["ds"]),
    ("3ds", "https://www.gametdb.com/3dstdb.zip", &["3ds"]),
    ("switch", "https://www.gametdb.com/switchtdb.zip", &["switch"]),
];

/// Serveur d'images de GameTDB (le même que celui des chargeurs USB Wii) :
/// « coverfull » est le scan complet d'une jaquette, dos | tranche | face.
const ART_HOST: &str = "https://art.gametdb.com";

/// Dossier et format des scans complets par console (DS : aucun scan complet).
fn art_root(platform: &str) -> Option<(&'static str, &'static str)> {
    match platform {
        "gamecube" | "wii" => Some(("wii", "png")),
        "3ds" => Some(("3ds", "jpg")),
        "switch" => Some(("switch", "jpg")),
        _ => None,
    }
}

/// Régions d'images d'une sortie, la plus probable d'abord : d'après la lettre
/// de région de l'identifiant (GC/Wii/3DS), sinon d'après la région GameTDB.
fn art_regions(platform: &str, id: &str, region: Option<&str>) -> &'static [&'static str] {
    let by_letter = |c: char| -> Option<&'static [&'static str]> {
        Some(match c {
            'E' | 'N' => &["US"],
            'J' => &["JA"],
            'K' => &["KO"],
            'P' => &["FR", "EN", "DE", "ES", "IT", "NL"],
            'D' => &["DE", "EN"],
            'F' => &["FR", "EN"],
            'S' => &["ES", "EN"],
            'I' => &["IT", "EN"],
            'H' => &["NL", "EN"],
            'U' => &["EN", "AU"],
            'X' | 'Y' | 'Z' => &["EN", "US"],
            _ => return None,
        })
    };
    if platform != "switch" {
        if let Some(r) = id.chars().nth(3).and_then(by_letter) {
            return r;
        }
    }
    match region {
        Some("NTSC-U") => &["US"],
        Some("PAL") => &["FR", "EN", "DE", "ES", "IT", "NL"],
        Some("NTSC-J") => &["JA"],
        Some("KOR") => &["KO"],
        _ => &["US", "EN"],
    }
}

/// Clé de comparaison d'un titre : minuscules, lettres et chiffres seulement.
fn title_key(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// Sorties GameTDB d'un jeu : par identifiant exact (disque, cartouche), sinon
/// — Switch, dont iBox ne connaît que l'identifiant de titre — par titre exact.
fn releases(conn: &Connection, platform: &str, serial: Option<&str>, title: &str) -> Result<Vec<(String, Option<String>)>> {
    if let Some(s) = serial {
        let key = serial_key(platform, s);
        let hit: Option<(String, Option<String>)> = conn
            .query_row("SELECT serial, region FROM ref_gametdb WHERE serial = ?1 AND platform_id = ?2", params![key, platform], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .optional()?;
        if let Some(h) = hit {
            return Ok(vec![h]);
        }
        if platform != "switch" {
            return Ok(Vec::new());
        }
    }
    let want = title_key(title);
    if want.len() < 3 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare("SELECT serial, region, title_en, title_fr FROM ref_gametdb WHERE platform_id = ?1")?;
    let rows = stmt.query_map([platform], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, region, en, fr) = row?;
        if [en, fr].iter().flatten().any(|t| title_key(t) == want) {
            out.push((id, region));
        }
    }
    // la sortie européenne d'abord (jaquettes françaises), puis les autres
    out.sort_by_key(|(_, r)| r.as_deref() != Some("PAL"));
    out.truncate(3);
    Ok(out)
}

/// Adresses possibles du scan complet d'un jeu, la meilleure d'abord (HD puis
/// standard, région de la sortie). Liste courte : chaque essai est une requête.
pub fn full_cover_urls(conn: &Connection, platform: &str, serial: Option<&str>, title: &str) -> Result<Vec<String>> {
    let Some((root, ext)) = art_root(platform) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for (id, region) in releases(conn, platform, serial, title)? {
        for r in art_regions(platform, &id, region.as_deref()).iter().take(3) {
            for kind in ["coverfullHQ", "coverfull"] {
                let url = format!("{ART_HOST}/{root}/{kind}/{r}/{id}.{ext}");
                if !out.contains(&url) {
                    out.push(url);
                }
            }
        }
    }
    out.truncate(8);
    Ok(out)
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Row {
    pub serial: String,
    pub platform_id: String,
    pub region: Option<String>,
    pub title_fr: Option<String>,
    pub title_en: Option<String>,
    pub synopsis_fr: Option<String>,
    pub synopsis_en: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub players: Option<i64>,
}

impl Row {
    pub fn title(&self) -> Option<&str> {
        self.title_fr.as_deref().or(self.title_en.as_deref())
    }
    pub fn synopsis(&self) -> Option<&str> {
        self.synopsis_fr.as_deref().or(self.synopsis_en.as_deref())
    }
}

pub fn database_for(platform: &str) -> Option<&'static str> {
    DATABASES.iter().find(|(_, _, p)| p.contains(&platform)).map(|(db, _, _)| *db)
}

/// Console d'une entrée selon la base et son `<type>` (les catégories hors
/// jeux sur disque/cartouche — WiiWare, Console virtuelle, homebrew… — sont ignorées).
fn platform_of(db: &str, kind: &str) -> Option<&'static str> {
    match (db, kind) {
        ("wii", "GameCube") => Some("gamecube"),
        ("wii", "") => Some("wii"),
        ("ds", "DS") | ("ds", "DSi") => Some("ds"),
        ("3ds", k) if !["CUSTOM", "Homebrew", "3DSWare", "eShop", "DSiWare"].contains(&k) && !k.is_empty() => Some("3ds"),
        ("3ds", "") => Some("3ds"),
        ("switch", "Switch") => Some("switch"),
        _ => None,
    }
}

const GENRES: [(&str, &str); 27] = [
    ("action", "Action"),
    ("adventure", "Aventure"),
    ("platformer", "Plateforme"),
    ("racing", "Course"),
    ("puzzle", "Réflexion"),
    ("role-playing", "RPG"),
    ("rpg", "RPG"),
    ("sports", "Sport"),
    ("shooter", "Tir"),
    ("fighting", "Combat"),
    ("simulation", "Simulation"),
    ("strategy", "Stratégie"),
    ("party", "Party game"),
    ("music", "Musique"),
    ("rhythm", "Rythme"),
    ("educational", "Éducatif"),
    ("board game", "Jeu de société"),
    ("survival horror", "Survival horror"),
    ("stealth", "Infiltration"),
    ("pinball", "Flipper"),
    ("fitness", "Fitness"),
    ("arcade", "Arcade"),
    // libellés libretro-database
    ("platform", "Plateforme"),
    ("role-playing (rpg)", "RPG"),
    ("beat'em up", "Beat'em up"),
    ("shoot'em up", "Shoot'em up"),
    ("sports - racing", "Course"),
];

/// « action,adventure,demo » → « Action, Aventure ».
pub fn translate_genre(raw: &str) -> Option<String> {
    let mut out: Vec<&str> = Vec::new();
    let lower = raw.to_lowercase();
    for g in lower.split(',').map(str::trim) {
        if let Some((_, fr)) = GENRES.iter().find(|(en, _)| *en == g) {
            if !out.contains(fr) {
                out.push(fr);
            }
        }
        if out.len() == 2 {
            break;
        }
    }
    (!out.is_empty()).then(|| out.join(", "))
}

pub fn parse(db: &str, xml: &str) -> Vec<Row> {
    let mut rows = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find("<game name=") {
        let Some(len) = rest[start..].find("</game>") else { break };
        let game = &rest[start..start + len];
        rest = &rest[start + len + 7..];

        let kind = tag(game, "type").unwrap_or("");
        let Some(platform) = platform_of(db, kind) else { continue };
        let Some(serial) = tag(game, "id") else { continue };
        let text = |loc: Option<&str>, t: &str| loc.and_then(|l| tag(l, t)).map(unescape);
        let fr = locale(game, "FR");
        let en = locale(game, "EN");
        let players = attr(game, "input", "players")
            .or_else(|| attr(game, "input", "players-single-cart"))
            .or_else(|| attr(game, "input", "players-multi-cart"))
            .and_then(|p| p.parse().ok())
            .filter(|p: &i64| *p > 0);
        rows.push(Row {
            serial: serial.to_string(),
            platform_id: platform.to_string(),
            region: tag(game, "region").map(str::to_string),
            title_fr: text(fr, "title"),
            title_en: text(en, "title"),
            synopsis_fr: text(fr, "synopsis"),
            synopsis_en: text(en, "synopsis"),
            developer: tag(game, "developer").map(unescape),
            publisher: tag(game, "publisher").map(unescape),
            year: attr(game, "date", "year").and_then(|y| y.parse().ok()).filter(|y: &i64| *y > 1970),
            genre: tag(game, "genre").and_then(translate_genre),
            players,
        });
    }
    rows
}

pub fn ensure(http: &Http, conn: &Connection, db: &str, force: bool) -> Result<usize> {
    let Some((_, url, _)) = DATABASES.iter().find(|(d, _, _)| *d == db) else { return Ok(0) };
    let id = format!("gametdb:{db}");
    let fresh: Option<i64> = conn
        .query_row(
            "SELECT items FROM ref_sources WHERE id = ?1 AND julianday('now') - julianday(fetched_at) < ?2",
            params![id, MAX_AGE_DAYS],
            |r| r.get(0),
        )
        .optional()?;
    if let (Some(n), false) = (fresh, force) {
        return Ok(n as usize);
    }

    let zip_bytes = http.bytes(url, 60 * 1024 * 1024, "GameTDB")?;
    let mut archive =
        zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|e| MetaError::Invalid(format!("archive GameTDB illisible ({e})")))?;
    let mut xml = String::new();
    {
        let mut file = archive.by_index(0).map_err(|e| MetaError::Invalid(format!("archive GameTDB vide ({e})")))?;
        if file.size() > 200 * 1024 * 1024 {
            return Err(MetaError::Invalid("base GameTDB anormalement volumineuse".into()));
        }
        file.read_to_string(&mut xml)?;
    }
    let rows = parse(db, &xml);

    let tx = conn.unchecked_transaction()?;
    for (_, _, platforms) in DATABASES.iter().filter(|(d, _, _)| *d == db) {
        for p in *platforms {
            tx.execute("DELETE FROM ref_gametdb WHERE platform_id = ?1", [p])?;
        }
    }
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO ref_gametdb
             (serial, platform_id, region, title_fr, title_en, synopsis_fr, synopsis_en, developer, publisher, year, genre, players)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        )?;
        for r in &rows {
            stmt.execute(params![
                r.serial, r.platform_id, r.region, r.title_fr, r.title_en, r.synopsis_fr, r.synopsis_en, r.developer, r.publisher, r.year,
                r.genre, r.players
            ])?;
        }
    }
    tx.execute(
        "INSERT INTO ref_sources (id, fetched_at, items) VALUES (?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, items = excluded.items",
        params![id, now_iso(), rows.len() as i64],
    )?;
    tx.commit()?;
    Ok(rows.len())
}

/// Identifiant GameTDB d'un jeu : identique pour GC/Wii/DS ; les 4 derniers
/// caractères du code produit pour la 3DS (« CTR-P-AXXE » → « AXXE »).
pub fn serial_key(platform: &str, serial: &str) -> String {
    if platform == "3ds" {
        serial.rsplit('-').next().unwrap_or(serial).to_string()
    } else {
        serial.to_string()
    }
}

/// Correspondance exacte ; à défaut, même jeu dans une autre région
/// (même code sauf la lettre de région) pour les informations textuelles.
pub fn lookup(conn: &Connection, platform: &str, serial: &str) -> Result<Option<Row>> {
    let key = serial_key(platform, serial);
    let read = |r: &rusqlite::Row| {
        Ok(Row {
            serial: r.get(0)?,
            platform_id: r.get(1)?,
            region: r.get(2)?,
            title_fr: r.get(3)?,
            title_en: r.get(4)?,
            synopsis_fr: r.get(5)?,
            synopsis_en: r.get(6)?,
            developer: r.get(7)?,
            publisher: r.get(8)?,
            year: r.get(9)?,
            genre: r.get(10)?,
            players: r.get(11)?,
        })
    };
    const COLS: &str = "SELECT serial, platform_id, region, title_fr, title_en, synopsis_fr, synopsis_en, developer, publisher, year, genre, players FROM ref_gametdb";
    if let Some(r) = conn.query_row(&format!("{COLS} WHERE serial = ?1"), [&key], read).optional()? {
        return Ok(Some(r));
    }
    if key.len() >= 4 && key.is_ascii() {
        let pattern = format!("{}_{}", &key[..3], &key[4..]);
        return Ok(conn
            .query_row(
                &format!("{COLS} WHERE serial LIKE ?1 AND platform_id = ?2 ORDER BY (synopsis_fr IS NULL), (region <> 'PAL') LIMIT 1"),
                params![pattern, platform],
                read,
            )
            .optional()?);
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<datafile>
	<game name="Pikmin (Europe)">
		<id>GPIP01</id>
		<type>GameCube</type>
		<region>PAL</region>
		<locale lang="EN"><title>Pikmin</title><synopsis>Olimar crashes &amp; must rebuild.</synopsis></locale>
		<locale lang="FR"><title>Pikmin</title><synopsis>Olimar s'écrase sur une planète.</synopsis></locale>
		<developer>Nintendo EAD</developer>
		<publisher>Nintendo</publisher>
		<date year="2002" month="6" day="14"/>
		<genre>strategy,puzzle</genre>
		<input players="1"/>
	</game>
	<game name="Mario Kart Wii">
		<id>RMCP01</id>
		<type/>
		<locale lang="EN"><title>Mario Kart Wii</title><synopsis/></locale>
		<date year="2008"/>
		<input players="4"/>
	</game>
	<game name="Some WiiWare">
		<id>WAAP</id>
		<type>WiiWare</type>
	</game>
</datafile>"#;

    #[test]
    fn lecture_de_la_base() {
        let rows = parse("wii", XML);
        assert_eq!(rows.len(), 2, "le WiiWare est ignoré");
        let p = &rows[0];
        assert_eq!((p.platform_id.as_str(), p.year, p.players), ("gamecube", Some(2002), Some(1)));
        assert_eq!(p.synopsis(), Some("Olimar s'écrase sur une planète."));
        assert_eq!(p.synopsis_en.as_deref(), Some("Olimar crashes & must rebuild."));
        assert_eq!(p.genre.as_deref(), Some("Stratégie, Réflexion"));
        assert_eq!(translate_genre("Platform").as_deref(), Some("Plateforme"));
        assert_eq!(translate_genre("Strategy").as_deref(), Some("Stratégie"));
        assert_eq!(translate_genre("Lancer de nains"), None);
        assert_eq!(rows[1].platform_id, "wii");
        assert_eq!(rows[1].synopsis(), None);
    }

    #[test]
    fn correspondance_exacte_puis_autre_region() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO ref_gametdb (serial, platform_id, region, title_en, year) VALUES ('GPIE01', 'gamecube', 'NTSC-U', 'Pikmin', 2001)",
            [],
        )
        .unwrap();
        assert_eq!(lookup(&conn, "gamecube", "GPIE01").unwrap().unwrap().year, Some(2001));
        assert_eq!(lookup(&conn, "gamecube", "GPIP01").unwrap().unwrap().serial, "GPIE01");
        assert!(lookup(&conn, "gamecube", "GXXP01").unwrap().is_none());
    }

    #[test]
    fn scans_complets_par_identifiant_ou_par_titre() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO ref_gametdb (serial, platform_id, region, title_en) VALUES ('GPIP01', 'gamecube', 'PAL', 'Pikmin');
             INSERT INTO ref_gametdb (serial, platform_id, region, title_en) VALUES ('AUBQA', 'switch', 'NTSC-U', 'Kirby and the Forgotten Land');
             INSERT INTO ref_gametdb (serial, platform_id, region, title_en) VALUES ('AUBQB', 'switch', 'PAL', 'Kirby and the Forgotten Land');",
        )
        .unwrap();
        let gc = full_cover_urls(&conn, "gamecube", Some("GPIP01"), "Pikmin").unwrap();
        assert_eq!(gc[0], "https://art.gametdb.com/wii/coverfullHQ/FR/GPIP01.png");
        assert_eq!(gc[1], "https://art.gametdb.com/wii/coverfull/FR/GPIP01.png");
        // identifiant inconnu sur GameCube : aucune supposition par titre
        assert!(full_cover_urls(&conn, "gamecube", Some("GXXP01"), "Pikmin").unwrap().is_empty());
        // Switch : identifiant de titre inconnu de GameTDB, sortie européenne d'abord
        let sw = full_cover_urls(&conn, "switch", Some("01004D300C5AE000"), "Kirby and the Forgotten Land").unwrap();
        assert_eq!(sw[0], "https://art.gametdb.com/switch/coverfullHQ/FR/AUBQB.jpg");
        assert!(sw.len() <= 8 && sw.iter().all(|u| steam_safe(u)));
        assert!(full_cover_urls(&conn, "switch", None, "Kirby").unwrap().is_empty());
        assert!(full_cover_urls(&conn, "ds", Some("ADME"), "x").unwrap().is_empty());
    }

    fn steam_safe(u: &str) -> bool {
        crate::metadata::steamgriddb::allowed_image_host(u)
    }

    #[test]
    fn code_produit_3ds() {
        assert_eq!(serial_key("3ds", "CTR-P-AXXE"), "AXXE");
        assert_eq!(serial_key("ds", "ADME"), "ADME");
    }
}
