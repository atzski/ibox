//! Adaptateur RPCS3 (PlayStation 3).
//!
//! Vérifié dans le code source de RPCS3 (2026-11-17) :
//! - dossier (`Utilities/File.cpp`, `fs::get_config_dir`) : `<programme>\portable\`
//!   s'il existe ; sinon variable `RPCS3_CONFIG_DIR` ; sinon le dossier du
//!   programme. Sous Windows, les réglages sont dans le sous-dossier
//!   `config\` (`get_config_dir(true)`, `config.yml` y est déplacé au démarrage
//!   par `Emulator::Init`) ;
//! - fichier par jeu (`Emu/system_utils.cpp`, `get_custom_config_path`) :
//!   `config\custom_configs\config_<TITLE_ID>.yml` ; `TITLE_ID` vient de
//!   `PARAM.SFO` (`BLUS30443`) ;
//! - chargement (`Emu/System.cpp`, `Emulator::Load`, mode `custom` par
//!   défaut) : `<chemin du jeu>.yml` **avant** `custom_configs` (le premier
//!   trouvé gagne) ; `g_cfg.from_string` applique le fichier par-dessus la
//!   configuration globale (`cfg::decode` non strict : une clé absente garde la
//!   valeur globale, une clé inconnue est ignorée) ;
//! - **base de configurations** (`rpcs3qt/config_database.cpp`,
//!   `main_application.cpp`) : si aucun fichier personnalisé n'existe, RPCS3
//!   applique la configuration fournie pour ce jeu par sa base
//!   (`GuiConfigs\config_database.dat`, JSON `games.<TITLE_ID>.config`) ;
//!   **un fichier personnalisé la désactive entièrement**. SmartConfig ne crée
//!   donc jamais de fichier pour un jeu présent dans cette base (correctif
//!   conservé) ;
//! - clés et valeurs (`Emu/system_config.h`, `system_config_types.cpp`) :
//!   `Video` › `Renderer` (`Vulkan`, `OpenGL`), `Resolution Scale` (25–800),
//!   `Anisotropic Filter Override` (0 = auto, 2…16), `VSync Mode` (`Disabled`,
//!   `Adaptive`, `Full`), `Frame limit` (`Off`, `30`, `50`, `60`, `Auto`,
//!   `PS3 Native`) ; `Core` › `SPU Block Size` (`Safe`, `Mega`, `Giga`),
//!   `Preferred SPU Threads` (0 = auto, 1–6).
//!
//! Jamais touchés : manettes (`input_configs`), chemins (`vfs.yml`), firmware,
//! sauvegardes, `config.yml`.

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use crate::smartconfig::yaml::Yaml;
use crate::smartconfig::platform::{self, UnixDirs};
use std::path::{Path, PathBuf};

pub struct Rpcs3;

pub const RENDERERS: &[&str] = &["vulkan", "opengl"];
pub const ANISO: &[&str] = &["0", "2", "4", "8", "16"];
pub const VSYNC: &[&str] = &["off", "adaptive", "full"];
pub const FRAME_LIMITS: &[&str] = &["off", "30", "50", "60", "auto", "ps3_native"];
pub const SPU_BLOCKS: &[&str] = &["safe", "mega", "giga"];

/// Taille maximale lue pour la base de configurations de RPCS3.
const MAX_DB_BYTES: u64 = 16 * 1024 * 1024;

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "rpcs3.renderer", label: "Moteur de rendu", kind: Kind::Choice(RENDERERS), risk: Risk::High, check: Some(common::api_check) },
    SettingSpec { key: "rpcs3.resolution_scale", label: "Échelle de résolution (%)", kind: Kind::Int { min: 25, max: 800 }, risk: Risk::Low, check: None },
    SettingSpec { key: "rpcs3.anisotropic_filter", label: "Filtrage anisotrope (0 = auto)", kind: Kind::Choice(ANISO), risk: Risk::Low, check: None },
    SettingSpec { key: "rpcs3.vsync", label: "Synchronisation verticale", kind: Kind::Choice(VSYNC), risk: Risk::Low, check: None },
    SettingSpec { key: "rpcs3.frame_limit", label: "Limite d'images", kind: Kind::Choice(FRAME_LIMITS), risk: Risk::Medium, check: None },
    SettingSpec { key: "rpcs3.spu_block_size", label: "Taille des blocs SPU", kind: Kind::Choice(SPU_BLOCKS), risk: Risk::Medium, check: None },
    SettingSpec { key: "rpcs3.preferred_spu_threads", label: "Fils SPU préférés (0 = auto)", kind: Kind::Int { min: 0, max: 6 }, risk: Risk::Medium, check: None },
];

