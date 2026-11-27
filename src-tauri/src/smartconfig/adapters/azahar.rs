//! Adaptateur Azahar (Nintendo 3DS).
//!
//! Vérifié dans le code source d'Azahar (2026-11-17) :
//! - dossier utilisateur (`src/common/file_util.cpp`, `SetUserPath`) :
//!   `<programme>\user` s'il existe (portable) ; sinon `%APPDATA%\Azahar`
//!   (`common_paths.h`) ; réglages dans `config\` ;
//! - fichier par jeu (`src/citra_qt/configuration/config.cpp`,
//!   `QtConfig::Initialize`, type `PerGameConfig`) :
//!   `config\custom\<ID>.ini`, `ID` = identifiant de programme sur 16
//!   chiffres hexadécimaux majuscules (`citra_qt.cpp`, `BootGame` :
//!   `ReadProgramId`, `{:016X}`) ;
//! - format QSettings (INI) : pour un réglage « commutable »,
//!   `nom\use_global=false` puis `nom=valeur` (`ReadGlobalSetting` : absent =
//!   valeur globale) ; booléens `true`/`false`, énumérations en entier. En
//!   mode par jeu, ni manettes, ni caméra, ni chemins ne sont lus (`if
//!   (global)`) : créer ce fichier ne touche à rien d'autre ;
//! - clés (`GenerateSettingKeys.cmake`, `settings.h`) : `[Renderer]`
//!   `graphics_api` (0 logiciel, 1 OpenGL, 2 Vulkan), `resolution_factor`
//!   (0 = taille de la fenêtre), `texture_filter` (0 aucun, 1 Anime4K,
//!   2 bicubique, 3 ScaleForce, 4 xBRZ, 5 MMPX), `async_shader_compilation`,
//!   `use_hw_shader`, `shaders_accurate_mul`, `use_disk_shader_cache`,
//!   `use_vsync`, `spirv_shader_gen`, `disable_spirv_optimizer` ; `[Layout]`
//!   `filter_mode` (filtrage linéaire). `use_cpu_jit` n'est lu qu'en global :
//!   jamais écrit.
//! - identifiant : lu en local dans l'en-tête du fichier du jeu (NCSD → NCCH
//!   de la partition 0, ou NCCH directement), champ `program_id` (+0x118),
//!   comme `AppLoader_NCCH::ReadProgramId`. Formats compressés (`.z*`),
//!   `.cia` (installé, pas lancé) et `.3dsx` (homebrew) : non pris en charge.

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::ini::Ini;
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use crate::smartconfig::platform::{self, UnixDirs};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub struct Azahar;

pub const APIS: &[&str] = &["software", "opengl", "vulkan"];
pub const FILTERS: &[&str] = &["none", "anime4k", "bicubic", "scaleforce", "xbrz", "mmpx"];

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "azahar.graphics_api", label: "API graphique", kind: Kind::Choice(APIS), risk: Risk::High, check: Some(common::api_check) },
    SettingSpec { key: "azahar.resolution_factor", label: "Résolution interne (0 = fenêtre)", kind: Kind::Int { min: 0, max: 10 }, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.texture_filter", label: "Filtre de textures", kind: Kind::Choice(FILTERS), risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.async_shader_compilation", label: "Compilation asynchrone des shaders", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.hw_shader", label: "Shaders matériels", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "azahar.accurate_mul", label: "Multiplication précise", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.disk_shader_cache", label: "Cache des shaders sur disque", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.vsync", label: "Synchronisation verticale", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.spirv_shader_gen", label: "Génération de shaders SPIR-V", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.disable_spirv_optimizer", label: "Désactiver l'optimiseur SPIR-V", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "azahar.linear_filtering", label: "Filtrage linéaire", kind: Kind::Bool, risk: Risk::Low, check: None },
];

