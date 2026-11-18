//! Adaptateur PPSSPP (PSP).
//!
//! Vérifié dans le code source de PPSSPP (2026-11-17) :
//! - carte mémoire (`Windows/main.cpp`) : `installed.txt` à côté du
//!   programme → chemin écrit sur sa première ligne, ou `Documents\PPSSPP` si
//!   elle est vide ; sinon `<programme>\memstick` ;
//! - réglages (`Core/Util/PathUtil.cpp` `GetSysDirectory`,
//!   `GetGameConfigFilePath`) : `<memstick>/PSP/SYSTEM/<DISC_ID>_ppsspp.ini`
//!   (`PSP` est la carte mémoire elle-même si son dossier s'appelle déjà
//!   `PSP`) ; `DISC_ID` vient de `PARAM.SFO` (`Load_PSP_ISO`) ;
//! - lecture (`Config::LoadGameConfig`) : une clé absente garde la valeur
//!   globale, **mais** `KeyMap::LoadFromIni` remet les commandes par défaut
//!   si le fichier n'a pas de section `[ControlMapping]`. PPSSPP l'écrit
//!   lui-même quand l'utilisateur crée la configuration du jeu. SmartConfig
//!   ne **crée donc jamais** ce fichier : il ne modifie qu'une configuration
//!   par jeu déjà créée dans PPSSPP (sinon les manettes seraient touchées) ;
//! - clés (`Core/Config.cpp`, toutes `CfgFlag::PER_GAME`) : `[Graphics]`
//!   `InternalResolution` (0 = auto, 1–10), `SoftwareRenderer`,
//!   `MultiSampleLevel` (exposant), `VerticalSync`, `TextureFiltering`
//!   (1 auto, 2 plus proche, 3 linéaire, 4 auto qualité max), `AnisotropyLevel`
//!   (exposant), `TexScalingType`, `TexScalingLevel` (1 = désactivé),
//!   `BloomHack` ; `[CPU]` `FastMemoryAccess`. `GraphicsBackend` n'est pas un
//!   réglage par jeu : jamais écrit.
//! - pas de correctifs intégrés sur ces clés (`compat.ini` agit à part).

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use crate::smartconfig::platform::UnixDirs;
use std::path::{Path, PathBuf};

pub struct Ppsspp;

pub const MSAA: &[&str] = &["1", "2", "4", "8", "16"];
pub const ANISO: &[&str] = &["0", "2", "4", "8", "16"];
pub const FILTERS: &[&str] = &["auto", "nearest", "linear", "auto_max_quality"];
pub const SCALERS: &[&str] = &["xbrz", "hybrid", "bicubic", "hybrid_bicubic"];
pub const BLOOM: &[&str] = &["off", "safe", "balanced", "aggressive"];

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "ppsspp.internal_resolution", label: "Résolution de rendu (0 = auto)", kind: Kind::Int { min: 0, max: 10 }, risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.software_rendering", label: "Rendu logiciel", kind: Kind::Bool, risk: Risk::High, check: None },
    SettingSpec { key: "ppsspp.msaa", label: "Anticrénelage (échantillons)", kind: Kind::Choice(MSAA), risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.vsync", label: "Synchronisation verticale", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.texture_filtering", label: "Filtrage des textures", kind: Kind::Choice(FILTERS), risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.anisotropic_filtering", label: "Filtrage anisotrope", kind: Kind::Choice(ANISO), risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.texture_scaling_type", label: "Agrandissement des textures (méthode)", kind: Kind::Choice(SCALERS), risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.texture_scaling_level", label: "Agrandissement des textures (1 = désactivé)", kind: Kind::Int { min: 1, max: 5 }, risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.lower_resolution_effects", label: "Effets en résolution réduite", kind: Kind::Choice(BLOOM), risk: Risk::Low, check: None },
    SettingSpec { key: "ppsspp.fast_memory", label: "Accès mémoire rapide", kind: Kind::Bool, risk: Risk::Medium, check: None },
];

fn slot(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "ppsspp.internal_resolution" => ("Graphics", "InternalResolution"),
        "ppsspp.software_rendering" => ("Graphics", "SoftwareRenderer"),
        "ppsspp.msaa" => ("Graphics", "MultiSampleLevel"),
        "ppsspp.vsync" => ("Graphics", "VerticalSync"),
        "ppsspp.texture_filtering" => ("Graphics", "TextureFiltering"),
        "ppsspp.anisotropic_filtering" => ("Graphics", "AnisotropyLevel"),
        "ppsspp.texture_scaling_type" => ("Graphics", "TexScalingType"),
        "ppsspp.texture_scaling_level" => ("Graphics", "TexScalingLevel"),
        "ppsspp.lower_resolution_effects" => ("Graphics", "BloomHack"),
        "ppsspp.fast_memory" => ("CPU", "FastMemoryAccess"),
        _ => return None,
    })
}

