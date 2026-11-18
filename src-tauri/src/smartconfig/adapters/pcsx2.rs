//! Adaptateur PCSX2 (PlayStation 2), version Qt actuelle (`pcsx2-qt`).
//!
//! Vérifié dans le code source de PCSX2 (2026-11-17) :
//! - dossier de données (`Pcsx2Config.cpp`, `EmuFolders::SetDataDirectory`) :
//!   `portable.ini` ou `portable.txt` à côté du programme → dossier du
//!   programme (ou sous-dossier relatif écrit dans `portable.txt`) ; sinon
//!   `Documents\PCSX2` ;
//! - dossier des réglages par jeu : `[Folders] GameSettings` de
//!   `inis/PCSX2.ini`, `gamesettings` par défaut (un dossier personnalisé est
//!   refusé plutôt que deviné) ;
//! - fichier (`VMManager::GetGameSettingsPath`, `UpdateGameSettingsLayer`) :
//!   `<SERIAL>_<CRC>.ini`, ou l'ancien `<CRC>.ini` s'il est le seul présent ;
//!   le CRC est celui de l'ELF de démarrage (voir `smartconfig::disc`) ;
//! - clés (`Pcsx2Config.cpp`) : `[EmuCore/GS]` `Renderer`, `upscale_multiplier`,
//!   `AspectRatio`, `filter`, `MaxAnisotropy`, `fxaa`, `pcrtc_antiblur`,
//!   `deinterlace_mode` ; `[EmuCore/Speedhacks]` `EECycleRate` (−3…3),
//!   `EECycleSkip` (0…3) ;
//! - correctifs intégrés (`GameDatabase.cpp`, `resources/GameIndex.yaml`) :
//!   `speedHacks: eeCycleRate` remplace le réglage de l'utilisateur et
//!   `gsHWFixes: deinterlace` s'applique en mode automatique : SmartConfig ne
//!   touche jamais ces deux réglages pour un jeu qui en a.

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::disc;
use crate::smartconfig::ini::Ini;
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use crate::smartconfig::platform::{self, UnixDirs};
use std::path::{Path, PathBuf};

pub struct Pcsx2;

pub const RENDERERS: &[&str] = &["vulkan", "d3d11", "d3d12", "opengl", "software"];
pub const ASPECT: &[&str] = &["stretch", "auto", "4_3", "16_9"];
pub const FILTERS: &[&str] = &["nearest", "bilinear_forced", "bilinear_ps2", "bilinear_forced_except_sprite"];
pub const ANISO: &[&str] = &["0", "2", "4", "8", "16"];
pub const DEINTERLACE: &[&str] = &["automatic", "off", "weave_tff", "weave_bff", "bob_tff", "bob_bff", "blend_tff", "blend_bff", "adaptive_tff", "adaptive_bff"];

const GS: &str = "EmuCore/GS";
const HACKS: &str = "EmuCore/Speedhacks";

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "pcsx2.renderer", label: "Moteur de rendu", kind: Kind::Choice(RENDERERS), risk: Risk::High, check: Some(common::api_check) },
    SettingSpec { key: "pcsx2.upscale_multiplier", label: "Résolution interne", kind: Kind::Int { min: 1, max: 8 }, risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.aspect_ratio", label: "Format d'image", kind: Kind::Choice(ASPECT), risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.texture_filtering", label: "Filtrage des textures", kind: Kind::Choice(FILTERS), risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.anisotropic_filtering", label: "Filtrage anisotrope", kind: Kind::Choice(ANISO), risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.fxaa", label: "Anticrénelage FXAA", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.pcrtc_antiblur", label: "Anti-flou", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.deinterlacing", label: "Désentrelacement", kind: Kind::Choice(DEINTERLACE), risk: Risk::Low, check: None },
    SettingSpec { key: "pcsx2.ee_cyclerate", label: "Fréquence du processeur EE", kind: Kind::Int { min: -3, max: 3 }, risk: Risk::Medium, check: None },
    SettingSpec { key: "pcsx2.ee_cycleskip", label: "Saut de cycles EE", kind: Kind::Int { min: 0, max: 3 }, risk: Risk::Medium, check: None },
];