/// (groupe, nom QSettings, clé « use_global »).
fn slot(key: &str) -> Option<(&'static str, &'static str, &'static str)> {
    Some(match key {
        "azahar.graphics_api" => ("Renderer", "graphics_api", "graphics_api\\use_global"),
        "azahar.resolution_factor" => ("Renderer", "resolution_factor", "resolution_factor\\use_global"),
        "azahar.texture_filter" => ("Renderer", "texture_filter", "texture_filter\\use_global"),
        "azahar.async_shader_compilation" => ("Renderer", "async_shader_compilation", "async_shader_compilation\\use_global"),
        "azahar.hw_shader" => ("Renderer", "use_hw_shader", "use_hw_shader\\use_global"),
        "azahar.accurate_mul" => ("Renderer", "shaders_accurate_mul", "shaders_accurate_mul\\use_global"),
        "azahar.disk_shader_cache" => ("Renderer", "use_disk_shader_cache", "use_disk_shader_cache\\use_global"),
        "azahar.vsync" => ("Renderer", "use_vsync", "use_vsync\\use_global"),
        "azahar.spirv_shader_gen" => ("Renderer", "spirv_shader_gen", "spirv_shader_gen\\use_global"),
        "azahar.disable_spirv_optimizer" => ("Renderer", "disable_spirv_optimizer", "disable_spirv_optimizer\\use_global"),
        "azahar.linear_filtering" => ("Layout", "filter_mode", "filter_mode\\use_global"),
        _ => return None,
    })
}

fn choices(key: &str) -> &'static [&'static str] {
    match key {
        "azahar.graphics_api" => APIS,
        "azahar.texture_filter" => FILTERS,
        _ => &[],
    }
}

fn writes(s: &Setting) -> Option<Vec<Write>> {
    let (group, name, global) = slot(&s.key)?;
    let v = match &s.value {
        Value::Bool(b) => b.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Choice(c) => choices(&s.key).iter().position(|x| x == c)?.to_string(),
    };
    Some(vec![(group, global, "false".into()), (group, name, v)])
}

/// Identifiant de programme lu dans l'en-tête (lecture seule, 0x400 octets au plus).
pub fn program_id(path: &Path) -> Result<u64, String> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !["3ds", "cci", "cxi", "app"].contains(&ext.as_str()) {
        return Err("format du jeu non pris en charge pour l'identifiant 3DS (seuls .3ds, .cci, .cxi, .app non compressés)".into());
    }
    let mut f = std::fs::File::open(path).map_err(|_| "fichier du jeu illisible")?;
    let mut read = |at: u64, len: usize| -> Result<Vec<u8>, String> {
        let mut buf = vec![0u8; len];
        f.seek(SeekFrom::Start(at)).and_then(|_| f.read_exact(&mut buf)).map_err(|_| "en-tête du jeu illisible")?;
        Ok(buf)
    };
    let head = read(0, 0x200)?;
    let ncch_at = match &head[0x100..0x104] {
        b"NCCH" => 0,
        b"NCSD" => u32::from_le_bytes(head[0x120..0x124].try_into().unwrap_or_default()) as u64 * 0x200,
        _ => return Err("en-tête 3DS (NCSD/NCCH) introuvable".into()),
    };
    let ncch = if ncch_at == 0 { head } else { read(ncch_at, 0x200)? };
    if &ncch[0x100..0x104] != b"NCCH" {
        return Err("partition principale du jeu introuvable".into());
    }
    let id = u64::from_le_bytes(ncch[0x118..0x120].try_into().unwrap_or_default());
    if id == 0 {
        return Err("identifiant de programme nul".into());
    }
    Ok(id)
}