fn slot(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "rpcs3.renderer" => ("Video", "Renderer"),
        "rpcs3.resolution_scale" => ("Video", "Resolution Scale"),
        "rpcs3.anisotropic_filter" => ("Video", "Anisotropic Filter Override"),
        "rpcs3.vsync" => ("Video", "VSync Mode"),
        "rpcs3.frame_limit" => ("Video", "Frame limit"),
        "rpcs3.spu_block_size" => ("Core", "SPU Block Size"),
        "rpcs3.preferred_spu_threads" => ("Core", "Preferred SPU Threads"),
        _ => return None,
    })
}

/// (identifiant interne, texte écrit par RPCS3) pour chaque option fermée.
fn table(key: &str) -> &'static [(&'static str, &'static str)] {
    match key {
        "rpcs3.renderer" => &[("vulkan", "Vulkan"), ("opengl", "OpenGL")],
        "rpcs3.anisotropic_filter" => &[("0", "0"), ("2", "2"), ("4", "4"), ("8", "8"), ("16", "16")],
        "rpcs3.vsync" => &[("off", "Disabled"), ("adaptive", "Adaptive"), ("full", "Full")],
        "rpcs3.frame_limit" => &[("off", "Off"), ("30", "30"), ("50", "50"), ("60", "60"), ("auto", "Auto"), ("ps3_native", "PS3 Native")],
        "rpcs3.spu_block_size" => &[("safe", "Safe"), ("mega", "Mega"), ("giga", "Giga")],
        _ => &[],
    }
}

fn writes(s: &Setting) -> Option<Vec<Write>> {
    let (sec, key) = slot(&s.key)?;
    let v = match &s.value {
        Value::Int(i) => i.to_string(),
        Value::Choice(c) => table(&s.key).iter().find(|(id, _)| id == c)?.1.to_string(),
        Value::Bool(_) => return None,
    };
    Some(vec![(sec, key, v)])
}

/// Identifiant PS3 « AAAANNNNN » (accepte « AAAA-NNNNN » venu d'un nom de fichier).
pub fn title_id(serial: &str) -> Option<String> {
    let id: String = serial.trim().to_ascii_uppercase().replacen('-', "", 1);
    let b = id.as_bytes();
    (b.len() == 9 && b[..4].iter().all(u8::is_ascii_uppercase) && b[4..].iter().all(u8::is_ascii_digit)).then_some(id)
}

/// Dossier de base de RPCS3 (`fs::get_config_dir()`), portable ou non.
fn base_dir(exe_dir: &Path) -> Result<PathBuf, String> {
    let portable = exe_dir.join("portable");
    if portable.is_dir() {
        return Ok(portable);
    }
    if std::env::var_os("RPCS3_CONFIG_DIR").is_some() {
        return Err("emplacement de configuration de RPCS3 personnalisé (RPCS3_CONFIG_DIR) non pris en charge".into());
    }
    Ok(exe_dir.to_path_buf())
}

/// Le jeu a-t-il une configuration dans la base de RPCS3 ? `Err` si la base
/// existe mais ne peut pas être lue (on ne peut pas savoir).
fn in_database(base: &Path, title: &str) -> Result<bool, String> {
    let path = base.join("GuiConfigs").join("config_database.dat");
    let Ok(meta) = std::fs::metadata(&path) else { return Ok(false) };
    if !meta.is_file() || meta.len() > MAX_DB_BYTES {
        return Err("base de configurations de RPCS3 illisible".into());
    }
    let bytes = std::fs::read(&path).map_err(|_| "base de configurations de RPCS3 illisible")?;
    // JSON invalide ou « return_code » négatif : RPCS3 l'ignore aussi
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else { return Ok(false) };
    if json.get("return_code").and_then(serde_json::Value::as_i64).unwrap_or(-255) < 0 {
        return Ok(false);
    }
    Ok(json.pointer(&format!("/games/{title}/config")).is_some_and(serde_json::Value::is_string))
}

