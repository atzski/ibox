//! `manifest.json` d'un paquet `.iboxplugin` : lecture et validation stricte.
//!
//! Le manifeste vient d'un paquet signé, mais il reste une donnée : chaque champ est vérifié
//! (identifiant, chemins relatifs sûrs, permissions connues, adresses en https) avant que le
//! socle ne s'en serve.

use serde::{Deserialize, Serialize};

/// Permissions connues. `webview:<origine https>` s'ajoute à cette liste.
/// `backdrop` : image de la zone sous l'overlay (verre flouté), la fenêtre étant exclue des captures.
pub const PERMISSIONS: [&str; 5] = ["overlay", "hotkey", "gamepad", "media-session", "backdrop"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub name: String,
    /// Identifiant du profil iNetbox du créateur.
    #[serde(default)]
    pub inetbox: Option<String>,
    /// Compte iNetbox du créateur (le serveur en déduit `inetbox`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    /// Page du paquet servie dans la fenêtre du plugin (`ui/index.html`)…
    #[serde(default)]
    pub entry: Option<String>,
    /// … ou une interface intégrée à iBox, pilotée par le plugin (seule valeur : `music`).
    #[serde(default)]
    pub builtin: Option<String>,
    #[serde(default = "default_side")]
    pub side: String,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default)]
    pub pad_combo: Option<Vec<String>>,
}

fn default_side() -> String {
    "right".into()
}
fn default_width() -> u32 {
    460
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Webview {
    pub url: String,
    #[serde(default)]
    pub scripts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: Author,
    #[serde(default)]
    pub description: String,
    /// Version minimale d'iBox, `>=x.y.z`.
    #[serde(default)]
    pub ibox: Option<String>,
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub overlay: Option<Overlay>,
    #[serde(default)]
    pub webview: Option<Webview>,
    /// Origines d'images autorisées par la CSP de la fenêtre (`https://*.ytimg.com`).
    #[serde(default)]
    pub images: Vec<String>,
}

pub type Result<T> = std::result::Result<T, String>;

/// Interfaces intégrées qu'un plugin peut réveiller (`overlay.builtin`).
pub const BUILTIN_UIS: [&str; 1] = ["music"];

pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    !b.is_empty() && b.len() <= 64 && b[0].is_ascii_alphanumeric() && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

/// `x.y.z` (chiffres seulement).
pub fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    let mut it = v.trim().split('.');
    let mut n = || it.next().filter(|s| !s.is_empty() && s.len() <= 9 && s.bytes().all(|c| c.is_ascii_digit())).and_then(|s| s.parse().ok());
    let r = (n()?, n()?, n()?);
    if it.next().is_some() {
        return None;
    }
    Some(r)
}

/// Chemin relatif sûr dans le paquet : pas de `..`, pas d'absolu, pas de `\` ni de `:`.
pub fn safe_path(p: &str) -> bool {
    !p.is_empty()
        && p.len() <= 200
        && !p.starts_with('/')
        && !p.contains('\\')
        && !p.contains(':')
        && p.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

/// Origine https stricte, sans chemin : `https://music.youtube.com`, éventuellement `https://*.ytimg.com`.
pub fn https_origin(s: &str, wildcard: bool) -> Option<&str> {
    let host = s.strip_prefix("https://")?;
    let bare = if wildcard { host.strip_prefix("*.").unwrap_or(host) } else { host };
    let ok = !bare.is_empty()
        && bare.len() <= 120
        && bare.contains('.')
        && !bare.starts_with('.')
        && !bare.ends_with('.')
        && bare.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'-');
    ok.then_some(host)
}

pub fn current_platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    }
}

/// Raccourci `Ctrl+Shift+C` → (modificateurs Win32 MOD_*, code de touche). Au moins un
/// modificateur parmi Ctrl, Alt, Win (Maj seul prendrait une lettre au jeu).
pub fn parse_hotkey(s: &str) -> Option<(u32, u32)> {
    const ALT: u32 = 0x1;
    const CTRL: u32 = 0x2;
    const SHIFT: u32 = 0x4;
    const WIN: u32 = 0x8;
    let parts: Vec<&str> = s.split('+').map(str::trim).collect();
    let (key, mods) = parts.split_last()?;
    let mut m = 0;
    for p in mods {
        let bit = match p.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => CTRL,
            "shift" => SHIFT,
            "alt" => ALT,
            "win" | "super" => WIN,
            _ => return None,
        };
        if m & bit != 0 {
            return None;
        }
        m |= bit;
    }
    if m & (CTRL | ALT | WIN) == 0 {
        return None;
    }
    let k = key.to_ascii_uppercase();
    let vk = match k.as_bytes() {
        [c] if c.is_ascii_uppercase() || c.is_ascii_digit() => *c as u32,
        [b'F', rest @ ..] if !rest.is_empty() => match k[1..].parse::<u32>() {
            Ok(n @ 1..=12) => 0x70 + n - 1,
            _ => return None,
        },
        _ => return None,
    };
    Some((m, vk))
}

