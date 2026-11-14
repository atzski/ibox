//! libretro-database (`metadat/`, licence CC BY-SA 4.0) : développeur, éditeur,
//! genre, année et nombre de joueurs, par console. Correspondance par CRC32
//! (cartouches) ou par nom No-Intro / Redump.

use super::http::{encode_segment, Http};
use super::matching::name_key;
use super::text::{dat_crc, dat_value};
use super::{libretro_system, MetaError, Result};
use crate::library::now_iso;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;

const BASE: &str = "https://raw.githubusercontent.com/libretro/libretro-database/master/metadat";
const MAX_AGE_DAYS: i64 = 30;
/// Champ du DAT → colonne.
const FIELDS: [(&str, &str); 5] =
    [("developer", "developer"), ("publisher", "publisher"), ("genre", "genre"), ("releaseyear", "releaseyear"), ("maxusers", "users")];

#[derive(Debug, Default, Clone, PartialEq)]
pub struct Entry {
    pub crc: Option<String>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub players: Option<i64>,
}

/// Blocs `game ( … )` d'un DAT : (nom, valeur du champ, crc).
pub fn parse_dat(text: &str, field: &str) -> Vec<(String, String, Option<String>)> {
    let mut out = Vec::new();
    for block in text.split("\ngame (").skip(1) {
        let block = block.split("\n)").next().unwrap_or(block);
        let name = dat_value(block, "comment").or_else(|| dat_value(block, "name"));
        let value = dat_value(block, field);
        if let (Some(n), Some(v)) = (name, value) {
            out.push((n.to_string(), v.to_string(), dat_crc(block)));
        }
    }
    out
}

pub fn ensure(http: &Http, conn: &Connection, platform: &str, force: bool) -> Result<usize> {
    let Some(system) = libretro_system(platform) else { return Ok(0) };
    let id = format!("libretro-db:{platform}");
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

    let mut entries: BTreeMap<String, Entry> = BTreeMap::new();
    for (field, key) in FIELDS {
        let url = format!("{BASE}/{field}/{}.dat", encode_segment(system));
        let text = match http.text(&url, 30 * 1024 * 1024, "libretro-database") {
            Ok(t) => t,
            Err(MetaError::Http { status: 404, .. }) => continue, // champ absent pour cette console
            Err(e) => return Err(e),
        };
        for (name, value, crc) in parse_dat(&text, key) {
            let e = entries.entry(name).or_default();
            if e.crc.is_none() {
                e.crc = crc;
            }
            match field {
                "developer" => e.developer = Some(value),
                "publisher" => e.publisher = Some(value),
                "genre" => e.genre = Some(value),
                "releaseyear" => e.year = value.parse().ok(),
                _ => e.players = value.parse().ok(),
            }
        }
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM ref_libretro_meta WHERE platform_id = ?1", [platform])?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR REPLACE INTO ref_libretro_meta (platform_id, name, name_key, crc, developer, publisher, genre, year, players)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for (name, e) in &entries {
            stmt.execute(params![platform, name, name_key(name), e.crc, e.developer, e.publisher, e.genre, e.year, e.players])?;
        }
    }
    tx.execute(
        "INSERT INTO ref_sources (id, fetched_at, items) VALUES (?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, items = excluded.items",
        params![id, now_iso(), entries.len() as i64],
    )?;
    tx.commit()?;
    Ok(entries.len())
}

/// Recherche : CRC exact, puis nom de fichier identique, puis même titre.
pub fn lookup(conn: &Connection, platform: &str, crc: Option<&str>, stem: &str, title: &str) -> Result<Option<Entry>> {
    let row = |r: &rusqlite::Row| {
        Ok(Entry {
            crc: r.get(0)?,
            developer: r.get(1)?,
            publisher: r.get(2)?,
            genre: r.get(3)?,
            year: r.get(4)?,
            players: r.get(5)?,
        })
    };
    const COLS: &str = "SELECT crc, developer, publisher, genre, year, players FROM ref_libretro_meta";
    if let Some(crc) = crc {
        if let Some(e) = conn
            .query_row(&format!("{COLS} WHERE platform_id = ?1 AND crc = ?2"), params![platform, crc.to_uppercase()], row)
            .optional()?
        {
            return Ok(Some(e));
        }
    }
    if let Some(e) = conn.query_row(&format!("{COLS} WHERE platform_id = ?1 AND name = ?2"), params![platform, stem], row).optional()? {
        return Ok(Some(e));
    }
    Ok(conn
        .query_row(&format!("{COLS} WHERE platform_id = ?1 AND name_key = ?2 LIMIT 1"), params![platform, name_key(title)], row)
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lecture_d_un_dat() {
        let dat = "clrmamepro (\n\tname \"Nintendo - Game Boy Advance\"\n)\n\ngame (\n\tcomment \"007: NightFire (USA, Europe) (En,Fr,De)\"\n\tdeveloper \"JV Games\"\n\trom ( crc 56C83C16 )\n)\n\ngame (\n\tcomment \"Sans développeur\"\n\trom ( crc 00000001 )\n)\n";
        assert_eq!(
            parse_dat(dat, "developer"),
            vec![("007: NightFire (USA, Europe) (En,Fr,De)".into(), "JV Games".into(), Some("56C83C16".into()))]
        );
    }

    #[test]
    fn recherche_par_crc_nom_et_titre() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO ref_libretro_meta (platform_id, name, name_key, crc, developer, year) VALUES ('gba', ?1, ?2, '56C83C16', 'JV Games', 2002)",
            params!["007: NightFire (USA, Europe) (En,Fr,De)", name_key("007: NightFire (USA, Europe) (En,Fr,De)")],
        )
        .unwrap();
        assert_eq!(lookup(&conn, "gba", Some("56c83c16"), "x", "x").unwrap().unwrap().year, Some(2002));
        assert!(lookup(&conn, "gba", None, "007: NightFire (USA, Europe) (En,Fr,De)", "x").unwrap().is_some());
        assert!(lookup(&conn, "gba", None, "nf", "007 - NightFire").unwrap().is_some());
        assert!(lookup(&conn, "gba", None, "nf", "Autre jeu").unwrap().is_none());
    }
}
