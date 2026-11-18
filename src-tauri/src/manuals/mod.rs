//! Manuels de jeu (carnets feuilletables dans les boîtiers).
//!
//! Un manuel = un PDF rangé dans `manuals/` (dossier des données d'iBox), une
//! ligne de `game_manuals`. Sources (activables dans les paramètres) :
//! - import local : PDF choisi par l'utilisateur ;
//! - `steam`         : manuel officiel publié sur la page Steam du jeu ;
//! - `screenscraper` : médias « manuel » de ScreenScraper (identifiants développeur
//!   fournis à la compilation, compte utilisateur facultatif) ;
//! - `archive`       : collections de manuels de l'Internet Archive (correspondance
//!   par titre, appliquée seule uniquement quand elle est sûre).
//!
//! Les PDF ne sont jamais redistribués : ils restent dans le cache local.

pub mod archive;
pub mod commands;
pub mod screenscraper;
pub mod steam;

use crate::library::time::now_iso;
use crate::metadata::http::Http;
use crate::metadata::{MetaError, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Taille maximale d'un manuel (les scans haute définition dépassent rarement 150 Mo).
pub const MAX_BYTES: u64 = 400 * 1024 * 1024;

/// Manuel connu d'un jeu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualInfo {
    pub game_id: i64,
    pub source: String,
    pub region: Option<String>,
    pub size: i64,
    pub pages: Option<i64>,
    pub added_at: String,
}

/// Manuel trouvé chez une source, pas encore téléchargé.
#[derive(Debug, Clone)]
pub struct Found {
    pub source: &'static str,
    /// Identifiant stable chez la source (enregistré avec le manuel).
    pub reference: String,
    /// Adresse de téléchargement (peut contenir des identifiants : jamais envoyée à l'interface).
    pub url: String,
    pub title: String,
    pub region: Option<String>,
    pub size: Option<u64>,
    /// Confiance de la correspondance (0..1). 1 = identifiant exact.
    pub score: f32,
}

/// Réglages transmis par l'interface.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualOptions {
    /// Sources activées : « steam », « screenscraper », « archive ».
    pub sources: Vec<String>,
    /// Région préférée : PAL | NTSC-U | NTSC-J.
    pub region: String,
    /// Langue de l'interface : fr | en.
    pub language: String,
    /// Région du jeu lui-même (PAL | NTSC-U | NTSC-J), renseignée côté natif :
    /// le manuel de la même édition que la boîte passe avant les autres.
    #[serde(default)]
    pub game_region: Option<String>,
}

impl ManualOptions {
    pub fn uses(&self, s: &str) -> bool {
        self.sources.iter().any(|x| x == s)
    }

    /// Ordre de préférence des régions ScreenScraper / No-Intro.
    pub fn region_order(&self) -> Vec<&'static str> {
        let mut out: Vec<&'static str> = Vec::new();
        if self.language == "fr" {
            out.extend(["fr", "eu", "wor"]);
        }
        match self.game_region.as_deref() {
            Some("PAL") => out.extend(["eu", "uk", "wor"]),
            Some("NTSC-U") => out.extend(["us", "ca", "wor"]),
            Some("NTSC-J") => out.extend(["jp"]),
            _ => {}
        }
        match self.region.as_str() {
            "NTSC-U" => out.extend(["us", "wor", "ca", "uk", "eu", "au"]),
            "NTSC-J" => out.extend(["jp", "wor", "us", "eu"]),
            _ => out.extend(["eu", "wor", "uk", "us", "au"]),
        }
        // ScreenScraper écrit « sp » pour l'Espagne
        out.extend(["fr", "de", "es", "sp", "it", "nl", "pt", "br", "kr", "cn", "jp", "ss"]);
        let mut seen = std::collections::HashSet::new();
        out.retain(|r| seen.insert(*r));
        out
    }

    /// Rang d'une région (plus petit = préféré).
    pub fn region_rank(&self, region: Option<&str>) -> usize {
        let order = self.region_order();
        region.and_then(|r| order.iter().position(|x| *x == r)).unwrap_or(order.len())
    }
}

