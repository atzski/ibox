//! ScreenScraper (api.screenscraper.fr, API v2) : médias « manuel ».
//!
//! - Identifiants **développeur** : propres à iBox, fournis à la compilation
//!   (voir build.rs), jamais dans les sources publiques.
//! - Compte **utilisateur** (facultatif) : identifiant et mot de passe du
//!   joueur, rangés dans le coffre Windows ; ils donnent son propre quota.
//! - Les adresses de téléchargement renvoyées contiennent les identifiants :
//!   elles ne quittent jamais la partie native.

use super::{Found, GameInfo, ManualOptions};
use crate::metadata::http::{encode_segment, Http};
use crate::metadata::matching::{name_key, similarity};
use crate::metadata::{keys, MetaError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROVIDER: &str = "screenscraper";
/// Entrée du coffre : compte utilisateur (JSON `{login, password}`).
pub const ACCOUNT_KEY: &str = "screenscraper-account";
const SOFTNAME: &str = "iBox";
const API: &str = "https://api.screenscraper.fr/api2";

// Doit rester identique à `MASK` dans build.rs.
const MASK: &[u8] = b"iBox-carnets-7f3a";

/// Identifiants développeur (absents d'une compilation sans `IBOX_SS_DEVID`).
fn dev() -> Option<(String, String)> {
    let packed = env!("IBOX_SS_DEV_PACKED");
    if packed.is_empty() {
        return None;
    }
    let bytes: Vec<u8> = (0..packed.len() / 2)
        .filter_map(|i| u8::from_str_radix(&packed[2 * i..2 * i + 2], 16).ok())
        .enumerate()
        .map(|(i, b)| b ^ MASK[i % MASK.len()])
        .collect();
    let text = String::from_utf8(bytes).ok()?;
    let (id, pw) = text.split_once('\n')?;
    Some((id.to_string(), pw.to_string()))
}

pub fn available() -> bool {
    dev().is_some()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub login: String,
    pub password: String,
}

pub fn account() -> Option<Account> {
    keys::get(ACCOUNT_KEY).ok().flatten().and_then(|s| serde_json::from_str(&s).ok())
}

/// Paramètres communs : identification d'iBox (+ compte du joueur s'il est relié).
fn auth(acc: Option<&Account>) -> Result<String> {
    let (id, pw) = dev().ok_or(MetaError::MissingKey("ScreenScraper"))?;
    let mut q = format!("devid={}&devpassword={}&softname={}&output=json", encode_segment(&id), encode_segment(&pw), SOFTNAME);
    if let Some(a) = acc {
        q.push_str(&format!("&ssid={}&sspassword={}", encode_segment(&a.login), encode_segment(&a.password)));
    }
    Ok(q)
}

/// Identifiant de système ScreenScraper.
pub fn system_id(platform: &str) -> Option<u32> {
    Some(match platform {
        "megadrive" => 1,
        "mastersystem" => 2,
        "nes" => 3,
        "snes" => 4,
        "gb" => 9,
        "gbc" => 10,
        "gba" => 12,
        "gamecube" => 13,
        "n64" => 14,
        "ds" => 15,
        "wii" => 16,
        "3ds" => 17,
        "wiiu" => 18,
        "gamegear" => 21,
        "saturn" => 22,
        "dreamcast" => 23,
        "atari2600" => 26,
        "jaguar" => 27,
        "xbox" => 32,
        "xbox360" => 33,
        "ps1" => 57,
        "ps2" => 58,
        "ps3" => 59,
        "psp" => 61,
        "switch" => 225,
        // PC Windows : manuels des jeux en boîte (recherche par titre seulement)
        "pc" => 138,
        _ => return None,
    })
}

/// Erreurs propres à ScreenScraper, en clair pour l'utilisateur.
fn explain(e: MetaError) -> MetaError {
    match e {
        MetaError::Http { status: 401 | 403, .. } => MetaError::BadKey("ScreenScraper"),
        MetaError::Http { status: 423, .. } => MetaError::Invalid("ScreenScraper est fermé pour maintenance, réessayez plus tard".into()),
        MetaError::Http { status: 426, .. } => MetaError::Invalid("ScreenScraper refuse cette version d'iBox".into()),
        MetaError::Http { status: 429 | 430 | 431, .. } => {
            MetaError::Invalid("ScreenScraper est saturé ou votre quota du jour est atteint. Réessayez plus tard, ou reliez votre compte dans les paramètres".into())
        }
        other => other,
    }
}

/// Informations du compte relié (vérifie aussi le mot de passe).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    pub login: String,
    pub level: Option<String>,
    pub max_threads: Option<u32>,
    pub requests_today: Option<u32>,
    pub max_requests_per_day: Option<u32>,
}

