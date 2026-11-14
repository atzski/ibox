//! Client de l'API iiDB (iiSU), selon sa documentation publique :
//! https://iisu.network/wiki/iidb-developers/introduction
//!
//! - base `https://iidb-api.iisu.network/api/v1`, clé dans l'en-tête `X-API-Key`
//!   (jamais dans une URL, un corps de requête ou un journal) ;
//! - requêtes espacées (une à la fois), `Retry-After` respecté sur 429, quelques
//!   nouvelles tentatives sur 5xx, aucune sur 401 ;
//! - les images se téléchargent à part, sans la clé (voir `super::download`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const BASE: &str = "https://iidb-api.iisu.network/api/v1";
/// Nom de la clé dans le coffre Windows.
pub const KEY: &str = "iidb";
/// Emplacements d'illustration d'une console.
pub const PLATFORM_SLOTS: [&str; 4] = ["platform_icon", "platform_logo", "platform_hero", "platform_border"];
/// Lignes par requête groupée (limite documentée).
pub const BATCH_MAX: usize = 25;

#[derive(Debug, Clone, PartialEq)]
pub enum IidbError {
    InvalidKey,
    Forbidden,
    RateLimited(u64),
    Unavailable,
    Request(String),
    Network,
    Unexpected,
}

impl std::fmt::Display for IidbError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IidbError::InvalidKey => write!(f, "Clé iiDB invalide : vérifiez-la dans votre profil iiSU."),
            IidbError::Forbidden => write!(f, "iiDB refuse cette opération pour ce compte."),
            IidbError::RateLimited(s) => write!(f, "Limite de requêtes iiDB atteinte : réessayez dans {s} s."),
            IidbError::Unavailable => write!(f, "Service iiDB indisponible pour le moment."),
            IidbError::Request(m) => write!(f, "Requête iiDB refusée : {m}"),
            IidbError::Network => write!(f, "iiDB ne répond pas : vérifiez la connexion Internet."),
            IidbError::Unexpected => write!(f, "Réponse iiDB inattendue."),
        }
    }
}

pub type Result<T> = std::result::Result<T, IidbError>;

/// Accès du compte (`GET /me/access`). Seuls le palier et l'usage sont gardés :
/// la réponse peut contenir la clé elle-même, qui n'est jamais relue.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Access {
    pub tier: String,
    pub requests_per_second: i64,
    pub monthly_usage: i64,
    pub monthly_soft_limit: i64,
    pub limit_exceeded: bool,
}

pub fn parse_access(v: &Value) -> Result<Access> {
    let tier = v.get("tier").ok_or(IidbError::Unexpected)?;
    let usage = v.get("usage").ok_or(IidbError::Unexpected)?;
    let int = |o: &Value, k: &str| o.get(k).and_then(Value::as_i64).unwrap_or(0);
    Ok(Access {
        tier: tier.get("code").and_then(Value::as_str).unwrap_or("").to_string(),
        requests_per_second: int(tier, "requests_per_second"),
        monthly_usage: int(usage, "monthly_usage"),
        monthly_soft_limit: int(usage, "monthly_soft_limit"),
        limit_exceeded: usage.get("monthly_soft_limit_exceeded").and_then(Value::as_bool).unwrap_or(false),
    })
}

/// Illustration proposée par iiDB (référence d'asset).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub resolution: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub is_animated: bool,
    #[serde(default)]
    pub mime_type: Option<String>,
}

/// Résultat de résolution d'une console.
#[derive(Debug, Clone, PartialEq)]
pub struct PlatformMatch {
    /// matched | needs_choice | not_found | invalid_request
    pub status: String,
    pub platform: Option<(i64, String)>,
    /// Identifiant de console iiDB (préférence d'illustrations des jeux).
    pub console_id: Option<String>,
    pub candidates: Vec<(i64, String)>,
    /// Emplacement → propositions, dans l'ordre recommandé.
    pub artwork: Vec<(String, Vec<Artwork>)>,
}

fn art_from(v: &Value) -> Option<Artwork> {
    let mut a: Artwork = serde_json::from_value(v.clone()).ok()?;
    // le JSON iiDB est en snake_case
    a.thumbnail_url = v.get("thumbnail_url").and_then(Value::as_str).map(str::to_string);
    a.display_name = v.get("display_name").and_then(Value::as_str).map(str::to_string);
    a.is_animated = v.get("is_animated").and_then(Value::as_bool).unwrap_or(false);
    Some(a)
}

