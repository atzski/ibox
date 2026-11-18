//! Système hôte : où chercher la configuration d'un émulateur.
//!
//! Windows : `Adapter::locate` (dossier portable, registre, Documents,
//! AppData), implémenté par chaque adaptateur. Linux / SteamOS (phase D2,
//! docs/STEAMDECK.md) : `Adapter::locate_unix` reçoit les dossiers XDG et Flatpak
//! de l'utilisateur ; chaque adaptateur suit le code source de son émulateur
//! (installation native, Flatpak, AppImage, portable), sans jamais deviner un
//! chemin. Android n'utilise pas de chemins de fichiers (accès par SAF) : il
//! lui faudra un autre type de cible que `PathBuf` (docs/SMARTCONFIG.md §16.2).

use super::adapters::{Adapter, Install, Location};
use std::path::{Path, PathBuf};

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
    /// `$XDG_CONFIG_HOME` est défini (DuckStation change alors de dossier).
    pub config_home_set: bool,
}

impl UnixDirs {
    /// D'après l'environnement. Une variable XDG relative est ignorée, comme
    /// l'exige la spécification ; sans `HOME` absolu : `None`.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Option<Self> {
        let abs = |k: &str| get(k).filter(|v| v.starts_with('/')).map(PathBuf::from);
        let home = abs("HOME")?;
        Some(Self {
            config_home_set: abs("XDG_CONFIG_HOME").is_some(),
            config_home: abs("XDG_CONFIG_HOME").unwrap_or_else(|| home.join(".config")),
            data_home: abs("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local/share")),
            flatpak_apps: home.join(".var/app"),
            home,
        })
    }

    /// Dossiers tels que l'émulateur les voit : une application Flatpak a ses propres
    /// `XDG_CONFIG_HOME` et `XDG_DATA_HOME` (`~/.var/app/<id>/config` et `data`),
    /// toujours définis ; `HOME` reste le dossier personnel.
    pub fn for_exe(&self, exe: &Path) -> Self {
        match flatpak_id(exe) {
            Some(id) => {
                let app = self.flatpak_apps.join(id);
                Self { config_home: app.join("config"), data_home: app.join("data"), config_home_set: true, ..self.clone() }
            }
            None => self.clone(),
        }
    }

    /// Fichiers d'une application Flatpak installée (`/app` dans le bac à sable) :
    /// installation de l'utilisateur, puis du système.
    pub fn flatpak_files(&self, id: &str) -> [PathBuf; 2] {
        let rel = Path::new("app").join(id).join("current").join("active").join("files");
        [self.data_home.join("flatpak").join(&rel), Path::new("/var/lib/flatpak").join(rel)]
    }
}

/// Identifiant Flatpak d'un émulateur lancé par son lanceur exporté
/// (`…/flatpak/exports/bin/<id>`).
pub fn flatpak_id(exe: &Path) -> Option<String> {
    let dir = exe.parent()?;
    if !dir.ends_with("flatpak/exports/bin") {
        return None;
    }
    let id = exe.file_name()?.to_str()?;
    (id.split('.').count() >= 3 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))).then(|| id.to_string())
}

/// AppImage : le programme tourne depuis une image montée ailleurs ; seuls les fichiers
/// posés à côté de l'AppImage elle-même peuvent servir de configuration portable.
pub fn is_appimage(exe: &Path) -> bool {
    exe.extension().is_some_and(|e| e.eq_ignore_ascii_case("appimage"))
}

