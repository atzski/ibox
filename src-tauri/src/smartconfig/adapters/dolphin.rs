//! Adaptateur Dolphin (GameCube, Wii).
//!
//! Format vérifié dans le code source de Dolphin (Source/Core/Core/Config/
//! MainSettings.cpp, GraphicsSettings.cpp, ConfigLoaders/GameConfigLoader.cpp) :
//! réglages par jeu dans `<User>/GameSettings/<ID6>.ini`, couche « jeu
//! utilisateur » qui ne remplace que les clés présentes. Sections : `Core`
//! (système Main) et `Video_Hardware` / `Video_Settings` / `Video_Hacks`
//! (système GFX). Les correctifs livrés avec Dolphin (`Sys/GameSettings`) ne
//! sont jamais contredits.
//!
//! Dossier utilisateur (UICommon::SetUserDirectory, Windows) : `portable.txt`
//! à côté du programme → `<exe>/User` ; sinon registre `LocalUserConfig` /
//! `UserConfigPath` ; sinon `Documents\Dolphin Emulator` s'il existe ; sinon
//! `%APPDATA%\Dolphin Emulator`.

use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::hardware::HardwareInfo;
use crate::smartconfig::ini::Ini;
use crate::smartconfig::model::{GameQuery, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use crate::smartconfig::platform::{self, UnixDirs};
use std::path::{Path, PathBuf};

pub struct Dolphin;

pub const BACKENDS: &[&str] = &["vulkan", "d3d11", "d3d12", "opengl"];
pub const SHADERS: &[&str] = &["specialized", "exclusive_ubershaders", "hybrid_ubershaders", "skip_drawing"];
pub const MSAA: &[&str] = &["1", "2", "4", "8"];

fn backend_check(v: &Value, hw: &HardwareInfo) -> Option<String> {
    let Value::Choice(c) = v else { return None };
    let ok = match c.as_str() {
        "vulkan" => hw.apis.vulkan_loader,
        "d3d11" => hw.apis.d3d11,
        "d3d12" => hw.apis.d3d12,
        "opengl" => hw.apis.opengl,
        _ => None,
    };
    match ok {
        Some(true) => None,
        Some(false) => Some("API graphique non disponible sur cet ordinateur".into()),
        None => Some("prise en charge de cette API graphique non vérifiée ici".into()),
    }
}

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "dolphin.gfx_backend", label: "Moteur de rendu", kind: Kind::Choice(BACKENDS), risk: Risk::High, check: Some(backend_check) },
    SettingSpec { key: "dolphin.cpu_thread", label: "Double cœur", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "dolphin.dsp_hle", label: "Émulation audio rapide (HLE)", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "dolphin.internal_resolution", label: "Résolution interne", kind: Kind::Int { min: 1, max: 8 }, risk: Risk::Low, check: None },
    SettingSpec { key: "dolphin.msaa", label: "Anticrénelage (échantillons)", kind: Kind::Choice(MSAA), risk: Risk::Low, check: None },
    SettingSpec { key: "dolphin.ssaa", label: "Suréchantillonnage (SSAA)", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "dolphin.shader_compilation", label: "Compilation des shaders", kind: Kind::Choice(SHADERS), risk: Risk::Low, check: None },
    SettingSpec { key: "dolphin.vsync", label: "Synchronisation verticale", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "dolphin.efb_access_enable", label: "Accès EFB par le processeur", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "dolphin.efb_emulate_format_changes", label: "Émuler les changements de format EFB", kind: Kind::Bool, risk: Risk::Medium, check: None },
];

/// Emplacement INI de chaque paramètre : (section, clé).
fn slot(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "dolphin.gfx_backend" => ("Core", "GFXBackend"),
        "dolphin.cpu_thread" => ("Core", "CPUThread"),
        "dolphin.dsp_hle" => ("Core", "DSPHLE"),
        "dolphin.internal_resolution" => ("Video_Settings", "InternalResolution"),
        "dolphin.msaa" => ("Video_Settings", "MSAA"),
        "dolphin.ssaa" => ("Video_Settings", "SSAA"),
        "dolphin.shader_compilation" => ("Video_Settings", "ShaderCompilationMode"),
        "dolphin.vsync" => ("Video_Hardware", "VSync"),
        "dolphin.efb_access_enable" => ("Video_Hacks", "EFBAccessEnable"),
        "dolphin.efb_emulate_format_changes" => ("Video_Hacks", "EFBEmulateFormatChanges"),
        _ => return None,
    })
}