/// Choix → entier écrit par PPSSPP (exposant, index ou valeur décalée).
fn choice_index(key: &str, c: &str) -> Option<usize> {
    match key {
        "ppsspp.msaa" => MSAA.iter().position(|m| *m == c),
        "ppsspp.anisotropic_filtering" => ANISO.iter().position(|m| *m == c),
        "ppsspp.texture_filtering" => FILTERS.iter().position(|m| *m == c).map(|i| i + 1),
        "ppsspp.texture_scaling_type" => SCALERS.iter().position(|m| *m == c),
        "ppsspp.lower_resolution_effects" => BLOOM.iter().position(|m| *m == c),
        _ => None,
    }
}

fn choice_of(key: &str, i: usize) -> Option<&'static str> {
    match key {
        "ppsspp.msaa" => MSAA.get(i).copied(),
        "ppsspp.anisotropic_filtering" => ANISO.get(i).copied(),
        "ppsspp.texture_filtering" => FILTERS.get(i.checked_sub(1)?).copied(),
        "ppsspp.texture_scaling_type" => SCALERS.get(i).copied(),
        "ppsspp.lower_resolution_effects" => BLOOM.get(i).copied(),
        _ => None,
    }
}

fn writes(s: &Setting) -> Option<Vec<Write>> {
    let (sec, key) = slot(&s.key)?;
    let v = match &s.value {
        Value::Bool(b) => if *b { "True" } else { "False" }.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Choice(c) => choice_index(&s.key, c)?.to_string(),
    };
    Some(vec![(sec, key, v)])
}

/// Identifiant PSP « AAAANNNNN » (accepte « AAAA-NNNNN » venu d'un nom de fichier).
pub fn disc_id(serial: &str) -> Option<String> {
    let id: String = serial.trim().to_ascii_uppercase().replacen('-', "", 1);
    let b = id.as_bytes();
    (b.len() == 9 && b[..4].iter().all(u8::is_ascii_uppercase) && b[4..].iter().all(u8::is_ascii_digit)).then_some(id)
}

/// Carte mémoire de PPSSPP (Windows).
fn memstick(exe_dir: &Path) -> Result<(PathBuf, bool), String> {
    let installed = exe_dir.join("installed.txt");
    if installed.is_file() {
        let raw = std::fs::read(&installed).map_err(|_| "installed.txt de PPSSPP illisible")?;
        let raw = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&raw);
        let first = String::from_utf8_lossy(raw).lines().next().unwrap_or_default().trim().to_string();
        if first.is_empty() {
            return Ok((crate::emulators::requirements::documents().join("PPSSPP"), false));
        }
        let p = PathBuf::from(first);
        if !p.is_absolute() {
            return Err("emplacement de la carte mémoire de PPSSPP non pris en charge".into());
        }
        return Ok((p, false));
    }
    Ok((exe_dir.join("memstick"), true))
}

fn system_dir(memstick: &Path) -> PathBuf {
    let is_psp = memstick.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("PSP"));
    if is_psp { memstick.to_path_buf() } else { memstick.join("PSP") }.join("SYSTEM")
}