fn num(v: &Value) -> Option<u32> {
    v.as_u64().map(|n| n as u32).or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}

pub fn user_info(http: &Http, acc: &Account) -> Result<UserInfo> {
    let url = format!("{API}/ssuserInfos.php?{}", auth(Some(acc))?);
    let v: Value = http.json(&url, None, "le compte ScreenScraper").map_err(explain)?;
    let u = &v["response"]["ssuser"];
    if u.is_null() {
        return Err(MetaError::BadKey("ScreenScraper"));
    }
    Ok(UserInfo {
        login: u["id"].as_str().unwrap_or(&acc.login).to_string(),
        level: u["niveau"].as_str().map(str::to_string),
        max_threads: num(&u["maxthreads"]),
        requests_today: num(&u["requeststoday"]),
        max_requests_per_day: num(&u["maxrequestsperday"]),
    })
}

/// Manuels proposés pour un jeu, meilleure région d'abord.
pub fn find(http: &Http, game: &GameInfo, opts: &ManualOptions) -> Result<Vec<Found>> {
    let Some(system) = system_id(&game.platform) else { return Ok(Vec::new()) };
    let acc = account();
    let base = auth(acc.as_ref())?;

    // 1. Le fichier du jeu (nom, taille, CRC, numéro de série) : correspondance exacte
    let mut url = format!("{API}/jeuInfos.php?{base}&systemeid={system}&romtype=rom");
    if let Some(n) = &game.file_name {
        url.push_str(&format!("&romnom={}", encode_segment(n)));
    }
    if let Some(s) = game.file_size.filter(|s| *s > 0) {
        url.push_str(&format!("&romtaille={s}"));
    }
    if let Some(c) = game.crc32.as_deref().filter(|c| !c.is_empty()) {
        url.push_str(&format!("&crc={}", encode_segment(c)));
    }
    if let Some(s) = game.serial.as_deref().filter(|s| !s.is_empty()) {
        url.push_str(&format!("&serialnum={}", encode_segment(s)));
    }
    let mut score = 1.0;
    // jeux PC : pas de fichier à reconnaître, seulement le titre
    let by_file = game.platform != "pc" && (game.file_name.is_some() || game.serial.is_some());
    let jeu = if !by_file { None } else { match http.json::<Value>(&url, None, "ScreenScraper") {
        Ok(v) if !v["response"]["jeu"].is_null() => Some(v["response"]["jeu"].clone()),
        Ok(_) | Err(MetaError::Http { status: 404, .. }) => None,
        Err(e) => return Err(explain(e)),
    } };
    // fiche trouvée par le fichier mais sans manuel : une autre fiche du même jeu peut en avoir un
    let jeu = jeu.filter(|j| j["medias"].as_array().is_some_and(|m| m.iter().any(|x| x["type"].as_str() == Some("manuel"))));
    // 2. Sinon, recherche par titre : seulement un nom quasi identique
    let jeu = match jeu {
        Some(j) => j,
        None => {
            let url = format!("{API}/jeuRecherche.php?{base}&systemeid={system}&recherche={}", encode_segment(&game.title));
            let v: Value = match http.json(&url, None, "ScreenScraper") {
                Ok(v) => v,
                Err(MetaError::Http { status: 404, .. }) => return Ok(Vec::new()),
                Err(e) => return Err(explain(e)),
            };
            let want = name_key(&game.title);
            let best = v["response"]["jeux"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|j| !j["id"].is_null())
                .map(|j| {
                    let s = j["noms"].as_array().into_iter().flatten().filter_map(|n| n["text"].as_str()).map(|n| similarity(&want, &name_key(n))).fold(0.0f32, f32::max);
                    // à nom égal, la fiche qui a un manuel l'emporte
                    let has_manual = j["medias"].as_array().is_some_and(|m| m.iter().any(|x| x["type"].as_str() == Some("manuel")));
                    (s, has_manual, j)
                })
                .max_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)))
                .map(|(s, _, j)| (s, j));
            match best {
                Some((s, j)) if s >= 0.86 => {
                    score = s;
                    // la recherche renvoie déjà les médias du jeu
                    if j["medias"].is_array() {
                        j.clone()
                    } else {
                        let id = j["id"].as_str().map(str::to_string).or(j["id"].as_u64().map(|n| n.to_string())).unwrap_or_default();
                        let url = format!("{API}/jeuInfos.php?{base}&systemeid={system}&gameid={}", encode_segment(&id));
                        match http.json::<Value>(&url, None, "ScreenScraper") {
                            Ok(v) => v["response"]["jeu"].clone(),
                            Err(MetaError::Http { status: 404, .. }) => return Ok(Vec::new()),
                            Err(e) => return Err(explain(e)),
                        }
                    }
                }
                _ => return Ok(Vec::new()),
            }
        }
    };
    Ok(manuals_of(&jeu, &game.title, score, opts))
}

