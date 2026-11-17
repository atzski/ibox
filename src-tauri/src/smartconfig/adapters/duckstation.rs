//! Adaptateur DuckStation (PlayStation 1).
//!
//! Vérifié dans le code source de DuckStation (2026-11-17) :
//! - dossier de données (`core/core.cpp`) : `portable.txt` ou `settings.ini`
//!   à côté du programme → dossier du programme ; sinon `Documents\DuckStation`
//!   s'il existe ; sinon `%LOCALAPPDATA%\DuckStation` ;
//! - dossier des réglages par jeu (`settings.cpp`, `EmuFolders::LoadConfig`) :
//!   `[Folders] GameSettings` de `settings.ini`, `gamesettings` par défaut (un
//!   dossier personnalisé est refusé plutôt que deviné) ;
//! - fichier (`System::GetGameSettingsPath`) : `<SERIAL>.ini` ; pour un jeu à
//!   plusieurs disques, celui du **premier disque** de l'ensemble
//!   (`resources/discsets.yaml`), sauf si ce fichier active
//!   `[Main] UseSeparateConfigForDiscSet` ;
//! - clés (`Settings::Load`) : `[GPU]` `Renderer`, `ResolutionScale`,
//!   `TextureFilter`, `Multisamples`, `PerSampleShading`, `PGXPEnable`,
//!   `PGXPTextureCorrection`, `WidescreenHack` ; `[CPU]` `ExecutionMode`,
//!   `OverclockEnable`, `OverclockNumerator`, `OverclockDenominator` ;
//!   `[CDROM]` `ReadSpeedup`, `SeekSpeedup` (1–6) ; `[Display]` `VSync` ;
//! - correctifs intégrés (`GameDatabase::Entry::ApplySettings`,
//!   `resources/gamedb.yaml`) : les traits `ForceInterpreter`,
//!   `ForceSoftwareRenderer`, `DisableUpscaling`, `DisableTextureFiltering`,
//!   `DisableWidescreen`, `DisablePGXP`, `DisablePGXPTextureCorrection`,
//!   `DisableCDROMReadSpeedup`, `DisableCDROMSeekSpeedup` et le réglage
//!   `cpuOverclockPercent` priment sur l'utilisateur : jamais contredits.

use super::common::{self, Write};
use super::{Adapter, Change, Install, KeyContext, Location};
use crate::smartconfig::ini::Ini;
use crate::smartconfig::model::{GameQuery, Mode, Setting, Value};
use crate::smartconfig::validation::{Kind, Risk, SettingSpec};
use std::path::PathBuf;

pub struct DuckStation;

pub const RENDERERS: &[&str] = &["vulkan", "d3d11", "d3d12", "opengl", "software"];
pub const FILTERS: &[&str] = &["nearest", "bilinear", "bilinear_bin_alpha", "jinc2", "jinc2_bin_alpha", "xbr", "xbr_bin_alpha"];
pub const MSAA: &[&str] = &["1", "2", "4", "8", "16"];
pub const CPU_MODES: &[&str] = &["interpreter", "cached_interpreter", "recompiler"];