/// Combo manette `["back", "y"]` → masque de boutons XInput. Deux boutons au moins.
pub fn parse_combo(names: &[String]) -> Option<u16> {
    let mut mask = 0u16;
    for n in names {
        let bit = match n.as_str() {
            "up" => 0x0001,
            "down" => 0x0002,
            "left" => 0x0004,
            "right" => 0x0008,
            "start" => 0x0010,
            "back" => 0x0020,
            "lb" => 0x0100,
            "rb" => 0x0200,
            "a" => 0x1000,
            "b" => 0x2000,
            "x" => 0x4000,
            "y" => 0x8000,
            _ => return None,
        };
        mask |= bit;
    }
    (mask.count_ones() >= 2).then_some(mask)
}

/// La version d'iBox satisfait-elle `>=x.y.z` ?
pub fn ibox_satisfies(req: Option<&str>, ibox: &str) -> bool {
    let Some(req) = req else { return true };
    let Some(min) = req.trim().strip_prefix(">=").and_then(parse_version) else { return false };
    parse_version(ibox).is_some_and(|v| v >= min)
}

impl Manifest {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let m: Manifest = serde_json::from_slice(bytes).map_err(|e| format!("Manifeste illisible : {e}"))?;
        m.validate()?;
        Ok(m)
    }

    pub fn has(&self, perm: &str) -> bool {
        self.permissions.iter().any(|p| p == perm)
    }

    /// Origine autorisée pour la WebView du plugin (`https://music.youtube.com`).
    pub fn webview_origin(&self) -> Option<&str> {
        self.permissions.iter().find_map(|p| p.strip_prefix("webview:"))
    }

    pub fn validate(&self) -> Result<()> {
        if !valid_id(&self.id) {
            return Err("Identifiant de plugin invalide.".into());
        }
        if self.name.trim().is_empty() || self.name.len() > 80 || self.author.name.trim().is_empty() || self.author.name.len() > 80 || self.description.len() > 600 {
            return Err("Nom, créateur ou description invalide.".into());
        }
        if parse_version(&self.version).is_none() {
            return Err("Version du plugin invalide.".into());
        }
        if let Some(req) = &self.ibox {
            if req.trim().strip_prefix(">=").and_then(parse_version).is_none() {
                return Err("Version d'iBox requise invalide.".into());
            }
        }
        if !self.platforms.is_empty() && self.platforms.iter().any(|p| !matches!(p.as_str(), "windows" | "linux")) {
            return Err("Plateforme inconnue.".into());
        }
        for p in &self.permissions {
            let ok = PERMISSIONS.contains(&p.as_str()) || p.strip_prefix("webview:").is_some_and(|o| https_origin(o, false).is_some());
            if !ok {
                return Err(format!("Permission inconnue : {p}"));
            }
        }
        if self.permissions.iter().filter(|p| p.starts_with("webview:")).count() > 1 {
            return Err("Une seule WebView par plugin.".into());
        }
        for img in &self.images {
            if https_origin(img, true).is_none() {
                return Err(format!("Origine d'image invalide : {img}"));
            }
        }
        if let Some(o) = &self.overlay {
            if !self.has("overlay") {
                return Err("La permission overlay manque.".into());
            }
            let ui_ok = match (&o.entry, &o.builtin) {
                (Some(e), None) => safe_path(e),
                (None, Some(b)) => BUILTIN_UIS.contains(&b.as_str()),
                _ => false,
            };
            if !ui_ok || !matches!(o.side.as_str(), "right" | "left") || !(240..=900).contains(&o.width) {
                return Err("Overlay invalide.".into());
            }
            if let Some(h) = &o.hotkey {
                if !self.has("hotkey") || parse_hotkey(h).is_none() {
                    return Err("Raccourci invalide ou permission hotkey manquante.".into());
                }
            }
            if let Some(c) = &o.pad_combo {
                if !self.has("gamepad") || parse_combo(c).is_none() {
                    return Err("Combo manette invalide ou permission gamepad manquante.".into());
                }
            }
        }
        if let Some(w) = &self.webview {
            let origin = self.webview_origin().ok_or("La permission webview manque.")?;
            let in_origin = w.url.strip_prefix("https://").is_some_and(|rest| {
                let host = rest.split('/').next().unwrap_or("");
                format!("https://{host}") == origin
            });
            if !in_origin || w.scripts.len() > 8 || !w.scripts.iter().all(|s| safe_path(s)) {
                return Err("WebView invalide.".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn sample() -> serde_json::Value {
        serde_json::json!({
            "id": "music-in-the-box", "name": "Music in the Box", "version": "1.0.0",
            "author": { "name": "atzski", "inetbox": "u_1" },
            "description": "Musique par-dessus vos parties.",
            "ibox": ">=0.1.100", "platforms": ["windows"],
            "permissions": ["overlay", "hotkey", "gamepad", "media-session", "webview:https://music.youtube.com"],
            "overlay": { "entry": "ui/index.html", "side": "right", "width": 460, "hotkey": "Ctrl+Shift+C", "padCombo": ["back", "y"] },
            "webview": { "url": "https://music.youtube.com/", "scripts": ["bridge/parse.js", "bridge/bridge.js"] },
            "images": ["https://*.ytimg.com", "https://lh3.googleusercontent.com"]
        })
    }

    fn with(f: impl FnOnce(&mut serde_json::Value)) -> Result<Manifest> {
        let mut v = sample();
        f(&mut v);
        Manifest::parse(v.to_string().as_bytes())
    }

    #[test]
    fn the_music_manifest_is_valid() {
        let m = with(|_| {}).unwrap();
        assert_eq!(m.webview_origin(), Some("https://music.youtube.com"));
        assert_eq!(m.overlay.unwrap().width, 460);
    }

    #[test]
    fn unsafe_or_unknown_fields_are_refused() {
        assert!(with(|v| v["id"] = "../x".into()).is_err());
        assert!(with(|v| v["id"] = "Music".into()).is_err());
        assert!(with(|v| v["overlay"]["entry"] = "../ui/index.html".into()).is_err());
        assert!(with(|v| v["overlay"]["entry"] = "C:/ui.html".into()).is_err());
        // interface intégrée : connue seulement, et jamais en plus d'une page
        assert!(with(|v| { v["overlay"]["builtin"] = "music".into(); v["overlay"].as_object_mut().unwrap().remove("entry"); }).is_ok());
        assert!(with(|v| v["overlay"]["builtin"] = "music".into()).is_err());
        assert!(with(|v| { v["overlay"]["builtin"] = "capture".into(); v["overlay"].as_object_mut().unwrap().remove("entry"); }).is_err());
        assert!(with(|v| { v["overlay"].as_object_mut().unwrap().remove("entry"); }).is_err());
        assert!(with(|v| v["webview"]["scripts"][0] = "/abs.js".into()).is_err());
        assert!(with(|v| v["permissions"][0] = "filesystem".into()).is_err());
        assert!(with(|v| v["permissions"][4] = "webview:http://music.youtube.com".into()).is_err());
        assert!(with(|v| v["webview"]["url"] = "https://evil.example/".into()).is_err());
        assert!(with(|v| v["webview"]["url"] = "https://music.youtube.com.evil.example/".into()).is_err());
        assert!(with(|v| v["images"][0] = "http://x.com".into()).is_err());
        assert!(with(|v| v["overlay"]["hotkey"] = "Shift+C".into()).is_err());
        // un raccourci sans la permission hotkey
        assert!(with(|v| v["permissions"] = serde_json::json!(["overlay", "gamepad", "webview:https://music.youtube.com"])).is_err());
        assert!(with(|v| v["version"] = "1.0".into()).is_err());
    }

    #[test]
    fn helpers() {
        assert_eq!(parse_hotkey("Ctrl+Shift+C"), Some((0x2 | 0x4, 'C' as u32)));
        assert_eq!(parse_hotkey("Alt+F12"), Some((0x1, 0x7B)));
        assert_eq!(parse_hotkey("Ctrl+Ctrl+C"), None);
        assert_eq!(parse_combo(&["back".into(), "y".into()]), Some(0x8020));
        assert_eq!(parse_combo(&["y".into()]), None);
        assert!(ibox_satisfies(Some(">=0.1.106"), "0.1.106"));
        assert!(!ibox_satisfies(Some(">=0.1.107"), "0.1.106"));
        assert!(ibox_satisfies(None, "0.0.1"));
        assert!(safe_path("ui/assets/a.js"));
        assert!(!safe_path("ui//a.js") && !safe_path("./a") && !safe_path("a\\b"));
    }
}
