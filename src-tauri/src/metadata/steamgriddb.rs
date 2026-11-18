//! SteamGridDB (API v2, clé personnelle en « Bearer ») : jaquettes et logos.
//! La recherche se fait par nom : les résultats sont proposés à l'utilisateur,
//! sauf titre strictement identique et unique.

use super::http::{encode_segment, Http};
use super::matching::{name_key, similarity};
use super::{keys, Candidate, MediaKind, MetaError, Result};
use serde::{Deserialize, Serialize};

pub const PROVIDER: &str = "steamgriddb";
const BASE: &str = "https://www.steamgriddb.com/api/v2";

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    success: bool,
    data: Option<T>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Hit {
    pub id: u64,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Image {
    pub url: String,
    pub thumb: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

fn key() -> Result<String> {
    keys::get(PROVIDER)?.ok_or(MetaError::MissingKey("SteamGridDB"))
}

fn call<T: for<'de> Deserialize<'de>>(http: &Http, key: &str, path: &str) -> Result<T> {
    match http.json::<Envelope<T>>(&format!("{BASE}{path}"), Some(key), "SteamGridDB") {
        Ok(Envelope { success: true, data: Some(d) }) => Ok(d),
        Ok(_) => Err(MetaError::Invalid("réponse SteamGridDB inattendue".into())),
        Err(MetaError::Http { status: 401, .. }) | Err(MetaError::Http { status: 403, .. }) => Err(MetaError::BadKey("SteamGridDB")),
        Err(e) => Err(e),
    }
}

/// Vérifie une clé avant de l'enregistrer.
pub fn verify(http: &Http, key: &str) -> Result<()> {
    call::<Vec<Hit>>(http, key, "/search/autocomplete/mario").map(|_| ())
}

pub fn search(http: &Http, title: &str) -> Result<Vec<Hit>> {
    let key = key()?;
    call(http, &key, &format!("/search/autocomplete/{}", encode_segment(title)))
}

/// Une page d'images (l'API en renvoie jusqu'à 50 par page).
fn images_page(http: &Http, key: &str, kind: MediaKind, game_id: u64, page: u32) -> Result<Vec<Image>> {
    let path = match kind {
        MediaKind::Logo => format!("/logos/game/{game_id}?types=static&nsfw=false&humor=false&page={page}"),
        MediaKind::Hero => format!("/heroes/game/{game_id}?types=static&nsfw=false&humor=false&page={page}"),
        // jaquettes : formats verticaux (boîtier), tous styles confondus
        _ => format!("/grids/game/{game_id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false&humor=false&page={page}"),
    };
    match call::<Vec<Image>>(http, key, &path) {
        Err(MetaError::Http { status: 404, .. }) => Ok(Vec::new()),
        other => other,
    }
}

fn images(http: &Http, key: &str, kind: MediaKind, game_id: u64) -> Result<Vec<Image>> {
    images_page(http, key, kind, game_id, 0)
}

/// Toutes les images d'un jeu, page après page (150 au plus).
fn all_images(http: &Http, key: &str, kind: MediaKind, game_id: u64) -> Result<Vec<Image>> {
    let mut out = Vec::new();
    for page in 0..3 {
        let batch = images_page(http, key, kind, game_id, page)?;
        let last = batch.len() < 50;
        out.extend(batch);
        if last {
            break;
        }
    }
    Ok(out)
}

/// Identifiant SteamGridDB d'un lien collé (« steamgriddb.com/game/5532594/grids ») ou d'un nombre.
pub fn parse_game_ref(text: &str) -> Option<u64> {
    let t = text.trim();
    if let Ok(id) = t.parse::<u64>() {
        return Some(id);
    }
    let after = t.split("/game/").nth(1)?;
    after.split(|c: char| !c.is_ascii_digit()).next()?.parse().ok()
}

#[derive(Debug, Deserialize)]
struct GameInfo {
    name: String,
}

fn to_candidates(kind: MediaKind, game_id: u64, label: &str, score: f32, imgs: Vec<Image>) -> Vec<Candidate> {
    imgs.into_iter()
        .map(|img| Candidate {
            provider: PROVIDER,
            kind,
            url: img.url,
            thumb: img.thumb,
            label: label.to_string(),
            width: img.width,
            height: img.height,
            score,
            source_game: Some(game_id),
        })
        .collect()
}

/// Propositions : par lien ou identifiant SteamGridDB (toutes les images de ce
/// jeu), sinon par nom (les 4 jeux les plus ressemblants, toutes leurs images).
pub fn candidates(http: &Http, query: &str, kind: MediaKind) -> Result<Vec<Candidate>> {
    let key = key()?;
    if let Some(id) = parse_game_ref(query) {
        let name = call::<GameInfo>(http, &key, &format!("/games/id/{id}")).map(|g| g.name).unwrap_or_else(|_| format!("Jeu {id}"));
        return Ok(to_candidates(kind, id, &name, 1.0, all_images(http, &key, kind, id)?));
    }
    let hits = search(http, query)?;
    let target = name_key(query);
    // les jeux sont interrogés en parallèle (une requête lente ne bloque pas les autres)
    let results: Vec<Result<Vec<Candidate>>> = std::thread::scope(|s| {
        let handles: Vec<_> = hits
            .iter()
            .take(4)
            .map(|hit| {
                let key = &key;
                let target = &target;
                s.spawn(move || {
                    let score = similarity(target, &name_key(&hit.name));
                    all_images(http, key, kind, hit.id).map(|imgs| to_candidates(kind, hit.id, &hit.name, score, imgs))
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Ok(Vec::new()))).collect()
    });
    let mut out = Vec::new();
    for r in results {
        out.extend(r?);
    }
    // les jeux les plus ressemblants d'abord, l'ordre de SteamGridDB (votes) ensuite
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    out.truncate(240);
    Ok(out)
}

/// Choix automatique : un seul jeu au titre strictement identique (sinon,
/// l'utilisateur choisit parmi les propositions).
pub fn auto_match(http: &Http, title: &str) -> Result<Option<Hit>> {
    let hits = search(http, title)?;
    let target = name_key(title);
    let exact: Vec<&Hit> = hits.iter().filter(|h| name_key(&h.name) == target).collect();
    Ok(match exact.as_slice() {
        [one] => Some((*one).clone()),
        _ => None,
    })
}

/// Jeu SteamGridDB correspondant à un jeu Steam (identifiant fiable, pas de nom).
pub fn game_by_steam(http: &Http, appid: &str) -> Result<Option<Hit>> {
    if appid.is_empty() || !appid.chars().all(|c| c.is_ascii_digit()) {
        return Ok(None);
    }
    let key = key()?;
    match call::<Hit>(http, &key, &format!("/games/steam/{appid}")) {
        Ok(hit) => Ok(Some(hit)),
        Err(MetaError::Http { status: 404, .. }) | Err(MetaError::Invalid(_)) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Identifiant Steam d'un jeu PC de la collection, s'il en a un.
pub fn steam_appid(conn: &rusqlite::Connection, game_id: i64) -> Option<String> {
    conn.query_row(
        "SELECT external_id FROM pc_installs WHERE game_id = ?1 AND source = 'steam' ORDER BY preferred DESC LIMIT 1",
        [game_id],
        |r| r.get(0),
    )
    .ok()
}

/// Première image d'un type (jaquette, fond, logo) d'un jeu SteamGridDB.
pub fn first_image(http: &Http, kind: MediaKind, game_id: u64) -> Result<Option<Image>> {
    let key = key()?;
    Ok(images(http, &key, kind, game_id)?.into_iter().next())
}

pub fn avatar_images(http: &Http, id: u64) -> Result<Vec<Image>> {
    let key = key()?;
    let mut out = Vec::new();
    for path in [
        format!("/icons/game/{id}?mimes=image/png&types=static&nsfw=false&humor=false"),
        format!("/grids/game/{id}?dimensions=512x512,1024x1024&types=static&nsfw=false&humor=false"),
    ] {
        match call::<Vec<Image>>(http, &key, &path) {
            Ok(images) => out.extend(images.into_iter().filter(|image|
                avatar_host(&image.url) && avatar_host(&image.thumb)
                && image.width.zip(image.height).is_some_and(|(w, h)| w == h && w >= 96)
            ).take(16)),
            Err(MetaError::Http { status: 404, .. }) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(out)
}

/// Fonds (« heroes ») et logos d'un jeu SteamGridDB, pour personnaliser une collection.
pub fn collection_images(http: &Http, id: u64, kind: &str) -> Result<Vec<Image>> {
    let key = key()?;
    if kind == "decor" {
        // décorations : icônes (souvent un personnage) puis logos, transparents, animés compris
        let mut out = Vec::new();
        for path in [
            format!("/icons/game/{id}?types=static,animated&nsfw=false&humor=false"),
            format!("/logos/game/{id}?types=static,animated&nsfw=false&humor=false"),
        ] {
            match call::<Vec<Image>>(http, &key, &path) {
                Ok(images) => out.extend(images.into_iter().filter(|i| avatar_host(&i.url) && avatar_host(&i.thumb) && decor_format(&i.url))),
                Err(MetaError::Http { status: 404, .. }) => {}
                Err(e) => return Err(e),
            }
        }
        out.truncate(48);
        return Ok(out);
    }
    let path = match kind {
        "logo" => format!("/logos/game/{id}?types=static&nsfw=false&humor=false"),
        _ => format!("/heroes/game/{id}?types=static&nsfw=false&humor=false"),
    };
    match call::<Vec<Image>>(http, &key, &path) {
        Ok(images) => Ok(images.into_iter().filter(|i| avatar_host(&i.url) && avatar_host(&i.thumb)).take(30).collect()),
        Err(MetaError::Http { status: 404, .. }) => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

/// Formats affichables tels quels (les icônes .ico sont écartées).
fn decor_format(url: &str) -> bool {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    [".png", ".webp", ".gif"].iter().any(|ext| path.ends_with(ext))
}

pub fn avatar_host(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| u.scheme() == "https"
        && matches!(u.host_str(), Some("cdn2.steamgriddb.com" | "cdn.steamgriddb.com"))
        && u.username().is_empty() && u.password().is_none() && u.port().is_none())
}

/// Les images ne sont téléchargées que depuis les hôtes connus des sources.
pub fn allowed_image_host(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    u.scheme() == "https"
        && matches!(u.host_str(), Some("thumbnails.libretro.com") | Some("cdn2.steamgriddb.com") | Some("cdn.steamgriddb.com") | Some("art.gametdb.com") | Some("images.launchbox-app.com"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lien_ou_identifiant_steamgriddb() {
        assert_eq!(parse_game_ref("https://www.steamgriddb.com/game/5532594/grids"), Some(5532594));
        assert_eq!(parse_game_ref("steamgriddb.com/game/5532594"), Some(5532594));
        assert_eq!(parse_game_ref(" 5532594 "), Some(5532594));
        assert_eq!(parse_game_ref("Mario Kart World"), None);
        assert_eq!(parse_game_ref("https://www.steamgriddb.com/game/"), None);
    }

    #[test]
    fn decorations_sans_ico() {
        assert!(decor_format("https://cdn2.steamgriddb.com/icon/abc.png"));
        assert!(decor_format("https://cdn2.steamgriddb.com/logo/abc.webp?x=1"));
        assert!(!decor_format("https://cdn2.steamgriddb.com/icon/abc.ico"));
    }

    #[test]
    fn hotes_autorises() {
        assert!(allowed_image_host("https://cdn2.steamgriddb.com/grid/abc.png"));
        assert!(allowed_image_host("https://thumbnails.libretro.com/Nintendo%20-%20GameCube/Named_Boxarts/X.png"));
        assert!(!allowed_image_host("http://thumbnails.libretro.com/x.png"));
        assert!(!allowed_image_host("https://example.com/x.png"));
        assert!(!allowed_image_host("file:///C:/Windows/win.ini"));
    }

    #[test]
    fn lecture_des_reponses() {
        let json = r#"{"success":true,"data":[{"id":1,"score":0,"style":"alternate","url":"https://cdn2.steamgriddb.com/grid/a.png","thumb":"https://cdn2.steamgriddb.com/thumb/a.png","width":600,"height":900,"mime":"image/png"}]}"#;
        let e: Envelope<Vec<Image>> = serde_json::from_str(json).unwrap();
        assert_eq!(e.data.unwrap()[0].width, Some(600));
        let s: Envelope<Vec<Hit>> = serde_json::from_str(r#"{"success":true,"data":[{"id":5,"name":"Pikmin","types":["steam"],"verified":true}]}"#).unwrap();
        assert_eq!(s.data.unwrap()[0].name, "Pikmin");
    }
}
