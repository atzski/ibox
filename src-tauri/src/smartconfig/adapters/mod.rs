//! Adaptateurs d'émulateurs : chacun connaît le format réel et le système de
//! réglages *par jeu* officiellement prévu par son émulateur. Pas d'écrivain
//! générique : un émulateur sans adaptateur n'est simplement pas pris en charge.

pub mod common;
pub mod dolphin;
pub mod duckstation;
pub mod eden;
pub mod azahar;
pub mod pcsx2;
pub mod ppsspp;
pub mod retroarch;
pub mod rpcs3;

use super::hardware::HardwareInfo;
use super::model::{GameQuery, Setting};
use super::validation::{self, Rejected, SettingSpec};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Émulateur tel qu'enregistré dans iBox (table `emulators`).
#[derive(Debug, Clone)]
pub struct Install {
    pub profile_id: String,
    pub exe: PathBuf,
    pub version: Option<String>,
    /// Cœur libretro choisi pour la console du jeu (RetroArch : fichier du
    /// dossier `cores`, ex. `genesis_plus_gx_libretro.dll`).
    pub core: Option<String>,
}

/// Où l'émulateur range sa configuration.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Location {
    pub config_root: PathBuf,
    /// Installation portable (configuration à côté du programme).
    pub portable: bool,
    pub version: Option<String>,
}

/// Une modification lisible (affichée dans l'aperçu et le journal).
#[derive(Debug, Clone, PartialEq, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub key: String,
    pub label: String,
    pub before: Option<String>,
    pub after: String,
}

/// Ce dont un adaptateur peut avoir besoin pour identifier le jeu comme
/// l'émulateur le fait. `main_file` (fichier principal du jeu, rôle `main`)
/// n'est lu qu'en local et n'est jamais transmis à un fournisseur.
#[derive(Debug, Clone, Copy)]
pub struct KeyContext<'a> {
    pub install: &'a Install,
    pub location: Option<&'a Location>,
    pub main_file: Option<&'a Path>,
}

/// Aperçu complet d'une application, calculé sans rien écrire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub target: PathBuf,
    #[serde(skip)]
    pub after: Vec<u8>,
    pub changes: Vec<Change>,
    /// Paramètres refusés (validation, correctif intégré à préserver…).
    pub skipped: Vec<Rejected>,
    /// Le fichier par jeu existait déjà.
    pub existed: bool,
}

pub trait Adapter: Send + Sync {
    /// Identique au `profile_id` des profils de lancement (`dolphin`…).
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn platforms(&self) -> &'static [&'static str];
    /// Liste blanche des paramètres modifiables.
    fn specs(&self) -> &'static [SettingSpec];
    fn locate(&self, install: &Install) -> Result<Location, String>;
    /// Localisation sous Linux / SteamOS (appelée par `platform::locate`).
    /// Portage préparé, non implémenté : chaque adaptateur l'écrira d'après le
    /// code source de son émulateur (installation native, Flatpak, AppImage,
    /// portable), comme `locate` l'a été pour Windows. Jamais de chemin deviné.
    fn locate_unix(&self, _install: &Install, _dirs: &super::platform::UnixDirs) -> Result<Location, String> {
        Err(format!("{} : réglages par jeu pas encore pris en charge sous Linux", self.name()))
    }
    /// Identifiant de jeu utilisé par l'émulateur pour ses réglages par jeu
    /// (nom du fichier sans extension) ; `Err` = introuvable, avec la raison.
    fn game_key(&self, game: &GameQuery, ctx: &KeyContext) -> Result<String, String>;
    /// Forme acceptée pour l'identifiant (par défaut `[A-Za-z0-9_-]`).
    fn valid_key(&self, key: &str) -> bool {
        !key.is_empty() && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    }
    /// Dernier contrôle propre à l'émulateur avant toute écriture
    /// (`existed` : le fichier par jeu existe déjà) ; `Err` = refus expliqué.
    fn preflight(&self, _ctx: &KeyContext, _loc: &Location, _key: &str, _existed: bool) -> Result<(), String> {
        Ok(())
    }
    /// (racine autorisée, dossier écrivable, fichier cible).
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf);
    /// Valeurs actuelles des paramètres connus dans le fichier par jeu.
    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String>;
    /// Paramètres que l'émulateur fixe lui-même pour ce jeu (correctifs à préserver).
    fn builtin_overrides(&self, install: &Install, key: &str) -> Vec<String>;
    /// Nouveau contenu : modification ciblée de `current`.
    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String>;
    /// Mode auquel correspond un ensemble de réglages (`None` = indéterminable).
    fn mode_of(&self, _settings: &[Setting]) -> Option<super::model::Mode> {
        None
    }
}

pub fn all() -> Vec<Box<dyn Adapter>> {
    vec![
        Box::new(dolphin::Dolphin),
        Box::new(pcsx2::Pcsx2),
        Box::new(duckstation::DuckStation),
        Box::new(ppsspp::Ppsspp),
        Box::new(rpcs3::Rpcs3),
        Box::new(azahar::Azahar),
        Box::new(retroarch::RetroArch),
        Box::new(eden::Eden),
    ]
}

pub fn by_id(id: &str) -> Option<Box<dyn Adapter>> {
    all().into_iter().find(|a| a.id() == id)
}

/// Prépare une application : localisation, garde-fous de chemin, validation,
/// correctifs intégrés, rendu ciblé. N'écrit rien (hormis le dossier par jeu
/// s'il manque, sous la racine de l'émulateur).
pub fn plan(adapter: &dyn Adapter, install: &Install, game: &GameQuery, main_file: Option<&Path>, settings: &[Setting], hw: &HardwareInfo) -> Result<Plan, String> {
    let loc = super::platform::locate(adapter, install)?;
    let ctx = KeyContext { install, location: Some(&loc), main_file };
    let key = adapter.game_key(game, &ctx).map_err(|e| format!("identifiant du jeu introuvable pour {} : {e}", adapter.name()))?;
    if !adapter.valid_key(&key) {
        return Err("identifiant du jeu invalide".into());
    }
    let (root, dir, target) = adapter.target(&loc, &key);
    let target = super::backup::guard_target(&root, &dir, &target).map_err(|e| e.to_string())?;
    let current = super::backup::read_current(&target).map_err(|e| e.to_string())?;
    adapter.preflight(&ctx, &loc, &key, current.is_some())?;
    let mut v = validation::validate(settings, adapter.specs(), hw);
    let builtin = adapter.builtin_overrides(install, &key);
    let (keep, fixed): (Vec<Setting>, Vec<Setting>) = v.accepted.into_iter().partition(|s| !builtin.contains(&s.key));
    v.rejected.extend(fixed.into_iter().map(|s| Rejected { key: s.key, reason: "réglé par l'émulateur lui-même pour ce jeu (correctif conservé)".into() }));
    let (after, changes) = adapter.render(current.as_deref(), &keep)?;
    Ok(Plan { target, after, changes, skipped: v.rejected, existed: current.is_some() })
}

/// Vérifie qu'un fichier relu contient bien les valeurs appliquées.
pub fn verify(adapter: &dyn Adapter, path: &Path, expected: &[Setting]) -> bool {
    let Ok(Some(bytes)) = super::backup::read_current(path) else { return expected.is_empty() };
    adapter.read(Some(&bytes)).map(|cur| expected.iter().all(|e| cur.contains(e))).unwrap_or(false)
}