impl Adapter for Rpcs3 {
    fn id(&self) -> &'static str {
        "rpcs3"
    }
    fn name(&self) -> &'static str {
        "RPCS3"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["ps3"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de RPCS3 invalide")?;
        let base = base_dir(exe_dir)?;
        let config = base.join("config");
        if !config.join("config.yml").is_file() {
            return Err("dossier de configuration de RPCS3 introuvable : lancez RPCS3 une fois, puis réessayez".into());
        }
        Ok(Location { config_root: config, portable: true, version: install.version.clone() })
    }

    fn game_key(&self, game: &GameQuery, _ctx: &KeyContext) -> Result<String, String> {
        if game.platform != "ps3" {
            return Err("console non gérée par RPCS3".into());
        }
        title_id(game.serial.as_deref().unwrap_or_default()).ok_or_else(|| "identifiant PS3 (TITLE_ID) absent ou dans un format inattendu : il peut figurer dans le nom du fichier, ex. « (BLUS-30443) »".into())
    }

    /// Utilities/File.cpp (`fs::get_config_dir`) : `<programme>/portable/`, sinon
    /// `$XDG_CONFIG_HOME/rpcs3` ou `~/.config/rpcs3` ; sous Linux sans sous-dossier `config`
    /// (`custom_configs`, `GuiConfigs` et `config.yml` à la racine).
    fn locate_unix(&self, install: &Install, dirs: &UnixDirs) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de RPCS3 invalide")?;
        let portable_dir = exe_dir.join("portable");
        let native = !platform::is_appimage(&install.exe) && platform::flatpak_id(&install.exe).is_none();
        let (base, portable) = if native && portable_dir.is_dir() {
            (portable_dir, true)
        } else {
            (dirs.for_exe(&install.exe).config_home.join("rpcs3"), false)
        };
        if !base.join("config.yml").is_file() {
            return Err("dossier de configuration de RPCS3 introuvable : lancez RPCS3 une fois, puis réessayez".into());
        }
        Ok(Location { config_root: base, portable, version: install.version.clone() })
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = loc.config_root.join("custom_configs");
        let file = dir.join(format!("config_{key}.yml"));
        (loc.config_root.clone(), dir, file)
    }

    fn preflight(&self, ctx: &KeyContext, loc: &Location, key: &str, existed: bool) -> Result<(), String> {
        // `<jeu>.yml` à côté du jeu : prioritaire, notre fichier serait ignoré
        if let Some(main) = ctx.main_file {
            let mut beside = main.as_os_str().to_owned();
            beside.push(".yml");
            if Path::new(&beside).exists() {
                return Err("une configuration RPCS3 placée à côté du jeu (.yml) est prioritaire : SmartConfig ne la modifie pas".into());
            }
        }
        if !existed {
            // Windows : `<base>/config` ; Linux : la configuration est à la racine de `<base>`
            let base = if cfg!(windows) { loc.config_root.parent().ok_or("emplacement de RPCS3 invalide")? } else { loc.config_root.as_path() };
            if in_database(base, key)? {
                return Err("RPCS3 applique pour ce jeu une configuration de sa propre base ; créer une configuration personnalisée la désactiverait. Créez d'abord la configuration du jeu dans RPCS3 (clic droit › Créer une configuration personnalisée), puis réessayez.".into());
            }
        }
        Ok(())
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        let Some(bytes) = current else { return Ok(Vec::new()) };
        let y = Yaml::parse(bytes)?;
        Ok(SPECS
            .iter()
            .filter_map(|p| {
                let (sec, key) = slot(p.key)?;
                let raw = y.get(sec, key)?;
                let value = match p.kind {
                    Kind::Int { .. } => Value::Int(raw.parse().ok()?),
                    _ => Value::Choice(table(p.key).iter().find(|(_, t)| *t == raw)?.0.into()),
                };
                Some(Setting { key: p.key.into(), value })
            })
            .collect())
    }

    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        // la base de configurations est traitée en bloc par `preflight`
        Vec::new()
    }

    fn mode_of(&self, settings: &[Setting]) -> Option<Mode> {
        let scale = settings.iter().find(|s| s.key == "rpcs3.resolution_scale").and_then(|s| if let Value::Int(i) = s.value { Some(i) } else { None })?;
        Some(match scale {
            i if i >= 200 => Mode::Quality,
            i if i <= 100 => Mode::Performance,
            _ => Mode::Balanced,
        })
    }

    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        let doc = match current {
            Some(b) => Yaml::parse(b)?,
            None => Yaml::empty(),
        };
        common::render_doc(doc, settings, SPECS, writes)
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

    fn vulkan() -> HardwareInfo {
        let mut hw = HardwareInfo::default();
        hw.apis.vulkan_loader = Some(true);
        hw
    }

    fn install(portable: bool) -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("RPCS3");
        let base = if portable { dir.join("portable") } else { dir.clone() };
        std::fs::create_dir_all(base.join("config")).unwrap();
        std::fs::write(base.join("config").join("config.yml"), "Video:\n  Renderer: Vulkan\n").unwrap();
        std::fs::write(dir.join("rpcs3.exe"), b"MZ").unwrap();
        (tmp, Install { profile_id: "rpcs3".into(), exe: dir.join("rpcs3.exe"), version: Some("0.0.38".into()), core: None })
    }

    fn game(serial: &str) -> GameQuery {
        GameQuery { game_id: 1, platform: "ps3".into(), title: "Jeu".into(), serial: Some(serial.into()), region: None, id_confidence: 1.0 }
    }

    #[test]
    fn emplacement_et_identifiant() {
        let (_t, inst) = install(true);
        let loc = Rpcs3.locate(&inst).unwrap();
        assert!(loc.config_root.ends_with(Path::new("portable").join("config")));
        let (_t2, classic) = install(false);
        assert!(Rpcs3.locate(&classic).unwrap().config_root.ends_with(Path::new("RPCS3").join("config")));
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: None };
        assert_eq!(Rpcs3.game_key(&game("BLUS-30443"), &ctx), Ok("BLUS30443".into()));
        assert_eq!(Rpcs3.game_key(&game("npeb00001"), &ctx), Ok("NPEB00001".into()));
        for bad in ["../x", "BLUS3044", "BLUS-30443-1", "BL US30443", "SLUS-2031."] {
            assert!(Rpcs3.game_key(&game(bad), &ctx).is_err(), "{bad}");
        }
        let (_, _, file) = Rpcs3.target(&loc, "BLUS30443");
        assert!(file.ends_with(Path::new("config").join("custom_configs").join("config_BLUS30443.yml")));
        let empty = tempfile::tempdir().unwrap();
        let none = Install { profile_id: "rpcs3".into(), exe: empty.path().join("rpcs3.exe"), version: None, core: None };
        assert!(Rpcs3.locate(&none).unwrap_err().contains("lancez RPCS3"));
    }

    #[test]
    #[cfg_attr(not(windows), ignore = "disposition portable propre à Windows ; Linux : smartconfig::platform::tests")]
    fn creation_application_et_lecture() {
        let (_t, inst) = install(true);
        let settings = vec![
            setting("rpcs3.renderer", Value::Choice("vulkan".into())),
            setting("rpcs3.resolution_scale", Value::Int(150)),
            setting("rpcs3.frame_limit", Value::Choice("ps3_native".into())),
            setting("rpcs3.spu_block_size", Value::Choice("mega".into())),
            setting("rpcs3.resolution_scale", Value::Int(150)), // doublon : refusé
            setting("rpcs3.vsync", Value::Choice("Full\nCore:".into())),
            setting("rpcs3.preferred_spu_threads", Value::Int(9)),
            setting("rpcs3.firmware_path", Value::Choice("C:\\x".into())),
        ];
        let p = plan(&Rpcs3, &inst, &game("BLUS30443"), None, &settings, &vulkan()).unwrap();
        assert!(!p.existed);
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert_eq!(text, "Video:\n  Renderer: Vulkan\n  Frame limit: PS3 Native\nCore:\n  SPU Block Size: Mega\n");
        assert_eq!(p.changes.len(), 3);
        assert_eq!(p.skipped.len(), 4);
        std::fs::write(&p.target, &p.after).unwrap();
        assert!(verify(&Rpcs3, &p.target, &[settings[0].clone(), settings[2].clone(), settings[3].clone()]));
        // rien à changer la seconde fois
        let again = plan(&Rpcs3, &inst, &game("BLUS30443"), None, &settings[..4], &vulkan()).unwrap();
        assert!(again.changes.iter().all(|c| c.key == "rpcs3.resolution_scale"));
        // OpenGL : API non vérifiée → refusé
        let gl = plan(&Rpcs3, &inst, &game("BLUS30443"), None, &[setting("rpcs3.renderer", Value::Choice("opengl".into()))], &vulkan()).unwrap();
        assert!(gl.changes.is_empty() && gl.skipped.len() == 1);
        let cur = Rpcs3.read(Some(&p.after)).unwrap();
        assert_eq!(Rpcs3.mode_of(&[setting("rpcs3.resolution_scale", Value::Int(300))]), Some(Mode::Quality));
        assert!(cur.contains(&setting("rpcs3.frame_limit", Value::Choice("ps3_native".into()))));
    }

    #[test]
    #[cfg_attr(not(windows), ignore = "disposition portable propre à Windows ; Linux : smartconfig::platform::tests")]
    fn fichier_complet_existant_modifie_sans_rien_perdre() {
        let (_t, inst) = install(true);
        let loc = Rpcs3.locate(&inst).unwrap();
        let (_, dir, file) = Rpcs3.target(&loc, "BLUS30443");
        std::fs::create_dir_all(&dir).unwrap();
        let full = "Core:\n  PPU Decoder: Recompiler (LLVM)\n  SPU Block Size: Safe\nVideo:\n  Renderer: OpenGL\n  Resolution Scale: 100\n  Vulkan:\n    Adapter: \"\"\nInput/Output:\n  Keyboard: \"Null\"\n";
        std::fs::write(&file, full).unwrap();
        let s = [setting("rpcs3.resolution_scale", Value::Int(200)), setting("rpcs3.spu_block_size", Value::Choice("safe".into()))];
        let p = plan(&Rpcs3, &inst, &game("BLUS30443"), None, &s, &vulkan()).unwrap();
        assert_eq!(String::from_utf8(p.after).unwrap(), full.replace("Scale: 100", "Scale: 200"));
        assert_eq!(p.changes.len(), 1);
        assert_eq!(p.changes[0].before.as_deref(), Some("100"));
    }

    #[test]
    #[cfg_attr(not(windows), ignore = "disposition portable propre à Windows ; Linux : smartconfig::platform::tests")]
    fn base_de_configurations_et_fichier_prioritaire_preserves() {
        let (t, inst) = install(true);
        let base = inst.exe.parent().unwrap().join("portable");
        std::fs::create_dir_all(base.join("GuiConfigs")).unwrap();
        std::fs::write(base.join("GuiConfigs").join("config_database.dat"), r#"{"return_code":0,"games":{"BLUS30443":{"config":"Core:\n  SPU Block Size: Safe\n"}}}"#).unwrap();
        let s = [setting("rpcs3.resolution_scale", Value::Int(200))];
        let err = plan(&Rpcs3, &inst, &game("BLUS30443"), None, &s, &vulkan()).unwrap_err();
        assert!(err.contains("propre base"), "{err}");
        // autre jeu : pas dans la base
        assert!(plan(&Rpcs3, &inst, &game("BLES00001"), None, &s, &vulkan()).is_ok());
        // configuration personnalisée déjà créée : la base est déjà ignorée par RPCS3
        let loc = Rpcs3.locate(&inst).unwrap();
        let (_, _, file) = Rpcs3.target(&loc, "BLUS30443");
        std::fs::write(&file, "Video:\n  Renderer: Vulkan\n").unwrap();
        assert!(plan(&Rpcs3, &inst, &game("BLUS30443"), None, &s, &vulkan()).is_ok());
        // fichier `<jeu>.yml` à côté du jeu : prioritaire
        let iso = t.path().join("Jeu.iso");
        std::fs::write(&iso, b"").unwrap();
        std::fs::write(t.path().join("Jeu.iso.yml"), "Video: {}\n").unwrap();
        assert!(plan(&Rpcs3, &inst, &game("BLUS30443"), Some(&iso), &s, &vulkan()).unwrap_err().contains("prioritaire"));
        // base illisible (JSON invalide) : ignorée par RPCS3 aussi
        std::fs::write(base.join("GuiConfigs").join("config_database.dat"), b"{").unwrap();
        assert_eq!(in_database(&base, "BLUS30443"), Ok(false));
    }
}
