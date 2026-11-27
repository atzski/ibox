//! Applications Android installées et installation des mises à jour d'iBox (plugin Tauri
//! `ibox-apps`, classe Kotlin `AppsPlugin`). Appelé par `src-tauri/src/android_apps/` et par
//! `src-tauri/src/shell.rs`.
//!
//! | Fonction | Rôle |
//! |---|---|
//! | [`IboxApps::apps`] | applications qu'on peut ouvrir, avec l'indication « jeu » donnée par l'application |
//! | [`IboxApps::art`] | icône et bannière Android TV (PNG) |
//! | [`IboxApps::launch`] | ouvre l'application (intent de lancement) |
//! | [`IboxApps::is_installed`], [`IboxApps::uninstall`] | présence, page de désinstallation d'Android |
//! | [`IboxApps::update_dir`], [`IboxApps::install_apk`] | dossier des téléchargements, installeur d'Android |
//!
//! Comme le reste du plugin : appels bloquants (réponse de Kotlin), jamais depuis le fil principal.

use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

/// Nom du plugin Tauri des applications (distinct de `ibox-android`).
pub const APPS_NAME: &str = "ibox-apps";

/// Une application qu'on peut ouvrir.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidApp {
    pub package_name: String,
    pub label: String,
    /// Déclarée comme jeu par l'application (`isGame`, catégorie « Jeux », catégorie du lanceur).
    pub game: bool,
    /// Application du système (préinstallée).
    #[serde(default)]
    pub system: bool,
    #[serde(default)]
    pub version_name: String,
    /// Première installation (ms depuis 1970).
    #[serde(default)]
    pub installed_at: i64,
    /// Taille de l'APK principal (octets).
    #[serde(default)]
    pub size: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppList {
    pub apps: Vec<AndroidApp>,
}

/// Images d'une application, PNG en base64.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AppArt {
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallOutcome {
    /// L'installeur d'Android a été ouvert (repli `ACTION_VIEW` : pas de réponse plus précise).
    Installer,
    /// Installé (mise à jour d'une autre application ; pour iBox, Android le relance avant).
    Installed,
    Cancelled,
    /// Refus de l'installeur (signature différente, paquet abîmé…).
    Failed,
    /// L'utilisateur n'a pas autorisé iBox à installer des applications.
    Permission,
}

#[derive(Deserialize)]
struct Outcome {
    outcome: InstallOutcome,
}

#[derive(Deserialize)]
struct Installed {
    installed: bool,
}

#[derive(Deserialize)]
struct PathReply {
    path: String,
}

pub struct IboxApps<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

#[cfg(target_os = "android")]
impl<R: Runtime> IboxApps<R> {
    fn call<T: serde::de::DeserializeOwned>(&self, command: &str, args: impl Serialize) -> Result<T> {
        self.handle.run_mobile_plugin(command, args).map_err(|e| Error::Android(crate::clean(e.to_string())))
    }
}

#[cfg(not(target_os = "android"))]
impl<R: Runtime> IboxApps<R> {
    fn call<T>(&self, _: &str, _: impl Serialize) -> Result<T> {
        Err(Error::Unsupported)
    }
}

fn package(name: &str) -> serde_json::Value {
    serde_json::json!({ "packageName": name })
}

impl<R: Runtime> IboxApps<R> {
    pub fn apps(&self) -> Result<Vec<AndroidApp>> {
        self.call::<AppList>("apps", ()).map(|l| l.apps)
    }

    pub fn art(&self, package_name: &str) -> Result<AppArt> {
        self.call("appArt", package(package_name))
    }

    pub fn launch(&self, package_name: &str) -> Result<()> {
        self.call::<serde_json::Value>("launchApp", package(package_name)).map(|_| ())
    }

    pub fn is_installed(&self, package_name: &str) -> Result<bool> {
        self.call::<Installed>("isInstalled", package(package_name)).map(|i| i.installed)
    }

    /// Page de désinstallation d'Android ; répond au retour dans iBox : encore installée ?
    pub fn uninstall(&self, package_name: &str) -> Result<bool> {
        self.call::<Installed>("uninstall", package(package_name)).map(|i| i.installed)
    }

    /// Dossier où télécharger un APK (partagé avec l'installeur par le FileProvider).
    pub fn update_dir(&self) -> Result<String> {
        self.call::<PathReply>("updateDir", ()).map(|p| p.path)
    }

    /// Installeur d'Android sur un APK (l'utilisateur confirme).
    pub fn install_apk(&self, path: &str) -> Result<InstallOutcome> {
        self.call::<Outcome>("installApk", serde_json::json!({ "path": path })).map(|o| o.outcome)
    }
}

pub trait IboxAppsExt<R: Runtime> {
    fn ibox_apps(&self) -> &IboxApps<R>;
}

impl<R: Runtime, T: Manager<R>> IboxAppsExt<R> for T {
    fn ibox_apps(&self) -> &IboxApps<R> {
        self.state::<IboxApps<R>>().inner()
    }
}

/// Plugin des applications (à enregistrer à côté de [`crate::init`]).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(APPS_NAME)
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let plugin = IboxApps::<R> { handle: _api.register_android_plugin("app.ibox.plugin", "AppsPlugin")? };
            #[cfg(not(target_os = "android"))]
            let plugin = IboxApps::<R> { _marker: std::marker::PhantomData };
            app.manage(plugin);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn liste_du_kotlin() {
        let l: AppList = serde_json::from_str(
            r#"{"apps":[{"packageName":"com.example.game","label":"Jeu","game":true,"system":false,"versionName":"1.2","installedAt":1700000000000,"size":1234}]}"#,
        )
        .unwrap();
        assert_eq!(l.apps[0].package_name, "com.example.game");
        assert!(l.apps[0].game);
        let o: Outcome = serde_json::from_str(r#"{"outcome":"cancelled"}"#).unwrap();
        assert_eq!(o.outcome, InstallOutcome::Cancelled);
        let a: AppArt = serde_json::from_str(r#"{"icon":"iVBO"}"#).unwrap();
        assert!(a.banner.is_none());
    }
}
