//! Adaptateur Eden (Nintendo Switch).
//!
//! Vérifié dans le code source d'Eden (git.eden-emu.dev, branche master, 2026-11-17) :
//! - dossier utilisateur (`src/common/fs/path_util.cpp`, `fs_paths.h`) :
//!   `<programme>\user` s'il existe (portable) ; sinon `%APPDATA%\eden` ;
//!   réglages dans `config\` ;
//! - fichier par jeu (`src/yuzu/configuration/configure_per_game.cpp`,
//!   `src/frontend_common/config.cpp`, `Config::Initialize`) :
//!   `config\custom\<ID>.ini`, `ID` = identifiant de titre sur 16 chiffres
//!   hexadécimaux majuscules (`{:016X}`) ;
//! - format (`Config::ReadSettingGeneric`) : pour un réglage par jeu,
//!   `nom\use_global=false`, `nom\default=false`, puis `nom=valeur` ; une
//!   valeur marquée `default=true` est ignorée. Booléens `true`/`false`,
//!   énumérations en entier (`settings_setting.h`, `ToString`) ;
//! - sections (`TranslateCategory`, `settings.cpp`) : `Renderer` (y compris
//!   avancé, astuces, extensions), `Cpu`, `Core`, `System` ;
//! - énumérations (`settings_enums.h`) : `RendererBackend` (0 OpenGL GLSL,
//!   1 Vulkan), `ResolutionSetup` (0 ×0,25 … 3 ×1 … 12 ×8), `VSyncMode`,
//!   `AntiAliasing`, `ScalingFilter`, `AnisotropyMode`, `CpuAccuracy`,
//!   `CpuBackend` (1 = NCE, processeurs ARM seulement), `VramUsageMode`,
//!   `NvdecEmulation`, `AstcRecompression`, `ExtendedDynamicState`,
//!   `ConsoleMode` (0 portable, 1 salon).
//!
//! Identifiant du jeu : celui que le scanner d'iBox lit dans un NSP/NSZ
//! (`games.serial`, préfixe `01`). Un XCI ne le donne pas en clair : pas
//! d'application dans ce cas, jamais deviné. Eden ne livre pas de réglages
//! par jeu sous forme de fichiers : aucun correctif intégré à préserver.

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::hardware::HardwareInfo;
use crate::smartconfig::ini::Ini;
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use std::path::PathBuf;

pub struct Eden;

pub const BACKENDS: &[&str] = &["opengl", "vulkan"];
/// Facteurs dans l'ordre de `ResolutionSetup`.
pub const RESOLUTIONS: &[&str] = &["0.25", "0.5", "0.75", "1", "1.25", "1.5", "2", "3", "4", "5", "6", "7", "8"];
pub const VSYNC: &[&str] = &["immediate", "mailbox", "fifo", "fifo_relaxed"];
pub const ANTI_ALIASING: &[&str] = &["none", "fxaa", "smaa"];
pub const FILTERS: &[&str] = &["nearest", "bilinear", "bicubic", "gaussian", "lanczos", "scaleforce", "fsr", "area", "zero_tangent", "bspline", "mitchell", "spline1", "mmpx", "sgsr", "sgsr_edge"];
pub const ANISOTROPY: &[&str] = &["auto", "default", "2x", "4x", "8x", "16x"];
/// `Debugging` (dernière valeur) est volontairement absent.
pub const CPU_ACCURACY: &[&str] = &["auto", "accurate", "unsafe", "paranoid"];
pub const CPU_BACKENDS: &[&str] = &["dynarmic", "nce"];
pub const VRAM: &[&str] = &["conservative", "aggressive"];
pub const NVDEC: &[&str] = &["off", "cpu", "gpu"];
pub const ASTC: &[&str] = &["uncompressed", "bc1", "bc3"];
pub const DYNA_STATE: &[&str] = &["disabled", "eds1", "eds2", "eds3"];
pub const CONSOLE_MODE: &[&str] = &["handheld", "docked"];