/// Remplace `~/` (forme enregistrée par RetroArch) par le dossier personnel.
pub fn expand_home(path: &str, home: &Path) -> PathBuf {
    match path.strip_prefix("~/") {
        Some(rest) => home.join(rest),
        None if path == "~" => home.to_path_buf(),
        None => PathBuf::from(path),
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
pub(crate) mod tests {
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
    fn flatpak_et_appimage() {
        let dirs = UnixDirs::from_env(|k| (k == "HOME").then(|| "/home/deck".to_string())).unwrap();
        assert!(!dirs.config_home_set);
        let exe = Path::new("/var/lib/flatpak/exports/bin/org.DolphinEmu.dolphin-emu");
        assert_eq!(flatpak_id(exe).as_deref(), Some("org.DolphinEmu.dolphin-emu"));
        let f = dirs.for_exe(exe);
        assert_eq!(f.config_home, PathBuf::from("/home/deck/.var/app/org.DolphinEmu.dolphin-emu/config"));
        assert_eq!(f.data_home, PathBuf::from("/home/deck/.var/app/org.DolphinEmu.dolphin-emu/data"));
        assert!(f.config_home_set);
        assert_eq!(f.home, dirs.home);
        assert_eq!(dirs.flatpak_files("org.DolphinEmu.dolphin-emu")[0], PathBuf::from("/home/deck/.local/share/flatpak/app/org.DolphinEmu.dolphin-emu/current/active/files"));
        // programme ordinaire : dossiers inchangés
        assert_eq!(dirs.for_exe(Path::new("/usr/bin/dolphin-emu")), dirs);
        assert!(flatpak_id(Path::new("/home/deck/flatpak/exports/bin/x")).is_none());
        assert!(is_appimage(Path::new("/home/deck/Emulation/pcsx2-v2.4-linux-appimage-x64-Qt.AppImage")));
        assert_eq!(expand_home("~/.config/retroarch/config", Path::new("/home/deck")), PathBuf::from("/home/deck/.config/retroarch/config"));
    }

    fn inst(id: &str, exe: &Path) -> Install {
        Install { profile_id: id.into(), exe: exe.to_path_buf(), version: None, core: None }
    }

    fn touch(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"").unwrap();
    }

    /// Dossiers relevés dans le code de chaque émulateur (docs/STEAMDECK.md §12).
    #[test]
    fn localisation_linux_de_chaque_emulateur() {
        use crate::smartconfig::adapters::by_id;
        let t = tempfile::tempdir().unwrap();
        let home = t.path();
        let d = temp_dirs(home);
        let apps = home.join("Emulation");
        let flatpak = |id: &str| PathBuf::from("/var/lib/flatpak/exports/bin").join(id);
        let at = |id: &str, exe: &Path| by_id(id).unwrap().locate_unix(&inst(id, exe), &d);

        // jamais lancé : refus clair, rien n'est créé
        for a in crate::smartconfig::adapters::all() {
            let e = a.locate_unix(&inst(a.id(), &apps.join("x.AppImage")), &d).unwrap_err();
            assert!(e.contains("lancez") || e.contains("introuvable"), "{}: {e}", a.id());
        }

        // Dolphin : $XDG_DATA_HOME/dolphin-emu ; Flatpak : ~/.var/app/<id>/data/dolphin-emu
        std::fs::create_dir_all(home.join(".local/share/dolphin-emu")).unwrap();
        assert_eq!(at("dolphin", Path::new("/usr/bin/dolphin-emu")).unwrap().config_root, home.join(".local/share/dolphin-emu"));
        let fp = home.join(".var/app/org.DolphinEmu.dolphin-emu/data/dolphin-emu");
        std::fs::create_dir_all(&fp).unwrap();
        assert_eq!(at("dolphin", &flatpak("org.DolphinEmu.dolphin-emu")).unwrap().config_root, fp);

        // PCSX2 : ~/.config/PCSX2, même depuis une AppImage
        std::fs::create_dir_all(home.join(".config/PCSX2/inis")).unwrap();
        let l = at("pcsx2", &apps.join("pcsx2-v2.4.0-linux-appimage-x64-Qt.AppImage")).unwrap();
        assert_eq!((l.config_root, l.portable), (home.join(".config/PCSX2"), false));

        // DuckStation : ~/.local/share/duckstation sans XDG_CONFIG_HOME ; portable à côté de l'AppImage
        touch(&home.join(".local/share/duckstation/settings.ini"));
        assert_eq!(at("duckstation", &apps.join("DuckStation-x64.AppImage")).unwrap().config_root, home.join(".local/share/duckstation"));
        let duck = home.join("Portable/DuckStation-x64.AppImage");
        touch(&home.join("Portable/portable.txt"));
        touch(&home.join("Portable/settings.ini"));
        let l = at("duckstation", &duck).unwrap();
        assert!(l.portable && l.config_root == home.join("Portable"));
        let set = UnixDirs { config_home_set: true, ..d.clone() };
        touch(&home.join(".config/duckstation/settings.ini"));
        let l = by_id("duckstation").unwrap().locate_unix(&inst("duckstation", Path::new("/usr/bin/duckstation-qt")), &set).unwrap();
        assert_eq!(l.config_root, home.join(".config/duckstation"));

        // PPSSPP : carte mémoire ~/.config/ppsspp (PSP/SYSTEM)
        std::fs::create_dir_all(home.join(".config/ppsspp/PSP/SYSTEM")).unwrap();
        assert_eq!(at("ppsspp", &apps.join("PPSSPP-v1.19-anylinux-x86_64.AppImage")).unwrap().config_root, home.join(".config/ppsspp"));

        // RPCS3 : ~/.config/rpcs3 (config.yml, custom_configs à la racine)
        touch(&home.join(".config/rpcs3/config.yml"));
        let l = at("rpcs3", &apps.join("rpcs3-v0.0.38_linux64.AppImage")).unwrap();
        assert_eq!(l.config_root, home.join(".config/rpcs3"));
        assert_eq!(by_id("rpcs3").unwrap().target(&l, "BLUS30443").2, home.join(".config/rpcs3/custom_configs/config_BLUS30443.yml"));

        // Azahar et Eden : ~/.config/azahar-emu, ~/.config/eden ; dossier user/ à côté : portable
        touch(&home.join(".config/azahar-emu/qt-config.ini"));
        assert_eq!(at("azahar", &apps.join("azahar.AppImage")).unwrap().config_root, home.join(".config/azahar-emu"));
        std::fs::create_dir_all(home.join(".config/eden")).unwrap();
        assert_eq!(at("eden", &apps.join("Eden.AppImage")).unwrap().config_root, home.join(".config/eden"));
        std::fs::create_dir_all(home.join("Eden/user/config")).unwrap();
        let l = at("eden", &home.join("Eden/Eden.AppImage")).unwrap();
        assert!(l.portable && l.config_root == home.join("Eden/user/config"));

        // RetroArch : ~/.config/retroarch/config par défaut, « ~/ » développé, ailleurs refusé
        let ra = home.join(".config/retroarch");
        std::fs::create_dir_all(ra.join("config")).unwrap();
        std::fs::write(ra.join("retroarch.cfg"), "rgui_config_directory = \"default\"
").unwrap();
        let exe = flatpak("org.libretro.RetroArch");
        assert!(at("retroarch", &exe).is_err(), "le Flatpak a ses propres dossiers");
        assert_eq!(at("retroarch", Path::new("/usr/bin/retroarch")).unwrap().config_root, ra.join("config"));
        std::fs::write(ra.join("retroarch.cfg"), "rgui_config_directory = \"~/.config/retroarch/config\"
").unwrap();
        assert_eq!(at("retroarch", Path::new("/usr/bin/retroarch")).unwrap().config_root, ra.join("config"));
        std::fs::write(ra.join("retroarch.cfg"), "rgui_config_directory = \"/tmp/ailleurs\"
").unwrap();
        assert!(at("retroarch", Path::new("/usr/bin/retroarch")).unwrap_err().contains("personnalisé"));
    }

    /// Dossiers d'essai : `HOME` dans un dossier temporaire (aussi sous Windows).
    pub fn temp_dirs(home: &Path) -> UnixDirs {
        UnixDirs {
            home: home.to_path_buf(),
            config_home: home.join(".config"),
            data_home: home.join(".local/share"),
            flatpak_apps: home.join(".var/app"),
            config_home_set: false,
        }
    }
}