const SPECS: &[SettingSpec] = &[
    SettingSpec { key: "duckstation.renderer", label: "Moteur de rendu", kind: Kind::Choice(RENDERERS), risk: Risk::High, check: Some(common::api_check) },
    SettingSpec { key: "duckstation.resolution_scale", label: "Résolution interne", kind: Kind::Int { min: 1, max: 16 }, risk: Risk::Low, check: None },
    SettingSpec { key: "duckstation.texture_filter", label: "Filtrage des textures", kind: Kind::Choice(FILTERS), risk: Risk::Low, check: None },
    SettingSpec { key: "duckstation.msaa", label: "Anticrénelage (échantillons)", kind: Kind::Choice(MSAA), risk: Risk::Low, check: None },
    SettingSpec { key: "duckstation.ssaa", label: "Suréchantillonnage (SSAA)", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "duckstation.pgxp", label: "Correction géométrique PGXP", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "duckstation.pgxp_texture_correction", label: "Correction des textures PGXP", kind: Kind::Bool, risk: Risk::Low, check: None },
    SettingSpec { key: "duckstation.widescreen_hack", label: "Rendu panoramique (astuce)", kind: Kind::Bool, risk: Risk::Medium, check: None },
    SettingSpec { key: "duckstation.cpu_execution_mode", label: "Mode d'exécution du processeur", kind: Kind::Choice(CPU_MODES), risk: Risk::Medium, check: None },
    SettingSpec { key: "duckstation.cpu_overclock", label: "Surcadençage du processeur (%)", kind: Kind::Int { min: 10, max: 1000 }, risk: Risk::High, check: None },
    SettingSpec { key: "duckstation.cdrom_read_speedup", label: "Accélération de lecture du CD", kind: Kind::Int { min: 1, max: 6 }, risk: Risk::Medium, check: None },
    SettingSpec { key: "duckstation.cdrom_seek_speedup", label: "Accélération de recherche du CD", kind: Kind::Int { min: 1, max: 6 }, risk: Risk::Medium, check: None },
    SettingSpec { key: "duckstation.vsync", label: "Synchronisation verticale", kind: Kind::Bool, risk: Risk::Low, check: None },
];

fn slot(key: &str) -> Option<(&'static str, &'static str)> {
    Some(match key {
        "duckstation.renderer" => ("GPU", "Renderer"),
        "duckstation.resolution_scale" => ("GPU", "ResolutionScale"),
        "duckstation.texture_filter" => ("GPU", "TextureFilter"),
        "duckstation.msaa" => ("GPU", "Multisamples"),
        "duckstation.ssaa" => ("GPU", "PerSampleShading"),
        "duckstation.pgxp" => ("GPU", "PGXPEnable"),
        "duckstation.pgxp_texture_correction" => ("GPU", "PGXPTextureCorrection"),
        "duckstation.widescreen_hack" => ("GPU", "WidescreenHack"),
        "duckstation.cpu_execution_mode" => ("CPU", "ExecutionMode"),
        "duckstation.cdrom_read_speedup" => ("CDROM", "ReadSpeedup"),
        "duckstation.cdrom_seek_speedup" => ("CDROM", "SeekSpeedup"),
        "duckstation.vsync" => ("Display", "VSync"),
        _ => return None,
    })
}

/// Noms écrits par DuckStation (`s_gpu_renderer_names`, `s_texture_filter_names`, `s_cpu_execution_mode_names`).
const NAMES: &[(&str, &str, &str)] = &[
    ("duckstation.renderer", "vulkan", "Vulkan"),
    ("duckstation.renderer", "d3d11", "D3D11"),
    ("duckstation.renderer", "d3d12", "D3D12"),
    ("duckstation.renderer", "opengl", "OpenGL"),
    ("duckstation.renderer", "software", "Software"),
    ("duckstation.texture_filter", "nearest", "Nearest"),
    ("duckstation.texture_filter", "bilinear", "Bilinear"),
    ("duckstation.texture_filter", "bilinear_bin_alpha", "BilinearBinAlpha"),
    ("duckstation.texture_filter", "jinc2", "JINC2"),
    ("duckstation.texture_filter", "jinc2_bin_alpha", "JINC2BinAlpha"),
    ("duckstation.texture_filter", "xbr", "xBR"),
    ("duckstation.texture_filter", "xbr_bin_alpha", "xBRBinAlpha"),
    ("duckstation.cpu_execution_mode", "interpreter", "Interpreter"),
    ("duckstation.cpu_execution_mode", "cached_interpreter", "CachedInterpreter"),
    ("duckstation.cpu_execution_mode", "recompiler", "Recompiler"),
];

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a } else { gcd(b, a % b) }
}

