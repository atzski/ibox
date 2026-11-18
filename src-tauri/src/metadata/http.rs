//! Client HTTP commun : identification générique (aucune donnée personnelle),
//! délais, taille maximale des réponses et politesse envers chaque service
//! (intervalle minimal entre deux requêtes vers un même hôte).

use super::{MetaError, Result};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const USER_AGENT: &str = "iBox/0.1 (bibliotheque de jeux pour Windows)";

pub struct Http {
    client: reqwest::blocking::Client,
    /// Sans suivi des redirections : sert à lire la destination d'un lien (manuels Steam).
    no_redirect: reqwest::blocking::Client,
    last: Mutex<HashMap<String, Instant>>,
}

/// Intervalle minimal entre deux requêtes vers un même hôte.
fn min_interval(host: &str) -> Duration {
    Duration::from_millis(match host {
        "www.steamgriddb.com" => 350,
        "www.gametdb.com" => 1500,
        "raw.githubusercontent.com" => 250,
        // ScreenScraper : un seul fil par compte, on reste très en dessous
        "api.screenscraper.fr" => 1200,
        "archive.org" => 400,
        _ => 120,
    })
}

impl Http {
    pub fn new() -> Result<Self> {
        let client = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|e| MetaError::Network(e.to_string()))?;
        let no_redirect = reqwest::blocking::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| MetaError::Network(e.to_string()))?;
        Ok(Self { client, no_redirect, last: Mutex::new(HashMap::new()) })
    }

    fn throttle(&self, url: &str) {
        let host = reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
        let wait = {
            let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            let gap = min_interval(&host);
            let wait = last.get(&host).map(|t| gap.saturating_sub(now.duration_since(*t))).unwrap_or_default();
            last.insert(host, now + wait);
            wait
        };
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
    }

    fn send(&self, url: &str, bearer: Option<&str>, what: &str) -> Result<reqwest::blocking::Response> {
        self.throttle(url);
        let mut req = self.client.get(url);
        if let Some(key) = bearer {
            req = req.bearer_auth(key);
        }
        let resp = req.send().map_err(|e| MetaError::Network(e.without_url().to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(MetaError::Http { status: status.as_u16(), what: what.to_string() });
        }
        Ok(resp)
    }

    /// Destination d'une redirection (`None` si l'adresse répond directement).
    pub fn redirect_target(&self, url: &str, what: &str) -> Result<Option<String>> {
        self.throttle(url);
        let resp = self.no_redirect.get(url).send().map_err(|e| MetaError::Network(e.without_url().to_string()))?;
        let status = resp.status();
        if status.is_redirection() {
            return Ok(resp.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()).map(str::to_string));
        }
        if status.is_success() {
            return Ok(None);
        }
        Err(MetaError::Http { status: status.as_u16(), what: what.to_string() })
    }

    /// Gros fichier écrit dans `out` au fil de l'eau (délai long), plafonné à `max` octets.
    pub fn download_to(&self, url: &str, out: &mut impl std::io::Write, max: u64, what: &str) -> Result<u64> {
        self.throttle(url);
        let resp = self
            .client
            .get(url)
            .timeout(Duration::from_secs(20 * 60))
            .send()
            .map_err(|e| MetaError::Network(e.without_url().to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(MetaError::Http { status: status.as_u16(), what: what.to_string() });
        }
        let n = std::io::copy(&mut resp.take(max + 1), out).map_err(|e| MetaError::Network(e.to_string()))?;
        if n > max {
            return Err(MetaError::Invalid(format!("{what} : réponse trop volumineuse")));
        }
        Ok(n)
    }

    /// Corps de réponse, plafonné à `max` octets.
    pub fn bytes(&self, url: &str, max: usize, what: &str) -> Result<Vec<u8>> {
        let resp = self.send(url, None, what)?;
        let mut out = Vec::new();
        resp.take(max as u64 + 1).read_to_end(&mut out).map_err(|e| MetaError::Network(e.to_string()))?;
        if out.len() > max {
            return Err(MetaError::Invalid(format!("{what} : réponse trop volumineuse")));
        }
        Ok(out)
    }

    pub fn text(&self, url: &str, max: usize, what: &str) -> Result<String> {
        Ok(String::from_utf8_lossy(&self.bytes(url, max, what)?).into_owned())
    }

    pub fn json<T: DeserializeOwned>(&self, url: &str, bearer: Option<&str>, what: &str) -> Result<T> {
        let resp = self.send(url, bearer, what)?;
        resp.json::<T>().map_err(|e| MetaError::Invalid(format!("{what} : réponse illisible ({e})")))
    }
}

/// Encodage d'un segment de chemin d'URL (espaces, parenthèses, accents…).
pub fn encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Décodage « %XX » (noms de fichiers des index de dossiers).
pub fn decode_percent(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| (b as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodage_aller_retour() {
        let name = "Legend of Zelda, The - The Wind Waker (Europe) (En,Fr,De,Es,It)";
        let enc = encode_segment(name);
        assert!(!enc.contains(' ') && !enc.contains('('));
        assert_eq!(decode_percent(&enc), name);
        assert_eq!(decode_percent("Pok%C3%A9mon%20Ruby"), "Pokémon Ruby");
        assert_eq!(decode_percent("100%"), "100%");
    }
}