fn slot(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "pcsx2.renderer" => (GS, "Renderer"),
        "pcsx2.upscale_multiplier" => (GS, "upscale_multiplier"),
        "pcsx2.aspect_ratio" => (GS, "AspectRatio"),
        "pcsx2.texture_filtering" => (GS, "filter"),
        "pcsx2.anisotropic_filtering" => (GS, "MaxAnisotropy"),
        "pcsx2.fxaa" => (GS, "fxaa"),
        "pcsx2.pcrtc_antiblur" => (GS, "pcrtc_antiblur"),
        "pcsx2.deinterlacing" => (GS, "deinterlace_mode"),
        "pcsx2.ee_cyclerate" => (HACKS, "EECycleRate"),
        "pcsx2.ee_cycleskip" => (HACKS, "EECycleSkip"),
        _ => return None,
    })
}

/// `GSRendererType` (Config.h).
const RENDERER_IDS: &[(&str, &str)] = &[("vulkan", "14"), ("d3d11", "3"), ("d3d12", "15"), ("opengl", "12"), ("software", "13")];
/// `AspectRatioNames` (Pcsx2Config.cpp).
const ASPECT_NAMES: &[(&str, &str)] = &[("stretch", "Stretch"), ("auto", "Auto 4:3/3:2"), ("4_3", "4:3"), ("16_9", "16:9")];

fn encode(key: &str, v: &Value) -> Option<String> {
    let pick = |table: &[(&str, &str)], c: &str| table.iter().find(|(a, _)| *a == c).map(|(_, b)| b.to_string());
    Some(match (key, v) {
        (_, Value::Bool(b)) => if *b { "true" } else { "false" }.to_string(),
        ("pcsx2.upscale_multiplier" | "pcsx2.ee_cyclerate" | "pcsx2.ee_cycleskip", Value::Int(i)) => i.to_string(),
        ("pcsx2.renderer", Value::Choice(c)) => pick(RENDERER_IDS, c)?,
        ("pcsx2.aspect_ratio", Value::Choice(c)) => pick(ASPECT_NAMES, c)?,
        ("pcsx2.texture_filtering", Value::Choice(c)) => FILTERS.iter().position(|f| f == c)?.to_string(),
        ("pcsx2.deinterlacing", Value::Choice(c)) => DEINTERLACE.iter().position(|f| f == c)?.to_string(),
        ("pcsx2.anisotropic_filtering", Value::Choice(c)) if ANISO.contains(&c.as_str()) => c.clone(),
        _ => return None,
    })
}

fn decode(key: &str, s: &str) -> Option<Value> {
    let back = |table: &[(&str, &str)]| table.iter().find(|(_, b)| *b == s).map(|(a, _)| Value::Choice(a.to_string()));
    match key {
        "pcsx2.fxaa" | "pcsx2.pcrtc_antiblur" => common::parse_bool(s).map(Value::Bool),
        "pcsx2.upscale_multiplier" => {
            let f: f64 = s.parse().ok()?;
            (f.fract() == 0.0).then_some(Value::Int(f as i64))
        }
        "pcsx2.ee_cyclerate" | "pcsx2.ee_cycleskip" => s.parse().ok().map(Value::Int),
        "pcsx2.renderer" => back(RENDERER_IDS),
        "pcsx2.aspect_ratio" => back(ASPECT_NAMES),
        "pcsx2.texture_filtering" => FILTERS.get(s.parse::<usize>().ok()?).map(|c| Value::Choice(c.to_string())),
        "pcsx2.deinterlacing" => DEINTERLACE.get(s.parse::<usize>().ok()?).map(|c| Value::Choice(c.to_string())),
        "pcsx2.anisotropic_filtering" => ANISO.iter().find(|a| **a == s).map(|a| Value::Choice(a.to_string())),
        _ => None,
    }
}

