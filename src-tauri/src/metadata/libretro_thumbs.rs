//! libretro-thumbnails : jaquettes, écrans-titres, captures et logos.
//! `https://thumbnails.libretro.com/<Système>/Named_<Type>/<Nom>.png`
//!
//! L'index de chaque dossier (page publique « Index of ») est mis en cache
//! dans la base pour choisir le bon nom sans multiplier les requêtes.

use super::http::{decode_percent, encode_segment, Http};
use super::matching::name_key;
use super::{libretro_system, MediaKind, MetaError, Result};
use crate::library::now_iso;
use rusqlite::{params, Connection, OptionalExtension};

const HOST: &str = "https://thumbnails.libretro.com";
/// Durée de validité d'un index avant rafraîchissement.
const MAX_AGE_DAYS: i64 = 14;

pub const KINDS: [MediaKind; 4] = [MediaKind::Front, MediaKind::Title, MediaKind::Screenshot, MediaKind::Logo];

fn folder(kind: MediaKind) -> Option<&'static str> {
    Some(match kind {
        MediaKind::Front => "Named_Boxarts",
        MediaKind::Title => "Named_Titles",
        MediaKind::Screenshot => "Named_Snaps",
        MediaKind::Logo => "Named_Logos",
        _ => return None,
    })
}

pub fn url(platform: &str, kind: MediaKind, name: &str) -> Option<String> {
    Some(format!(
        "{HOST}/{}/{}/{}.png",
        encode_segment(libretro_system(platform)?),
        folder(kind)?,
        encode_segment(name)
    ))
}

/// Noms (sans « .png ») extraits d'une page d'index.
pub fn parse_index(html: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = html;
    while let Some(i) = rest.find("href=\"") {
        rest = &rest[i + 6..];
        let Some(end) = rest.find('"') else { break };
        let href = &rest[..end];
        if let Some(stem) = href.strip_suffix(".png") {
            if !stem.contains('/') && !stem.starts_with('?') {
                out.push(decode_percent(stem));
            }
        }
        rest = &rest[end..];
    }
    out.sort();
    out.dedup();
    out
}

fn source_id(platform: &str, kind: MediaKind) -> String {
    format!("libretro-thumbs:{platform}:{}", kind.as_str())
}

/// Télécharge l'index si absent ou trop ancien. Renvoie le nombre de noms connus.
pub fn ensure_index(http: &Http, conn: &Connection, platform: &str, kind: MediaKind, force: bool) -> Result<usize> {
    let (Some(system), Some(dir)) = (libretro_system(platform), folder(kind)) else { return Ok(0) };
    let id = source_id(platform, kind);
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

    let page = format!("{HOST}/{}/{dir}/", encode_segment(system));
    let names = match http.text(&page, 40 * 1024 * 1024, "l'index libretro") {
        Ok(html) => parse_index(&html),
        Err(MetaError::Http { status: 404, .. }) => Vec::new(), // ex. pas de logos pour cette console
        Err(e) => return Err(e),
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM ref_libretro_thumbs WHERE platform_id = ?1 AND kind = ?2", params![platform, kind.as_str()])?;
    {
        let mut stmt = tx.prepare("INSERT OR IGNORE INTO ref_libretro_thumbs (platform_id, kind, name, name_key) VALUES (?1, ?2, ?3, ?4)")?;
        for n in &names {
            stmt.execute(params![platform, kind.as_str(), n, name_key(n)])?;
        }
    }
    tx.execute(
        "INSERT INTO ref_sources (id, fetched_at, items) VALUES (?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, items = excluded.items",
        params![id, now_iso(), names.len() as i64],
    )?;
    tx.commit()?;
    Ok(names.len())
}

pub fn names(conn: &Connection, platform: &str, kind: MediaKind) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM ref_libretro_thumbs WHERE platform_id = ?1 AND kind = ?2")?;
    let rows = stmt.query_map(params![platform, kind.as_str()], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lecture_d_un_index_apache() {
        let html = r#"<tr><td><a href="?C=N;O=D">Name</a></td></tr>
            <a href="/Nintendo%20-%20GameCube/">Parent</a>
            <a href="Legend%20of%20Zelda%2C%20The%20-%20The%20Wind%20Waker%20%28USA%29.png">Legend…</a>
            <a href="Pok%C3%A9mon%20Colosseum%20%28Europe%29.png">Pok…</a>
            <a href="Pok%C3%A9mon%20Colosseum%20%28Europe%29.png">doublon</a>"#;
        assert_eq!(
            parse_index(html),
            vec!["Legend of Zelda, The - The Wind Waker (USA)".to_string(), "Pokémon Colosseum (Europe)".to_string()]
        );
    }

    #[test]
    fn adresse_d_une_image() {
        assert_eq!(
            url("gamecube", MediaKind::Front, "Pikmin (Europe)").unwrap(),
            "https://thumbnails.libretro.com/Nintendo%20-%20GameCube/Named_Boxarts/Pikmin%20%28Europe%29.png"
        );
        assert!(url("switch", MediaKind::Front, "x").is_none());
        assert!(url("gamecube", MediaKind::Back, "x").is_none());
    }
}