/// Écritures INI d'un paramètre (le surcadençage occupe trois clés,
/// `Settings::CPUOverclockPercentToFraction`).
fn writes(s: &Setting) -> Option<Vec<Write>> {
    if s.key == "duckstation.cpu_overclock" {
        let Value::Int(pct) = s.value else { return None };
        if pct == 100 {
            return Some(vec![("CPU", "OverclockEnable", "false".into())]);
        }
        let g = gcd(pct, 100);
        return Some(vec![("CPU", "OverclockEnable", "true".into()), ("CPU", "OverclockNumerator", (pct / g).to_string()), ("CPU", "OverclockDenominator", (100 / g).to_string())]);
    }
    let (sec, key) = slot(&s.key)?;
    let v = match &s.value {
        Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),
        Value::Int(i) => i.to_string(),
        Value::Choice(c) if s.key == "duckstation.msaa" => MSAA.iter().find(|m| **m == c)?.to_string(),
        Value::Choice(c) => NAMES.iter().find(|(k, id, _)| *k == s.key && id == c)?.2.to_string(),
    };
    Some(vec![(sec, key, v)])
}

fn decode(key: &str, ini: &Ini) -> Option<Value> {
    if key == "duckstation.cpu_overclock" {
        let on = common::parse_bool(&ini.get("CPU", "OverclockEnable")?)?;
        if !on {
            return Some(Value::Int(100));
        }
        let n: i64 = ini.get("CPU", "OverclockNumerator")?.parse().ok()?;
        let d: i64 = ini.get("CPU", "OverclockDenominator")?.parse().ok()?;
        return (n >= 1 && d >= 1).then(|| Value::Int(n * 100 / d));
    }
    let (sec, k) = slot(key)?;
    let s = ini.get(sec, k)?;
    let spec = SPECS.iter().find(|p| p.key == key)?;
    match spec.kind {
        Kind::Bool => common::parse_bool(&s).map(Value::Bool),
        Kind::Int { .. } => s.parse().ok().map(Value::Int),
        Kind::Choice(_) if key == "duckstation.msaa" => MSAA.iter().find(|m| **m == s).map(|m| Value::Choice(m.to_string())),
        Kind::Choice(_) => NAMES.iter().find(|(k2, _, name)| *k2 == key && *name == s).map(|(_, id, _)| Value::Choice(id.to_string())),
    }
}

/// Premier disque de l'ensemble contenant `serial` (`discsets.yaml`), ou `serial`.
fn first_of_set(discsets: &str, serial: &str) -> String {
    let mut current: Vec<&str> = Vec::new();
    let mut in_serials = false;
    let mut sets: Vec<Vec<&str>> = Vec::new();
    for line in discsets.lines() {
        let l = line.split('#').next().unwrap_or_default().trim_end();
        if l.starts_with("- ") {
            sets.push(std::mem::take(&mut current));
            in_serials = false;
        } else if l == "  serials:" {
            in_serials = true;
        } else if let Some(s) = l.strip_prefix("    - ").filter(|_| in_serials) {
            current.push(s.trim());
        } else if l.starts_with("  ") && !l.starts_with("    ") {
            in_serials = false;
        }
    }
    sets.push(current);
    sets.into_iter().find(|s| s.contains(&serial)).and_then(|s| s.first().map(|f| f.to_string())).unwrap_or_else(|| serial.to_string())
}

/// Réglages imposés par la base de jeux de DuckStation pour ce numéro de série.
fn builtin_for(gamedb: &str, serial: &str) -> Vec<String> {
    let Some(entry) = common::yaml_entry(gamedb, serial) else { return Vec::new() };
    let traits = common::yaml_section(&entry, "traits");
    let has = |t: &str| traits.iter().any(|l| l.strip_prefix("- ").map(str::trim) == Some(t));
    let mut out: Vec<&str> = Vec::new();
    for (t, keys) in [
        ("ForceInterpreter", &["duckstation.cpu_execution_mode"][..]),
        ("ForceSoftwareRenderer", &["duckstation.renderer"]),
        ("DisableUpscaling", &["duckstation.resolution_scale", "duckstation.msaa", "duckstation.ssaa"]),
        ("DisableTextureFiltering", &["duckstation.texture_filter"]),
        ("DisableWidescreen", &["duckstation.widescreen_hack"]),
        ("DisablePGXP", &["duckstation.pgxp", "duckstation.pgxp_texture_correction"]),
        ("DisablePGXPTextureCorrection", &["duckstation.pgxp_texture_correction"]),
        ("DisableCDROMReadSpeedup", &["duckstation.cdrom_read_speedup"]),
        ("DisableCDROMSeekSpeedup", &["duckstation.cdrom_seek_speedup"]),
    ] {
        if has(t) {
            out.extend(keys);
        }
    }
    if common::yaml_section(&entry, "settings").iter().any(|l| l.starts_with("cpuOverclockPercent:")) {
        out.push("duckstation.cpu_overclock");
    }
    out.sort_unstable();
    out.dedup();
    out.into_iter().map(String::from).collect()
}

