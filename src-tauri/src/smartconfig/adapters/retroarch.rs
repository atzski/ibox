//! Adaptateur RetroArch (surcharges par jeu).
//!
//! Vérifié dans le code source de RetroArch (v1.22.2) :
//! - `retroarch.cfg` (`configuration.c`, `config_load_file` Windows) : à côté
//!   du programme, sinon `%APPDATA%\RetroArch\retroarch.cfg` ;
//! - dossier des surcharges (`file_path_special.c`,
//!   `APPLICATION_SPECIAL_DIRECTORY_CONFIG`) : `rgui_config_directory` s'il
//!   est renseigné (`:\config` par défaut, `:` = dossier du programme), sinon
//!   le dossier de `retroarch.cfg` ;
//! - surcharge de jeu (`config_load_override`) :
//!   `<config>\<library_name du cœur>\<nom du contenu sans extension>.cfg`,
//!   chargée **après** les surcharges de cœur et de dossier (elle l'emporte) ;
//!   seules les clés présentes remplacent la configuration principale ;
//! - format (`config_file.c`) : `clé = "valeur"` ;
//! - clés (`configuration.c`) : `video_driver`, `video_vsync`,
//!   `video_hard_sync`, `video_hard_sync_frames` (≤ 3,
//!   `MAXIMUM_HARD_SYNC_FRAMES`), `video_frame_delay`, `rewind_enable`,
//!   `run_ahead_enabled`, `run_ahead_frames`.
//!
//! Le dossier dépend du `library_name` déclaré par le cœur
//! (`retro_get_system_info`), pas du nom du fichier : seuls les cœurs dont ce
//! nom a été vérifié dans leur code source sont pris en charge (`CORES`).
//! Les options des cœurs (`.opt`), manettes, chemins et raccourcis ne sont
//! jamais touchés.

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::cfg::Cfg;
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use crate::smartconfig::platform::{self, UnixDirs};
use std::path::{Path, PathBuf};

pub struct RetroArch;

/// Fichier du cœur → `library_name` (vérifié dans le code de chaque cœur).
pub const CORES: &[(&str, &str)] = &[
    ("genesis_plus_gx_libretro.dll", "Genesis Plus GX"), // libretro/libretro.c
    ("mednafen_saturn_libretro.dll", "Beetle Saturn"),   // libretro.c, MEDNAFEN_CORE_NAME
    ("fbneo_libretro.dll", "FinalBurn Neo"),             // src/burner/title.h, APP_TITLE
    ("play_libretro.dll", "Play!"),                      // Source/ui_libretro/main_libretro.cpp
    ("pcsx_rearmed_libretro.dll", "PCSX-ReARMed"),       // frontend/libretro.c
    ("yabause_libretro.dll", "Yabause"),                 // yabause/src/libretro/libretro.c
];

pub const DRIVERS: &[&str] = &["vulkan", "opengl", "d3d11", "d3d12"];

pub const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "retroarch.video_driver", label: "Pilote vidéo", kind: Kind::Choice(DRIVERS), risk: Risk::High, check: Some(common::api_check) },
    SettingSpec { key: "retroarch.vsync", label: "Synchronisation verticale", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "retroarch.hard_sync", label: "Synchronisation GPU stricte", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "retroarch.hard_sync_frames", label: "Images de synchronisation GPU", kind: Kind::Int { min: 0, max: 3 }, risk: Risk::Low, check: None },
    SettingSpec { key: "retroarch.frame_delay", label: "Délai d'image (ms)", kind: Kind::Int { min: 0, max: 15 }, risk: Risk::Medium, check: None },
    SettingSpec { key: "retroarch.rewind", label: "Retour arrière", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "retroarch.run_ahead", label: "Anticipation (images, 0 = désactivée)", kind: Kind::Int { min: 0, max: 6 }, risk: Risk::Medium, check: None },
];

fn writes(s: &Setting) -> Option<Vec<Write>> {
    let b = |v: &bool| v.to_string();
    Some(match (s.key.as_str(), &s.value) {
        ("retroarch.video_driver", Value::Choice(c)) => {
            let d = match c.as_str() {
                "vulkan" => "vulkan",
                "opengl" => "gl",
                "d3d11" => "d3d11",
                "d3d12" => "d3d12",
                _ => return None,
            };
            vec![("", "video_driver", d.into())]
        }
        ("retroarch.vsync", Value::Bool(v)) => vec![("", "video_vsync", b(v))],
        ("retroarch.hard_sync", Value::Bool(v)) => vec![("", "video_hard_sync", b(v))],
        ("retroarch.hard_sync_frames", Value::Int(i)) => vec![("", "video_hard_sync_frames", i.to_string())],
        ("retroarch.frame_delay", Value::Int(i)) => vec![("", "video_frame_delay", i.to_string())],
        ("retroarch.rewind", Value::Bool(v)) => vec![("", "rewind_enable", b(v))],
        ("retroarch.run_ahead", Value::Int(0)) => vec![("", "run_ahead_enabled", "false".into())],
        ("retroarch.run_ahead", Value::Int(i)) => vec![("", "run_ahead_enabled", "true".into()), ("", "run_ahead_frames", i.to_string())],
        _ => return None,
    })
}

