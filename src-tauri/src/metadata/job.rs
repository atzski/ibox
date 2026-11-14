//! Récupération des informations et des images pour un ensemble de jeux.
//!
//! 1. Bases de référence : téléchargées si absentes ou anciennes (sinon cache).
//! 2. Pour chaque jeu : texte (GameTDB par identifiant, sinon libretro-database),
//!    puis images (libretro, puis SteamGridDB pour la jaquette si elle manque).
//!    Jaquettes complètes (dos, tranche, face) : GameTDB puis LaunchBox. Une
//!    synchronisation ordinaire repasse aussi sur les jeux déjà traités à qui il
//!    en manque une (au plus une recherche tous les 30 jours par jeu).
//! 3. Les images importées par l'utilisateur ne sont jamais remplacées ; les
//!    correspondances incertaines sont marquées « à choisir », jamais appliquées.

use super::http::Http;
use super::matching::{best_variant, decide, Decision};
use super::media::{MediaStore, MAX_IMAGE_BYTES};
use super::{gametdb, launchbox, libretro_meta, libretro_system, libretro_thumbs, steamgriddb, FetchOptions, MediaKind, MetaError, Result};
use crate::library::{now_iso, repo::sort_title};
use crate::scanner::Region;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    /// « refs » (bases de référence) ou « games ».
    pub phase: &'static str,
    pub done: usize,
    pub total: usize,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub games: usize,
    pub metadata: usize,
    pub images: usize,
    pub ambiguous: usize,
    pub not_found: usize,
    pub errors: Vec<String>,
}

struct GameInfo {
    id: i64,
    platform: String,
    title: String,
    serial: Option<String>,
    locked: bool,
    file_id: i64,
    path: String,
    size: i64,
    crc32: Option<String>,
}

/// Mise à jour d'une base de référence (libellé, action).
type RefTask<'a> = (String, Box<dyn Fn() -> Result<usize> + 'a>);

/// Consoles à cartouche : fichiers assez petits pour calculer un CRC32.
const CRC_PLATFORMS: [&str; 7] = ["gb", "gbc", "gba", "n64", "snes", "ds", "3ds"];
const CRC_MAX_BYTES: i64 = 64 * 1024 * 1024;

pub struct Job<'a> {
    pub http: &'a Http,
    pub store: &'a MediaStore,
    pub options: &'a FetchOptions,
    /// Remplacer les informations et images déjà présentes (sauf imports de l'utilisateur).
    pub force: bool,
    /// Retélécharger les bases de référence même récentes.
    pub refresh_refs: bool,
    pub cancel: &'a AtomicBool,
}

