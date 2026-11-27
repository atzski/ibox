//! Pendant une partie : notifications Android, autorisation d'Android 13, service « Partie en
//! cours », retour à iBox (plugin Tauri `ibox-ingame`, classe Kotlin `IngamePlugin`,
//! docs/ANDROID.md §17). Appelé par `src-tauri/src/android_ingame.rs`.
//!
//! | Fonction | Rôle |
//! |---|---|
//! | [`IboxIngame::status`], [`IboxIngame::request`], [`IboxIngame::open_settings`] | autorisation des notifications (dialogue d'Android, sinon ses Paramètres) |
//! | [`IboxIngame::configure`] | textes dans la langue d'iBox (noms des canaux, notification de la partie) |
//! | [`IboxIngame::session_start`], [`IboxIngame::session_stop`] | service de premier plan et notification « Partie en cours » |
//! | [`IboxIngame::post`] | une notification dans un canal ([`Channel`]) |
//!
//! Le toucher d'une notification ramène iBox devant ; ce qu'il faut ouvrir ensuite est rendu une
//! fois par [`IboxIngame::status`] (champ `tap`). Appels bloquants, jamais du fil principal.

use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Nom du plugin Tauri (distinct de `ibox-android`).
pub const INGAME_NAME: &str = "ibox-ingame";

/// Canaux de notification, un par type (noms donnés par [`IboxIngame::configure`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Channel {
    #[serde(rename = "ibox.achievements")]
    Achievements,
    #[serde(rename = "ibox.messages")]
    Messages,
    #[serde(rename = "ibox.friends")]
    Friends,
    #[serde(rename = "ibox.requests")]
    Requests,
    #[serde(rename = "ibox.notices")]
    Notices,
}

/// Autorisation des notifications.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyStatus {
    /// Notifications permises (Android 13+ : autorisation accordée ; avant : pas coupées).
    pub granted: bool,
    /// Le dialogue d'Android peut encore s'ouvrir (sinon : ses Paramètres).
    #[serde(default)]
    pub can_ask: bool,
    /// Android 13+ (autorisation d'exécution).
    #[serde(default)]
    pub runtime: bool,
    /// Service « Partie en cours » actif.
    #[serde(default)]
    pub session: bool,
    /// Page des Paramètres d'Android ouverte à la place du dialogue.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub opened: bool,
    /// Toucher d'une notification à traiter (JSON), rendu une seule fois.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tap: Option<String>,
}

/// Une notification.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    /// Identifiant Android (même identifiant : la notification est remplacée).
    pub id: i32,
    pub channel: Channel,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// Grande icône (PNG ou JPEG en base64).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    /// Ce que l'interface ouvre au toucher (JSON).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tap: Option<String>,
    /// Rien quand iBox est devant (l'interface montre déjà sa carte).
    pub only_in_background: bool,
}

#[derive(Deserialize)]
struct Posted {
    posted: bool,
}

#[derive(Deserialize)]
struct Foreground {
    foreground: bool,
}

pub struct IboxIngame<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

#[cfg(target_os = "android")]
impl<R: Runtime> IboxIngame<R> {
    fn call<T: serde::de::DeserializeOwned>(&self, command: &str, args: impl Serialize) -> Result<T> {
        self.handle.run_mobile_plugin(command, args).map_err(|e| Error::Android(crate::clean(e.to_string())))
    }
}

#[cfg(not(target_os = "android"))]
impl<R: Runtime> IboxIngame<R> {
    fn call<T>(&self, _: &str, _: impl Serialize) -> Result<T> {
        Err(Error::Unsupported)
    }
}

impl<R: Runtime> IboxIngame<R> {
    pub fn status(&self) -> Result<NotifyStatus> {
        self.call("status", ())
    }

    /// Dialogue d'Android (répond à son retour), ou page de ses Paramètres (`opened`).
    pub fn request(&self) -> Result<NotifyStatus> {
        self.call("request", ())
    }

    pub fn open_settings(&self) -> Result<()> {
        self.call::<serde_json::Value>("openSettings", ()).map(|_| ())
    }

    /// Textes : `channel.<canal>`, `session.title` (« En jeu : {0} »), `session.body`, `session.return`.
    pub fn configure(&self, texts: &HashMap<String, String>) -> Result<()> {
        self.call::<serde_json::Value>("configure", serde_json::json!({ "texts": texts })).map(|_| ())
    }

    /// Service de premier plan ; `false` si Android l'a refusé (notification ordinaire à la place).
    pub fn session_start(&self, title: &str, emulator: &str, started_at_ms: i64) -> Result<bool> {
        self.call::<Foreground>("sessionStart", serde_json::json!({ "title": title, "emulator": emulator, "startedAt": started_at_ms }))
            .map(|f| f.foreground)
    }

    pub fn session_stop(&self) -> Result<()> {
        self.call::<serde_json::Value>("sessionStop", ()).map(|_| ())
    }

    /// Vrai si la notification est partie (faux : iBox devant, autorisation absente, canal coupé).
    pub fn post(&self, post: &Post) -> Result<bool> {
        self.call::<Posted>("post", post).map(|p| p.posted)
    }
}

pub trait IboxIngameExt<R: Runtime> {
    fn ibox_ingame(&self) -> &IboxIngame<R>;
}

impl<R: Runtime, T: Manager<R>> IboxIngameExt<R> for T {
    fn ibox_ingame(&self) -> &IboxIngame<R> {
        self.state::<IboxIngame<R>>().inner()
    }
}

/// Plugin « pendant une partie » (à enregistrer à côté de [`crate::init`]).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(INGAME_NAME)
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let plugin = IboxIngame::<R> { handle: _api.register_android_plugin("app.ibox.plugin", "IngamePlugin")? };
            #[cfg(not(target_os = "android"))]
            let plugin = IboxIngame::<R> { _marker: std::marker::PhantomData };
            app.manage(plugin);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn echanges_avec_kotlin() {
        let s: NotifyStatus = serde_json::from_str(r#"{"granted":false,"canAsk":true,"runtime":true,"session":false}"#).unwrap();
        assert!(s.can_ask && !s.granted && s.tap.is_none());
        let p = Post {
            id: 101,
            channel: Channel::Achievements,
            title: "Succès".into(),
            body: None,
            image: None,
            tap: Some("{}".into()),
            only_in_background: true,
        };
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["channel"], "ibox.achievements");
        assert_eq!(v["onlyInBackground"], true);
        assert!(v.get("body").is_none());
    }
}