/// Valeur typée → texte INI (seul chemin d'écriture).
fn encode(key: &str, v: &Value) -> Option<String> {
    Some(match (key, v) {
        (_, Value::Bool(b)) => if *b { "True" } else { "False" }.to_string(),
        ("dolphin.internal_resolution", Value::Int(i)) => i.to_string(),
        ("dolphin.msaa", Value::Choice(c)) if MSAA.contains(&c.as_str()) => c.clone(),
        ("dolphin.gfx_backend", Value::Choice(c)) => match c.as_str() {
            "vulkan" => "Vulkan",
            "d3d11" => "D3D",
            "d3d12" => "D3D12",
            "opengl" => "OGL",
            _ => return None,
        }
        .to_string(),
        ("dolphin.shader_compilation", Value::Choice(c)) => SHADERS.iter().position(|s| s == c)?.to_string(),
        _ => return None,
    })
}

/// Texte INI → valeur typée (lecture des réglages actuels).
fn decode(key: &str, s: &str) -> Option<Value> {
    let spec = SPECS.iter().find(|p| p.key == key)?;
    Some(match spec.kind {
        Kind::Bool => Value::Bool(match s.to_ascii_lowercase().as_str() {
            "true" | "1" => true,
            "false" | "0" => false,
            _ => return None,
        }),
        Kind::Int { .. } => Value::Int(s.parse().ok()?),
        Kind::Choice(_) => Value::Choice(match key {
            "dolphin.gfx_backend" => match s {
                "Vulkan" => "vulkan",
                "D3D" => "d3d11",
                "D3D12" => "d3d12",
                "OGL" => "opengl",
                _ => return None,
            }
            .into(),
            "dolphin.shader_compilation" => SHADERS.get(s.parse::<usize>().ok()?)?.to_string(),
            "dolphin.msaa" => MSAA.iter().find(|m| **m == s)?.to_string(),
            _ => return None,
        }),
    })
}

/// Identifiant de disque GameCube/Wii (6 caractères) ou WiiWare (4).
pub fn valid_game_id(id: &str) -> bool {
    matches!(id.len(), 4 | 6) && id.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

impl Dolphin {
    fn registry_user_dir(exe_dir: &Path) -> Option<PathBuf> {
        #[cfg(windows)]
        {
            let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER).open_subkey(r"Software\Dolphin Emulator").ok()?;
            let local = key.get_value::<u32, _>("LocalUserConfig").map(|v| v != 0).or_else(|_| key.get_value::<String, _>("LocalUserConfig").map(|s| s.trim() == "1")).unwrap_or(false);
            if local {
                return Some(exe_dir.join("User"));
            }
            key.get_value::<String, _>("UserConfigPath").ok().filter(|s| !s.trim().is_empty()).map(PathBuf::from)
        }
        #[cfg(not(windows))]
        {
            let _ = exe_dir;
            None
        }
    }
}

/// `Sys/GameSettings` livré avec Dolphin (correctifs par jeu) : à côté du programme, ou
/// sous Linux dans `share/dolphin-emu/Sys` (CMakeLists.txt, `datadir`), Flatpak compris.
fn sys_game_settings(install: &Install) -> Option<PathBuf> {
    let exe_dir = install.exe.parent()?;
    if cfg!(windows) {
        return Some(exe_dir.join("Sys").join("GameSettings"));
    }
    let mut dirs = vec![exe_dir.join("Sys")];
    if let (Some(id), Some(u)) = (platform::flatpak_id(&install.exe), UnixDirs::from_env(|k| std::env::var(k).ok())) {
        dirs.extend(u.flatpak_files(&id).into_iter().map(|f| f.join("share/dolphin-emu/Sys")));
    }
    dirs.extend([PathBuf::from("/usr/share/dolphin-emu/Sys"), PathBuf::from("/usr/local/share/dolphin-emu/Sys")]);
    dirs.into_iter().find(|d| d.is_dir()).map(|d| d.join("GameSettings"))
}

