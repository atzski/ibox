//! Connecteur Heroic Games Launcher (Linux, Steam Deck) : jeux Epic, GOG et Amazon
//! installés par Heroic, en lecture seule.
//!
//! Fichiers lus (relevés dans le code de Heroic, docs/STEAMDECK.md §12) :
//! - dossier de Heroic : `~/.config/heroic`, ou en Flatpak
//!   `~/.var/app/com.heroicgameslauncher.hgl/config/heroic` ;
//! - Epic (legendary) : `legendaryConfig/legendary/installed.json`, objet
//!   `app_name` → `{title, install_path, is_dlc…}` (ancien emplacement
//!   `~/.config/legendary/installed.json`) ;
//! - GOG : `gog_store/installed.json`, `{"installed": [{appName, install_path…}]}` ;
//! - Amazon (nile) : `nile_config/nile/installed.json`, liste `[{id, path…}]`.
//!
//! GOG et Amazon n'écrivent pas le titre dans leur liste d'installation : il est lu dans le
//! cache de bibliothèque de Heroic (`store_cache/gog_library.json` clé `games`,
//! `store_cache/nile_library.json` clé `library`), à défaut le nom du dossier du jeu.
//! Lancement : lien `heroic://launch/<runner>/<appName>` confié au système (Heroic gère
//! compte, Proton et protections). Les jeux possédés jamais installés ne sont pas importés.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub struct HeroicGame {
    /// `legendary`, `gog` ou `nile`.
    pub runner: &'static str,
    pub app_name: String,
    pub title: String,
    pub install_dir: String,
}

impl HeroicGame {
    /// Identifiant stable dans iBox : `<runner>/<appName>`.
    pub fn external_id(&self) -> String {
        format!("{}/{}", self.runner, self.app_name)
    }
    pub fn launch_uri(&self) -> String {
        format!("heroic://launch/{}/{}", self.runner, self.app_name)
    }
}

const RUNNERS: [&str; 3] = ["legendary", "gog", "nile"];

/// Identifiants des boutiques : lettres, chiffres, tiret, point, souligné (rien d'autre dans un lien).
fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Dossiers de configuration possibles de Heroic (installation classique puis Flatpak).
pub fn config_dirs(home: &Path) -> [PathBuf; 2] {
    [
        home.join(".config").join("heroic"),
        home.join(".var").join("app").join("com.heroicgameslauncher.hgl").join("config").join("heroic"),
    ]
}

/// Dossier de Heroic trouvé sur cet ordinateur (Linux seulement).
pub fn config_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    let home = crate::paths::home()?;
    config_dirs(&home).into_iter().find(|p| p.is_dir())
}