/// NCE exécute le code du jeu directement : seulement sur processeur ARM 64 bits.
fn nce_check(v: &Value, hw: &HardwareInfo) -> Option<String> {
    (v == &Value::Choice("nce".into()) && hw.os.arch != "aarch64").then(|| "exécution native (NCE) : réservée aux processeurs ARM".into())
}

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "eden.backend", label: "API graphique", kind: Kind::Choice(BACKENDS), risk: Risk::High, check: Some(common::api_check) },
    SettingSpec { key: "eden.resolution", label: "Résolution interne", kind: Kind::Choice(RESOLUTIONS), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.vsync", label: "Synchronisation verticale", kind: Kind::Choice(VSYNC), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.anti_aliasing", label: "Anticrénelage", kind: Kind::Choice(ANTI_ALIASING), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.scaling_filter", label: "Filtre de mise à l'échelle", kind: Kind::Choice(FILTERS), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.anisotropy", label: "Filtrage anisotrope", kind: Kind::Choice(ANISOTROPY), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.disk_shader_cache", label: "Cache des shaders sur disque", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "eden.async_shaders", label: "Compilation asynchrone des shaders", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "eden.reactive_flushing", label: "Vidage réactif", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "eden.vram_usage", label: "Utilisation de la mémoire vidéo", kind: Kind::Choice(VRAM), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.nvdec", label: "Décodage vidéo (NVDEC)", kind: Kind::Choice(NVDEC), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.astc_recompression", label: "Recompression des textures ASTC", kind: Kind::Choice(ASTC), risk: Risk::Low, check: None },
    SettingSpec { key: "eden.dyna_state", label: "État dynamique étendu", kind: Kind::Choice(DYNA_STATE), risk: Risk::Medium, check: None },
    SettingSpec { key: "eden.cpu_accuracy", label: "Précision du processeur", kind: Kind::Choice(CPU_ACCURACY), risk: Risk::Medium, check: None },
    SettingSpec { key: "eden.cpu_backend", label: "Moteur d'exécution du processeur", kind: Kind::Choice(CPU_BACKENDS), risk: Risk::High, check: Some(nce_check) },
    SettingSpec { key: "eden.speed_limit", label: "Limiter la vitesse", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "eden.sync_core_speed", label: "Synchroniser la vitesse des cœurs", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "eden.console_mode", label: "Mode de la console", kind: Kind::Choice(CONSOLE_MODE), risk: Risk::Low, check: None },
];

/// (section, nom, clé « nom\use_global », clé « nom\default ») : chaînes statiques.
type Slot = (&'static str, &'static str, &'static str, &'static str);

macro_rules! s {
    ($sec:literal, $name:literal) => {
        ($sec, $name, concat!($name, "\\use_global"), concat!($name, "\\default"))
    };
}

fn slot(key: &str) -> Option<Slot> {
    Some(match key {
        "eden.backend" => s!("Renderer", "backend"),
        "eden.resolution" => s!("Renderer", "resolution_setup"),
        "eden.vsync" => s!("Renderer", "use_vsync"),
        "eden.anti_aliasing" => s!("Renderer", "anti_aliasing"),
        "eden.scaling_filter" => s!("Renderer", "scaling_filter"),
        "eden.anisotropy" => s!("Renderer", "max_anisotropy"),
        "eden.disk_shader_cache" => s!("Renderer", "use_disk_shader_cache"),
        "eden.async_shaders" => s!("Renderer", "use_asynchronous_shaders"),
        "eden.reactive_flushing" => s!("Renderer", "use_reactive_flushing"),
        "eden.vram_usage" => s!("Renderer", "vram_usage_mode"),
        "eden.nvdec" => s!("Renderer", "nvdec_emulation"),
        "eden.astc_recompression" => s!("Renderer", "astc_recompression"),
        "eden.dyna_state" => s!("Renderer", "dyna_state"),
        "eden.cpu_accuracy" => s!("Cpu", "cpu_accuracy"),
        "eden.cpu_backend" => s!("Cpu", "cpu_backend"),
        "eden.speed_limit" => s!("Core", "use_speed_limit"),
        "eden.sync_core_speed" => s!("Core", "sync_core_speed"),
        "eden.console_mode" => s!("System", "use_docked_mode"),
        _ => return None,
    })
}

fn choices(key: &str) -> &'static [&'static str] {
    match SPECS.iter().find(|s| s.key == key).map(|s| s.kind) {
        Some(Kind::Choice(c)) => c,
        _ => &[],
    }
}

fn writes(s: &Setting) -> Option<Vec<Write>> {
    let (section, name, global, default) = slot(&s.key)?;
    let v = match &s.value {
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Choice(c) => choices(&s.key).iter().position(|x| x == c)?.to_string(),
    };
    Some(vec![(section, global, "false".into()), (section, default, "false".into()), (section, name, v)])
}

/// Identifiant de titre Switch valide (16 chiffres hexadécimaux majuscules, préfixe 01).
pub fn valid_title_id(id: &str) -> bool {
    id.len() == 16 && id.starts_with("01") && id.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b))
}

