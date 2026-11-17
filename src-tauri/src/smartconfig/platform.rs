//! Système hôte : où chercher la configuration d'un émulateur.
//!
//! Windows : `Adapter::locate` (dossier portable, registre, Documents,
//! AppData), implémenté par chaque adaptateur. Linux / SteamOS (préparé en
//! phase 6, non implémenté) : `Adapter::locate_unix` reçoit les dossiers XDG
//! et Flatpak de l'utilisateur ; par défaut il refuse, sans jamais deviner un
//! chemin. Android n'utilise pas de chemins de fichiers (accès par SAF) : il
//! lui faudra un autre type de cible que `PathBuf` (docs/SMARTCONFIG.md §16.2).

use super::adapters::{Adapter, Install, Location};
use std::path::PathBuf;

/// Dossiers de l'utilisateur sur un système de type Unix (spécification XDG
/// Base Directory ; applications Flatpak sous `~/.var/app/<id>`).
#[derive(Debug, Clone, PartialEq)]
pub struct UnixDirs {
    pub home: PathBuf,
    /// `$XDG_CONFIG_HOME`, sinon `~/.config`.
    pub config_home: PathBuf,
    /// `$XDG_DATA_HOME`, sinon `~/.local/share`.
    pub data_home: PathBuf,
    /// `~/.var/app` : un émulateur Flatpak y range `<id>/config` et `<id>/data`.
    pub flatpak_apps: PathBuf,
}

impl UnixDirs {
    /// D'après l'environnement. Une variable XDG relative est ignorée, comme
    /// l'exige la spécification ; sans `HOME` absolu : `None`.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let abs = |k: &str| get(k).filter(|v| v.starts_with('/')).map(PathBuf::from);
        let home = abs("HOME")?;
        Some(Self {
            config_home: abs("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config")),
            data_home: abs("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local/share")),
            flatpak_apps: home.join(".var/app"),
            home,
        })
    }
}

/// Dossier de configuration de l'émulateur sur le système courant.
pub fn locate(adapter: &dyn Adapter, install: &Install) -> Result<Location, String> {
    #[cfg(target_os = "linux")]
    {
        let dirs = UnixDirs::from_env(|k| std::env::var(k).ok()).ok_or("dossier personnel introuvable")?;
        adapter.locate_unix(install, &dirs)
    }
    #[cfg(not(target_os = "linux"))]
    {
        adapter.locate(install)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dossiers_xdg() {
        let env = |pairs: &'static [(&'static str, &'static str)]| move |k: &str| pairs.iter().find(|(a, _)| *a == k).map(|(_, v)| v.to_string());
        let d = UnixDirs::from_env(env(&[("HOME", "/home/deck")])).unwrap();
        assert_eq!(d.config_home, PathBuf::from("/home/deck/.config"));
        assert_eq!(d.data_home, PathBuf::from("/home/deck/.local/share"));
        assert_eq!(d.flatpak_apps, PathBuf::from("/home/deck/.var/app"));
        // variable relative ignorée
        let d = UnixDirs::from_env(env(&[("HOME", "/home/a"), ("XDG_CONFIG_HOME", "rel/cfg"), ("XDG_DATA_HOME", "/data")])).unwrap();
        assert_eq!(d.config_home, PathBuf::from("/home/a/.config"));
        assert_eq!(d.data_home, PathBuf::from("/data"));
        assert!(UnixDirs::from_env(env(&[])).is_none());
    }

    #[test]
    fn localisation_unix_refusee_par_defaut() {
        let dirs = UnixDirs::from_env(|k| (k == "HOME").then(|| "/home/deck".to_string())).unwrap();
        let inst = Install { profile_id: "dolphin".into(), exe: PathBuf::from("/usr/bin/dolphin-emu"), version: None, core: None };
        for a in crate::smartconfig::adapters::all() {
            let e = a.locate_unix(&inst, &dirs).unwrap_err();
            assert!(e.contains("Linux"), "{e}");
        }
    }
}