/// Jeu tel que les sources en ont besoin.
#[derive(Debug, Clone)]
pub struct GameInfo {
    pub id: i64,
    pub region: Option<String>,
    pub platform: String,
    pub title: String,
    pub serial: Option<String>,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    pub crc32: Option<String>,
    pub steam_appid: Option<String>,
}

pub fn game_info(conn: &Connection, game_id: i64) -> Result<GameInfo> {
    let row = conn
        .query_row(
            "SELECT g.platform_id, g.title, g.serial, f.path, f.size, f.crc32, g.region FROM games g
             LEFT JOIN game_files f ON f.game_id = g.id AND f.role IN ('main', 'disc', 'playlist')
             WHERE g.id = ?1 ORDER BY CASE f.role WHEN 'main' THEN 0 WHEN 'disc' THEN 1 ELSE 2 END, f.disc_number LIMIT 1",
            [game_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?
        .ok_or(MetaError::NotFound)?;
    let steam_appid: Option<String> = conn
        .query_row(
            "SELECT external_id FROM pc_installs WHERE game_id = ?1 AND source = 'steam' ORDER BY preferred DESC LIMIT 1",
            [game_id],
            |r| r.get(0),
        )
        .optional()?;
    let file_name = row.3.as_deref().and_then(|p| Path::new(p).file_name()).map(|n| n.to_string_lossy().into_owned());
    Ok(GameInfo { id: game_id, region: row.6, platform: row.0, title: row.1, serial: row.2, file_name, file_size: row.4, crc32: row.5, steam_appid })
}

/// Rangement des PDF.
pub struct ManualStore {
    root: PathBuf,
}

impl ManualStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn path(&self, file: &str) -> Result<PathBuf> {
        // jamais de chemin fourni de l'extérieur : seulement des noms produits ici
        if file.contains(['/', '\\']) || file.contains("..") {
            return Err(MetaError::Invalid(file.to_string()));
        }
        Ok(self.root.join(file))
    }

    pub fn info(&self, conn: &Connection, game_id: i64) -> Result<Option<ManualInfo>> {
        Ok(conn
            .query_row(
                "SELECT game_id, source, region, size, pages, added_at FROM game_manuals WHERE game_id = ?1",
                [game_id],
                map_info,
            )
            .optional()?)
    }

    pub fn list(&self, conn: &Connection) -> Result<Vec<ManualInfo>> {
        let mut st = conn.prepare("SELECT game_id, source, region, size, pages, added_at FROM game_manuals")?;
        let rows = st.query_map([], map_info)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn read(&self, conn: &Connection, game_id: i64) -> Result<Vec<u8>> {
        let file: String = conn
            .query_row("SELECT file FROM game_manuals WHERE game_id = ?1", [game_id], |r| r.get(0))
            .optional()?
            .ok_or(MetaError::NotFound)?;
        Ok(std::fs::read(self.path(&file)?)?)
    }

    /// Couverture déjà rendue (JPEG), si le lecteur l'a enregistrée.
    pub fn read_cover(&self, conn: &Connection, game_id: i64) -> Result<Option<Vec<u8>>> {
        let Some(file) = self.file_of(conn, game_id)? else { return Ok(None) };
        match std::fs::read(self.path(&cover_name(&file))?) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save_cover(&self, conn: &Connection, game_id: i64, jpeg: &[u8], pages: Option<i64>) -> Result<()> {
        if crate::metadata::media::sniff(jpeg).is_none() || jpeg.len() > 8 * 1024 * 1024 {
            return Err(MetaError::Invalid("couverture".into()));
        }
        let Some(file) = self.file_of(conn, game_id)? else { return Err(MetaError::NotFound) };
        std::fs::write(self.path(&cover_name(&file))?, jpeg)?;
        if let Some(p) = pages.filter(|p| *p > 0) {
            conn.execute("UPDATE game_manuals SET pages = ?2 WHERE game_id = ?1", params![game_id, p])?;
        }
        Ok(())
    }

    /// Dossier du cache des pages d'un manuel (supprimé avec lui).
    fn cache_dir(&self, file: &str) -> Result<PathBuf> {
        self.path(file)?;
        Ok(self.root.join("cache").join(file.trim_end_matches(".pdf")))
    }

    /// Page déjà rendue (JPEG), à une largeur donnée.
    pub fn read_page(&self, conn: &Connection, game_id: i64, page: u32, width: u32) -> Result<Option<Vec<u8>>> {
        let Some(file) = self.file_of(conn, game_id)? else { return Ok(None) };
        match std::fs::read(self.cache_dir(&file)?.join(format!("{page}-{width}.jpg"))) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save_page(&self, conn: &Connection, game_id: i64, page: u32, width: u32, jpeg: &[u8]) -> Result<()> {
        if crate::metadata::media::sniff(jpeg).is_none() || jpeg.len() > 12 * 1024 * 1024 || page == 0 || page > 5000 || width > 4096 {
            return Err(MetaError::Invalid("page".into()));
        }
        let Some(file) = self.file_of(conn, game_id)? else { return Err(MetaError::NotFound) };
        let dir = self.cache_dir(&file)?;
        std::fs::create_dir_all(&dir)?;
        let tmp = dir.join(format!("{page}-{width}.tmp"));
        std::fs::write(&tmp, jpeg)?;
        std::fs::rename(&tmp, dir.join(format!("{page}-{width}.jpg")))?;
        Ok(())
    }

    /// Mise en page (proportions des pages, JSON) calculée une fois par le lecteur.
    pub fn read_layout(&self, conn: &Connection, game_id: i64) -> Result<Option<String>> {
        let Some(file) = self.file_of(conn, game_id)? else { return Ok(None) };
        match std::fs::read_to_string(self.cache_dir(&file)?.join("layout.json")) {
            Ok(s) => Ok(Some(s)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save_layout(&self, conn: &Connection, game_id: i64, layout: &str) -> Result<()> {
        if layout.len() > 256 * 1024 || serde_json::from_str::<Vec<f64>>(layout).is_err() {
            return Err(MetaError::Invalid("mise en page".into()));
        }
        let Some(file) = self.file_of(conn, game_id)? else { return Err(MetaError::NotFound) };
        let dir = self.cache_dir(&file)?;
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join("layout.json"), layout)?;
        Ok(())
    }

    fn file_of(&self, conn: &Connection, game_id: i64) -> Result<Option<String>> {
        Ok(conn.query_row("SELECT file FROM game_manuals WHERE game_id = ?1", [game_id], |r| r.get(0)).optional()?)
    }

    /// Retire le manuel ; `dismiss` : l'utilisateur n'en veut pas, ne plus le chercher seul.
    pub fn remove(&self, conn: &Connection, game_id: i64, dismiss: bool) -> Result<()> {
        if let Some(file) = self.file_of(conn, game_id)? {
            let _ = std::fs::remove_file(self.path(&file)?);
            let _ = std::fs::remove_file(self.path(&cover_name(&file))?);
            let _ = std::fs::remove_dir_all(self.cache_dir(&file)?);
        }
        conn.execute("DELETE FROM game_manuals WHERE game_id = ?1", [game_id])?;
        if dismiss {
            set_lookup(conn, game_id, "dismissed")?;
        }
        Ok(())
    }

    /// Copie un PDF local.
    pub fn import(&self, conn: &Connection, game_id: i64, source_path: &Path) -> Result<ManualInfo> {
        let mut src = std::fs::File::open(source_path)?;
        let len = src.metadata()?.len();
        if len > MAX_BYTES {
            return Err(MetaError::Invalid("PDF trop volumineux".into()));
        }
        self.write_from(conn, game_id, &mut src, "user", None, None)
    }

    /// Télécharge un manuel trouvé chez une source.
    pub fn download(&self, conn: &Connection, http: &Http, game_id: i64, found: &Found) -> Result<ManualInfo> {
        std::fs::create_dir_all(&self.root)?;
        let tmp = self.root.join(format!("{game_id}.part"));
        let result = (|| {
            let mut out = std::fs::File::create(&tmp)?;
            http.download_to(&found.url, &mut out, MAX_BYTES, "le manuel")?;
            out.flush()?;
            drop(out);
            let mut f = std::fs::File::open(&tmp)?;
            self.write_from(conn, game_id, &mut f, found.source, Some(&found.reference), found.region.as_deref())
        })();
        let _ = std::fs::remove_file(&tmp);
        result
    }

    fn write_from(
        &self,
        conn: &Connection,
        game_id: i64,
        src: &mut impl Read,
        source: &str,
        reference: Option<&str>,
        region: Option<&str>,
    ) -> Result<ManualInfo> {
        std::fs::create_dir_all(&self.root)?;
        let mut head = [0u8; 1024];
        let n = read_up_to(src, &mut head)?;
        if !is_pdf(&head[..n]) {
            return Err(MetaError::Invalid("ce fichier n'est pas un PDF".into()));
        }
        let stamp = now_iso().replace([':', '-'], "");
        let file = format!("{game_id}-{}.pdf", &stamp[..15.min(stamp.len())]);
        let path = self.path(&file)?;
        let tmp = path.with_extension("pdf.tmp");
        let size = {
            let mut out = std::fs::File::create(&tmp)?;
            out.write_all(&head[..n])?;
            let rest = std::io::copy(&mut src.take(MAX_BYTES), &mut out)?;
            out.flush()?;
            n as u64 + rest
        };
        // l'ancien manuel (et sa couverture) laisse la place au nouveau
        if let Some(old) = self.file_of(conn, game_id)? {
            if old != file {
                let _ = std::fs::remove_file(self.path(&old)?);
                let _ = std::fs::remove_file(self.path(&cover_name(&old))?);
                let _ = std::fs::remove_dir_all(self.cache_dir(&old)?);
            }
        }
        std::fs::rename(&tmp, &path)?;
        conn.execute(
            "INSERT INTO game_manuals (game_id, source, source_ref, region, file, size, pages, added_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)
             ON CONFLICT(game_id) DO UPDATE SET source = ?2, source_ref = ?3, region = ?4, file = ?5, size = ?6, pages = NULL, added_at = ?7",
            params![game_id, source, reference, region, file, size as i64, now_iso()],
        )?;
        set_lookup(conn, game_id, "found")?;
        self.info(conn, game_id)?.ok_or(MetaError::NotFound)
    }

    pub fn size_bytes(&self) -> u64 {
        fn walk(dir: &Path) -> u64 {
            std::fs::read_dir(dir)
                .map(|it| {
                    it.flatten()
                        .map(|e| match e.metadata() {
                            Ok(m) if m.is_dir() => walk(&e.path()),
                            Ok(m) => m.len(),
                            Err(_) => 0,
                        })
                        .sum()
                })
                .unwrap_or(0)
        }
        walk(&self.root)
    }

    /// Fichiers orphelins (jeu retiré, téléchargement interrompu).
    pub fn collect_garbage(&self, conn: &Connection) -> Result<usize> {
        let mut st = conn.prepare("SELECT file FROM game_manuals")?;
        let keep: std::collections::HashSet<String> =
            st.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?.into_iter().flat_map(|f| [cover_name(&f), f]).collect();
        let mut n = 0;
        if let Ok(it) = std::fs::read_dir(&self.root) {
            for e in it.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if e.path().is_dir() {
                    continue;
                }
                if !keep.contains(&name) && std::fs::remove_file(e.path()).is_ok() {
                    n += 1;
                }
            }
        }
        // caches de pages des manuels disparus
        if let Ok(it) = std::fs::read_dir(self.root.join("cache")) {
            for e in it.flatten() {
                let name = format!("{}.pdf", e.file_name().to_string_lossy());
                if !keep.contains(&name) && std::fs::remove_dir_all(e.path()).is_ok() {
                    n += 1;
                }
            }
        }
        Ok(n)
    }
}

fn map_info(r: &rusqlite::Row) -> rusqlite::Result<ManualInfo> {
    Ok(ManualInfo { game_id: r.get(0)?, source: r.get(1)?, region: r.get(2)?, size: r.get(3)?, pages: r.get(4)?, added_at: r.get(5)? })
}

fn cover_name(file: &str) -> String {
    format!("{}.cover.jpg", file.trim_end_matches(".pdf"))
}

fn read_up_to(src: &mut impl Read, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut n = 0;
    while n < buf.len() {
        match src.read(&mut buf[n..])? {
            0 => break,
            k => n += k,
        }
    }
    Ok(n)
}

/// Un PDF commence par « %PDF- » (parfois après quelques octets parasites).
pub fn is_pdf(head: &[u8]) -> bool {
    head.windows(5).take(1024).any(|w| w == b"%PDF-")
}

pub fn set_lookup(conn: &Connection, game_id: i64, outcome: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO manual_lookups (game_id, outcome, checked_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(game_id) DO UPDATE SET outcome = ?2, checked_at = ?3",
        params![game_id, outcome, now_iso()],
    )?;
    Ok(())
}

/// Dernière recherche : (résultat, date ISO).
pub fn lookup(conn: &Connection, game_id: i64) -> Result<Option<(String, String)>> {
    Ok(conn
        .query_row("SELECT outcome, checked_at FROM manual_lookups WHERE game_id = ?1", [game_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?)
}

/// Plateformes citées dans un titre (« Super Mario World (SNES) Manual »…).
/// Les noms les plus longs d'abord : « PlayStation 2 » n'est pas « PlayStation ».
pub fn platforms_in(text: &str) -> Vec<&'static str> {
    const NAMES: &[(&str, &str)] = &[
        ("game boy advance", "gba"),
        ("game boy color", "gbc"),
        ("nintendo entertainment system", "nes"),
        ("super nintendo", "snes"),
        ("super famicom", "snes"),
        ("playstation portable", "psp"),
        ("playstation 3", "ps3"),
        ("playstation 2", "ps2"),
        ("playstation", "ps1"),
        ("master system", "mastersystem"),
        ("nintendo 64", "n64"),
        ("nintendo ds", "ds"),
        ("mega drive", "megadrive"),
        ("megadrive", "megadrive"),
        ("game boy", "gb"),
        ("game gear", "gamegear"),
        ("game cube", "gamecube"),
        ("gamecube", "gamecube"),
        ("xbox 360", "xbox360"),
        ("dreamcast", "dreamcast"),
        ("genesis", "megadrive"),
        ("saturn", "saturn"),
        ("famicom", "nes"),
        ("wii u", "wiiu"),
        ("atari 2600", "atari2600"),
        ("jaguar", "jaguar"),
        ("switch", "switch"),
        ("xbox", "xbox"),
        ("snes", "snes"),
        ("n64", "n64"),
        ("gba", "gba"),
        ("gbc", "gbc"),
        ("nes", "nes"),
        ("3ds", "3ds"),
        ("nds", "ds"),
        ("psx", "ps1"),
        ("ps1", "ps1"),
        ("ps2", "ps2"),
        ("ps3", "ps3"),
        ("psp", "psp"),
        ("wii", "wii"),
        ("ngc", "gamecube"),
        ("windows", "pc"),
        ("dos", "pc"),
        ("pc", "pc"),
    ];
    let folded = crate::metadata::matching::name_key_raw(text);
    let mut padded = format!(" {folded} ");
    let mut out = Vec::new();
    for (name, id) in NAMES {
        let needle = format!(" {name} ");
        if padded.contains(&needle) {
            padded = padded.replace(&needle, " ");
            if !out.contains(id) {
                out.push(*id);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnait_un_pdf() {
        assert!(is_pdf(b"%PDF-1.7\n..."));
        assert!(is_pdf(b"\xef\xbb\xbf%PDF-1.4"));
        assert!(!is_pdf(b"<html><body>"));
    }

    #[test]
    fn plateformes_citees() {
        assert_eq!(platforms_in("Super Metroid (SNES) Manual"), vec!["snes"]);
        assert_eq!(platforms_in("Gran Turismo 4 PlayStation 2 manual"), vec!["ps2"]);
        assert_eq!(platforms_in("Pokemon Emerald - Game Boy Advance"), vec!["gba"]);
        assert!(platforms_in("Super Metroid (USA)").is_empty());
    }

    #[test]
    fn ordre_des_regions() {
        let fr = ManualOptions { sources: vec![], region: "PAL".into(), language: "fr".into(), game_region: None };
        assert!(fr.region_rank(Some("fr")) < fr.region_rank(Some("eu")));
        assert!(fr.region_rank(Some("eu")) < fr.region_rank(Some("us")));
        assert!(fr.region_rank(Some("us")) < fr.region_rank(None));
        let us = ManualOptions { sources: vec![], region: "NTSC-U".into(), language: "en".into(), game_region: None };
        assert!(us.region_rank(Some("us")) < us.region_rank(Some("eu")));
        // jeu japonais : son manuel japonais passe avant l'américain pour un joueur anglophone
        let jp = ManualOptions { game_region: Some("NTSC-J".into()), ..us };
        assert!(jp.region_rank(Some("jp")) < jp.region_rank(Some("us")));
    }

    #[test]
    fn import_refuse_ce_qui_n_est_pas_un_pdf() {
        let dir = std::env::temp_dir().join(format!("ibox-manuals-{}", std::process::id()));
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence) VALUES (1, 'snes', 'X', 'x', 'now', 'manual', 1)",
            [],
        )
        .unwrap();
        let store = ManualStore::new(dir.clone());
        std::fs::create_dir_all(&dir).unwrap();
        let bad = dir.join("faux.pdf");
        std::fs::write(&bad, b"<html>").unwrap();
        assert!(store.import(&conn, 1, &bad).is_err());
        let good = dir.join("vrai.pdf");
        std::fs::write(&good, b"%PDF-1.4\n%%EOF").unwrap();
        let info = store.import(&conn, 1, &good).unwrap();
        assert_eq!(info.source, "user");
        // cache des pages et mise en page
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, b'J', b'F', b'I', b'F', 0];
        store.save_page(&conn, 1, 1, 960, &jpeg).unwrap();
        assert_eq!(store.read_page(&conn, 1, 1, 960).unwrap().as_deref(), Some(&jpeg[..]));
        assert!(store.read_page(&conn, 1, 2, 960).unwrap().is_none());
        store.save_layout(&conn, 1, "[0.7,1.4]").unwrap();
        assert_eq!(store.read_layout(&conn, 1).unwrap().as_deref(), Some("[0.7,1.4]"));
        assert!(store.save_layout(&conn, 1, "pas du json").is_err());
        assert_eq!(store.read(&conn, 1).unwrap(), b"%PDF-1.4\n%%EOF");
        store.remove(&conn, 1, true).unwrap();
        assert!(store.info(&conn, 1).unwrap().is_none());
        assert!(!dir.join("cache").read_dir().map(|mut d| d.next().is_some()).unwrap_or(false), "cache des pages supprimé avec le manuel");
        assert_eq!(lookup(&conn, 1).unwrap().unwrap().0, "dismissed");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Essais réels (réseau) : `cargo test --lib manuals::live -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    use super::*;

    fn game(platform: &str, title: &str, steam: Option<&str>) -> GameInfo {
        GameInfo { id: 0, region: None, platform: platform.into(), title: title.into(), serial: None, file_name: None, file_size: None, crc32: None, steam_appid: steam.map(str::to_string) }
    }

    #[test]
    #[ignore]
    fn vrai_archive_et_steam() {
        let http = Http::new().unwrap();
        let opts = ManualOptions { sources: vec![], region: "PAL".into(), language: "fr".into(), game_region: None };
        for (p, t) in [("snes", "Super Metroid"), ("megadrive", "Sonic the Hedgehog 2"), ("ps1", "Crash Bandicoot"), ("n64", "Super Mario 64"), ("gamecube", "Super Mario Sunshine")] {
            let found = archive::find(&http, &game(p, t, None), &opts).unwrap();
            println!("{p} {t} :");
            for f in &found {
                println!("   {:.2} {:?} {} {:?} {}", f.score, f.region, f.title, f.size, f.url);
            }
        }
        let s = steam::find(&http, &game("pc", "Oblivion", Some("22330"))).unwrap();
        println!("steam : {:?}", s.iter().map(|f| &f.url).collect::<Vec<_>>());
        assert_eq!(s.len(), 1);
        let none = steam::find(&http, &game("pc", "Portal 2", Some("620"))).unwrap();
        println!("steam sans manuel : {}", none.len());
    }

    /// Jeux listés dans le fichier `IBOX_MANUAL_GAMES` (JSON : plateforme, titre, région,
    /// série, chemin, taille) : combien de manuels sûrs seraient ajoutés.
    #[test]
    #[ignore]
    fn vrai_collection() {
        let Ok(path) = std::env::var("IBOX_MANUAL_GAMES") else { return };
        let list: Vec<(String, String, Option<String>, Option<String>, Option<String>, Option<i64>)> =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let http = Http::new().unwrap();
        let opts = ManualOptions { sources: vec!["steam".into(), "screenscraper".into(), "archive".into()], region: "PAL".into(), language: "fr".into(), game_region: None };
        let (mut sure, mut maybe) = (0, 0);
        for (platform, title, region, serial, file, size) in &list {
            let g = GameInfo {
                id: 0,
                region: region.clone(),
                platform: platform.clone(),
                title: title.clone(),
                serial: serial.clone(),
                file_name: file.as_deref().and_then(|p| Path::new(p).file_name()).map(|n| n.to_string_lossy().into_owned()),
                file_size: *size,
                crc32: None,
                steam_appid: None,
            };
            let o = ManualOptions { game_region: region.clone(), ..opts.clone() };
            let mut found = Vec::new();
            if screenscraper::available() {
                match screenscraper::find(&http, &g, &o) { Ok(f) => found.extend(f), Err(e) => println!("   SS erreur : {e}") }
            }
            match archive::find(&http, &g, &o) { Ok(f) => found.extend(f), Err(e) => println!("   IA erreur : {e}") }
            let best = found.iter().map(|f| f.score).fold(0.0f32, f32::max);
            if best >= archive::AUTO_SCORE { sure += 1 } else if best > 0.0 { maybe += 1 }
            println!("{:<9} {:<55} sûr={} propositions={} meilleur={:.2} {:?}", platform, title, best >= archive::AUTO_SCORE, found.len(), best, found.first().map(|f| (&f.source, &f.region)));
        }
        println!("== {} jeux : {} sûrs, {} à vérifier", list.len(), sure, maybe);
    }

    /// Demande `IBOX_SS_DEVID` / `IBOX_SS_DEVPASSWORD` à la compilation.
    #[test]
    #[ignore]
    fn vrai_screenscraper() {
        if !screenscraper::available() {
            println!("identifiants développeur absents : essai sauté");
            return;
        }
        let http = Http::new().unwrap();
        let opts = ManualOptions { sources: vec![], region: "PAL".into(), language: "fr".into(), game_region: None };
        let mut g = game("snes", "Super Metroid", None);
        g.file_name = Some("Super Metroid (Japan, USA) (En,Ja).sfc".into());
        g.file_size = Some(3_145_728);
        let found = screenscraper::find(&http, &g, &opts).unwrap();
        for f in &found {
            println!("   {:.2} {:?} {} {:?}", f.score, f.region, f.title, f.size);
        }
        assert!(!found.is_empty(), "aucun manuel ScreenScraper pour Super Metroid");
        assert!(found.iter().all(|f| f.url.starts_with("https://")));
    }
}
