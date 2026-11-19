//! Catalogue des plugins : `GET /plugins` sur le serveur iNetbox. Il ne contient que des liens
//! et des empreintes ; la confiance vient de la signature de chaque paquet (`trust.rs`).
//!
//! Pour les essais, `IBOX_PLUGINS_CATALOG` peut désigner un fichier JSON local : les paquets
//! qu'il cite peuvent alors être des chemins locaux. Ils restent soumis à la même signature.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::install::MAX_PACKAGE;
use super::manifest;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub name: String,
    /// Identifiant du profil iNetbox du créateur (avatar, profil public).
    #[serde(default)]
    pub inetbox: Option<String>,
    /// Compte iNetbox du créateur (le serveur en déduit `inetbox`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub author: Author,
    pub url: String,
    pub sha256: String,
    pub signature: String,
    #[serde(default = "default_publisher")]
    pub publisher: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub notes: String,
    /// Permissions annoncées (affichées avant l'installation ; le manifeste signé fait foi).
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Icône en `data:image/png;base64,…` (64 Ko au plus), facultative : la fenêtre principale
    /// n'affiche aucune image d'une origine inconnue.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub ibox: Option<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
}

fn default_publisher() -> String {
    "atzski".into()
}

#[derive(Debug, Default, Deserialize)]
struct Catalog {
    #[serde(default)]
    plugins: Vec<Entry>,
}

/// Source du catalogue : un fichier local d'essai, ou le serveur iNetbox.
enum Origin {
    Local(PathBuf),
    Remote(String),
}

fn origin() -> Origin {
    match std::env::var("IBOX_PLUGINS_CATALOG").ok().filter(|s| !s.trim().is_empty()) {
        Some(s) if !s.starts_with("https://") && !s.starts_with("http://") => Origin::Local(PathBuf::from(s)),
        Some(s) => Origin::Remote(s),
        None => Origin::Remote(format!("{}/v1/plugins", crate::inetbox::service_url().trim_end_matches('/'))),
    }
}

fn client(timeout: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .connect_timeout(Duration::from_secs(20))
        .user_agent(concat!("iBox/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

fn read_limited(r: impl Read, limit: usize) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    r.take(limit as u64 + 1).read_to_end(&mut buf).map_err(|_| "Téléchargement interrompu.".to_string())?;
    if buf.len() > limit {
        return Err("Réponse trop volumineuse.".into());
    }
    Ok(buf)
}

/// Garde les entrées bien formées ; les autres sont ignorées (une seule erreur ne vide pas le catalogue).
pub fn parse(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    let c: Catalog = serde_json::from_slice(bytes).map_err(|_| "Catalogue des plugins illisible.".to_string())?;
    Ok(c.plugins
        .into_iter()
        .filter(|e| {
            manifest::valid_id(&e.id)
                && manifest::parse_version(&e.version).is_some()
                && e.sha256.len() == 64
                && e.sha256.bytes().all(|c| c.is_ascii_hexdigit())
                && !e.name.trim().is_empty()
                && e.icon.as_deref().is_none_or(valid_icon)
        })
        .collect())
}

pub fn valid_icon(i: &str) -> bool {
    i.len() <= 90_000 && ["data:image/png;base64,", "data:image/webp;base64,"].iter().any(|p| i.starts_with(p))
}

pub fn fetch() -> Result<Vec<Entry>, String> {
    match origin() {
        Origin::Local(path) => parse(&std::fs::read(&path).map_err(|_| format!("Catalogue local introuvable : {}", path.display()))?),
        Origin::Remote(url) => {
            let resp = client(30)?.get(&url).send().map_err(|_| "Catalogue des plugins injoignable.".to_string())?;
            if !resp.status().is_success() {
                return Err(format!("Catalogue des plugins indisponible ({}).", resp.status().as_u16()));
            }
            parse(&read_limited(resp, 1024 * 1024)?)
        }
    }
}

/// Télécharge le paquet d'une entrée. https seulement, sauf chemin local cité par un catalogue local.
pub fn download(entry: &Entry) -> Result<Vec<u8>, String> {
    match origin() {
        Origin::Local(catalog) if !entry.url.starts_with("https://") => {
            let p = Path::new(&entry.url);
            let path = if p.is_absolute() { p.to_path_buf() } else { catalog.parent().unwrap_or(Path::new(".")).join(p) };
            let f = std::fs::File::open(&path).map_err(|_| format!("Paquet introuvable : {}", path.display()))?;
            read_limited(f, MAX_PACKAGE)
        }
        _ => {
            if !entry.url.starts_with("https://") {
                return Err("Le paquet doit être servi en https.".into());
            }
            let resp = client(300)?.get(&entry.url).send().map_err(|_| "Téléchargement du plugin impossible.".to_string())?;
            if !resp.status().is_success() {
                return Err(format!("Téléchargement du plugin impossible ({}).", resp.status().as_u16()));
            }
            read_limited(resp, MAX_PACKAGE)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_entries_are_skipped() {
        let ok = serde_json::json!({ "id": "demo", "name": "Démo", "version": "1.0.0", "author": { "name": "atzski", "inetbox": "u1" },
            "url": "https://example.com/demo.iboxplugin", "sha256": "a".repeat(64), "signature": "x" });
        let mut bad_id = ok.clone();
        bad_id["id"] = "../x".into();
        let mut bad_sha = ok.clone();
        bad_sha["sha256"] = "zz".into();
        let mut bad_icon = ok.clone();
        bad_icon["icon"] = "http://x/i.png".into();
        let list = parse(serde_json::json!({ "plugins": [ok, bad_id, bad_sha, bad_icon] }).to_string().as_bytes()).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].publisher, "atzski");
        assert!(parse(b"nope").is_err());
    }
}
