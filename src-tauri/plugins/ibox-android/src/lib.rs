//! Socle Android d'iBox (plugin mobile Tauri 2).
//!
//! Partie Kotlin : `android/src/main/java/app/ibox/plugin/` (classe `IboxPlugin`, relais de la
//! manette `PadRelay`, stockage `Storage`). Partie Rust : ce fichier, appelé par les commandes
//! d'iBox (`src-tauri/src/mobile.rs`, `src-tauri/src/launcher/android.rs`).
//!
//! | Fonction | Rôle |
//! |---|---|
//! | [`IboxAndroid::launch`] | démarre une activité par intent ([`Intent`] : composant, action, données, extras, options, adresses à autoriser) |
//! | [`IboxAndroid::installed`] | activités installées parmi une liste « paquet/activité » |
//! | [`IboxAndroid::set_immersive`] | plein écran immersif (barres système masquées, visibles un instant au glissement) |
//! | [`IboxAndroid::set_pad_relay`] | relais natif de la manette : événement `pad` au format de `src/input/gamepad.ts` |
//! | [`IboxAndroid::storage_status`], [`IboxAndroid::request_all_files`] | accès aux fichiers, volumes (mémoire interne, carte SD) |
//! | [`IboxAndroid::pick_folder`] | sélecteur de dossier du système → chemin (autorisation SAF gardée) |
//! | [`IboxAndroid::rom_uri`] | adresse `content://` d'une ROM pour un émulateur (SAF ou FileProvider) |
//! | [`IboxAndroid::second_status`], [`IboxAndroid::second_configure`], [`IboxAndroid::second_push`] | second écran (`second.rs`, `SecondScreen.kt`) |
//!
//! Applications installées (jeux de la bibliothèque) et installeur d'APK : module [`apps`],
//! plugin Tauri à part (`ibox-apps`, classe Kotlin `AppsPlugin`), enregistré par [`apps::init`].
//! Pendant une partie (notifications, service « Partie en cours », retour à iBox) : module
//! [`ingame`], plugin Tauri `ibox-ingame` (classe Kotlin `IngamePlugin`), enregistré par [`ingame::init`].
//! | [`IboxAndroid::device_state`], [`IboxAndroid::set_frame_rate`] | chaleur, batterie, écran, mémoire ; fréquence d'affichage (`device.rs`, événement `device`) |
//!
//! Le bouton Retour d'Android passe par le plugin `app` du cœur de Tauri (`onBackButtonPress`).
//! Les types sont compilés partout (tests sous Windows) ; les appels ne fonctionnent que sur Android.

mod second;
pub use second::{SecondDisplay, SecondStatus};
pub mod apps;
pub mod ingame;
mod device;
pub use device::DeviceState;

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Refus du côté Android (activité introuvable, choix annulé…), message en français.
    #[error("{0}")]
    Android(String),
    #[error("Disponible uniquement sur Android.")]
    Unsupported,
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

/// Valeur ajoutée à l'intent (`putExtra`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extra {
    pub key: String,
    /// `string`, `bool`, `int`, `long`, `float`, `stringArray`.
    #[serde(rename = "type")]
    pub kind: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub values: Option<Vec<String>>,
}

impl Extra {
    pub fn new(kind: &str, key: &str, value: impl Into<String>) -> Self {
        Self { key: key.into(), kind: kind.into(), value: value.into(), values: None }
    }
}

/// Activité à démarrer.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Intent {
    /// « paquet/activité » (« paquet/.Activité » accepté).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub categories: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub extras: Vec<Extra>,
    /// `clearTask`, `clearTop`, `noHistory`, `newTask`, `singleTop`.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub flags: Vec<String>,
    /// Adresses `content://` que l'activité pourra lire (et écrire si iBox le peut).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub grant_uris: Vec<String>,
    /// Dossiers (chemins) dont l'activité reçoit tout le contenu, par une adresse SAF de l'arbre
    /// autorisé et `FLAG_GRANT_PREFIX_URI_PERMISSION` (fichiers voisins de la ROM, sauvegardes).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub grant_folders: Vec<String>,
}