impl Adapter for DuckStation {
    fn id(&self) -> &'static str {
        "duckstation"
    }
    fn name(&self) -> &'static str {
        "DuckStation"
    }
    fn platforms(&self) -> &'static [&'static str] {
        &["ps1"]
    }
    fn specs(&self) -> &'static [SettingSpec] {
        SPECS
    }

    fn locate(&self, install: &Install) -> Result<Location, String> {
        let exe_dir = install.exe.parent().ok_or("emplacement de DuckStation invalide")?;
        let (root, portable) = if exe_dir.join("portable.txt").is_file() || exe_dir.join("settings.ini").is_file() {
            (exe_dir.to_path_buf(), true)
        } else {
            let docs = crate::emulators::requirements::documents().join("DuckStation");
            if docs.is_dir() {
                (docs, false)
            } else {
                let local = std::env::var("LOCALAPPDATA").map_err(|_| "dossier de configuration de DuckStation introuvable")?;
                (PathBuf::from(local).join("DuckStation"), false)
            }
        };
        let settings = root.join("settings.ini");
        if !settings.is_file() {
            return Err("dossier de configuration de DuckStation introuvable : lancez DuckStation une fois, puis réessayez".into());
        }
        if let Some(dir) = std::fs::read(&settings).ok().and_then(|b| Ini::parse(&b).ok()).and_then(|i| i.get("Folders", "GameSettings")) {
            if !dir.eq_ignore_ascii_case("gamesettings") {
                return Err("dossier des réglages par jeu personnalisé dans DuckStation : non pris en charge".into());
            }
        }
        Ok(Location { config_root: root, portable, version: install.version.clone() })
    }

    fn game_key(&self, game: &GameQuery, ctx: &KeyContext) -> Result<String, String> {
        if game.platform != "ps1" {
            return Err("console non gérée par DuckStation".into());
        }
        let serial = game.serial.as_deref().unwrap_or_default().trim().to_ascii_uppercase();
        if !common::valid_sony_serial(&serial) {
            return Err("numéro de série absent ou dans un format inattendu".into());
        }
        let exe_dir = ctx.install.exe.parent().ok_or("emplacement de DuckStation invalide")?;
        let sets = common::read_db(&exe_dir.join("resources").join("discsets.yaml")).ok_or("liste des jeux à plusieurs disques de DuckStation illisible (resources/discsets.yaml)")?;
        let first = first_of_set(&sets, &serial);
        if first == serial {
            return Ok(serial);
        }
        if !common::valid_sony_serial(&first) {
            return Err("ensemble de disques inattendu".into());
        }
        // `UseSeparateConfigForDiscSet` du premier disque : chaque disque a son fichier
        let separate = ctx
            .location
            .and_then(|l| std::fs::read(l.config_root.join("gamesettings").join(format!("{first}.ini"))).ok())
            .and_then(|b| Ini::parse(&b).ok())
            .and_then(|i| i.get("Main", "UseSeparateConfigForDiscSet"))
            .and_then(|v| common::parse_bool(&v))
            .unwrap_or(false);
        Ok(if separate { serial } else { first })
    }

    fn target(&self, loc: &Location, key: &str) -> (PathBuf, PathBuf, PathBuf) {
        let dir = loc.config_root.join("gamesettings");
        let file = dir.join(format!("{key}.ini"));
        (loc.config_root.clone(), dir, file)
    }

    fn read(&self, current: Option<&[u8]>) -> Result<Vec<Setting>, String> {
        common::read(current, SPECS, decode)
    }

    fn builtin_overrides(&self, install: &Install, key: &str) -> Vec<String> {
        let Some(db) = install.exe.parent().and_then(|d| common::read_db(&d.join("resources").join("gamedb.yaml"))) else { return Vec::new() };
        builtin_for(&db, key)
    }

    fn mode_of(&self, settings: &[Setting]) -> Option<Mode> {
        let get = |k: &str| settings.iter().find(|s| s.key == k).map(|s| &s.value);
        let Some(Value::Int(res)) = get("duckstation.resolution_scale") else { return None };
        let msaa = match get("duckstation.msaa") {
            Some(Value::Choice(c)) => c.parse::<i64>().unwrap_or(1),
            _ => 1,
        };
        Some(if *res >= 4 || msaa >= 4 {
            Mode::Quality
        } else if *res <= 1 && msaa <= 1 {
            Mode::Performance
        } else {
            Mode::Balanced
        })
    }

    fn render(&self, current: Option<&[u8]>, settings: &[Setting]) -> Result<(Vec<u8>, Vec<Change>), String> {
        common::render(current, settings, SPECS, writes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::{plan, verify};
    use crate::smartconfig::hardware::HardwareInfo;
    use std::path::Path;

    fn setting(k: &str, v: Value) -> Setting {
        Setting { key: k.into(), value: v }
    }

    fn portable() -> (tempfile::TempDir, Install) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("DuckStation");
        std::fs::create_dir_all(dir.join("resources")).unwrap();
        std::fs::write(dir.join("portable.txt"), b"").unwrap();
        std::fs::write(dir.join("settings.ini"), b"[Main]\nSettingsVersion = 3\n").unwrap();
        std::fs::write(dir.join("duckstation-qt-x64-ReleaseLTCG.exe"), b"MZ").unwrap();
        std::fs::write(dir.join("resources").join("discsets.yaml"), b"- name: \"Final Fantasy VII\"\n  saveName: \"Final Fantasy VII (USA)\"\n  serials:\n    - SCUS-94163\n    - SCUS-94164\n    - SCUS-94165\n- name: \"Autre\"\n  serials:\n    - SLUS-00001\n    - SLUS-00002\n").unwrap();
        std::fs::write(
            dir.join("resources").join("gamedb.yaml"),
            b"SCUS-94426:\n  name: \"Jeu\"\n  traits:\n    - DisableUpscaling # correctif\n    - ForcePGXPCPUMode\n  settings:\n    cpuOverclockPercent: 200\nSCUS-94163:\n  name: \"FF7\"\n",
        )
        .unwrap();
        (tmp, Install { profile_id: "duckstation".into(), exe: dir.join("duckstation-qt-x64-ReleaseLTCG.exe"), version: Some("0.1-9999".into()), core: None })
    }

    fn game(serial: &str) -> GameQuery {
        GameQuery { game_id: 1, platform: "ps1".into(), title: "Jeu".into(), serial: Some(serial.into()), region: None, id_confidence: 1.0 }
    }

    #[test]
    fn identifiant_et_ensembles_de_disques() {
        let (_t, inst) = portable();
        let loc = DuckStation.locate(&inst).unwrap();
        assert!(loc.portable);
        let ctx = KeyContext { install: &inst, location: Some(&loc), main_file: None };
        assert_eq!(DuckStation.game_key(&game("scus-94426"), &ctx), Ok("SCUS-94426".into()));
        // disque 2 : réglages du disque 1
        assert_eq!(DuckStation.game_key(&game("SCUS-94164"), &ctx), Ok("SCUS-94163".into()));
        // sauf si le disque 1 demande des réglages séparés
        let gs = loc.config_root.join("gamesettings");
        std::fs::create_dir_all(&gs).unwrap();
        std::fs::write(gs.join("SCUS-94163.ini"), b"[Main]\nUseSeparateConfigForDiscSet = true\n").unwrap();
        assert_eq!(DuckStation.game_key(&game("SCUS-94164"), &ctx), Ok("SCUS-94164".into()));
        for bad in ["../../x", "SLUS00594", "SCUS-9442", "SCUS-94426\r\n[GPU]"] {
            assert!(DuckStation.game_key(&game(bad), &ctx).is_err(), "{bad}");
        }
        std::fs::remove_file(inst.exe.parent().unwrap().join("resources").join("discsets.yaml")).unwrap();
        assert!(DuckStation.game_key(&game("SCUS-94426"), &ctx).is_err());
    }

    #[test]
    fn correctifs_de_la_base_preserves_et_valeurs_invalides() {
        let (_t, inst) = portable();
        let settings = vec![
            setting("duckstation.resolution_scale", Value::Int(4)),
            setting("duckstation.msaa", Value::Choice("4".into())),
            setting("duckstation.cpu_overclock", Value::Int(200)),
            setting("duckstation.pgxp", Value::Bool(true)),
            setting("duckstation.cdrom_read_speedup", Value::Int(0)),
            setting("duckstation.texture_filter", Value::Choice("Nearest".into())),
            setting("duckstation.memory_card", Value::Choice("PerGame".into())),
        ];
        let p = plan(&DuckStation, &inst, &game("SCUS-94426"), None, &settings, &HardwareInfo::default()).unwrap();
        let text = String::from_utf8(p.after.clone()).unwrap();
        assert_eq!(text, "[GPU]\r\nPGXPEnable = true\r\n");
        assert_eq!(p.changes.len(), 1);
        assert_eq!(p.skipped.iter().filter(|r| r.reason.contains("correctif")).count(), 3);
        assert_eq!(p.skipped.len(), 6);
        assert!(p.target.ends_with(Path::new("gamesettings").join("SCUS-94426.ini")));
    }

    #[test]
    fn surcadencage_lecture_et_verification() {
        let (_t, inst) = portable();
        let before = "[Main]\nUseSeparateConfigForDiscSet = false\n\n[Pad1]\nType = AnalogController\n";
        let s = [setting("duckstation.cpu_overclock", Value::Int(150)), setting("duckstation.renderer", Value::Choice("software".into())), setting("duckstation.vsync", Value::Bool(false))];
        let (after, changes) = DuckStation.render(Some(before.as_bytes()), &s).unwrap();
        let text = String::from_utf8(after.clone()).unwrap();
        assert!(text.starts_with("[Main]\nUseSeparateConfigForDiscSet = false\n\n[Pad1]\nType = AnalogController\n"));
        assert!(text.contains("[CPU]\nOverclockEnable = true\nOverclockNumerator = 3\nOverclockDenominator = 2\n"));
        assert!(text.contains("[GPU]\nRenderer = Software\n"));
        assert_eq!(changes.len(), 3);
        assert_eq!(changes[0].after, "OverclockEnable = true ; OverclockNumerator = 3 ; OverclockDenominator = 2");
        let read = DuckStation.read(Some(&after)).unwrap();
        for x in &s {
            assert!(read.contains(x), "{x:?}");
        }
        let (again, none) = DuckStation.render(Some(&after), &s).unwrap();
        assert_eq!(again, after);
        assert!(none.is_empty());
        let loc = DuckStation.locate(&inst).unwrap();
        let (_, dir, file) = DuckStation.target(&loc, "SCUS-94426");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&file, &after).unwrap();
        assert!(verify(&DuckStation, &file, &s));
        assert!(!verify(&DuckStation, &file, &[setting("duckstation.cpu_overclock", Value::Int(100))]));
        assert_eq!(DuckStation.mode_of(&[setting("duckstation.resolution_scale", Value::Int(1))]), Some(Mode::Performance));
    }
}