impl Adapter for Azahar {
    fn id(&self) -> &'static str {
        "azahar"
    }
    fn name(&self) -> &'static str {
        "Azahar"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["3ds"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement d'Azahar invalide")?;
        let local = exe_dir.join("user");
        let (user, portable) = if local.is_dir() {
            (local, true)
        } else {
            let appdata = std::env::var("APPDATA").map_err(|_| "dossier de configuration d'Azahar introuvable")?;
            (PathBuf::from(appdata).join("Azahar"), false)
        };
        let config = user.join("config");
        if !config.join("qt-config.ini").is_file() {
            return Err("dossier de configuration d'Azahar introuvable : lancez Azahar une fois, puis réessayez".into());
        }
        Ok(Location { config_root: config, portable, version: install.version.clone() })
    }

    fn game_key(&self, game: &GameQuery, ctx: &KeyContext) -> Result<String, String> {
        if game.platform != "3ds" {
            return Err("console non gérée par Azahar".into());
        }
        let file = ctx.main_file.ok_or("fichier du jeu absent")?;
        program_id(file).map(|id| format!("{id:016X}"))
    }

    fn valid_key(&self, key: &str) -> bool {
        key.len() == 16 && key.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b))
    }

    /// src/common/file_util.cpp (`SetUserPath`) : dossier `user` du dossier courant (iBox lance
    /// l'émulateur depuis son propre dossier), sinon `$XDG_CONFIG_HOME/azahar-emu` ou `~/.config/azahar-emu`.
    fn locate_unix(&self, install: &Install, dirs: &UnixDirs) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement d'Azahar invalide")?;
        let local = exe_dir.join("user");
        let (config, portable) = if platform::flatpak_id(&install.exe).is_none() && local.is_dir() {
            (local.join("config"), true)
        } else {
            (dirs.for_exe(&install.exe).config_home.join("azahar-emu"), false)
        };
        if !config.join("qt-config.ini").is_file() {
            return Err("dossier de configuration d'Azahar introuvable : lancez Azahar une fois, puis réessayez".into());
        }
        Ok(Location { config_root: config, portable, version: install.version.clone() })
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = loc.config_root.join("custom");
        let file = dir.join(format!("{key}.ini"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        common::read(current, SPECS, |k, ini| {
            let (group, name, global) = slot(k)?;
            // valeur prise en compte seulement si le jeu n'utilise pas la valeur globale
            if !ini.get(group, global).is_some_and(|g| common::parse_bool(&g) == Some(false)) {
                return None;
            }
            if ini.get(group, &format!("{name}\\default")).is_some_and(|d| common::parse_bool(&d) == Some(true)) {
                return None;
            }
            let s = ini.get(group, name)?;
            match SPECS.iter().find(|p| p.key == k)?.kind {
                Kind::Bool => common::parse_bool(&s).map(Value::Bool),
                Kind::Int { .. } => s.parse().ok().map(Value::Int),
                Kind::Text => None,
                Kind::Choice(c) => c.get(s.parse::<usize>().ok()?).map(|c| Value::Choice((*c).into())),
            }
        })
    }

    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        Vec::new()
    }

    fn mode_of(&self, settings: &[Setting]) -> Option<Mode> {
        let res = settings.iter().find(|s| s.key == "azahar.resolution_factor").and_then(|s| if let Value::Int(i) = s.value { Some(i) } else { None })?;
        Some(match res {
            0 => return None, // taille de la fenêtre
            i if i >= 3 => Mode::Quality,
            1 => Mode::Performance,
            _ => Mode::Balanced,
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
    use crate::smartconfig::hardware::HardwareInfo;

    fn setting(k: &str, v: Value) -> Setting {
        Setting { key: k.into(), value: v }
    }

    fn portable() -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("Azahar");
        std::fs::create_dir_all(dir.join("user").join("config")).unwrap();
        std::fs::write(dir.join("user").join("config").join("qt-config.ini"), "[Renderer]\r\nresolution_factor=1\r\n").unwrap();
        std::fs::write(dir.join("azahar.exe"), b"MZ").unwrap();
        (tmp, Install { profile_id: "azahar".into(), exe: dir.join("azahar.exe"), version: Some("2123".into()), core: None })
    }

    fn game() -> GameQuery {
        GameQuery { game_id: 1, platform: "3ds".into(), title: "Jeu".into(), serial: Some("CTR-P-AXCE".into()), region: None, id_confidence: 1.0 }
    }

    /// Image `.3ds` minimale : NCSD, partition 0 à 0x4000, NCCH avec l'ID.
    fn cart(dir: &Path, id: u64) -> PathBuf {
        let mut b = vec![0u8; 0x4200];
        b[0x100..0x104].copy_from_slice(b"NCSD");
        b[0x120..0x124].copy_from_slice(&0x20u32.to_le_bytes());
        b[0x4100..0x4104].copy_from_slice(b"NCCH");
        b[0x4118..0x4120].copy_from_slice(&id.to_le_bytes());
        let p = dir.join("Jeu.3ds");
        std::fs::write(&p, b).unwrap();
        p
    }

    #[test]
    fn emplacement_et_identifiant() {
        let (t, inst) = portable();
        let loc = Azahar.locate(&inst).unwrap();
        assert!(loc.portable);
        let rom = cart(t.path(), 0x0004000000055D00);
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: Some(&rom) };
        assert_eq!(Azahar.game_key(&game(), &ctx), Ok("0004000000055D00".into()));
        // NCCH seul (.cxi)
        let mut cxi = vec![0u8; 0x200];
        cxi[0x100..0x104].copy_from_slice(b"NCCH");
        cxi[0x118..0x120].copy_from_slice(&0x0004000000123400u64.to_le_bytes());
        let p = t.path().join("Jeu.cxi");
        std::fs::write(&p, cxi).unwrap();
        assert_eq!(program_id(&p), Ok(0x0004000000123400));
        // formats non pris en charge, en-tête invalide, ID nul, fichier absent
        for (name, bytes) in [("Jeu.cia", vec![0u8; 0x400]), ("Jeu.zcci", vec![0u8; 0x400]), ("Faux.3ds", vec![0u8; 0x400]), ("Court.3ds", vec![0u8; 0x10])] {
            let p = t.path().join(name);
            std::fs::write(&p, bytes).unwrap();
            assert!(program_id(&p).is_err(), "{name}");
        }
        assert!(program_id(&cart(t.path(), 0)).is_err());
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: None };
        assert!(Azahar.game_key(&game(), &ctx).is_err());
        assert!(!Azahar.valid_key("../00040000000"));
        assert!(!Azahar.valid_key("0004000000055d00"));
        let (_, _, file) = Azahar.target(&loc, "0004000000055D00");
        assert!(file.ends_with(Path::new("user").join("config").join("custom").join("0004000000055D00.ini")));
    }

    #[test]
    fn creation_au_format_qsettings_et_relecture() {
        let (t, inst) = portable();
        let rom = cart(t.path(), 0x0004000000055D00);
        let mut hw = HardwareInfo::default();
        hw.apis.vulkan_loader = Some(true);
        let settings = vec![
            setting("azahar.graphics_api", Value::Choice("vulkan".into())),
            setting("azahar.resolution_factor", Value::Int(3)),
            setting("azahar.linear_filtering", Value::Bool(false)),
            setting("azahar.resolution_factor", Value::Int(4)), // doublon
            setting("azahar.texture_filter", Value::Choice("4".into())),
            setting("azahar.use_cpu_jit", Value::Bool(false)),
        ];
        let p = plan(&Azahar, &inst, &game(), Some(&rom), &settings, &hw).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert_eq!(text, "[Renderer]\r\ngraphics_api\\use_global=false\r\ngraphics_api=2\r\n\r\n[Layout]\r\nfilter_mode\\use_global=false\r\nfilter_mode=false\r\n");
        assert_eq!(p.changes.len(), 2);
        assert_eq!(p.skipped.len(), 3);
        std::fs::write(&p.target, &p.after).unwrap();
        assert!(verify(&Azahar, &p.target, &[settings[0].clone(), settings[2].clone()]));
        // fichier réécrit par Azahar (QSettings, clés triées) : modification ciblée
        let saved = "[Layout]\nfilter_mode\\use_global=false\nfilter_mode=false\nlayout_option\\use_global=true\n\n[Renderer]\ngraphics_api\\use_global=false\ngraphics_api=2\nresolution_factor\\use_global=true\n";
        std::fs::write(&p.target, saved).unwrap();
        let s = [setting("azahar.resolution_factor", Value::Int(3)), setting("azahar.graphics_api", Value::Choice("vulkan".into()))];
        let p2 = plan(&Azahar, &inst, &game(), Some(&rom), &s, &hw).unwrap();
        assert_eq!(String::from_utf8(p2.after.clone()).unwrap(), saved.replace("resolution_factor\\use_global=true\n", "resolution_factor\\use_global=false\nresolution_factor=3\n"));
        assert_eq!(p2.changes.len(), 1);
        // une valeur présente mais « use_global=true » n'est pas lue comme appliquée
        let cur = Azahar.read(Some(b"[Renderer]\nresolution_factor\\use_global=true\nresolution_factor=5\n")).unwrap();
        assert!(cur.is_empty());
        assert_eq!(Azahar.mode_of(&[setting("azahar.resolution_factor", Value::Int(3))]), Some(Mode::Quality));
    }
}