impl Adapter for Eden {
    fn id(&self) -> &'static str {
        "eden"
    }
    fn name(&self) -> &'static str {
        "Eden"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["switch"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement d'Eden invalide")?;
        let local = exe_dir.join("user");
        let (user, portable) = if local.is_dir() {
            (local, true)
        } else {
            let appdata = std::env::var("APPDATA").map_err(|_| "dossier de configuration d'Eden introuvable")?;
            (PathBuf::from(appdata).join("eden"), false)
        };
        let config = user.join("config");
        if !config.is_dir() {
            return Err("dossier de configuration d'Eden introuvable : lancez Eden une fois, puis réessayez".into());
        }
        Ok(Location { config_root: config, portable, version: install.version.clone() })
    }

    fn game_key(&self, game: &GameQuery, _ctx: &KeyContext) -> Result<String, String> {
        if game.platform != "switch" {
            return Err("console non gérée par Eden".into());
        }
        let id = game.serial.as_deref().map(|s| s.trim().to_ascii_uppercase()).filter(|s| valid_title_id(s));
        id.ok_or_else(|| "identifiant de titre inconnu : iBox le lit dans les fichiers NSP/NSZ, pas dans les XCI".into())
    }

    fn valid_key(&self, key: &str) -> bool {
        valid_title_id(key)
    }

    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = loc.config_root.join("custom");
        let file = dir.join(format!("{key}.ini"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        common::read(current, SPECS, |k, ini| {
            let (section, name, global, default) = slot(k)?;
            // valeur propre au jeu seulement si use_global=false et default≠true
            if !ini.get(section, global).is_some_and(|g| common::parse_bool(&g) == Some(false)) {
                return None;
            }
            if ini.get(section, default).is_some_and(|d| common::parse_bool(&d) == Some(true)) {
                return None;
            }
            let s = ini.get(section, name)?;
            match SPECS.iter().find(|p| p.key == k)?.kind {
                Kind::Bool => common::parse_bool(&s).map(Value::Bool),
                Kind::Int { .. } => s.parse().ok().map(Value::Int),
                Kind::Choice(c) => c.get(s.parse::<usize>().ok()?).map(|c| Value::Choice((*c).into())),
            }
        })
    }

    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        Vec::new()
    }

    /// Résolution interne : en dessous de ×1 performance, ×1 (native) équilibré, au-delà qualité.
    fn mode_of(&self, settings: &[Setting]) -> Option<Mode> {
        let Value::Choice(r) = &settings.iter().find(|s| s.key == "eden.resolution")?.value else { return None };
        let i = RESOLUTIONS.iter().position(|x| x == r)?;
        let native = RESOLUTIONS.iter().position(|x| *x == "1")?;
        Some(match i.cmp(&native) {
            std::cmp::Ordering::Less => Mode::Performance,
            std::cmp::Ordering::Equal => Mode::Balanced,
            std::cmp::Ordering::Greater => Mode::Quality,
        })
    }

    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        let ini = match current {
            Some(b) => Ini::parse(b)?,
            None => Ini::empty_compact(),
        };
        common::render_doc(ini, settings, SPECS, writes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::{plan, verify};

    fn setting(k: &str, v: Value) -> Setting {
        Setting { key: k.into(), value: v }
    }
    fn choice(k: &str, c: &str) -> Setting {
        setting(k, Value::Choice(c.into()))
    }

    fn portable() -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Eden");
        std::fs::create_dir_all(dir.join("user").join("config")).unwrap();
        std::fs::write(dir.join("user").join("config").join("qt-config.ini"), "[Renderer]\r\nbackend=1\r\n").unwrap();
        std::fs::write(dir.join("eden.exe"), b"MZ").unwrap();
        (tmp, Install { profile_id: "eden".into(), exe: dir.join("eden.exe"), version: Some("0.2.1".into()), core: None })
    }

    fn totk(serial: Option<&str>) -> GameQuery {
        GameQuery { game_id: 1, platform: "switch".into(), title: "The Legend of Zelda: Tears of the Kingdom".into(), serial: serial.map(str::to_string), region: None, id_confidence: 1.0 }
    }

    fn x86() -> HardwareInfo {
        let mut hw = HardwareInfo::default();
        hw.os.arch = "x86_64".into();
        hw.apis.vulkan_loader = Some(true);
        hw
    }

    #[test]
    fn emplacement_et_identifiant_de_titre() {
        let (_t, inst) = portable();
        let loc = Eden.locate(&inst).unwrap();
        assert!(loc.portable);
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: None };
        assert_eq!(Eden.game_key(&totk(Some("0100f2c0115b6000")), &ctx), Ok("0100F2C0115B6000".into()));
        // XCI (pas d'identifiant), ID Switch 2, autre console, chemin piégé
        assert!(Eden.game_key(&totk(None), &ctx).is_err());
        assert!(Eden.game_key(&totk(Some("0400486024DEC000")), &ctx).is_err());
        assert!(Eden.game_key(&GameQuery { platform: "switch2".into(), ..totk(Some("0100F2C0115B6000")) }, &ctx).is_err());
        assert!(!Eden.valid_key("..\\0100F2C0115B60"));
        let (_, _, file) = Eden.target(&loc, "0100F2C0115B6000");
        assert!(file.ends_with(std::path::Path::new("user").join("config").join("custom").join("0100F2C0115B6000.ini")));
        // installation jamais lancée : pas de dossier de configuration
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("user")).unwrap();
        let fresh = Install { exe: tmp.path().join("eden.exe"), ..inst };
        assert!(Eden.locate(&fresh).is_err());
    }

    #[test]
    fn format_par_jeu_d_eden_et_garde_fous() {
        let (_t, inst) = portable();
        let settings = vec![
            choice("eden.backend", "vulkan"),
            choice("eden.resolution", "1.5"),
            setting("eden.disk_shader_cache", Value::Bool(true)),
            choice("eden.console_mode", "docked"),
            choice("eden.cpu_backend", "nce"),           // refusé : processeur x86
            choice("eden.resolution", "9"),              // doublon → les deux refusés
            choice("eden.cpu_accuracy", "debugging"),    // hors liste
            setting("eden.program_args", Value::Bool(true)), // inconnu
        ];
        let p = plan(&Eden, &inst, &totk(Some("0100F2C0115B6000")), None, &settings, &x86()).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert!(text.contains("[Renderer]\r\nbackend\\use_global=false\r\nbackend\\default=false\r\nbackend=1\r\n"), "{text}");
        assert!(text.contains("use_disk_shader_cache\\use_global=false\r\nuse_disk_shader_cache\\default=false\r\nuse_disk_shader_cache=true\r\n"));
        assert!(text.contains("[System]\r\nuse_docked_mode\\use_global=false\r\nuse_docked_mode\\default=false\r\nuse_docked_mode=1\r\n"));
        assert!(!text.contains("cpu_backend") && !text.contains("resolution_setup"));
        assert_eq!(p.changes.len(), 3);
        assert_eq!(p.skipped.len(), 4);
        std::fs::write(&p.target, &p.after).unwrap();
        assert!(verify(&Eden, &p.target, &[settings[0].clone(), settings[2].clone(), settings[3].clone()]));
        // sur un appareil ARM, NCE est accepté
        let mut arm = x86();
        arm.os.arch = "aarch64".into();
        let p = plan(&Eden, &inst, &totk(Some("0100F2C0115B6000")), None, &[choice("eden.cpu_backend", "nce")], &arm).unwrap();
        assert!(String::from_utf8(p.after).unwrap().contains("[Cpu]\r\ncpu_backend\\use_global=false\r\ncpu_backend\\default=false\r\ncpu_backend=1\r\n"));
    }

    #[test]
    fn relecture_fidele_a_eden() {
        // valeur globale ou marquée « par défaut » : ignorée, comme le fait Eden
        let cur = Eden.read(Some(b"[Renderer]\nresolution_setup\\use_global=true\nresolution_setup=8\nuse_vsync\\use_global=false\nuse_vsync\\default=true\nuse_vsync=2\nanti_aliasing\\use_global=false\nanti_aliasing\\default=false\nanti_aliasing=2\n")).unwrap();
        assert_eq!(cur, vec![choice("eden.anti_aliasing", "smaa")]);
        // fichier réécrit par Eden : modification ciblée, rien d'autre ne bouge
        let saved = b"[Renderer]\nanti_aliasing\\use_global=false\nanti_aliasing\\default=false\nanti_aliasing=2\nfsr_sharpening_slider\\use_global=true\n\n[Controls]\nplayer_0_button_a=\"engine:keyboard,code:67\"\n";
        let (out, changes) = Eden.render(Some(saved), &[choice("eden.anti_aliasing", "smaa"), choice("eden.resolution", "2")]).unwrap();
        let out = String::from_utf8(out).unwrap();
        assert_eq!(changes.len(), 1);
        assert!(out.contains("player_0_button_a=\"engine:keyboard,code:67\""));
        assert!(out.contains("resolution_setup\\use_global=false\nresolution_setup\\default=false\nresolution_setup=6\n"));
        assert_eq!(Eden.mode_of(&[choice("eden.resolution", "0.75")]), Some(Mode::Performance));
        assert_eq!(Eden.mode_of(&[choice("eden.resolution", "1")]), Some(Mode::Balanced));
        assert_eq!(Eden.mode_of(&[choice("eden.resolution", "3")]), Some(Mode::Quality));
    }
}