/// Dossier de données de PCSX2.
/// Dossier de PCSX2 vérifié (même règle sous Windows et Linux).
fn checked(root: PathBuf, portable: bool, install: &Install) -> Result<Location, String> {
    if !root.join("inis").is_dir() {
        return Err("dossier de configuration de PCSX2 introuvable : lancez PCSX2 une fois, puis réessayez".into());
    }
    if let Ok(bytes) = std::fs::read(root.join("inis").join("PCSX2.ini")) {
        if let Some(dir) = Ini::parse(&bytes).ok().and_then(|i| i.get("Folders", "GameSettings")) {
            if !dir.eq_ignore_ascii_case("gamesettings") {
                return Err("dossier des réglages par jeu personnalisé dans PCSX2 : non pris en charge".into());
            }
        }
    }
    Ok(Location { config_root: root, portable, version: install.version.clone() })
}

fn data_root(exe_dir: &Path) -> Result<(PathBuf, bool), String> {
    if exe_dir.join("portable.ini").is_file() || exe_dir.join("portable.txt").is_file() {
        let sub = std::fs::read_to_string(exe_dir.join("portable.txt")).unwrap_or_default();
        let sub = sub.trim();
        if sub.is_empty() {
            return Ok((exe_dir.to_path_buf(), true));
        }
        let rel = Path::new(sub);
        if rel.is_absolute() || rel.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
            return Err("dossier portable personnalisé de PCSX2 non pris en charge".into());
        }
        return Ok((exe_dir.join(rel), true));
    }
    Ok((crate::emulators::requirements::documents().join("PCSX2"), false))
}

/// Correctifs de `GameIndex.yaml` qui fixent nos réglages pour ce numéro de série.
fn builtin_for(gameindex: &str, serial: &str) -> Vec<String> {
    let Some(entry) = common::yaml_entry(gameindex, serial) else { return Vec::new() };
    let mut out = Vec::new();
    if common::yaml_section(&entry, "speedHacks").iter().any(|l| l.starts_with("eeCycleRate:")) {
        out.push("pcsx2.ee_cyclerate".to_string());
    }
    if common::yaml_section(&entry, "gsHWFixes").iter().any(|l| l.starts_with("deinterlace:")) {
        out.push("pcsx2.deinterlacing".to_string());
    }
    out
}

fn is_crc(s: &str) -> bool {
    s.len() == 8 && s.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b))
}