pub fn parse_platform_result(v: &Value) -> PlatformMatch {
    if v.get("status").and_then(Value::as_str) == Some("invalid_request") {
        return PlatformMatch { status: "invalid_request".into(), platform: None, console_id: None, candidates: vec![], artwork: vec![] };
    }
    let m = v.get("match");
    let status = m.and_then(|m| m.get("status")).and_then(Value::as_str).unwrap_or("not_found").to_string();
    let pair = |p: &Value| Some((p.get("id")?.as_i64()?, p.get("name")?.as_str()?.to_string()));
    let platform = m.and_then(|m| m.get("platform")).and_then(pair);
    let console_id = m.and_then(|m| m.get("platform")).and_then(|p| p.get("console_id")).and_then(Value::as_str).map(str::to_string);
    let candidates = v
        .get("candidates")
        .and_then(Value::as_array)
        .map(|c| c.iter().filter_map(|c| c.get("platform").and_then(pair)).collect())
        .unwrap_or_default();
    let mut artwork = Vec::new();
    if let Some(obj) = v.get("artwork").and_then(Value::as_object) {
        for slot in PLATFORM_SLOTS {
            let list = obj.get(slot).and_then(Value::as_array).map(|a| a.iter().filter_map(art_from).collect()).unwrap_or_default();
            artwork.push((slot.to_string(), list));
        }
    }
    PlatformMatch { status, platform, console_id, candidates, artwork }
}

/// Une console à résoudre : son identifiant iiDB connu, ou son identifiant de système et son nom.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformLookup {
    /// Identifiant iBox.
    pub id: String,
    pub console_id: String,
    pub title: String,
}

pub fn lookup_body(remote_id: Option<i64>, l: &PlatformLookup) -> Value {
    let mut row = json!({
        "artwork": "recommended",
        "slots": PLATFORM_SLOTS,
        "candidates_per_slot": 3,
        "include": ["asset_metadata"],
    });
    match remote_id {
        Some(id) => row["platform_id"] = json!(id),
        None => {
            row["console_id"] = json!(l.console_id);
            row["title"] = json!(l.title);
        }
    }
    row
}

/// Page de galerie d'une console.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryPage {
    pub items: Vec<Artwork>,
    pub next_cursor: Option<String>,
    pub total: i64,
}

pub fn parse_gallery(v: &Value) -> Result<GalleryPage> {
    let items = v.get("items").and_then(Value::as_array).ok_or(IidbError::Unexpected)?;
    let page = v.get("page");
    Ok(GalleryPage {
        items: items.iter().filter_map(art_from).collect(),
        next_cursor: page
            .filter(|p| p.get("has_more").and_then(Value::as_bool) == Some(true))
            .and_then(|p| p.get("next_cursor"))
            .and_then(Value::as_str)
            .map(str::to_string),
        total: page.and_then(|p| p.get("total")).and_then(Value::as_i64).unwrap_or(0),
    })
}

/// Licence iiDB proposée pour une recherche.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionCandidate {
    pub id: i64,
    pub name: String,
    pub icon_url: Option<String>,
    pub games: Option<i64>,
}

// ——— Jeux ———

/// Proposition de jeu quand iiDB ne tranche pas (`needs_choice`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameCandidate {
    pub id: i64,
    pub name: String,
    pub year: Option<i64>,
    pub platform: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GameMatch {
    /// matched | needs_choice | not_found | invalid_request
    pub status: String,
    pub parent: Option<(i64, String)>,
    pub candidates: Vec<GameCandidate>,
}