/// Le même cœur s'appelle `…_libretro.dll` sous Windows et `…_libretro.so` sous Linux.
fn library_name(core: &str) -> Option<&'static str> {
    let stem = |f: &str| -> String {
        let l = f.to_ascii_lowercase();
        l.strip_suffix(".dll").or_else(|| l.strip_suffix(".so")).map(str::to_string).unwrap_or(l)
    };
    CORES.iter().find(|(f, _)| stem(f) == stem(core)).map(|(_, n)| *n)
}

/// Élément de nom de fichier sûr sous Windows (le nom d'un jeu peut contenir
/// espaces, parenthèses, accents…).
fn safe_component(s: &str) -> bool {
    !s.is_empty()
        && s.chars().count() <= 150
        && s != "."
        && s != ".."
        && !s.ends_with(['.', ' '])
        && !s.starts_with(' ')
        && !s.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
}

/// `retroarch.cfg` effectivement lu par RetroArch.
fn main_config(exe_dir: &Path) -> Result<(PathBuf, bool), String> {
    let local = exe_dir.join("retroarch.cfg");
    if local.is_file() {
        return Ok((local, true));
    }
    let appdata = std::env::var("APPDATA").map_err(|_| "configuration de RetroArch introuvable")?;
    let roaming = PathBuf::from(appdata).join("RetroArch").join("retroarch.cfg");
    if roaming.is_file() {
        return Ok((roaming, false));
    }
    Err("configuration de RetroArch introuvable : lancez RetroArch une fois, puis réessayez".into())
}