fn read_json(path: &Path) -> Option<serde_json::Value> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Titres du cache de bibliothèque de Heroic (`{"<clé>": [{app_name, title}…]}`).
fn cached_titles(file: &Path, key: &str) -> Vec<(String, String)> {
    let Some(j) = read_json(file) else { return Vec::new() };
    j.get(key)
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|g| {
                    let id = g.get("app_name")?.as_str()?;
                    let title = g.get("title")?.as_str()?.trim();
                    (!title.is_empty()).then(|| (id.to_string(), title.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn title_for(titles: &[(String, String)], id: &str, dir: &str) -> String {
    if let Some((_, t)) = titles.iter().find(|(i, _)| i == id) {
        return t.clone();
    }
    Path::new(dir)
        .file_name()
        .map(|n| n.to_string_lossy().trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| id.to_string())
}

/// Epic (legendary) : objet `app_name` → installation.
pub fn parse_legendary(j: &serde_json::Value) -> Vec<HeroicGame> {
    let Some(map) = j.as_object() else { return Vec::new() };
    map.iter()
        .filter_map(|(key, g)| {
            let app = g.get("app_name").and_then(|v| v.as_str()).unwrap_or(key);
            let dir = g.get("install_path")?.as_str()?.trim();
            if !safe_id(app) || dir.is_empty() || g.get("is_dlc").and_then(|v| v.as_bool()) == Some(true) {
                return None;
            }
            let title = g.get("title").and_then(|v| v.as_str()).map(str::trim).filter(|t| !t.is_empty()).unwrap_or(app);
            Some(HeroicGame { runner: "legendary", app_name: app.into(), title: title.into(), install_dir: dir.into() })
        })
        .collect()
}

/// GOG : `{"installed": [{appName, install_path}…]}`.
pub fn parse_gog(j: &serde_json::Value, titles: &[(String, String)]) -> Vec<HeroicGame> {
    let Some(list) = j.get("installed").and_then(|v| v.as_array()) else { return Vec::new() };
    list.iter()
        .filter_map(|g| {
            let app = g.get("appName")?.as_str()?;
            let dir = g.get("install_path")?.as_str()?.trim();
            if !safe_id(app) || dir.is_empty() || g.get("is_dlc").and_then(|v| v.as_bool()) == Some(true) {
                return None;
            }
            Some(HeroicGame { runner: "gog", app_name: app.into(), title: title_for(titles, app, dir), install_dir: dir.into() })
        })
        .collect()
}

/// Amazon (nile) : `[{id, path}…]`.
pub fn parse_nile(j: &serde_json::Value, titles: &[(String, String)]) -> Vec<HeroicGame> {
    let Some(list) = j.as_array() else { return Vec::new() };
    list.iter()
        .filter_map(|g| {
            let app = g.get("id")?.as_str()?;
            let dir = g.get("path")?.as_str()?.trim();
            if !safe_id(app) || dir.is_empty() {
                return None;
            }
            Some(HeroicGame { runner: "nile", app_name: app.into(), title: title_for(titles, app, dir), install_dir: dir.into() })
        })
        .collect()
}

/// Jeux installés par Heroic, depuis son dossier de configuration (`home` : ancien
/// emplacement de legendary).
pub fn scan(config: &Path, home: Option<&Path>) -> Vec<HeroicGame> {
    let mut out = Vec::new();
    let legendary = [Some(config.join("legendaryConfig").join("legendary").join("installed.json")), home.map(|h| h.join(".config").join("legendary").join("installed.json"))];
    if let Some(j) = legendary.into_iter().flatten().find_map(|p| read_json(&p)) {
        out.extend(parse_legendary(&j));
    }
    let cache = config.join("store_cache");
    if let Some(j) = read_json(&config.join("gog_store").join("installed.json")) {
        out.extend(parse_gog(&j, &cached_titles(&cache.join("gog_library.json"), "games")));
    }
    if let Some(j) = read_json(&config.join("nile_config").join("nile").join("installed.json")) {
        out.extend(parse_nile(&j, &cached_titles(&cache.join("nile_library.json"), "library")));
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|g| seen.insert(g.external_id()));
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    out
}

/// Lien sûr (préfixe, runner et identifiant vérifiés) avant de le confier au système.
pub fn checked_uri(uri: &str) -> Option<&str> {
    let rest = uri.strip_prefix("heroic://launch/")?;
    let (runner, app) = rest.split_once('/')?;
    (RUNNERS.contains(&runner) && safe_id(app)).then_some(uri)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jeux_epic_gog_amazon_de_heroic() {
        let epic = parse_legendary(&json!({
            "Sugar": {"app_name": "Sugar", "title": "Rocket League", "install_path": "/home/deck/Games/Heroic/rocketleague", "is_dlc": false},
            "DLC1": {"app_name": "DLC1", "title": "Pack", "install_path": "/home/deck/Games/Heroic/x", "is_dlc": true},
            "bad id": {"app_name": "x; rm", "title": "X", "install_path": "/x"}
        }));
        assert_eq!(epic.len(), 1);
        assert_eq!(epic[0].launch_uri(), "heroic://launch/legendary/Sugar");
        assert_eq!(epic[0].external_id(), "legendary/Sugar");

        let titles = vec![("1207658924".to_string(), "Unreal Tournament 2004".to_string())];
        let gog = parse_gog(
            &json!({"installed": [
                {"appName": "1207658924", "install_path": "/home/deck/Games/Heroic/UT2004", "platform": "windows"},
                {"appName": "1423049311", "install_path": "/run/media/deck/SD/Heroic/Cyberpunk 2077", "platform": "windows"}
            ]}),
            &titles,
        );
        assert_eq!(gog[0].title, "Unreal Tournament 2004");
        // titre absent du cache : nom du dossier du jeu
        assert_eq!(gog[1].title, "Cyberpunk 2077");

        let nile = parse_nile(&json!([{"id": "amzn1.adg.product.abc-123", "path": "/home/deck/Games/Heroic/Amazon/Game"}]), &[]);
        assert_eq!(nile[0].launch_uri(), "heroic://launch/nile/amzn1.adg.product.abc-123");
        assert!(checked_uri(&nile[0].launch_uri()).is_some());

        assert!(checked_uri("heroic://launch/sideload/x").is_none());
        assert!(checked_uri("heroic://launch/gog/1 2").is_none());
        assert!(checked_uri("https://launch/gog/1").is_none());
    }

    #[test]
    fn lecture_du_dossier_de_heroic() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let [classic, flatpak] = config_dirs(home);
        assert!(flatpak.ends_with(".var/app/com.heroicgameslauncher.hgl/config/heroic"));
        let w = |p: PathBuf, v: serde_json::Value| {
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, v.to_string()).unwrap();
        };
        // ancien emplacement de legendary, GOG avec son cache de titres
        w(home.join(".config/legendary/installed.json"), json!({"Sugar": {"app_name": "Sugar", "title": "Rocket League", "install_path": "/g/rl"}}));
        w(classic.join("gog_store/installed.json"), json!({"installed": [{"appName": "1207658924", "install_path": "/g/ut"}]}));
        w(classic.join("store_cache/gog_library.json"), json!({"games": [{"app_name": "1207658924", "title": "Unreal Tournament 2004"}], "__timestamp": {"games": "x"}}));
        w(classic.join("nile_config/nile/installed.json"), json!([{"id": "amzn1.x", "path": "/g/Amazon Game"}]));
        w(classic.join("store_cache/nile_library.json"), json!({"library": [{"app_name": "amzn1.x", "title": "Amazon Game"}]}));
        let games = scan(&classic, Some(home));
        let names: Vec<_> = games.iter().map(|g| (g.runner, g.title.as_str())).collect();
        assert_eq!(names, [("nile", "Amazon Game"), ("legendary", "Rocket League"), ("gog", "Unreal Tournament 2004")]);
    }
}
