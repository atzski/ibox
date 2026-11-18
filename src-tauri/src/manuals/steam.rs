//! Steam : manuel officiel publié par l'éditeur.
//!
//! `store.steampowered.com/manual/<appid>/` redirige vers le PDF du manuel
//! quand le jeu en a un (sinon vers la page du magasin).

use super::{Found, GameInfo};
use crate::metadata::http::Http;
use crate::metadata::Result;

pub const PROVIDER: &str = "steam";

/// Le lien de redirection est-il bien un PDF hébergé par Steam ?
pub fn is_manual_url(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    let host = u.host_str().unwrap_or("");
    u.scheme() == "https"
        && (host.ends_with(".steamstatic.com") || host.ends_with(".steampowered.com") || host.ends_with(".akamaihd.net"))
        && u.path().to_lowercase().ends_with(".pdf")
}

pub fn find(http: &Http, game: &GameInfo) -> Result<Vec<Found>> {
    let Some(appid) = game.steam_appid.as_deref().filter(|a| !a.is_empty() && a.chars().all(|c| c.is_ascii_digit())) else {
        return Ok(Vec::new());
    };
    let target = http.redirect_target(&format!("https://store.steampowered.com/manual/{appid}/"), "Steam")?;
    Ok(target
        .filter(|t| is_manual_url(t))
        .map(|url| Found { source: PROVIDER, reference: appid.to_string(), url, title: game.title.clone(), region: None, size: None, score: 1.0 })
        .into_iter()
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liens_de_manuels() {
        assert!(is_manual_url("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/22330/manuals/obliv_goty_pc_man-v2.pdf?t=1745343031"));
        assert!(!is_manual_url("https://store.steampowered.com/app/22330/"));
        assert!(!is_manual_url("https://example.com/manual.pdf"));
    }
}
