//! Second écran (AYN Thor : écran tactile du bas). Partie Kotlin : `SecondScreen.kt`.
//!
//! L'écran du bas affiche une WebView sans IPC : la fenêtre principale lui pousse son état
//! ([`IboxAndroid::second_push`], JSON transmis tel quel) et reçoit ses touchers par l'événement
//! `second` du plugin (`addPluginListener("ibox-android", "second", …)`).

use serde::{Deserialize, Serialize};
use tauri::Runtime;

use crate::{IboxAndroid, Result};

/// Un écran vu par Android.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondDisplay {
    pub id: i32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub density: u32,
    /// Catégorie « présentation » d'Android (écran fait pour un second contenu).
    pub presentation: bool,
    /// Écran choisi pour l'écran du bas.
    pub target: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondStatus {
    /// Un second écran utilisable est branché.
    pub available: bool,
    pub displays: Vec<SecondDisplay>,
    /// Réglage reçu de l'interface.
    pub enabled: bool,
    /// Surface ouverte sur l'écran du bas.
    pub active: bool,
    /// `activity` ou `presentation`.
    #[serde(default)]
    pub surface: Option<String>,
    /// Les ressources d'iBox peuvent être servies à la WebView du bas.
    pub bridge: bool,
    #[serde(default)]
    pub display_id: Option<i32>,
}

#[derive(Serialize)]
struct Configure<'a> {
    enabled: bool,
    mode: &'a str,
    yielded: bool,
}

impl<R: Runtime> IboxAndroid<R> {
    pub fn second_status(&self) -> Result<SecondStatus> {
        self.call("secondStatus", ())
    }

    /// Active ou coupe l'écran du bas. `mode` : `auto` (activité dès Android 10), `activity`,
    /// `presentation`. `yielded` : écran laissé à l'émulateur (jeux DS, 3DS).
    pub fn second_configure(&self, enabled: bool, mode: &str, yielded: bool) -> Result<SecondStatus> {
        self.call("secondConfigure", Configure { enabled, mode, yielded })
    }

    /// État affiché en bas (JSON produit par l'interface).
    pub fn second_push(&self, state: &str) -> Result<()> {
        self.call::<serde_json::Value>("secondPush", serde_json::json!({ "state": state })).map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etat_du_kotlin_lu() {
        let s: SecondStatus = serde_json::from_value(serde_json::json!({
            "available": true, "enabled": true, "active": true, "surface": "activity", "bridge": true, "displayId": 2,
            "displays": [{ "id": 2, "name": "Bas", "width": 1240, "height": 1080, "density": 320, "presentation": true, "target": true }]
        }))
        .unwrap();
        assert_eq!(s.displays[0].width, 1240);
        assert_eq!(s.display_id, Some(2));
        let none: SecondStatus = serde_json::from_value(serde_json::json!({ "available": false, "displays": [], "enabled": false, "active": false, "surface": null, "bridge": false })).unwrap();
        assert!(none.surface.is_none() && none.display_id.is_none());
    }
}
