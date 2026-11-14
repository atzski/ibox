//! Connecteur Epic Games Store : manifestes d'installation du lanceur Epic
//! (`%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item`), en lecture seule.
//!
//! Epic ne publie pas d'API pour lire la bibliothèque d'un joueur : les jeux
//! possédés jamais installés sur cet ordinateur ne sont donc pas importés. Un jeu
//! désinstallé après avoir été vu reste dans iBox, avec « Installer ».
//! Lancement et installation : liens `com.epicgames.launcher://apps/…` ouverts par
//! le lanceur Epic (il gère compte et protections).

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct EpicGame {
    pub app_name: String,
    pub title: String,
    pub install_dir: Option<String>,
    pub installed: bool,
    pub launch_uri: String,
}

pub fn manifests_dir() -> Option<PathBuf> {
    let base = std::env::var("ProgramData").ok()?;
    let p = Path::new(&base).join("Epic").join("EpicGamesLauncher").join("Data").join("Manifests");
    p.is_dir().then_some(p)
}

pub fn scan(dir: &Path) -> Vec<EpicGame> {
    let mut out: Vec<EpicGame> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return out };
    for e in entries.flatten() {
        let p = e.path();
        if !p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("item")) {
            continue;
        }
        let Ok(bytes) = std::fs::read(&p) else { continue };
        if let Some(g) = parse_item(&String::from_utf8_lossy(&bytes)) {
            if !out.iter().any(|o| o.app_name == g.app_name) {
                out.push(g);
            }
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    out
}

/// Identifiants Epic : lettres, chiffres, tiret, point, souligné (rien d'autre dans un lien).
fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

pub fn parse_item(text: &str) -> Option<EpicGame> {
    let j: serde_json::Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let s = |k: &str| j.get(k).and_then(|v| v.as_str()).map(str::trim).unwrap_or("");
    let b = |k: &str| j.get(k).and_then(|v| v.as_bool());
    let app = s("AppName");
    let (ns, item) = (s("CatalogNamespace"), s("CatalogItemId"));
    if !safe_id(app) || !safe_id(ns) || !safe_id(item) {
        return None;
    }
    // contenus additionnels : rattachés à un autre jeu
    let main = s("MainGameAppName");
    if !main.is_empty() && main != app {
        return None;
    }
    if b("bIsApplication") == Some(false) {
        return None;
    }
    if let Some(cats) = j.get("AppCategories").and_then(|c| c.as_array()) {
        if !cats.iter().any(|c| c.as_str() == Some("games")) {
            return None;
        }
    }
    let title = Some(s("DisplayName")).filter(|t| !t.is_empty()).unwrap_or(app).to_string();
    let dir = Some(s("InstallLocation")).filter(|d| !d.is_empty()).map(str::to_string);
    Some(EpicGame {
        installed: b("bIsIncompleteInstall") != Some(true) && dir.is_some(),
        install_dir: dir,
        launch_uri: format!("com.epicgames.launcher://apps/{ns}%3A{item}%3A{app}?action=launch&silent=true"),
        app_name: app.to_string(),
        title,
    })
}

/// Lien sûr (préfixe et caractères vérifiés) avant de le confier à Windows.
pub fn checked_uri(uri: &str) -> Option<&str> {
    let rest = uri.strip_prefix("com.epicgames.launcher://apps/")?;
    let ok = rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '%' | '?' | '=' | '&'));
    ok.then_some(uri)
}

/// Lien d'installation correspondant à un lien de lancement.
pub fn install_uri(launch_uri: &str) -> Option<String> {
    checked_uri(launch_uri)?;
    let base = launch_uri.split('?').next()?;
    Some(format!("{base}?action=install"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifestes_epic() {
        let g = parse_item(
            r#"{"AppName":"Sugar","DisplayName":"Rocket League®","InstallLocation":"C:\\Program Files\\Epic Games\\rocketleague",
                "CatalogNamespace":"9773aa1aa54f4f7b80e44bef04986cea","CatalogItemId":"530145df28a24424923f5828cc9031a1",
                "MainGameAppName":"","bIsApplication":true,"bIsIncompleteInstall":false,"AppCategories":["public","games","applications"]}"#,
        )
        .unwrap();
        assert_eq!(g.title, "Rocket League®");
        assert!(g.installed);
        assert_eq!(
            g.launch_uri,
            "com.epicgames.launcher://apps/9773aa1aa54f4f7b80e44bef04986cea%3A530145df28a24424923f5828cc9031a1%3ASugar?action=launch&silent=true"
        );
        assert_eq!(
            install_uri(&g.launch_uri).unwrap(),
            "com.epicgames.launcher://apps/9773aa1aa54f4f7b80e44bef04986cea%3A530145df28a24424923f5828cc9031a1%3ASugar?action=install"
        );

        // contenu additionnel, logiciel, identifiant douteux : écartés
        assert!(parse_item(r#"{"AppName":"DLC1","MainGameAppName":"Sugar","CatalogNamespace":"a","CatalogItemId":"b","AppCategories":["games"]}"#).is_none());
        assert!(parse_item(r#"{"AppName":"Tool","CatalogNamespace":"a","CatalogItemId":"b","AppCategories":["software"]}"#).is_none());
        assert!(parse_item(r#"{"AppName":"x\" & calc","CatalogNamespace":"a","CatalogItemId":"b"}"#).is_none());
        // installation inachevée
        let partial = parse_item(r#"{"AppName":"P","CatalogNamespace":"a","CatalogItemId":"b","InstallLocation":"D:\\P","bIsIncompleteInstall":true}"#).unwrap();
        assert!(!partial.installed);
        assert!(checked_uri("com.epicgames.launcher://apps/a b").is_none());
    }
}