impl Adapter for Dolphin {
    fn id(&self) -> &'static str {
        "dolphin"
    }
    fn name(&self) -> &'static str {
        "Dolphin"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["gamecube", "wii"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de Dolphin invalide")?;
        let version = install.version.clone();
        if exe_dir.join("portable.txt").is_file() {
            return Ok(Location { config_root: exe_dir.join("User"), portable: true, version });
        }
        let found = Self::registry_user_dir(exe_dir).or_else(|| {
            let docs = crate::emulators::requirements::documents().join("Dolphin Emulator");
            if docs.is_dir() {
                return Some(docs);
            }
            std::env::var("APPDATA").ok().map(|a| PathBuf::from(a).join("Dolphin Emulator"))
        });
        match found {
            Some(root) if root.is_dir() => Ok(Location { portable: root.starts_with(exe_dir), config_root: root, version }),
            _ => Err("dossier de configuration de Dolphin introuvable : lancez Dolphin une fois, puis réessayez".into()),
        }
    }

    fn game_key(&self, game: &GameQuery, _ctx: &KeyContext) -> Result<String, String> {
        if !self.platforms().contains(&game.platform.as_str()) {
            return Err("console non gérée par Dolphin".into());
        }
        let id = game.serial.as_deref().unwrap_or_default().trim().to_ascii_uppercase();
        if valid_game_id(&id) {
            Ok(id)
        } else {
            Err("identifiant de disque absent ou invalide".into())
        }
    }

    /// Source/Core/UICommon/UICommon.cpp (`SetUserDirectory`) : `portable.txt` à côté du
    /// programme (dossier `User`), `$DOLPHIN_EMU_USERPATH`, `~/.dolphin-emu` s'il existe (hors
    /// Flatpak), sinon `$XDG_DATA_HOME/dolphin-emu` (où se trouve `GameSettings`).
    fn locate_unix(&self, install: &Install, dirs: &UnixDirs) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de Dolphin invalide")?;
        let version = install.version.clone();
        let flatpak = platform::flatpak_id(&install.exe).is_some();
        if !flatpak && exe_dir.join("portable.txt").is_file() {
            return Ok(Location { config_root: exe_dir.join("User"), portable: true, version });
        }
        if !flatpak && std::env::var_os("DOLPHIN_EMU_USERPATH").is_some() {
            return Err("dossier de Dolphin personnalisé (DOLPHIN_EMU_USERPATH) non pris en charge".into());
        }
        let d = dirs.for_exe(&install.exe);
        let legacy = d.home.join(".dolphin-emu");
        let root = if !flatpak && legacy.is_dir() { legacy } else { d.data_home.join("dolphin-emu") };
        if !root.is_dir() {
            return Err("dossier de configuration de Dolphin introuvable : lancez Dolphin une fois, puis réessayez".into());
        }
        Ok(Location { config_root: root, portable: false, version })
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = loc.config_root.join("GameSettings");
        let file = dir.join(format!("{key}.ini"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        let Some(bytes) = current else { return Ok(Vec::new()) };
        let ini = Ini::parse(bytes)?;
        Ok(SPECS
            .iter()
            .filter_map(|s| {
                let (sec, k) = slot(s.key)?;
                let v = decode(s.key, &ini.get(sec, k)?)?;
                Some(Setting { key: s.key.into(), value: v })
            })
            .collect())
    }

    fn builtin_overrides(&self, install: &Install, key: &str) -> Vec<String> {
        let Some(sys) = sys_game_settings(install) else {
            // Linux : base des correctifs introuvable, tous les paramètres qu'elle peut fixer sont préservés
            return if cfg!(windows) { Vec::new() } else { SPECS.iter().filter(|s| slot(s.key).is_some()).map(|s| s.key.to_string()).collect() };
        };
        let mut names = vec![format!("{key}.ini")];
        if key.len() >= 3 {
            names.insert(0, format!("{}.ini", &key[..3]));
        }
        let inis: Vec<Ini> = names.iter().filter_map(|n| std::fs::read(sys.join(n)).ok()).filter_map(|b| Ini::parse(&b).ok()).collect();
        SPECS
            .iter()
            .filter(|s| slot(s.key).is_some_and(|(sec, k)| inis.iter().any(|i| i.get(sec, k).is_some())))
            .map(|s| s.key.to_string())
            .collect()
    }

    /// Déduit de la résolution interne et de l'anticrénelage, seuls réglages
    /// qui distinguent nettement vitesse et qualité.
    fn mode_of(&self, settings: &[Setting]) -> Option<crate::smartconfig::model::Mode> {
        use crate::smartconfig::model::Mode;
        let get = |k: &str| settings.iter().find(|s| s.key == k).map(|s| &s.value);
        let Some(Value::Int(res)) = get("dolphin.internal_resolution") else { return None };
        let msaa = match get("dolphin.msaa") {
            Some(Value::Choice(c)) => c.parse::<i64>().unwrap_or(1),
            _ => 1,
        };
        let ssaa = matches!(get("dolphin.ssaa"), Some(Value::Bool(true)));
        Some(if *res >= 3 || msaa >= 4 || ssaa {
            Mode::Quality
        } else if *res <= 1 && msaa <= 1 {
            Mode::Performance
        } else {
            Mode::Balanced
        })
    }

    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        let mut ini = match current {
            Some(b) => Ini::parse(b)?,
            None => Ini::empty(),
        };
        let mut changes = Vec::new();
        for s in settings {
            let (sec, k) = slot(&s.key).ok_or("paramètre non pris en charge")?;
            let value = encode(&s.key, &s.value).ok_or("valeur non transposable")?;
            let before = ini.get(sec, k);
            if before.as_deref() == Some(value.as_str()) {
                continue;
            }
            ini.set(sec, k, &value);
            let label = SPECS.iter().find(|p| p.key == s.key).map(|p| p.label).unwrap_or_default();
            changes.push(Change { key: s.key.clone(), label: label.into(), before, after: value });
        }
        Ok((ini.to_bytes(), changes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::{plan, verify};
    use crate::smartconfig::hardware::GraphicsApis;

    fn setting(k: &str, v: Value) -> Setting {
        Setting { key: k.into(), value: v }
    }

    fn portable() -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Dolphin-x64");
        std::fs::create_dir_all(dir.join("User")).unwrap();
        std::fs::create_dir_all(dir.join("Sys").join("GameSettings")).unwrap();
        std::fs::write(dir.join("portable.txt"), b"").unwrap();
        std::fs::write(dir.join("Dolphin.exe"), b"MZ").unwrap();
        // correctif livré avec Dolphin pour ce jeu
        std::fs::write(dir.join("Sys").join("GameSettings").join("GMS.ini"), b"[Video_Hacks]\nEFBAccessEnable = True\n").unwrap();
        (tmp, Install { profile_id: "dolphin".into(), exe: dir.join("Dolphin.exe"), version: Some("2509".into()), core: None })
    }

    fn game(serial: &str) -> GameQuery {
        GameQuery { game_id: 1, platform: "gamecube".into(), title: "Super Mario Sunshine".into(), serial: Some(serial.into()), region: Some("NTSC-U".into()), id_confidence: 1.0 }
    }

    fn key(inst: &Install, g: &GameQuery) -> Option<String> {
        Dolphin.game_key(g, &KeyContext { install: inst, location: None, main_file: None }).ok()
    }

    #[test]
    fn installation_portable_et_identifiant() {
        let (_t, inst) = portable();
        let loc = Dolphin.locate(&inst).unwrap();
        assert!(loc.portable);
        assert!(loc.config_root.ends_with("User"));
        assert_eq!(key(&inst, &game("gmse01")), Some("GMSE01".into()));
        assert_eq!(key(&inst, &game("../../x")), None);
        assert_eq!(key(&inst, &GameQuery { platform: "ps2".into(), ..game("GMSE01") }), None);
    }

    #[test]
    fn apercu_preserve_les_correctifs_et_refuse_les_api_non_verifiees() {
        let (_t, inst) = portable();
        let hw = HardwareInfo { apis: GraphicsApis { d3d11: Some(true), ..Default::default() }, ..Default::default() };
        let settings = vec![
            setting("dolphin.internal_resolution", Value::Int(3)),
            setting("dolphin.efb_access_enable", Value::Bool(false)),
            setting("dolphin.gfx_backend", Value::Choice("vulkan".into())),
            setting("dolphin.shader_compilation", Value::Choice("hybrid_ubershaders".into())),
            setting("dolphin.save_path", Value::Choice("C:\\".into())),
        ];
        let p = plan(&Dolphin, &inst, &game("GMSE01"), None, &settings, &hw).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert!(text.contains("[Video_Settings]\r\nInternalResolution = 3\r\nShaderCompilationMode = 2\r\n"));
        assert!(!text.contains("EFBAccessEnable"));
        assert!(!text.contains("GFXBackend"));
        assert_eq!(p.changes.len(), 2);
        assert_eq!(p.skipped.len(), 3);
        assert!(!p.existed);
        assert!(p.target.ends_with(Path::new("GameSettings").join("GMSE01.ini")));
    }

    #[test]
    fn lecture_et_verification() {
        let (_t, inst) = portable();
        let loc = Dolphin.locate(&inst).unwrap();
        let (_, dir, file) = Dolphin.target(&loc, "GMSE01");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&file, b"[Core]\nCPUThread = False\nGFXBackend = D3D12\n[Video_Settings]\nMSAA = 4\n").unwrap();
        let cur = Dolphin.read(std::fs::read(&file).ok().as_deref()).unwrap();
        assert!(cur.contains(&setting("dolphin.cpu_thread", Value::Bool(false))));
        assert!(cur.contains(&setting("dolphin.gfx_backend", Value::Choice("d3d12".into()))));
        assert!(cur.contains(&setting("dolphin.msaa", Value::Choice("4".into()))));
        assert!(verify(&Dolphin, &file, &[setting("dolphin.msaa", Value::Choice("4".into()))]));
        assert!(!verify(&Dolphin, &file, &[setting("dolphin.msaa", Value::Choice("8".into()))]));
    }

    #[test]
    fn aucune_valeur_inchangee_n_est_reecrite() {
        let (bytes, changes) = Dolphin.render(Some(b"[Core]\nDSPHLE = True\n"), &[setting("dolphin.dsp_hle", Value::Bool(true))]).unwrap();
        assert_eq!(bytes, b"[Core]\nDSPHLE = True\n");
        assert!(changes.is_empty());
    }
}