impl Adapter for Pcsx2 {
    fn id(&self) -> &'static str {
        "pcsx2"
    }
    fn name(&self) -> &'static str {
        "PCSX2"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["ps2"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de PCSX2 invalide")?;
        let (root, portable) = data_root(exe_dir)?;
        checked(root, portable, install)
    }

    /// `<SERIAL>_<CRC>` (ou `<CRC>`) calculé depuis l'image ; sinon, le seul
    /// fichier `gamesettings/<SERIAL>_*.ini` déjà présent pour ce numéro de série.
    fn game_key(&self, game: &GameQuery, ctx: &KeyContext) -> Result<String, String> {
        if game.platform != "ps2" {
            return Err("console non gérée par PCSX2".into());
        }
        let dir = ctx.location.map(|l| l.config_root.join("gamesettings"));
        let from_disc = match ctx.main_file {
            Some(f) => disc::ps2_boot(f),
            None => Err("fichier du jeu absent".into()),
        };
        match from_disc {
            Ok(b) if b.crc == 0 => Err("CRC nul : PCSX2 n'applique pas de réglages par jeu".into()),
            Ok(b) => {
                let crc = format!("{:08X}", b.crc);
                if b.serial.is_empty() {
                    return Ok(crc);
                }
                if !common::valid_sony_serial(&b.serial) {
                    return Err("numéro de série du disque inattendu".into());
                }
                let full = format!("{}_{crc}", b.serial);
                // ancien nom `<CRC>.ini` : lu par PCSX2 seulement si le nouveau manque
                let legacy = dir.as_ref().is_some_and(|d| !d.join(format!("{full}.ini")).is_file() && d.join(format!("{crc}.ini")).is_file());
                Ok(if legacy { crc } else { full })
            }
            Err(why) => {
                let serial = game.serial.as_deref().unwrap_or_default().trim().to_ascii_uppercase();
                if !common::valid_sony_serial(&serial) {
                    return Err(format!("{why} ; numéro de série inconnu"));
                }
                let prefix = format!("{serial}_");
                let found: Vec<String> = dir
                    .and_then(|d| std::fs::read_dir(d).ok())
                    .into_iter()
                    .flatten()
                    .flatten()
                    .filter_map(|e| e.file_name().to_str().map(str::to_string))
                    .filter_map(|n| n.strip_suffix(".ini").map(str::to_string))
                    .filter(|n| n.strip_prefix(&prefix).is_some_and(is_crc))
                    .collect();
                match found.as_slice() {
                    [one] => Ok(one.clone()),
                    [] => Err(format!("{why} ; aucun réglage PCSX2 existant pour {serial} (lancez le jeu une fois dans PCSX2 et créez ses réglages par jeu)")),
                    _ => Err(format!("{why} ; plusieurs réglages PCSX2 pour {serial}, lequel est le bon est indéterminable")),
                }
            }
        }
    }

    /// pcsx2/Pcsx2Config.cpp (`EmuFolders::SetDataDirectory`) : `portable.ini`/`portable.txt` à côté
    /// du programme, sinon `$XDG_CONFIG_HOME/PCSX2` ou `~/.config/PCSX2`. Une AppImage tourne depuis
    /// une image montée : elle n'est jamais portable par ces fichiers.
    fn locate_unix(&self, install: &Install, dirs: &UnixDirs) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de PCSX2 invalide")?;
        let native = !platform::is_appimage(&install.exe) && platform::flatpak_id(&install.exe).is_none();
        let (root, portable) = if native && (exe_dir.join("portable.ini").is_file() || exe_dir.join("portable.txt").is_file()) {
            data_root(exe_dir)?
        } else {
            (dirs.for_exe(&install.exe).config_home.join("PCSX2"), false)
        };
        checked(root, portable, install)
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = loc.config_root.join("gamesettings");
        let file = dir.join(format!("{key}.ini"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        common::read(current, SPECS, |k, ini| {
            let (sec, key) = slot(k)?;
            decode(k, &ini.get(sec, key)?)
        })
    }

    fn builtin_overrides(&self, install: &Install, key: &str) -> Vec<String> {
        let Some(serial) = key.split_once('_').map(|(s, _)| s) else { return Vec::new() };
        let Some(db) = install.exe.parent().and_then(|d| common::read_db(&d.join("resources").join("GameIndex.yaml"))) else {
            // Linux (AppImage, Flatpak) : GameIndex.yaml illisible, les réglages qu'il peut fixer sont préservés
            return if cfg!(windows) { Vec::new() } else { vec!["pcsx2.ee_cyclerate".into(), "pcsx2.deinterlacing".into()] };
        };
        builtin_for(&db, serial)
    }

    fn mode_of(&self, settings: &[Setting]) -> Option<Mode> {
        let up = settings.iter().find(|s| s.key == "pcsx2.upscale_multiplier").and_then(|s| if let Value::Int(i) = s.value { Some(i) } else { None })?;
        Some(match up {
            i if i >= 3 => Mode::Quality,
            1 => Mode::Performance,
            _ => Mode::Balanced,
        })
    }

    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        common::render(current, settings, SPECS, |s| {
            let (sec, key) = slot(&s.key)?;
            Some(vec![(sec, key, encode(&s.key, &s.value)?)] as Vec<Write>)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::{plan, verify};
    use crate::smartconfig::disc::tests::{elf_bytes, ps2_iso};
    use crate::smartconfig::hardware::{GraphicsApis, HardwareInfo};

    fn setting(k: &str, v: Value) -> Setting {
        Setting { key: k.into(), value: v }
    }

    /// PCSX2 portable dans un dossier temporaire, avec une image ISO du jeu.
    fn portable() -> (tempfile::TempDir, Install, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("PCSX2");
        std::fs::create_dir_all(dir.join("inis")).unwrap();
        std::fs::create_dir_all(dir.join("resources")).unwrap();
        std::fs::write(dir.join("portable.ini"), b"").unwrap();
        std::fs::write(dir.join("pcsx2-qt.exe"), b"MZ").unwrap();
        std::fs::write(dir.join("inis").join("PCSX2.ini"), b"[Folders]\nGameSettings = gamesettings\n").unwrap();
        std::fs::write(dir.join("resources").join("GameIndex.yaml"), b"SLUS-20312:\n  name: \"Jeu\"\n  speedHacks:\n    eeCycleRate: 1 # correctif\n").unwrap();
        let iso = tmp.path().join("jeu.iso");
        std::fs::write(&iso, ps2_iso("BOOT2 = cdrom0:\\DATA\\SLUS_203.12;1\r\n", &elf_bytes(), false)).unwrap();
        (tmp, Install { profile_id: "pcsx2".into(), exe: dir.join("pcsx2-qt.exe"), version: Some("2.4.0".into()), core: None }, iso)
    }

    fn game(serial: Option<&str>) -> GameQuery {
        GameQuery { game_id: 1, platform: "ps2".into(), title: "Jeu".into(), serial: serial.map(Into::into), region: None, id_confidence: 1.0 }
    }

    fn crc() -> String {
        format!("{:08X}", disc::elf_crc(&elf_bytes()))
    }

    #[test]
    fn identifiant_calcule_depuis_l_image_puis_repli() {
        let (_t, inst, iso) = portable();
        let loc = Pcsx2.locate(&inst).unwrap();
        assert!(loc.portable);
        fn ctx<'a>(inst: &'a Install, loc: &'a Location, f: Option<&'a Path>) -> KeyContext<'a> {
            KeyContext { install: inst, location: Some(loc), main_file: f }
        }
        let ctx = |f| ctx(&inst, &loc, f);
        assert_eq!(Pcsx2.game_key(&game(None), &ctx(Some(&iso))), Ok(format!("SLUS-20312_{}", crc())));
        // ancien nom seul présent : c'est lui que PCSX2 lit
        let gs = loc.config_root.join("gamesettings");
        std::fs::create_dir_all(&gs).unwrap();
        std::fs::write(gs.join(format!("{}.ini", crc())), b"").unwrap();
        assert_eq!(Pcsx2.game_key(&game(None), &ctx(Some(&iso))), Ok(crc()));
        std::fs::remove_file(gs.join(format!("{}.ini", crc()))).unwrap();
        // CHD : CRC introuvable, repli sur un fichier existant pour ce numéro de série
        let chd = iso.with_extension("chd");
        let err = Pcsx2.game_key(&game(Some("SLUS-20312")), &ctx(Some(&chd))).unwrap_err();
        assert!(err.contains("identifiant introuvable"), "{err}");
        std::fs::write(gs.join("SLUS-20312_0BADF00D.ini"), b"").unwrap();
        assert_eq!(Pcsx2.game_key(&game(Some("SLUS-20312")), &ctx(Some(&chd))), Ok("SLUS-20312_0BADF00D".into()));
        // deux fichiers : ambigu, rien n'est deviné
        std::fs::write(gs.join("SLUS-20312_12345678.ini"), b"").unwrap();
        assert!(Pcsx2.game_key(&game(Some("SLUS-20312")), &ctx(Some(&chd))).is_err());
        // numéro de série malveillant
        assert!(Pcsx2.game_key(&game(Some("../../x")), &ctx(None)).is_err());
        assert!(Pcsx2.game_key(&GameQuery { platform: "ps1".into(), ..game(None) }, &ctx(Some(&iso))).is_err());
    }

    #[test]
    fn dossier_personnalise_refuse() {
        let (_t, inst, _) = portable();
        let ini = inst.exe.parent().unwrap().join("inis").join("PCSX2.ini");
        std::fs::write(&ini, b"[Folders]\nGameSettings = D:\\ailleurs\n").unwrap();
        assert!(Pcsx2.locate(&inst).is_err());
    }

    #[test]
    fn apercu_valeurs_invalides_et_correctifs_preserves() {
        let (_t, inst, iso) = portable();
        let hw = HardwareInfo { apis: GraphicsApis { d3d11: Some(true), ..Default::default() }, ..Default::default() };
        let settings = vec![
            setting("pcsx2.upscale_multiplier", Value::Int(3)),
            setting("pcsx2.renderer", Value::Choice("vulkan".into())),
            setting("pcsx2.ee_cyclerate", Value::Int(2)),
            setting("pcsx2.ee_cycleskip", Value::Int(9)),
            setting("pcsx2.aspect_ratio", Value::Choice("16_9\r\n[Folders]".into())),
            setting("pcsx2.fxaa", Value::Bool(true)),
            setting("pcsx2.bios_path", Value::Choice("C:\\".into())),
        ];
        let p = plan(&Pcsx2, &inst, &game(None), Some(&iso), &settings, &hw).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert_eq!(text, "[EmuCore/GS]\r\nupscale_multiplier = 3\r\nfxaa = true\r\n");
        assert_eq!(p.changes.len(), 2);
        assert_eq!(p.skipped.len(), 5);
        assert!(p.skipped.iter().any(|r| r.key == "pcsx2.ee_cyclerate" && r.reason.contains("correctif")));
        assert!(p.target.ends_with(Path::new("gamesettings").join(format!("SLUS-20312_{}.ini", crc()))));
        assert!(!p.existed);
    }

    #[test]
    fn modification_ciblee_lecture_et_verification() {
        let (_t, inst, iso) = portable();
        let loc = Pcsx2.locate(&inst).unwrap();
        let (_, dir, file) = Pcsx2.target(&loc, &format!("SLUS-20312_{}", crc()));
        std::fs::create_dir_all(&dir).unwrap();
        let before = "[EmuCore]\nEnablePatches = true\n[EmuCore/GS]\nRenderer = 14\nupscale_multiplier = 2.000000\n[Pad1]\nType = DualShock2\n";
        std::fs::write(&file, before).unwrap();
        let cur = Pcsx2.read(Some(before.as_bytes())).unwrap();
        assert!(cur.contains(&setting("pcsx2.renderer", Value::Choice("vulkan".into()))));
        assert!(cur.contains(&setting("pcsx2.upscale_multiplier", Value::Int(2))));
        // valeur identique : rien à changer
        let (same, changes) = Pcsx2.render(Some(before.as_bytes()), &[setting("pcsx2.renderer", Value::Choice("vulkan".into()))]).unwrap();
        assert_eq!(same, before.as_bytes());
        assert!(changes.is_empty());
        let hw = HardwareInfo::default();
        let p = plan(&Pcsx2, &inst, &game(None), Some(&iso), &[setting("pcsx2.texture_filtering", Value::Choice("nearest".into()))], &hw).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert!(text.contains("[Pad1]\nType = DualShock2\n"));
        assert!(text.contains("upscale_multiplier = 2.000000\nfilter = 0\n"));
        assert!(p.existed);
        std::fs::write(&file, &p.after).unwrap();
        assert!(verify(&Pcsx2, &file, &[setting("pcsx2.texture_filtering", Value::Choice("nearest".into()))]));
        assert!(!verify(&Pcsx2, &file, &[setting("pcsx2.texture_filtering", Value::Choice("bilinear_ps2".into()))]));
        assert_eq!(Pcsx2.mode_of(&cur), Some(Mode::Balanced));
    }
}