/// Médias « manuel » d'une fiche de jeu ScreenScraper.
fn manuals_of(jeu: &Value, fallback_title: &str, score: f32, opts: &ManualOptions) -> Vec<Found> {
    let game_id = jeu["id"].as_str().map(str::to_string).or(jeu["id"].as_u64().map(|n| n.to_string())).unwrap_or_default();
    let title = jeu["noms"]
        .as_array()
        .and_then(|ns| {
            let order = opts.region_order();
            ns.iter()
                .filter_map(|n| Some((n["region"].as_str().unwrap_or(""), n["text"].as_str()?)))
                .min_by_key(|(r, _)| order.iter().position(|x| x == r).unwrap_or(usize::MAX))
                .map(|(_, t)| t.to_string())
        })
        .unwrap_or_else(|| fallback_title.to_string());
    let mut out: Vec<Found> = jeu["medias"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["type"].as_str() == Some("manuel"))
        .filter(|m| m["format"].as_str().map(|f| f.eq_ignore_ascii_case("pdf")).unwrap_or(true))
        .filter_map(|m| {
            let url = m["url"].as_str()?.to_string();
            let region = m["region"].as_str().map(str::to_string);
            Some(Found {
                source: PROVIDER,
                reference: format!("{game_id}:{}", region.as_deref().unwrap_or("")),
                url,
                title: title.clone(),
                region,
                size: m["size"].as_str().and_then(|s| s.parse().ok()).or(m["size"].as_u64()),
                score,
            })
        })
        .collect();
    out.sort_by_key(|f| opts.region_rank(f.region.as_deref()));
    out.dedup_by(|a, b| a.region == b.region);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lit_les_manuels_d_une_fiche() {
        let jeu: Value = serde_json::json!({
            "id": "3",
            "noms": [{"region": "us", "text": "Super Metroid"}, {"region": "fr", "text": "Super Metroid"}],
            "medias": [
                {"type": "box-2D", "region": "eu", "url": "https://x/box", "format": "png"},
                {"type": "manuel", "region": "us", "url": "https://x/m-us", "size": "5186578", "format": "pdf"},
                {"type": "manuel", "region": "eu", "url": "https://x/m-eu", "format": "pdf"},
                {"type": "manuel", "region": "fr", "url": "https://x/m-fr", "format": "pdf"}
            ]
        });
        let fr = ManualOptions { sources: vec![], region: "PAL".into(), language: "fr".into(), game_region: None };
        let found = manuals_of(&jeu, "x", 1.0, &fr);
        assert_eq!(found.iter().map(|f| f.region.as_deref().unwrap()).collect::<Vec<_>>(), ["fr", "eu", "us"]);
        assert_eq!(found[2].size, Some(5_186_578));
        assert_eq!(found[0].reference, "3:fr");
        let us = ManualOptions { sources: vec![], region: "NTSC-U".into(), language: "en".into(), game_region: None };
        assert_eq!(manuals_of(&jeu, "x", 1.0, &us)[0].region.as_deref(), Some("us"));
    }

    #[test]
    fn systemes_connus() {
        assert_eq!(system_id("snes"), Some(4));
        assert_eq!(system_id("ps2"), Some(58));
        assert_eq!(system_id("pc"), Some(138));
    }
}