impl Intent {
    /// Paquet visé (celui du composant, sinon `package_name`).
    pub fn target_package(&self) -> Option<&str> {
        self.component.as_deref().and_then(|c| c.split('/').next()).or(self.package_name.as_deref())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// Activités trouvées (même écriture que la demande).
    pub components: Vec<String>,
    /// Paquets installés parmi ceux des activités demandées.
    pub packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub path: String,
    pub label: String,
    pub primary: bool,
    pub removable: bool,
    pub mounted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStatus {
    /// iBox lit tous les fichiers (Android 11+ : « Accès à tous les fichiers »).
    pub all_files: bool,
    pub sdk: u32,
    pub volumes: Vec<Volume>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFolder {
    /// Arbre SAF autorisé (gardé pour les adresses des ROM).
    pub uri: String,
    /// Chemin de fichiers (`/storage/emulated/0/Roms`, `/storage/1A2B-3C4D/Roms`).
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UriKind {
    /// Document d'un arbre autorisé par l'utilisateur (`com.android.externalstorage.documents`) ;
    /// à défaut, FileProvider.
    Saf,
    /// FileProvider d'iBox (`app.ibox.android.fileprovider`).
    Provider,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RomUri {
    pub uri: String,
    pub kind: UriKind,
}

/// Accès au plugin (`app.ibox_android()`).
pub struct IboxAndroid<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    #[cfg(not(target_os = "android"))]
    _marker: std::marker::PhantomData<fn() -> R>,
}

#[cfg(target_os = "android")]
impl<R: Runtime> IboxAndroid<R> {
    fn call<T: serde::de::DeserializeOwned>(&self, command: &str, args: impl Serialize) -> Result<T> {
        self.handle.run_mobile_plugin(command, args).map_err(|e| Error::Android(clean(e.to_string())))
    }
}

/// Les refus de Kotlin arrivent enrobés (« … error: … ») : on garde le message.
#[cfg(target_os = "android")]
fn clean(message: String) -> String {
    serde_json::from_str::<serde_json::Value>(&message)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
        .unwrap_or(message)
}

#[cfg(not(target_os = "android"))]
impl<R: Runtime> IboxAndroid<R> {
    fn call<T>(&self, _: &str, _: impl Serialize) -> Result<T> {
        Err(Error::Unsupported)
    }
}

#[derive(Serialize)]
struct Enabled {
    enabled: bool,
}

impl<R: Runtime> IboxAndroid<R> {
    /// Démarre une activité. Erreur si elle n'existe pas ou si Android refuse.
    pub fn launch(&self, intent: &Intent) -> Result<()> {
        self.call::<serde_json::Value>("launch", intent).map(|_| ())
    }

    /// Activités installées parmi `components` (« paquet/activité »).
    pub fn installed(&self, components: &[String]) -> Result<Installed> {
        self.call("installed", serde_json::json!({ "components": components }))
    }

    pub fn set_immersive(&self, enabled: bool) -> Result<()> {
        self.call::<serde_json::Value>("setImmersive", Enabled { enabled }).map(|_| ())
    }

    /// Relais natif de la manette (événement `pad`). Actif, la WebView ne reçoit plus les
    /// événements des manettes.
    pub fn set_pad_relay(&self, enabled: bool) -> Result<()> {
        self.call::<serde_json::Value>("setPadRelay", Enabled { enabled }).map(|_| ())
    }

    pub fn storage_status(&self) -> Result<StorageStatus> {
        self.call("storageStatus", ())
    }

    /// Ouvre la page d'autorisation d'Android ; répond au retour dans iBox. Bloquant : jamais
    /// depuis le fil principal.
    pub fn request_all_files(&self) -> Result<StorageStatus> {
        self.call("requestAllFiles", ())
    }

    /// Sélecteur de dossier du système, ouvert sur `initial` (chemin) si possible. Bloquant :
    /// jamais depuis le fil principal.
    pub fn pick_folder(&self, initial: Option<&str>) -> Result<PickedFolder> {
        self.call("pickFolder", serde_json::json!({ "initialPath": initial }))
    }

    /// Le dossier est dans un arbre SAF autorisé par l'utilisateur (les émulateurs qui veulent une
    /// adresse SAF peuvent ouvrir ses fichiers, et ceux qui sont à côté).
    pub fn saf_covered(&self, path: &str) -> Result<bool> {
        let v: serde_json::Value = self.call("safCovered", serde_json::json!({ "path": path }))?;
        Ok(v.get("covered").and_then(|c| c.as_bool()).unwrap_or(false))
    }

    pub fn rom_uri(&self, path: &str, kind: UriKind) -> Result<RomUri> {
        self.call("romUri", serde_json::json!({ "path": path, "kind": kind }))
    }
}

/// Accès depuis l'application, une fenêtre ou une commande.
pub trait IboxAndroidExt<R: Runtime> {
    fn ibox_android(&self) -> &IboxAndroid<R>;
}

impl<R: Runtime, T: Manager<R>> IboxAndroidExt<R> for T {
    fn ibox_android(&self) -> &IboxAndroid<R> {
        self.state::<IboxAndroid<R>>().inner()
    }
}

/// Nom du plugin côté interface : `addPluginListener("ibox-android", "pad", …)`.
pub const NAME: &str = "ibox-android";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(NAME)
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let plugin = IboxAndroid::<R> { handle: _api.register_android_plugin("app.ibox.plugin", "IboxPlugin")? };
            #[cfg(not(target_os = "android"))]
            let plugin = IboxAndroid::<R> { _marker: std::marker::PhantomData };
            app.manage(plugin);
            Ok(())
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intent_au_format_du_kotlin() {
        let intent = Intent {
            component: Some("org.dolphinemu.dolphinemu/.ui.main.TvMainActivity".into()),
            action: Some("android.intent.action.MAIN".into()),
            extras: vec![Extra::new("string", "AutoStartFile", "content://x")],
            flags: vec!["clearTask".into()],
            grant_uris: vec!["content://x".into()],
            ..Default::default()
        };
        let v = serde_json::to_value(&intent).unwrap();
        assert_eq!(v["component"], "org.dolphinemu.dolphinemu/.ui.main.TvMainActivity");
        assert_eq!(v["extras"][0]["type"], "string");
        assert_eq!(v["grantUris"][0], "content://x");
        assert!(v.get("data").is_none() && v.get("categories").is_none());
        assert_eq!(intent.target_package(), Some("org.dolphinemu.dolphinemu"));
    }
}
