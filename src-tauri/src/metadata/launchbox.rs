//! LaunchBox Games Database (gamesdb.launchbox-app.com) : base publique,
//! téléchargeable en un seul fichier (`Metadata.zip`), qui recense pour chaque
//! jeu les images de sa boîte : face, dos, tranche et scan complet.
//!
//! Utilisée pour les jaquettes complètes que GameTDB n'a pas (Switch 2, PS2,
//! PSP…). Le fichier (≈ 110 Mo compressé, ≈ 500 Mo de XML) est lu en flux : seuls
//! les jeux des consoles prises en charge et leurs images de boîte sont gardés.
//! Rafraîchi au plus tous les 30 jours ; correspondance par titre exact.

use super::http::Http;
use super::text::unescape;
use super::{MetaError, Result};
use crate::library::now_iso;
use crate::scanner::Region;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::io::{Read, Seek};

const MAX_AGE_DAYS: i64 = 30;
const SOURCE_ID: &str = "launchbox";
pub const METADATA_URL: &str = "https://gamesdb.launchbox-app.com/Metadata.zip";
pub const IMAGE_HOST: &str = "images.launchbox-app.com";
/// Taille maximale acceptée pour l'archive téléchargée.
const MAX_ZIP: u64 = 400 * 1024 * 1024;

/// Consoles d'iBox → nom de la plateforme dans LaunchBox.
const PLATFORMS: [(&str, &str); 16] = [
    ("gamecube", "Nintendo GameCube"),
    ("wii", "Nintendo Wii"),
    ("wiiu", "Nintendo Wii U"),
    ("switch", "Nintendo Switch"),
    ("switch2", "Nintendo Switch 2"),
    ("ds", "Nintendo DS"),
    ("3ds", "Nintendo 3DS"),
    ("n64", "Nintendo 64"),
    ("snes", "Super Nintendo Entertainment System"),
    ("gb", "Nintendo Game Boy"),
    ("gbc", "Nintendo Game Boy Color"),
    ("gba", "Nintendo Game Boy Advance"),
    ("ps1", "Sony Playstation"),
    ("ps2", "Sony Playstation 2"),
    ("psp", "Sony PSP"),
    // applications Android de la bibliothèque (src/android_apps)
    ("android", "Android"),
];

pub fn supports(platform: &str) -> bool {
    PLATFORMS.iter().any(|(p, _)| *p == platform)
}

fn platform_of(lb: &str) -> Option<&'static str> {
    PLATFORMS.iter().find(|(_, n)| *n == lb).map(|(p, _)| *p)
}

/// Type d'image LaunchBox → face de la boîte.
fn kind_of(t: &str) -> Option<&'static str> {
    match t {
        "Box - Front" => Some("front"),
        "Box - Back" => Some("back"),
        "Box - Spine" => Some("spine"),
        "Box - Full" => Some("full"),
        "Disc" => Some("disc"),
        _ => None,
    }
}

/// Clé de comparaison d'un titre : minuscules sans accents, « & » → « and »,
/// articles retirés, chiffres romains → arabes, mention d'édition Switch 2 retirée.
pub fn title_key(s: &str) -> String {
    let mut flat = String::with_capacity(s.len());
    for c in s.chars() {
        let c = match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' | 'À' | 'Á' | 'Â' | 'Ä' => 'a',
            'ç' | 'Ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'Î' | 'Ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'Ô' | 'Ö' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'Û' | 'Ü' => 'u',
            '\'' | '’' => continue,
            '&' => {
                flat.push_str(" and ");
                continue;
            }
            c => c,
        };
        for l in c.to_lowercase() {
            flat.push(if l.is_ascii_alphanumeric() { l } else { ' ' });
        }
    }
    const ROMAN: [(&str, &str); 19] = [
        ("ii", "2"), ("iii", "3"), ("iv", "4"), ("v", "5"), ("vi", "6"), ("vii", "7"), ("viii", "8"), ("ix", "9"), ("xi", "11"),
        ("xii", "12"), ("xiii", "13"), ("xiv", "14"), ("xv", "15"), ("xvi", "16"), ("xvii", "17"), ("xviii", "18"), ("xix", "19"),
        ("xx", "20"), ("x", "x"),
    ];
    let words: Vec<&str> = flat
        .split_whitespace()
        .filter(|w| !matches!(*w, "the" | "a" | "an"))
        .map(|w| ROMAN.iter().find(|(r, _)| *r == w).map(|(_, n)| *n).unwrap_or(w))
        .collect();
    let mut key = words.join(" ");
    for tail in [" nintendo switch 2 edition", " switch 2 edition"] {
        if let Some(k) = key.strip_suffix(tail) {
            key = k.to_string();
        }
    }
    key
}

fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from >= hay.len() {
        return None;
    }
    hay[from..].windows(needle.len()).position(|w| w == needle).map(|p| p + from)
}

fn tag<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let s = block.find(&open)? + open.len();
    let e = block[s..].find(&close)? + s;
    let v = block[s..e].trim();
    (!v.is_empty()).then_some(v)
}

/// Contenu retenu du fichier LaunchBox.
#[derive(Default)]
pub struct Index {
    pub games: Vec<(i64, &'static str, String)>,
    pub images: Vec<(i64, &'static str, Option<String>, String)>,
}

/// Lit le XML en flux (blocs `<Game>` et `<GameImage>`), sans le charger en entier.
pub fn parse(mut xml: impl Read, mut cancelled: impl FnMut() -> bool) -> Result<Index> {
    let mut idx = Index::default();
    let mut ids: HashSet<i64> = HashSet::new();
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = vec![0u8; 4 << 20];
    loop {
        if cancelled() {
            return Err(MetaError::Cancelled);
        }
        let n = xml.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        let mut pos = 0;
        loop {
            let Some(i) = find(&buf, b"<Game", pos) else {
                pos = buf.len().saturating_sub(16).max(pos);
                break;
            };
            if buf.len() - i < 12 {
                pos = i;
                break;
            }
            let close: &[u8] = if buf[i..].starts_with(b"<Game>") {
                b"</Game>"
            } else if buf[i..].starts_with(b"<GameImage>") {
                b"</GameImage>"
            } else {
                pos = i + 5;
                continue;
            };
            let Some(end) = find(&buf, close, i) else {
                pos = i;
                break;
            };
            pos = end + close.len();
            let block = String::from_utf8_lossy(&buf[i..end]);
            let id = tag(&block, "DatabaseID").and_then(|v| v.parse::<i64>().ok());
            let Some(id) = id else { continue };
            if close == b"</Game>" {
                let Some(platform) = tag(&block, "Platform").and_then(|p| platform_of(&unescape(p))) else { continue };
                let Some(name) = tag(&block, "Name").map(unescape) else { continue };
                ids.insert(id);
                idx.games.push((id, platform, name));
            } else if ids.contains(&id) {
                let Some(kind) = tag(&block, "Type").and_then(|t| kind_of(&unescape(t))) else { continue };
                let Some(file) = tag(&block, "FileName").map(unescape) else { continue };
                // nom de fichier seul (sous-dossiers permis), jamais une adresse ni un chemin remontant
                if file.contains("..") || file.contains(':') || file.starts_with('/') || file.contains('\\') {
                    continue;
                }
                idx.images.push((id, kind, tag(&block, "Region").map(unescape), file));
            }
        }
        buf.drain(..pos);
    }
    Ok(idx)
}

/// Télécharge (si besoin) et indexe la base. Renvoie le nombre de jeux retenus.
pub fn ensure(http: &Http, conn: &Connection, force: bool, cancelled: impl FnMut() -> bool) -> Result<usize> {
    let fresh: Option<i64> = conn
        .query_row(
            "SELECT items FROM ref_sources WHERE id = ?1 AND julianday('now') - julianday(fetched_at) < ?2",
            params![SOURCE_ID, MAX_AGE_DAYS],
            |r| r.get(0),
        )
        .optional()?;
    if let (Some(n), false) = (fresh, force) {
        return Ok(n as usize);
    }

    // l'archive passe par un fichier temporaire (supprimé à la fin), jamais en mémoire entière
    let mut file = tempfile::tempfile()?;
    http.download_to(METADATA_URL, &mut file, MAX_ZIP, "LaunchBox Games Database")?;
    file.rewind()?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| MetaError::Invalid(format!("archive LaunchBox illisible ({e})")))?;
    let entry = (0..archive.len())
        .find(|&i| archive.by_index(i).ok().is_some_and(|f| matches!(f.name(), Ok(n) if n.eq_ignore_ascii_case("Metadata.xml"))))
        .ok_or_else(|| MetaError::Invalid("archive LaunchBox sans Metadata.xml".into()))?;
    let xml = archive.by_index(entry).map_err(|e| MetaError::Invalid(format!("archive LaunchBox ({e})")))?;
    if xml.size() > 4 * 1024 * 1024 * 1024 {
        return Err(MetaError::Invalid("base LaunchBox anormalement volumineuse".into()));
    }
    let idx = parse(xml, cancelled)?;

    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM ref_launchbox", [])?;
    tx.execute("DELETE FROM ref_launchbox_images", [])?;
    {
        let mut g = tx.prepare("INSERT OR REPLACE INTO ref_launchbox (db_id, platform_id, name, title_key) VALUES (?1, ?2, ?3, ?4)")?;
        for (id, platform, name) in &idx.games {
            g.execute(params![id, platform, name, title_key(name)])?;
        }
        let mut im = tx.prepare("INSERT INTO ref_launchbox_images (db_id, kind, region, file) VALUES (?1, ?2, ?3, ?4)")?;
        for (id, kind, region, file) in &idx.images {
            im.execute(params![id, kind, region, file])?;
        }
    }
    tx.execute(
        "INSERT INTO ref_sources (id, fetched_at, items) VALUES (?1, ?2, ?3)
         ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at, items = excluded.items",
        params![SOURCE_ID, now_iso(), idx.games.len() as i64],
    )?;
    tx.commit()?;
    Ok(idx.games.len())
}

/// Rang d'une région d'image selon la préférence (plus petit = meilleur).
fn region_rank(region: Option<&str>, pref: Region) -> u8 {
    let r = region.unwrap_or("");
    match pref {
        Region::Pal => match r {
            "France" => 0,
            "Europe" => 1,
            "" | "World" => 2,
            "United Kingdom" | "Germany" | "Italy" | "Spain" | "Netherlands" | "Australia" => 3,
            "North America" | "United States" | "Canada" => 4,
            _ => 5,
        },
        Region::NtscU => match r {
            "North America" | "United States" => 0,
            "" | "World" => 1,
            "Canada" => 2,
            "Europe" | "United Kingdom" => 3,
            _ => 5,
        },
        Region::NtscJ => match r {
            "Japan" => 0,
            "" | "World" => 1,
            "Asia" => 2,
            _ => 5,
        },
    }
}

/// Images de boîte du jeu (titre exact sur la même console) : face → adresse,
/// la meilleure région d'abord. `None` si aucun jeu ou plusieurs jeux différents correspondent.
pub fn box_images(conn: &Connection, platform: &str, title: &str, pref: Region) -> Result<Option<Vec<(String, String)>>> {
    let key = title_key(title);
    if key.len() < 2 {
        return Ok(None);
    }
    let ids: Vec<i64> = conn
        .prepare("SELECT db_id FROM ref_launchbox WHERE platform_id = ?1 AND title_key = ?2")?
        .query_map(params![platform, key], |r| r.get(0))?
        .collect::<std::result::Result<_, _>>()?;
    // plusieurs fiches au même titre (remake, homonyme) : on ne devine pas
    let [id] = ids[..] else { return Ok(None) };
    let mut rows: Vec<(String, Option<String>, String)> = conn
        .prepare("SELECT kind, region, file FROM ref_launchbox_images WHERE db_id = ?1")?
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<std::result::Result<_, _>>()?;
    rows.sort_by_key(|(_, region, _)| region_rank(region.as_deref(), pref));
    let mut out: Vec<(String, String)> = Vec::new();
    for (kind, _, file) in rows {
        if !out.iter().any(|(k, _)| *k == kind) {
            out.push((kind, image_url(&file)));
        }
    }
    Ok(Some(out))
}

pub fn image_url(file: &str) -> String {
    let path: Vec<String> = file.split('/').map(|p| p.replace(' ', "%20").replace('#', "%23")).collect();
    format!("https://{IMAGE_HOST}/{}", path.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const XML: &str = r#"<?xml version="1.0"?><LaunchBox>
<Game><Name>Mario Kart World</Name><DatabaseID>900</DatabaseID><Platform>Nintendo Switch 2</Platform></Game>
<Game><Name>Halo</Name><DatabaseID>901</DatabaseID><Platform>Microsoft Xbox</Platform></Game>
<GameImage><DatabaseID>900</DatabaseID><FileName>abc-01.jpg</FileName><Type>Box - Back</Type><Region>North America</Region></GameImage>
<GameImage><DatabaseID>900</DatabaseID><FileName>abc-02.jpg</FileName><Type>Box - Back</Type><Region>Europe</Region></GameImage>
<GameImage><DatabaseID>900</DatabaseID><FileName>abc-03.jpg</FileName><Type>Screenshot - Gameplay</Type></GameImage>
<GameImage><DatabaseID>900</DatabaseID><FileName>../evil.jpg</FileName><Type>Box - Front</Type></GameImage>
<GameImage><DatabaseID>901</DatabaseID><FileName>halo.jpg</FileName><Type>Box - Back</Type></GameImage>
</LaunchBox>"#;

    #[test]
    fn lecture_en_flux_et_filtrage() {
        // morceaux minuscules : les balises coupées entre deux lectures restent lues
        struct Slow<'a>(&'a [u8]);
        impl Read for Slow<'_> {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                let n = self.0.len().min(7).min(out.len());
                out[..n].copy_from_slice(&self.0[..n]);
                self.0 = &self.0[n..];
                Ok(n)
            }
        }
        let idx = parse(Slow(XML.as_bytes()), || false).unwrap();
        assert_eq!(idx.games, vec![(900, "switch2", "Mario Kart World".to_string())]);
        assert_eq!(idx.images.len(), 2);
        assert!(idx.images.iter().all(|(id, k, _, _)| *id == 900 && *k == "back"));
    }

    /// Chaque type d'image retenu doit entrer dans la table (la contrainte de 010 refusait « disc »).
    #[test]
    fn tous_les_types_d_image_entrent_en_base() {
        let conn = crate::db::open_in_memory().unwrap();
        for t in ["Box - Front", "Box - Back", "Box - Spine", "Box - Full", "Disc"] {
            let kind = kind_of(t).unwrap();
            conn.execute("INSERT INTO ref_launchbox_images (db_id, kind, region, file) VALUES (1, ?1, NULL, 'x.jpg')", [kind])
                .unwrap_or_else(|e| panic!("{t} ({kind}) : {e}"));
        }
    }

    #[test]
    fn titres_et_regions() {
        assert_eq!(title_key("The Legend of Zelda: Tears of the Kingdom – Nintendo Switch 2 Edition"), "legend of zelda tears of kingdom");
        assert_eq!(title_key("Final Fantasy VII"), "final fantasy 7");
        assert_eq!(title_key("Pokémon Légendes"), "pokemon legendes");
        let conn = crate::db::open_in_memory().unwrap();
        let idx = parse(XML.as_bytes(), || false).unwrap();
        for (id, p, n) in &idx.games {
            conn.execute("INSERT INTO ref_launchbox VALUES (?1, ?2, ?3, ?4)", params![id, p, n, title_key(n)]).unwrap();
        }
        for (id, k, r, f) in &idx.images {
            conn.execute("INSERT INTO ref_launchbox_images VALUES (?1, ?2, ?3, ?4)", params![id, k, r, f]).unwrap();
        }
        let pal = box_images(&conn, "switch2", "Mario Kart World", Region::Pal).unwrap().unwrap();
        assert_eq!(pal, vec![("back".to_string(), "https://images.launchbox-app.com/abc-02.jpg".to_string())]);
        let us = box_images(&conn, "switch2", "mario kart world", Region::NtscU).unwrap().unwrap();
        assert!(us[0].1.ends_with("abc-01.jpg"));
        assert!(box_images(&conn, "switch", "Mario Kart World", Region::Pal).unwrap().is_none());
        assert!(crate::metadata::steamgriddb::allowed_image_host(&pal[0].1));
        // même titre sur une autre console (ex. jeu PC ou Switch sans boîte connue) : proposé, console indiquée
        let other = candidates(&conn, "switch", "Mario Kart World", crate::metadata::MediaKind::Back, false, Region::Pal).unwrap();
        assert_eq!(other.len(), 2);
        assert!(other[0].label.contains("Nintendo Switch 2") && other[0].url.ends_with("abc-02.jpg"));
        // aucune tranche nulle part : rien d'inventé
        assert!(candidates(&conn, "switch2", "Mario Kart World", crate::metadata::MediaKind::Spine, false, Region::Pal).unwrap().is_empty());
    }
}