pub fn parse_game_result(v: &Value) -> GameMatch {
    if v.get("status").and_then(Value::as_str) == Some("invalid_request") {
        return GameMatch { status: "invalid_request".into(), parent: None, candidates: vec![] };
    }
    let m = v.get("match");
    let status = m.and_then(|m| m.get("status")).and_then(Value::as_str).unwrap_or("not_found").to_string();
    let parent = m
        .and_then(|m| m.get("parent"))
        .and_then(|p| Some((p.get("id")?.as_i64()?, p.get("name")?.as_str()?.to_string())));
    let candidates = v
        .get("candidates")
        .and_then(Value::as_array)
        .map(|c| {
            c.iter()
                .filter_map(|c| {
                    Some(GameCandidate {
                        id: c.get("id")?.as_i64()?,
                        name: c.get("name")?.as_str()?.to_string(),
                        year: c.get("year").and_then(Value::as_i64),
                        platform: c.get("primary_platform").and_then(Value::as_str).map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    GameMatch { status, parent, candidates }
}

/// Résultat de `/assets/batch` pour un jeu : emplacement → propositions.
pub fn parse_artwork_result(v: &Value) -> (Option<i64>, Vec<(String, Vec<Artwork>)>) {
    let id = v.get("parent_id").and_then(Value::as_i64);
    let mut out = Vec::new();
    if let Some(obj) = v.get("artwork").and_then(Value::as_object) {
        for (slot, list) in obj {
            let arts = list.as_array().map(|a| a.iter().filter_map(art_from).collect()).unwrap_or_default();
            out.push((slot.clone(), arts));
        }
    }
    (id, out)
}

/// Client authentifié. Une requête à la fois, espacées d'au moins `gap`.
pub struct Client {
    http: reqwest::blocking::Client,
    key: String,
    last: Mutex<Option<Instant>>,
    gap: Duration,
}

impl Client {
    pub fn new(key: &str) -> Result<Self> {
        let key = key.trim().to_string();
        if key.is_empty() || key.len() > 256 || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(IidbError::InvalidKey);
        }
        let http = reqwest::blocking::Client::builder()
            .user_agent(concat!("iBox/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(40))
            .build()
            .map_err(|_| IidbError::Network)?;
        Ok(Self { http, key, last: Mutex::new(None), gap: Duration::from_millis(400) })
    }

    fn pace(&self) {
        let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = *last {
            let since = t.elapsed();
            if since < self.gap {
                std::thread::sleep(self.gap - since);
            }
        }
        *last = Some(Instant::now());
    }

    /// Requête authentifiée, avec `Retry-After` (429) et quelques reprises (5xx).
    fn call(&self, path: &str, query: &[(&str, String)], body: Option<&Value>) -> Result<Value> {
        let mut url = reqwest::Url::parse(&format!("{BASE}{path}")).map_err(|_| IidbError::Unexpected)?;
        for (k, v) in query {
            url.query_pairs_mut().append_pair(k, v);
        }
        let mut attempt = 0;
        loop {
            self.pace();
            let req = match body {
                Some(b) => self.http.post(url.clone()).json(b),
                None => self.http.get(url.clone()),
            };
            let resp = req.header("X-API-Key", &self.key).header("Accept", "application/json").send();
            let resp = match resp {
                Ok(r) => r,
                Err(_) if attempt < 2 => {
                    attempt += 1;
                    std::thread::sleep(Duration::from_secs(attempt));
                    continue;
                }
                Err(_) => return Err(IidbError::Network),
            };
            let status = resp.status().as_u16();
            match status {
                200 => return resp.json::<Value>().map_err(|_| IidbError::Unexpected),
                401 => return Err(IidbError::InvalidKey),
                403 => return Err(IidbError::Forbidden),
                429 => {
                    let wait = resp
                        .headers()
                        .get("retry-after")
                        .and_then(|h| h.to_str().ok())
                        .and_then(|s| s.trim().parse::<u64>().ok())
                        .unwrap_or(5);
                    if attempt < 2 && wait <= 30 {
                        attempt += 1;
                        std::thread::sleep(Duration::from_secs(wait.max(1)));
                        continue;
                    }
                    return Err(IidbError::RateLimited(wait));
                }
                500 | 502 | 503 | 504 if attempt < 2 => {
                    attempt += 1;
                    std::thread::sleep(Duration::from_secs(2 * attempt));
                    continue;
                }
                500..=599 => return Err(IidbError::Unavailable),
                _ => {
                    let msg = resp
                        .json::<Value>()
                        .ok()
                        .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
                        .unwrap_or_else(|| format!("code {status}"));
                    return Err(IidbError::Request(msg));
                }
            }
        }
    }

    pub fn access(&self) -> Result<Access> {
        parse_access(&self.call("/me/access", &[], None)?)
    }

    /// Résout jusqu'à 25 consoles en une requête (l'ordre des résultats suit celui des lignes).
    pub fn resolve_platforms(&self, rows: &[Value]) -> Result<Vec<PlatformMatch>> {
        let v = self.call("/resolve/platforms/batch", &[], Some(&json!({ "lookups": rows })))?;
        let results = v.get("results").and_then(Value::as_array).ok_or(IidbError::Unexpected)?;
        Ok(results.iter().map(parse_platform_result).collect())
    }

    pub fn search_platforms(&self, q: &str) -> Result<Vec<(i64, String)>> {
        let v = self.call("/search/platforms", &[("q", q.to_string())], None)?;
        Ok(v.get("results")
            .and_then(Value::as_array)
            .map(|r| {
                r.iter()
                    .filter_map(|p| Some((p.get("platform_id").or(p.get("id"))?.as_i64()?, p.get("name")?.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Résout jusqu'à 25 jeux (sans illustrations : passe de correspondance).
    pub fn resolve_games(&self, rows: &[Value]) -> Result<Vec<GameMatch>> {
        let v = self.call("/resolve/batch", &[], Some(&json!({ "lookups": rows })))?;
        let results = v.get("results").and_then(Value::as_array).ok_or(IidbError::Unexpected)?;
        Ok(results.iter().map(parse_game_result).collect())
    }

    pub fn resolve_game(&self, row: &Value) -> Result<GameMatch> {
        Ok(parse_game_result(&self.call("/resolve", &[], Some(row))?))
    }

    /// Illustrations recommandées pour jusqu'à 25 jeux connus (`parent_id`).
    pub fn artwork_batch(&self, rows: &[Value]) -> Result<Vec<(Option<i64>, Vec<(String, Vec<Artwork>)>)>> {
        let v = self.call("/assets/batch", &[], Some(&json!({ "lookups": rows })))?;
        let results = v.get("results").and_then(Value::as_array).ok_or(IidbError::Unexpected)?;
        Ok(results.iter().map(parse_artwork_result).collect())
    }

    pub fn parent_gallery(&self, parent_id: i64, asset_type: &str, cursor: Option<&str>) -> Result<GalleryPage> {
        let mut q = vec![("asset_type", asset_type.to_string()), ("limit", "24".to_string())];
        if let Some(c) = cursor {
            q.push(("cursor", c.to_string()));
        }
        parse_gallery(&self.call(&format!("/assets/parents/{parent_id}/gallery"), &q, None)?)
    }

    /// Jeux proposés pour une recherche libre (choix de l'utilisateur).
    pub fn search_parents(&self, q: &str) -> Result<Vec<GameCandidate>> {
        let v = self.call("/search/parents", &[("q", q.to_string()), ("limit", "20".to_string())], None)?;
        Ok(v.get("results")
            .and_then(Value::as_array)
            .map(|r| {
                r.iter()
                    .filter_map(|p| {
                        Some(GameCandidate {
                            id: p.get("parent_id")?.as_i64()?,
                            name: p.get("name")?.as_str()?.to_string(),
                            year: p.get("initial_release_year").or(p.get("year")).and_then(Value::as_i64),
                            platform: p.get("primary_platform").and_then(Value::as_str).map(str::to_string),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Collections iiDB (licences : Mario, Zelda…) pour une recherche libre.
    pub fn search_collections(&self, q: &str) -> Result<Vec<CollectionCandidate>> {
        let v = self.call("/search/collections", &[("q", q.to_string()), ("limit", "24".to_string()), ("assets_only", "true".to_string())], None)?;
        Ok(v.get("results").and_then(Value::as_array).map(|r| r.iter().filter_map(|c| Some(CollectionCandidate {
            id: c.get("collection_id")?.as_i64()?,
            name: c.get("name")?.as_str()?.to_string(),
            icon_url: c.get("icon_url").and_then(Value::as_str).map(str::to_string),
            games: c.get("parent_count").and_then(Value::as_i64),
        })).collect()).unwrap_or_default())
    }

    /// Icônes d'une collection iiDB.
    pub fn collection_icons(&self, collection_id: i64) -> Result<GalleryPage> {
        parse_gallery(&self.call(&format!("/assets/collections/{collection_id}/gallery"), &[("asset_type", "collection_icon".to_string()), ("limit", "48".to_string())], None)?)
    }

    pub fn platform_gallery(&self, remote_id: i64, slot: &str, cursor: Option<&str>) -> Result<GalleryPage> {
        let mut q = vec![("asset_type", slot.to_string()), ("limit", "24".to_string())];
        if let Some(c) = cursor {
            q.push(("cursor", c.to_string()));
        }
        parse_gallery(&self.call(&format!("/assets/platforms/{remote_id}/gallery"), &q, None)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acces_sans_relire_la_cle() {
        let v = json!({"user_id": 1, "tier": {"code": "free", "api_tier": 0, "requests_per_second": 2},
                       "usage": {"monthly_usage": 12, "monthly_soft_limit": 5000, "monthly_soft_limit_exceeded": false},
                       "api_key": {"api_key": "SECRET"}});
        let a = parse_access(&v).unwrap();
        assert_eq!((a.tier.as_str(), a.requests_per_second, a.monthly_usage), ("free", 2, 12));
        assert!(!format!("{a:?}").contains("SECRET"));
    }

    #[test]
    fn resolution_de_console() {
        let v = json!({
            "match": {"status": "matched", "platform": {"id": 7, "name": "Nintendo GameCube"}, "reason": "console_key"},
            "artwork_status": "partial",
            "artwork": {
                "platform_icon": [{"id": 11, "type": "platform_icon", "url": "https://assets.iisu.network/a.png", "revision": "r1", "thumbnail_url": "https://assets.iisu.network/a.webp"}],
                "platform_logo": [],
                "platform_hero": [{"id": 12, "type": "platform_hero", "url": "https://assets.iisu.network/b.png"}]
            },
            "missing_artwork": {"platform_logo": "missing"}
        });
        let m = parse_platform_result(&v);
        assert_eq!(m.status, "matched");
        assert_eq!(m.platform, Some((7, "Nintendo GameCube".into())));
        assert_eq!(m.artwork.len(), 4, "les quatre emplacements, même vides");
        assert_eq!(m.artwork[0].1[0].thumbnail_url.as_deref(), Some("https://assets.iisu.network/a.webp"));
        assert!(m.artwork[1].1.is_empty() && m.artwork[3].1.is_empty());
        assert_eq!(m.artwork[2].1[0].revision, "");

        let choice = parse_platform_result(&json!({"match": {"status": "needs_choice", "platform": null},
            "artwork_status": "not_resolved", "artwork": {}, "candidates": [{"platform": {"id": 3, "name": "Nintendo DS"}, "reason": "fuzzy"}]}));
        assert_eq!((choice.status.as_str(), choice.candidates.len()), ("needs_choice", 1));
        assert_eq!(parse_platform_result(&json!({"status": "invalid_request", "errors": []})).status, "invalid_request");
    }

    #[test]
    fn jeux_correspondance_et_illustrations() {
        let m = parse_game_result(&json!({"match": {"status": "matched", "parent": {"id": 46185, "name": "Ape Escape 3", "year": 2005}}, "artwork_status": "not_requested", "artwork": {}}));
        assert_eq!(m.parent, Some((46185, "Ape Escape 3".into())));
        let c = parse_game_result(&json!({"match": {"status": "needs_choice", "parent": null}, "artwork_status": "not_resolved", "artwork": {},
            "candidates": [{"id": 1, "name": "Doom", "year": 1993, "primary_platform": "PC", "reason": "name_exact"}, {"id": 2, "name": "Doom", "year": 2016, "reason": "name_exact"}]}));
        assert_eq!((c.status.as_str(), c.candidates.len()), ("needs_choice", 2));
        assert_eq!(c.candidates[0].platform.as_deref(), Some("PC"));
        let (id, art) = parse_artwork_result(&json!({"parent_id": 46185, "name": "Ape Escape 3", "artwork_status": "partial",
            "artwork": {"boxart": [{"id": 456, "type": "boxart", "url": "https://assets.iisu.network/b.png", "revision": "r"}], "hero": []}}));
        assert_eq!(id, Some(46185));
        assert_eq!(art.iter().find(|(s, _)| s == "boxart").unwrap().1[0].id, 456);
    }

    #[test]
    fn galerie_et_pagination() {
        let v = json!({"platform_id": 7, "name": "GC", "type": "platform_logo",
            "items": [{"id": 1, "type": "platform_logo", "url": "https://assets.iisu.network/1.png", "revision": "x", "resolution": "1200x400"}],
            "page": {"limit": 24, "total": 30, "next_cursor": "abc", "has_more": true}});
        let p = parse_gallery(&v).unwrap();
        assert_eq!((p.items.len(), p.next_cursor.as_deref(), p.total), (1, Some("abc"), 30));
        assert_eq!(p.items[0].resolution.as_deref(), Some("1200x400"));
    }

    #[test]
    fn corps_de_recherche() {
        let l = PlatformLookup { id: "gamecube".into(), console_id: "gc".into(), title: "Nintendo GameCube".into() };
        let b = lookup_body(None, &l);
        assert_eq!(b["console_id"], "gc");
        assert_eq!(b["slots"].as_array().unwrap().len(), 4);
        let b = lookup_body(Some(7), &l);
        assert_eq!(b["platform_id"], 7);
        assert!(b.get("console_id").is_none());
        assert!(Client::new("  ").is_err() && Client::new("a b").is_err());
    }
}