impl Job<'_> {
    pub fn run(&self, conn: &Connection, ids: Option<&[i64]>, mut progress: impl FnMut(JobProgress)) -> Result<JobSummary> {
        let mut summary = JobSummary::default();
        let games = load_games(conn, ids)?;
        // jeux déjà traités à qui il manque la jaquette complète (synchro ordinaire)
        let jacket_only = if ids.is_none() && (self.options.uses("gametdb") || self.options.uses("launchbox")) {
            load_jacket_candidates(conn)?
        } else {
            Vec::new()
        };
        summary.games = games.len() + jacket_only.len();
        let pref = self.options.preferred_region();

        // 1. Bases de référence
        let platforms: BTreeSet<&str> = games.iter().chain(jacket_only.iter()).map(|g| g.platform.as_str()).collect();
        let mut tasks: Vec<RefTask> = Vec::new();
        if self.options.uses("launchbox") && platforms.iter().any(|p| launchbox::supports(p)) {
            tasks.push((
                "LaunchBox Games Database".to_string(),
                Box::new(move || launchbox::ensure(self.http, conn, self.refresh_refs, || self.cancel.load(Ordering::Relaxed))),
            ));
        }
        if self.options.uses("gametdb") {
            let dbs: BTreeSet<&str> = platforms.iter().filter_map(|p| gametdb::database_for(p)).collect();
            for db in dbs {
                tasks.push((format!("GameTDB ({db})"), Box::new(move || gametdb::ensure(self.http, conn, db, self.refresh_refs))));
            }
        }
        if self.options.uses("libretro-db") {
            for p in platforms.iter().filter(|p| libretro_system(p).is_some()) {
                let p = *p;
                tasks.push((format!("libretro-database ({p})"), Box::new(move || libretro_meta::ensure(self.http, conn, p, self.refresh_refs))));
            }
        }
        if self.options.uses("libretro") {
            for p in platforms.iter().filter(|p| libretro_system(p).is_some()) {
                for kind in libretro_thumbs::KINDS {
                    let p = *p;
                    tasks.push((
                        format!("index libretro ({p}, {})", kind.as_str()),
                        Box::new(move || libretro_thumbs::ensure_index(self.http, conn, p, kind, self.refresh_refs)),
                    ));
                }
            }
        }
        let mut offline = false;
        let total_tasks = tasks.len();
        for (i, (label, task)) in tasks.iter().enumerate() {
            self.check()?;
            progress(JobProgress { phase: "refs", done: i, total: total_tasks, current: Some(label.clone()) });
            if offline {
                continue;
            }
            if let Err(e) = task() {
                offline |= matches!(e, MetaError::Network(_));
                summary.errors.push(format!("{label} : {e}"));
            }
        }

        // 2. Jeux
        let mut index_cache: HashMap<(String, MediaKind), Vec<String>> = HashMap::new();
        for (i, game) in games.iter().enumerate() {
            self.check()?;
            progress(JobProgress { phase: "games", done: i, total: games.len(), current: Some(game.title.clone()) });

            match self.text(conn, game) {
                Ok(true) => summary.metadata += 1,
                Ok(false) => {}
                Err(e) => summary.errors.push(format!("{} : {e}", game.title)),
            }

            let mut ambiguous = false;
            if !offline {
                match self.images(conn, game, pref, &mut index_cache) {
                    Ok((n, amb)) => {
                        summary.images += n;
                        ambiguous = amb;
                    }
                    Err(e) => {
                        offline |= matches!(e, MetaError::Network(_));
                        summary.errors.push(format!("{} : {e}", game.title));
                    }
                }
            }

            let has_front = has_media(conn, game.id, MediaKind::Front)?;
            let status = if has_front {
                "found"
            } else if ambiguous {
                summary.ambiguous += 1;
                "ambiguous"
            } else {
                summary.not_found += 1;
                "none"
            };
            conn.execute(
                "UPDATE games SET media_status = ?2, meta_fetched_at = ?3 WHERE id = ?1",
                params![game.id, status, now_iso()],
            )?;
        }
        // 3. Jaquettes complètes des jeux déjà traités
        let total = games.len() + jacket_only.len();
        for (i, game) in jacket_only.iter().enumerate() {
            self.check()?;
            if offline {
                break;
            }
            progress(JobProgress { phase: "games", done: games.len() + i, total, current: Some(game.title.clone()) });
            match self.jackets(conn, game, pref) {
                Ok(n) => summary.images += n,
                Err(e) => {
                    offline |= matches!(e, MetaError::Network(_));
                    summary.errors.push(format!("{} : {e}", game.title));
                }
            }
        }
        progress(JobProgress { phase: "games", done: total, total, current: None });
        if offline {
            summary.errors.insert(0, "Hors connexion : les images n'ont pas pu être téléchargées. Les informations déjà en cache restent disponibles.".into());
        }
        Ok(summary)
    }

    fn check(&self) -> Result<()> {
        if self.cancel.load(Ordering::Relaxed) { Err(MetaError::Cancelled) } else { Ok(()) }
    }

    /// Informations textuelles. Renvoie true si quelque chose a été trouvé.
    fn text(&self, conn: &Connection, game: &GameInfo) -> Result<bool> {
        if self.options.uses("gametdb") && gametdb::database_for(&game.platform).is_some() {
            if let Some(serial) = &game.serial {
                if let Some(row) = gametdb::lookup(conn, &game.platform, serial)? {
                    // Le titre GameTDB (exact, localisé) remplace un titre tiré du nom de fichier
                    let exact = gametdb::serial_key(&game.platform, serial) == row.serial;
                    let title = if exact && !game.locked { row.title() } else { None };
                    apply_text(conn, game.id, &Fields {
                        title,
                        year: row.year,
                        publisher: row.publisher.as_deref(),
                        developer: row.developer.as_deref(),
                        genre: row.genre.as_deref(),
                        players: row.players,
                        description: row.synopsis(),
                    }, "gametdb", self.force)?;
                    return Ok(true);
                }
            }
        }
        if self.options.uses("libretro-db") && libretro_system(&game.platform).is_some() {
            let crc = self.crc(conn, game)?;
            let stem = stem(&game.path);
            if let Some(e) = libretro_meta::lookup(conn, &game.platform, crc.as_deref(), &stem, &game.title)? {
                // genres en français quand une traduction existe
                let genre = e.genre.as_deref().map(|g| gametdb::translate_genre(g).unwrap_or_else(|| g.to_string()));
                apply_text(conn, game.id, &Fields {
                    title: None,
                    year: e.year,
                    publisher: e.publisher.as_deref(),
                    developer: e.developer.as_deref(),
                    genre: genre.as_deref(),
                    players: e.players,
                    description: None,
                }, "libretro-db", self.force)?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// CRC32 des petites cartouches (calculé une fois, conservé en base).
    fn crc(&self, conn: &Connection, game: &GameInfo) -> Result<Option<String>> {
        if let Some(c) = &game.crc32 {
            return Ok(Some(c.clone()));
        }
        if !CRC_PLATFORMS.contains(&game.platform.as_str()) || game.size > CRC_MAX_BYTES {
            return Ok(None);
        }
        let Ok(mut file) = std::fs::File::open(&game.path) else { return Ok(None) }; // lecture seule
        let mut hasher = crc32fast::Hasher::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            self.check()?;
            let n = file.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        let crc = format!("{:08X}", hasher.finalize());
        conn.execute("UPDATE game_files SET crc32 = ?2 WHERE id = ?1", params![game.file_id, crc])?;
        Ok(Some(crc))
    }

    /// Images : renvoie (nombre téléchargé, correspondance à choisir ?).
    fn images(
        &self,
        conn: &Connection,
        game: &GameInfo,
        pref: Region,
        cache: &mut HashMap<(String, MediaKind), Vec<String>>,
    ) -> Result<(usize, bool)> {
        let mut downloaded = 0;
        let mut ambiguous = false;
        let mut names = |kind: MediaKind| -> Result<Vec<String>> {
            let key = (game.platform.clone(), kind);
            if !cache.contains_key(&key) {
                cache.insert(key.clone(), libretro_thumbs::names(conn, &game.platform, kind)?);
            }
            Ok(cache[&key].clone())
        };

        if self.options.uses("libretro") && libretro_system(&game.platform).is_some() {
            let front_names = names(MediaKind::Front)?;
            let chosen = match decide(&stem(&game.path), &game.title, pref, &front_names) {
                Decision::Auto { name, .. } => Some(name),
                Decision::Choose(_) => {
                    ambiguous = true;
                    None
                }
                Decision::None => None,
            };
            if let Some(chosen) = chosen {
                for kind in libretro_thumbs::KINDS {
                    if !self.may_write(conn, game.id, kind)? {
                        continue;
                    }
                    let list = names(kind)?;
                    let Some(name) = best_variant(&chosen, pref, &list) else { continue };
                    let Some(url) = libretro_thumbs::url(&game.platform, kind, name) else { continue };
                    match self.download(&url) {
                        Ok(bytes) => {
                            self.store.save(conn, game.id, kind, 0, &bytes, "libretro", Some(&url))?;
                            downloaded += 1;
                        }
                        Err(MetaError::Http { status: 404, .. }) | Err(MetaError::Invalid(_)) => {}
                        Err(e) => return Err(e),
                    }
                }
                ambiguous = false;
            }
        }

        // Jaquette complète : dos, tranche (et face si elle manque)
        downloaded += self.jackets(conn, game, pref)?;

        // SteamGridDB : jaquette, fond (« hero ») et logo du même jeu quand le titre
        // correspond exactement à un seul jeu ; sinon, proposés à l'utilisateur.
        let mut wanted = Vec::new();
        for kind in [MediaKind::Front, MediaKind::Hero, MediaKind::Logo] {
            if self.may_write(conn, game.id, kind)? && !has_media(conn, game.id, kind)? {
                wanted.push(kind);
            }
        }
        if self.options.uses("steamgriddb") && !wanted.is_empty() {
            // jeu Steam : correspondance par son identifiant (fiable), sinon par titre exact
            let by_steam = match steamgriddb::steam_appid(conn, game.id) {
                Some(appid) => match steamgriddb::game_by_steam(self.http, &appid) {
                    Ok(hit) => hit,
                    Err(MetaError::MissingKey(_)) => None,
                    Err(e) => return Err(e),
                },
                None => None,
            };
            let matched = match by_steam {
                Some(hit) => Ok(Some(hit)),
                None => steamgriddb::auto_match(self.http, &game.title),
            };
            match matched {
                Ok(Some(hit)) => {
                    for kind in wanted {
                        let Some(img) = steamgriddb::first_image(self.http, kind, hit.id)? else { continue };
                        match self.download(&img.url) {
                            Ok(bytes) => {
                                self.store.save(conn, game.id, kind, 0, &bytes, steamgriddb::PROVIDER, Some(&img.url))?;
                                if kind == MediaKind::Front {
                                    downloaded += 1;
                                    ambiguous = false;
                                }
                            }
                            Err(MetaError::Http { status: 404, .. }) | Err(MetaError::Invalid(_)) => {}
                            Err(e) => return Err(e),
                        }
                    }
                }
                // pas de correspondance sûre : à choisir s'il manque la jaquette
                Ok(None) => ambiguous = ambiguous || !has_media(conn, game.id, MediaKind::Front)?,
                Err(MetaError::MissingKey(_)) => {}
                Err(e) => return Err(e),
            }
        }
        Ok((downloaded, ambiguous))
    }

    /// Jaquette complète de la vraie boîte : scan GameTDB (dos | tranche | face,
    /// sortie exacte), sinon images de boîte LaunchBox (titre exact, région
    /// préférée). Ne complète que ce qui manque ; note la date de la recherche.
    fn jackets(&self, conn: &Connection, game: &GameInfo, pref: Region) -> Result<usize> {
        let mut n = 0;
        let wants = |kind: MediaKind| -> Result<bool> { Ok(self.may_write(conn, game.id, kind)? && (self.force || !has_media(conn, game.id, kind)?)) };

        if self.options.uses("gametdb") && wants(MediaKind::Full)? {
            for url in gametdb::full_cover_urls(conn, &game.platform, game.serial.as_deref(), &game.title)? {
                self.check()?;
                match self.download(&url) {
                    Ok(bytes) => {
                        self.store.save(conn, game.id, MediaKind::Full, 0, &bytes, "gametdb", Some(&url))?;
                        n += 1;
                        break;
                    }
                    Err(MetaError::Http { status: 404, .. }) | Err(MetaError::Invalid(_)) => {}
                    Err(e) => return Err(e),
                }
            }
        }

        if self.options.uses("launchbox") && launchbox::supports(&game.platform) {
            let has_full = has_media(conn, game.id, MediaKind::Full)?;
            if let Some(images) = launchbox::box_images(conn, &game.platform, &game.title, pref)? {
                for (kind, url) in images {
                    let kind = match kind.as_str() {
                        "back" => MediaKind::Back,
                        "spine" => MediaKind::Spine,
                        "full" if !has_full => MediaKind::Full,
                        "front" => MediaKind::Front,
                        _ => continue,
                    };
                    if !wants(kind)? {
                        continue;
                    }
                    self.check()?;
                    match self.download(&url) {
                        Ok(bytes) => {
                            self.store.save(conn, game.id, kind, 0, &bytes, "launchbox", Some(&url))?;
                            n += 1;
                        }
                        Err(MetaError::Http { status: 404, .. }) | Err(MetaError::Invalid(_)) => {}
                        Err(e) => return Err(e),
                    }
                }
            }
        }
        conn.execute("UPDATE games SET jacket_checked_at = ?2 WHERE id = ?1", params![game.id, now_iso()])?;
        Ok(n)
    }

    /// N'écrase jamais une image importée ; n'écrase les autres qu'en mode « forcer ».
    fn may_write(&self, conn: &Connection, game_id: i64, kind: MediaKind) -> Result<bool> {
        Ok(match self.store.source_of(conn, game_id, kind, 0)? {
            None => true,
            Some(s) if s == "user" => false,
            Some(_) => self.force,
        })
    }

    fn download(&self, url: &str) -> Result<Vec<u8>> {
        download_image(self.http, url)
    }
}

pub fn download_image(http: &Http, url: &str) -> Result<Vec<u8>> {
    if !steamgriddb::allowed_image_host(url) {
        return Err(MetaError::ForbiddenUrl(url.to_string()));
    }
    http.bytes(url, MAX_IMAGE_BYTES, "l'image")
}

pub struct Fields<'a> {
    pub title: Option<&'a str>,
    pub year: Option<i64>,
    pub publisher: Option<&'a str>,
    pub developer: Option<&'a str>,
    pub genre: Option<&'a str>,
    pub players: Option<i64>,
    pub description: Option<&'a str>,
}

pub fn players_label(n: i64) -> String {
    if n <= 1 { "1 joueur".into() } else { format!("1 à {n} joueurs") }
}

/// Complète les champs vides (ou remplace tout en mode « forcer »).
pub fn apply_text(conn: &Connection, game_id: i64, f: &Fields, source: &str, force: bool) -> Result<()> {
    let players = f.players.map(players_label);
    conn.execute(
        "UPDATE games SET
           year        = CASE WHEN ?2 OR year IS NULL        THEN COALESCE(?3, year)        ELSE year END,
           publisher   = CASE WHEN ?2 OR publisher IS NULL   THEN COALESCE(?4, publisher)   ELSE publisher END,
           developer   = CASE WHEN ?2 OR developer IS NULL   THEN COALESCE(?5, developer)   ELSE developer END,
           genre       = CASE WHEN ?2 OR genre IS NULL       THEN COALESCE(?6, genre)       ELSE genre END,
           players     = CASE WHEN ?2 OR players IS NULL     THEN COALESCE(?7, players)     ELSE players END,
           description = CASE WHEN ?2 OR description IS NULL THEN COALESCE(?8, description) ELSE description END,
           meta_source = ?9
         WHERE id = ?1",
        params![game_id, force, f.year, f.publisher, f.developer, f.genre, players, f.description, source],
    )?;
    if let Some(t) = f.title.map(str::trim).filter(|t| !t.is_empty()) {
        conn.execute(
            "UPDATE games SET title = ?2, sort_title = ?3 WHERE id = ?1 AND user_locked = 0",
            params![game_id, t, sort_title(t)],
        )?;
    }
    Ok(())
}

fn stem(path: &str) -> String {
    Path::new(path).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

fn has_media(conn: &Connection, game_id: i64, kind: MediaKind) -> Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM media WHERE game_id = ?1 AND kind = ?2", params![game_id, kind.as_str()], |_| Ok(()))
        .optional()?
        .is_some())
}