impl Adapter for Ppsspp {
    fn id(&self) -> &'static str {
        "ppsspp"
    }
    fn name(&self) -> &'static str {
        "PPSSPP"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["psp"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de PPSSPP invalide")?;
        let (root, portable) = memstick(exe_dir)?;
        if !system_dir(&root).is_dir() {
            return Err("dossier de configuration de PPSSPP introuvable : lancez PPSSPP une fois, puis réessayez".into());
        }
        Ok(Location { config_root: root, portable, version: install.version.clone() })
    }

    fn game_key(&self, game: &GameQuery, _ctx: &KeyContext) -> Result<String, String> {
        if game.platform != "psp" {
            return Err("console non gérée par PPSSPP".into());
        }
        disc_id(game.serial.as_deref().unwrap_or_default()).ok_or_else(|| "identifiant PSP (DISC_ID) absent ou dans un format inattendu".into())
    }

    /// Core/Util/PathUtil.cpp (`GetDefaultDesktopMemStickDirectory`) : carte mémoire dans
    /// `$XDG_CONFIG_HOME/ppsspp` ou `~/.config/ppsspp`.
    fn locate_unix(&self, install: &Install, dirs: &UnixDirs) -> Result<Location, String> {
        let root = dirs.for_exe(&install.exe).config_home.join("ppsspp");
        if !system_dir(&root).is_dir() {
            return Err("dossier de configuration de PPSSPP introuvable : lancez PPSSPP une fois, puis réessayez".into());
        }
        Ok(Location { config_root: root, portable: false, version: install.version.clone() })
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = system_dir(&loc.config_root);
        let file = dir.join(format!("{key}_ppsspp.ini"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        common::read(current, SPECS, |k, ini| {
            let (sec, key) = slot(k)?;
            let s = ini.get(sec, key)?;
            match SPECS.iter().find(|p| p.key == k)?.kind {
                Kind::Bool => common::parse_bool(&s).map(Value::Bool),
                Kind::Int { .. } => s.parse().ok().map(Value::Int),
                Kind::Choice(_) => choice_of(k, s.parse().ok()?).map(|c| Value::Choice(c.into())),
            }
        })
    }

    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        Vec::new()
    }

    fn mode_of(&self, settings: &[Setting]) -> Option<Mode> {
        let res = settings.iter().find(|s| s.key == "ppsspp.internal_resolution").and_then(|s| if let Value::Int(i) = s.value { Some(i) } else { None })?;
        Some(match res {
            0 => return None, // « auto » : dépend de la fenêtre
            i if i >= 4 => Mode::Quality,
            1 | 2 => Mode::Performance,
            _ => Mode::Balanced,
        })
    }

    /// Ne modifie qu'un fichier créé par PPSSPP (voir l'en-tête du module).
    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        if current.is_none() {
            return Err("Créez d'abord la configuration propre à ce jeu dans PPSSPP (menu du jeu › Créer une configuration de jeu), puis réessayez : sans elle, PPSSPP réinitialiserait vos commandes.".into());
        }
        common::render(current, settings, SPECS, writes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::{plan, verify};
    use crate::smartconfig::hardware::HardwareInfo;

    fn setting(k: &str, v: Value) -> Setting {
        Setting { key: k.into(), value: v }
    }

    fn portable() -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("PPSSPP");
        std::fs::create_dir_all(dir.join("memstick").join("PSP").join("SYSTEM")).unwrap();
        std::fs::write(dir.join("PPSSPPWindows64.exe"), b"MZ").unwrap();
        (tmp, Install { profile_id: "ppsspp".into(), exe: dir.join("PPSSPPWindows64.exe"), version: Some("1.19".into()), core: None })
    }

    fn game(serial: &str) -> GameQuery {
        GameQuery { game_id: 1, platform: "psp".into(), title: "Jeu".into(), serial: Some(serial.into()), region: None, id_confidence: 1.0 }
    }

    const EXISTING: &str = "# Game config for ULUS10041 - Jeu\n[CPU]\nFastMemoryAccess = True\n[Graphics]\nInternalResolution = 2\nTextureFiltering = 1\n[ControlMapping]\nCross = 1-52\n";

    #[test]
    #[cfg_attr(not(windows), ignore = "disposition portable propre à Windows ; Linux : smartconfig::platform::tests")]
    fn emplacement_et_identifiant() {
        let (_t, inst) = portable();
        let loc = Ppsspp.locate(&inst).unwrap();
        assert!(loc.portable);
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: None };
        assert_eq!(Ppsspp.game_key(&game("ULUS10041"), &ctx), Ok("ULUS10041".into()));
        assert_eq!(Ppsspp.game_key(&game("ulus-10041"), &ctx), Ok("ULUS10041".into()));
        for bad in ["../x", "ULUS1004", "ULUS10041_ppsspp", "ULUS 10041", "ULUS-1004-1"] {
            assert!(Ppsspp.game_key(&game(bad), &ctx).is_err(), "{bad}");
        }
        let (_, _, file) = Ppsspp.target(&loc, "ULUS10041");
        assert!(file.ends_with(Path::new("memstick").join("PSP").join("SYSTEM").join("ULUS10041_ppsspp.ini")));
        assert_eq!(system_dir(Path::new("D:\\PSP")), PathBuf::from("D:\\PSP").join("SYSTEM"));
    }

    #[test]
    #[cfg_attr(not(windows), ignore = "disposition portable propre à Windows ; Linux : smartconfig::platform::tests")]
    fn jamais_de_creation_ni_de_manette_touchee() {
        let (_t, inst) = portable();
        let s = [setting("ppsspp.internal_resolution", Value::Int(3))];
        let err = plan(&Ppsspp, &inst, &game("ULUS10041"), None, &s, &HardwareInfo::default()).unwrap_err();
        assert!(err.contains("Créez d'abord"));
        let loc = Ppsspp.locate(&inst).unwrap();
        let (_, _, file) = Ppsspp.target(&loc, "ULUS10041");
        std::fs::write(&file, EXISTING).unwrap();
        let settings = vec![
            setting("ppsspp.internal_resolution", Value::Int(3)),
            setting("ppsspp.texture_filtering", Value::Choice("linear".into())),
            setting("ppsspp.msaa", Value::Choice("3".into())),
            setting("ppsspp.fast_memory", Value::Bool(true)),
            setting("ppsspp.graphics_backend", Value::Choice("vulkan".into())),
        ];
        let p = plan(&Ppsspp, &inst, &game("ULUS10041"), None, &settings, &HardwareInfo::default()).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert_eq!(text, EXISTING.replace("InternalResolution = 2\nTextureFiltering = 1", "InternalResolution = 3\nTextureFiltering = 3"));
        assert_eq!(p.changes.len(), 2);
        assert_eq!(p.skipped.len(), 2);
        std::fs::write(&file, &p.after).unwrap();
        assert!(verify(&Ppsspp, &file, &settings[..2]));
        let cur = Ppsspp.read(Some(&p.after)).unwrap();
        assert!(cur.contains(&setting("ppsspp.fast_memory", Value::Bool(true))));
        assert_eq!(Ppsspp.mode_of(&cur), Some(Mode::Balanced));
    }
}
