//! Stickers GIPHY (GIF animés détourés) pour les décorations de l'accueil.
//! Clé API personnelle et gratuite du joueur, rangée comme les autres dans le coffre Windows ;
//! elle ne passe que dans l'adresse de l'API et n'apparaît jamais dans les erreurs.

use super::http::{encode_segment, Http};
use super::{keys, MetaError, Result};
use serde::{Deserialize, Serialize};

pub const PROVIDER: &str = "giphy";
const API: &str = "https://api.giphy.com/v1/stickers/search";

#[derive(Deserialize)]
struct Envelope {
    data: Vec<Gif>,
}
#[derive(Deserialize)]
struct Gif {
    images: Images,
}
#[derive(Deserialize)]
struct Images {
    fixed_height: Option<Rendition>,
    fixed_height_small: Option<Rendition>,
}
#[derive(Deserialize)]
struct Rendition {
    url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Sticker {
    /// GIF de 200 px de haut : assez net pour une case, sans fichier énorme.
    pub url: String,
    pub thumb: String,
}

/// Seules les images servies par GIPHY sont gardées.
pub fn giphy_host(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.port().is_none()
            && u.host_str().is_some_and(|h| h == "giphy.com" || h.ends_with(".giphy.com"))
    })
}

fn query(http: &Http, key: &str, q: &str, limit: u32) -> Result<Vec<Sticker>> {
    let url = format!("{API}?api_key={key}&q={}&limit={limit}&rating=g&lang=fr", encode_segment(q.trim()));
    let env = match http.json::<Envelope>(&url, None, "GIPHY") {
        Ok(env) => env,
        Err(MetaError::Http { status: 401 | 403, .. }) => return Err(MetaError::BadKey("GIPHY")),
        Err(e) => return Err(e),
    };
    Ok(env
        .data
        .into_iter()
        .filter_map(|g| {
            let url = g.images.fixed_height?.url?;
            let thumb = g.images.fixed_height_small.and_then(|r| r.url).unwrap_or_else(|| url.clone());
            (giphy_host(&url) && giphy_host(&thumb)).then_some(Sticker { url, thumb })
        })
        .collect())
}

pub fn search(http: &Http, q: &str) -> Result<Vec<Sticker>> {
    let key = keys::get(PROVIDER)?.ok_or(MetaError::MissingKey("GIPHY"))?;
    query(http, &key, q, 36)
}

/// Vérifie une clé avant de l'enregistrer.
pub fn verify(http: &Http, key: &str) -> Result<()> {
    query(http, key, "mario", 1).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hotes_giphy_seulement() {
        assert!(giphy_host("https://media2.giphy.com/media/abc/200.gif?cid=1"));
        assert!(giphy_host("https://i.giphy.com/abc.gif"));
        assert!(!giphy_host("https://giphy.com.evil.example/abc.gif"));
        assert!(!giphy_host("http://media.giphy.com/abc.gif"));
    }
}