/// Propositions pour le sélecteur d'images : toutes les images de boîte d'une
/// face (toutes régions), pour le titre exact du jeu ou, en recherche libre,
/// pour les jeux dont le titre contient les mots cherchés.
pub fn candidates(conn: &Connection, platform: &str, text: &str, kind: super::MediaKind, search: bool, pref: Region) -> Result<Vec<super::Candidate>> {
    use super::MediaKind as K;
    let face = match kind {
        K::Front => "front",
        K::Back => "back",
        K::Spine => "spine",
        K::Full => "full",
        _ => return Ok(Vec::new()),
    };
    let key = title_key(text);
    if key.len() < 2 {
        return Ok(Vec::new());
    }
    // la console du jeu d'abord ; si elle n'a rien (jeux PC, Switch 2…), le même
    // titre sur les autres consoles, puis — en recherche libre — tout LaunchBox
    let like = format!("%{}%", key.replace('%', "").replace('_', ""));
    let lookups: [(&str, bool); 2] = if search {
        [("platform_id = ?1 AND title_key LIKE ?2", true), ("platform_id <> ?1 AND title_key LIKE ?2", true)]
    } else {
        [("platform_id = ?1 AND title_key = ?2", false), ("platform_id <> ?1 AND title_key = ?2", false)]
    };
    let mut out = Vec::new();
    for (i, (filter, fuzzy)) in lookups.iter().enumerate() {
        if i == 1 && !out.is_empty() {
            break;
        }
        let games: Vec<(i64, String, String)> = conn
            // seulement les jeux qui ont vraiment cette face de boîte
            .prepare(&format!(
                "SELECT db_id, name, platform_id FROM ref_launchbox g WHERE {filter}
                 AND EXISTS (SELECT 1 FROM ref_launchbox_images i WHERE i.db_id = g.db_id AND i.kind = ?3)
                 ORDER BY length(title_key) LIMIT 12"
            ))?
            .query_map(params![platform, if *fuzzy { &like } else { &key }, face], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<std::result::Result<_, _>>()?;
        for (id, name, game_platform) in games {
            let mut rows: Vec<(Option<String>, String)> = conn
                .prepare("SELECT region, file FROM ref_launchbox_images WHERE db_id = ?1 AND kind = ?2")?
                .query_map(params![id, face], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<std::result::Result<_, _>>()?;
            rows.sort_by_key(|(region, _)| region_rank(region.as_deref(), pref));
            let other = (game_platform != platform).then(|| PLATFORMS.iter().find(|(p, _)| *p == game_platform).map(|(_, n)| *n).unwrap_or(""));
            for (region, file) in rows {
                let url = image_url(&file);
                let region = region.as_deref().unwrap_or("toutes régions");
                out.push(super::Candidate {
                    provider: "launchbox",
                    kind,
                    thumb: url.clone(),
                    url,
                    label: match other {
                        Some(p) => format!("{name} · {p} · {region}"),
                        None => format!("{name} · {region}"),
                    },
                    width: None,
                    height: None,
                    score: match (search, other.is_some()) {
                        (false, false) => 1.0,
                        (true, false) => 0.8,
                        (false, true) => 0.7,
                        (true, true) => 0.6,
                    },
                    source_game: None,
                });
            }
        }
    }
    out.truncate(80);
    Ok(out)
}