/// Jeux déjà traités sans dos ni scan complet, sur une console qui a des
/// jaquettes complètes, pas recherchés depuis 30 jours.
fn load_jacket_candidates(conn: &Connection) -> Result<Vec<GameInfo>> {
    let mut stmt = conn.prepare(
        "SELECT g.id, g.platform_id, g.title, g.serial, g.user_locked, m.id, m.path, m.size, m.crc32
         FROM games g JOIN game_files m ON m.game_id = g.id AND m.role = 'main'
         WHERE m.status = 'present' AND g.meta_fetched_at IS NOT NULL
           AND (g.jacket_checked_at IS NULL OR julianday('now') - julianday(g.jacket_checked_at) > 30)
           AND NOT EXISTS (SELECT 1 FROM media x WHERE x.game_id = g.id AND x.kind IN ('back', 'full'))
         ORDER BY g.sort_title",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(GameInfo {
            id: r.get(0)?,
            platform: r.get(1)?,
            title: r.get(2)?,
            serial: r.get(3)?,
            locked: r.get(4)?,
            file_id: r.get(5)?,
            path: r.get(6)?,
            size: r.get(7)?,
            crc32: r.get(8)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        let g = r?;
        if launchbox::supports(&g.platform) || ["gamecube", "wii", "3ds", "switch"].contains(&g.platform.as_str()) {
            out.push(g);
        }
    }
    Ok(out)
}