impl Adapter for RetroArch {
    fn id(&self) -> &'static str {
        "retroarch"
    }
    fn name(&self) -> &'static str {
        "RetroArch"
    }
    fn platforms(&self) -> &'static [&'static str] {
        // consoles dont un cœur vérifié (`CORES`) est proposé par iBox
        &["megadrive", "mastersystem", "gamegear", "saturn", "arcade", "ps1", "ps2"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de RetroArch invalide")?;
        let (cfg_path, portable) = main_config(exe_dir)?;
        let cfg = Cfg::parse(&std::fs::read(&cfg_path).map_err(|_| "configuration de RetroArch illisible")?)?;
        let dir = match cfg.get("rgui_config_directory").filter(|d| !d.is_empty() && d != "default") {
            None => cfg_path.parent().ok_or("emplacement de RetroArch invalide")?.to_path_buf(),
            Some(d) => match d.strip_prefix(":\\").or_else(|| d.strip_prefix(":/")) {
                Some(rel) if !rel.is_empty() && Path::new(rel).components().all(|c| matches!(c, std::path::Component::Normal(_))) => exe_dir.join(rel),
                _ => return Err("dossier de configuration de RetroArch personnalisé (rgui_config_directory) non pris en charge".into()),
            },
        };
        if !dir.is_dir() {
            return Err("dossier de configuration de RetroArch introuvable : lancez RetroArch une fois, puis réessayez".into());
        }
        Ok(Location { config_root: dir, portable, version: install.version.clone() })
    }

    /// `<library_name>/<nom du contenu>` : le dossier du cœur fait partie de l'identifiant.
    fn game_key(&self, game: &GameQuery, ctx: &KeyContext) -> Result<String, String> {
        if !self.platforms().contains(&game.platform.as_str()) {
            return Err("console non prise en charge par SmartConfig pour RetroArch".into());
        }
        let core = ctx.install.core.as_deref().ok_or("aucun cœur RetroArch choisi pour cette console")?;
        let lib = library_name(core).ok_or("cœur RetroArch non vérifié par iBox (nom de dossier des surcharges inconnu)")?;
        let file = ctx.main_file.ok_or("fichier du jeu absent")?;
        let stem = file.file_stem().and_then(|s| s.to_str()).ok_or("nom du fichier du jeu illisible")?;
        if !safe_component(stem) {
            return Err("nom du fichier du jeu non pris en charge".into());
        }
        Ok(format!("{lib}/{stem}"))
    }

    fn valid_key(&self, key: &str) -> bool {
        key.split_once('/').is_some_and(|(lib, stem)| CORES.iter().any(|(_, n)| *n == lib) && safe_component(stem))
    }

    /// frontend/drivers/platform_unix.c : `$XDG_CONFIG_HOME/retroarch` ou `~/.config/retroarch`
    /// (`retroarch.cfg`) ; surcharges dans `rgui_config_directory`, par défaut `<base>/config`,
    /// enregistré avec `~/`. Un dossier hors de `<base>` n'est pas pris en charge.
    fn locate_unix(&self, install: &Install, dirs: &UnixDirs) -> Result<Location, String> {
        let d = dirs.for_exe(&install.exe);
        let base = d.config_home.join("retroarch");
        let bytes = std::fs::read(base.join("retroarch.cfg")).map_err(|_| "configuration de RetroArch introuvable : lancez RetroArch une fois, puis réessayez")?;
        let cfg = Cfg::parse(&bytes)?;
        let dir = match cfg.get("rgui_config_directory").filter(|v| !v.is_empty() && v != "default") {
            None => base.join("config"),
            Some(v) => {
                let p = platform::expand_home(&v, &d.home);
                if !p.is_absolute() || !p.starts_with(&base) || p.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
                    return Err("dossier de configuration de RetroArch personnalisé (rgui_config_directory) non pris en charge".into());
                }
                p
            }
        };
        if !dir.is_dir() {
            return Err("dossier de configuration de RetroArch introuvable : lancez RetroArch une fois, puis réessayez".into());
        }
        Ok(Location { config_root: dir, portable: false, version: install.version.clone() })
    }
    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let (lib, stem) = key.split_once('/').unwrap_or(("", key));
        let dir = loc.config_root.join(lib);
        let file = dir.join(format!("{stem}.cfg"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        let Some(bytes) = current else { return Ok(Vec::new()) };
        let c = Cfg::parse(bytes)?;
        let bool_of = |k: &str| c.get(k).and_then(|v| common::parse_bool(&v));
        let int_of = |k: &str| c.get(k).and_then(|v| v.parse::<i64>().ok());
        let mut out = Vec::new();
        let mut push = |k: &str, v: Option<Value>| {
            if let Some(v) = v {
                out.push(Setting { key: k.into(), value: v });
            }
        };
        push(
            "retroarch.video_driver",
            c.get("video_driver").and_then(|d| match d.as_str() {
                "vulkan" => Some(Value::Choice("vulkan".into())),
                "gl" => Some(Value::Choice("opengl".into())),
                "d3d11" => Some(Value::Choice("d3d11".into())),
                "d3d12" => Some(Value::Choice("d3d12".into())),
                _ => None,
            }),
        );
        push("retroarch.vsync", bool_of("video_vsync").map(Value::Bool));
        push("retroarch.hard_sync", bool_of("video_hard_sync").map(Value::Bool));
        push("retroarch.hard_sync_frames", int_of("video_hard_sync_frames").map(Value::Int));
        push("retroarch.frame_delay", int_of("video_frame_delay").map(Value::Int));
        push("retroarch.rewind", bool_of("rewind_enable").map(Value::Bool));
        push(
            "retroarch.run_ahead",
            match bool_of("run_ahead_enabled") {
                Some(false) => Some(Value::Int(0)),
                Some(true) => int_of("run_ahead_frames").map(Value::Int),
                None => None,
            },
        );
        Ok(out)
    }

    fn builtin_overrides(&self, _install: &Install, _key: &str) -> Vec<String> {
        Vec::new()
    }

    fn mode_of(&self, _settings: &[Setting]) -> Option<Mode> {
        // réglages de latence et d'affichage : aucun mode qualité/performance
        None
    }

    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        let doc = match current {
            Some(b) => Cfg::parse(b)?,
            None => Cfg::empty(),
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

    fn portable(core: Option<&str>) -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("RetroArch");
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::write(dir.join("retroarch.cfg"), "rgui_config_directory = \":\\config\"\nvideo_vsync = \"true\"\n").unwrap();
        std::fs::write(dir.join("retroarch.exe"), b"MZ").unwrap();
        (tmp, Install { profile_id: "retroarch".into(), exe: dir.join("retroarch.exe"), version: Some("1.22.2".into()), core: core.map(str::to_string) })
    }

    fn game() -> GameQuery {
        GameQuery { game_id: 1, platform: "megadrive".into(), title: "Sonic".into(), serial: None, region: None, id_confidence: 1.0 }
    }

    #[test]
    fn emplacement_et_identifiant() {
        let (t, inst) = portable(Some("genesis_plus_gx_libretro.dll"));
        let loc = RetroArch.locate(&inst).unwrap();
        assert!(loc.portable && loc.config_root.ends_with(Path::new("RetroArch").join("config")));
        let rom = t.path().join("Sonic The Hedgehog (USA, Europe).md");
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: Some(&rom) };
        let key = RetroArch.game_key(&game(), &ctx).unwrap();
        assert_eq!(key, "Genesis Plus GX/Sonic The Hedgehog (USA, Europe)");
        assert!(RetroArch.valid_key(&key));
        let (root, dir, file) = RetroArch.target(&loc, &key);
        assert_eq!(dir, root.join("Genesis Plus GX"));
        assert_eq!(file, dir.join("Sonic The Hedgehog (USA, Europe).cfg"));
        for bad in ["Genesis Plus GX/../x", "Inconnu/Sonic", "Genesis Plus GX/a\\b", "Genesis Plus GX/a:b", "Genesis Plus GX/", "Sonic", "Genesis Plus GX/x."] {
            assert!(!RetroArch.valid_key(bad), "{bad}");
        }
        // cœur absent ou non vérifié
        let (_t2, other) = portable(Some("picodrive_libretro.dll"));
        let ctx2 = KeyContext { install: &other, location: Some(&loc), main_file: Some(&rom) };
        assert!(RetroArch.game_key(&game(), &ctx2).unwrap_err().contains("non vérifié"));
        let (_t3, none) = portable(None);
        assert!(RetroArch.game_key(&game(), &KeyContext { install: &none, location: Some(&loc), main_file: Some(&rom) }).is_err());
        // dossier de configuration personnalisé : refusé
        std::fs::write(inst.exe.parent().unwrap().join("retroarch.cfg"), "rgui_config_directory = \"D:\\ailleurs\"\n").unwrap();
        assert!(RetroArch.locate(&inst).unwrap_err().contains("personnalisé"));
        // non renseigné : dossier de retroarch.cfg
        std::fs::write(inst.exe.parent().unwrap().join("retroarch.cfg"), "video_vsync = \"true\"\n").unwrap();
        assert_eq!(RetroArch.locate(&inst).unwrap().config_root, inst.exe.parent().unwrap());
    }

    #[test]
    #[cfg_attr(not(windows), ignore = "disposition portable propre à Windows ; Linux : smartconfig::platform::tests")]
    fn surcharge_creee_puis_modifiee_sans_rien_perdre() {
        let (t, inst) = portable(Some("genesis_plus_gx_libretro.dll"));
        let rom = t.path().join("Sonic (USA).md");
        let mut hw = HardwareInfo::default();
        hw.apis.vulkan_loader = Some(true);
        let settings = vec![
            setting("retroarch.vsync", Value::Bool(false)),
            setting("retroarch.run_ahead", Value::Int(2)),
            setting("retroarch.frame_delay", Value::Int(99)),
            setting("retroarch.video_driver", Value::Choice("vulkan\"\nsavefile_directory = \"C:".into())),
            setting("retroarch.savefile_directory", Value::Choice("C:\\".into())),
        ];
        let p = plan(&RetroArch, &inst, &game(), Some(&rom), &settings, &hw).unwrap();
        assert_eq!(String::from_utf8(p.after.clone()).unwrap(), "video_vsync = \"false\"\nrun_ahead_enabled = \"true\"\nrun_ahead_frames = \"2\"\n");
        assert_eq!((p.changes.len(), p.skipped.len()), (2, 3));
        assert!(p.target.ends_with(Path::new("config").join("Genesis Plus GX").join("Sonic (USA).cfg")));
        std::fs::write(&p.target, &p.after).unwrap();
        assert!(verify(&RetroArch, &p.target, &settings[..2]));
        // surcharge existante (manettes comprises) : seules nos clés changent
        let existing = "input_player1_a_btn = \"1\"\r\nrun_ahead_enabled = \"true\"\r\nrun_ahead_frames = \"1\"\r\n";
        std::fs::write(&p.target, existing).unwrap();
        let s = [setting("retroarch.run_ahead", Value::Int(0)), setting("retroarch.video_driver", Value::Choice("vulkan".into()))];
        let p2 = plan(&RetroArch, &inst, &game(), Some(&rom), &s, &hw).unwrap();
        assert_eq!(String::from_utf8(p2.after.clone()).unwrap(), existing.replace("enabled = \"true\"", "enabled = \"false\"") + "video_driver = \"vulkan\"\r\n");
        let cur = RetroArch.read(Some(&p2.after)).unwrap();
        assert!(cur.contains(&s[0]) && cur.contains(&s[1]));
        assert_eq!(RetroArch.mode_of(&cur), None);
    }
}