fn load_games(conn: &Connection, ids: Option<&[i64]>) -> Result<Vec<GameInfo>> {
    let base = "SELECT g.id, g.platform_id, g.title, g.serial, g.user_locked, m.id, m.path, m.size, m.crc32
                FROM games g JOIN game_files m ON m.game_id = g.id AND m.role = 'main'
                WHERE m.status = 'present'";
    let read = |r: &rusqlite::Row| {
        Ok(GameInfo {
            id: r.get(0)?,
            platform: r.get(1)?,
            title: r.get(2)?,
            serial: r.get(3)?,
            locked: r.get(4)?,
            file_id: r.get(5)?,
            path: r.get(6)?,
            size: r.get(7)?,
            crc32: r.get(8)?,
        })
    };
    let mut out = Vec::new();
    match ids {
        Some(ids) => {
            let mut stmt = conn.prepare(&format!("{base} AND g.id = ?1"))?;
            for id in ids {
                if let Some(g) = stmt.query_row([id], read).optional()? {
                    out.push(g);
                }
            }
        }
        // Sans liste : uniquement les jeux jamais traités
        None => {
            let mut stmt = conn.prepare(&format!("{base} AND g.meta_fetched_at IS NULL ORDER BY g.sort_title"))?;
            let rows = stmt.query_map([], read)?;
            for r in rows {
                out.push(r?);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn completer_sans_ecraser_puis_forcer() {
        let conn = crate::db::open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO games (id, platform_id, title, sort_title, added_at, id_method, id_confidence, publisher, user_locked)
             VALUES (1, 'gamecube', 'pikmin test', 'pikmin test', 'x', 'header', 1, 'Éditeur manuel', 0),
                    (2, 'gamecube', 'Mon titre', 'mon titre', 'x', 'manual', 1, NULL, 1);",
        )
        .unwrap();
        let f = Fields {
            title: Some("Pikmin"),
            year: Some(2002),
            publisher: Some("Nintendo"),
            developer: Some("Nintendo EAD"),
            genre: Some("Stratégie"),
            players: Some(1),
            description: Some("Olimar…"),
        };
        apply_text(&conn, 1, &f, "gametdb", false).unwrap();
        let (title, publisher, players): (String, String, String) =
            conn.query_row("SELECT title, publisher, players FROM games WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((title.as_str(), publisher.as_str(), players.as_str()), ("Pikmin", "Éditeur manuel", "1 joueur"));

        apply_text(&conn, 1, &f, "gametdb", true).unwrap();
        let publisher: String = conn.query_row("SELECT publisher FROM games WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(publisher, "Nintendo");

        // un titre corrigé à la main n'est jamais remplacé
        apply_text(&conn, 2, &f, "gametdb", true).unwrap();
        let title: String = conn.query_row("SELECT title FROM games WHERE id = 2", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Mon titre");
    }

    #[test]
    fn telechargement_limite_aux_sources_connues() {
        let http = Http::new().unwrap();
        assert!(matches!(download_image(&http, "https://example.com/a.png"), Err(MetaError::ForbiddenUrl(_))));
        assert!(matches!(download_image(&http, "file:///C:/x.png"), Err(MetaError::ForbiddenUrl(_))));
    }

    #[test]
    fn libelle_joueurs() {
        assert_eq!(players_label(1), "1 joueur");
        assert_eq!(players_label(4), "1 à 4 joueurs");
    }
}
