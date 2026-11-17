//! Profils de lancement (vérifiés dans le code source de chaque émulateur,
//! voir docs/EMULATORS.md) et construction des arguments.
//!
//! Sécurité : les arguments forment une liste passée telle quelle au
//! processus — jamais une ligne de commande interprétée par un shell. Le
//! chemin du jeu remplace `{rom}` comme argument entier : un nom de fichier
//! contenant des espaces, des guillemets ou `&` ne peut rien déclencher.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: &'static str,
    pub name: &'static str,
    /// Noms d'exécutables reconnus (préfixes, sans casse).
    #[serde(skip)]
    pub exe_prefixes: &'static [&'static str],
    /// Consoles proposées par défaut.
    pub platforms: &'static [&'static str],
    /// Modèle d'arguments : `{rom}`, `{fullscreen}`, `{core}`.
    pub args: &'static [&'static str],
    /// Arguments insérés à la place de `{fullscreen}` quand le plein écran est demandé.
    pub fullscreen: &'static [&'static str],
    /// Nécessite un cœur libretro par console.
    pub needs_core: bool,
}

pub const PROFILES: &[Profile] = &[
    Profile {
        id: "cemu",
        name: "Cemu",
        exe_prefixes: &["cemu"],
        platforms: &["wiiu"],
        // -g : jeu à lancer ; -f : plein écran
        args: &["{fullscreen}", "-g", "{rom}"],
        fullscreen: &["-f"],
        needs_core: false,
    },
    Profile {
        id: "dolphin",
        name: "Dolphin",
        exe_prefixes: &["dolphin"],
        platforms: &["gamecube", "wii"],
        // -b : sans interface, quitte quand le jeu s'arrête ; -e : fichier à lancer
        args: &["-b", "{fullscreen}", "-e", "{rom}"],
        fullscreen: &["-C", "Dolphin.Display.Fullscreen=True"],
        needs_core: false,
    },
    Profile {
        id: "melonds",
        name: "melonDS",
        exe_prefixes: &["melonds"],
        platforms: &["ds"],
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["-f"],
        needs_core: false,
    },
    Profile {
        id: "pcsx2",
        name: "PCSX2",
        exe_prefixes: &["pcsx2-qt", "pcsx2"],
        platforms: &["ps2"],
        // -batch : quitte à l'arrêt ; « -- » : fin des options avant le fichier
        args: &["-batch", "{fullscreen}", "--", "{rom}"],
        fullscreen: &["-fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "duckstation",
        name: "DuckStation",
        exe_prefixes: &["duckstation"],
        platforms: &["ps1"],
        args: &["-batch", "{fullscreen}", "--", "{rom}"],
        fullscreen: &["-fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "ppsspp",
        name: "PPSSPP",
        exe_prefixes: &["ppssppwindows", "ppsspp"],
        platforms: &["psp"],
        // --pause-menu-exit : quitte à la fin du jeu au lieu de revenir au menu
        args: &["--pause-menu-exit", "{fullscreen}", "{rom}"],
        fullscreen: &["--fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "mgba",
        name: "mGBA",
        exe_prefixes: &["mgba"],
        platforms: &["gb", "gbc", "gba"],
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["-f"],
        needs_core: false,
    },
    Profile {
        id: "azahar",
        name: "Azahar",
        // successeur de Citra et Lime3DS (même interface en ligne de commande)
        exe_prefixes: &["azahar", "citra-qt", "citra", "lime3ds"],
        platforms: &["3ds"],
        // fichier en argument positionnel ; -f / --fullscreen (src/citra_qt/citra_qt.cpp)
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["-f"],
        needs_core: false,
    },
    Profile {
        id: "lichii",
        name: "Lichii",
        exe_prefixes: &["lichii"],
        platforms: &["switch2", "switch"],
        // -g : jeu à lancer ; -f : plein écran (src/core/launch_params.cpp)
        args: &["{fullscreen}", "-g", "{rom}"],
        fullscreen: &["-f"],
        needs_core: false,
    },
    // — iBox Platforms (options vérifiées dans le code source, 2026-11-17) —
    Profile {
        id: "mesen",
        name: "Mesen",
        exe_prefixes: &["mesen"],
        platforms: &["nes", "snes"],
        // UI/Utilities/CommandLineHelper.cs : fichier positionnel, « --fullscreen »
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["--fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "rmg",
        name: "Rosalie's Mupen GUI",
        exe_prefixes: &["rmg"],
        platforms: &["n64"],
        // Source/RMG/main.cpp : -q quitte à la fin de l'émulation, -f plein écran, ROM positionnelle
        args: &["-q", "{fullscreen}", "{rom}"],
        fullscreen: &["-f"],
        needs_core: false,
    },
    Profile {
        id: "sameboy",
        name: "SameBoy",
        exe_prefixes: &["sameboy"],
        platforms: &["gb", "gbc"],
        // SDL/main.c : « --fullscreen » / « -f »
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["--fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "xemu",
        name: "xemu",
        exe_prefixes: &["xemu"],
        platforms: &["xbox"],
        // system/vl.c : -dvd_path ; option QEMU -full-screen
        args: &["{fullscreen}", "-dvd_path", "{rom}"],
        fullscreen: &["-full-screen"],
        needs_core: false,
    },
    Profile {
        id: "xenia",
        name: "Xenia Canary",
        exe_prefixes: &["xenia_canary", "xenia"],
        platforms: &["xbox360"],
        // src/xenia/app/emulator_window.cc : DEFINE_bool(fullscreen) ; cible positionnelle
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["--fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "rpcs3",
        name: "RPCS3",
        exe_prefixes: &["rpcs3"],
        platforms: &["ps3"],
        // rpcs3/rpcs3.cpp : « no-gui », « fullscreen » (seulement avec no-gui)
        args: &["--no-gui", "{fullscreen}", "{rom}"],
        fullscreen: &["--fullscreen"],
        needs_core: false,
    },
    Profile {
        id: "vita3k",
        name: "Vita3K",
        exe_prefixes: &["vita3k"],
        // les jeux s'installent dans Vita3K puis se lancent depuis son interface
        platforms: &[],
        args: &["{rom}"],
        fullscreen: &[],
        needs_core: false,
    },
    Profile {
        id: "shadps4",
        name: "shadPS4",
        exe_prefixes: &["shadps4"],
        platforms: &[],
        // src/main.cpp : -g/--game, -f/--fullscreen true|false
        args: &["{fullscreen}", "-g", "{rom}"],
        fullscreen: &["-f", "true"],
        needs_core: false,
    },
    Profile {
        id: "flycast",
        name: "Flycast",
        exe_prefixes: &["flycast"],
        platforms: &["dreamcast"],
        // core/cfg/cl.cpp : -config section:clé=valeur ; fichier positionnel
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["-config", "window:fullscreen=yes"],
        needs_core: false,
    },
    Profile {
        id: "stella",
        name: "Stella",
        exe_prefixes: &["stella"],
        platforms: &["atari2600"],
        args: &["{fullscreen}", "{rom}"],
        fullscreen: &["-fullscreen", "1"],
        needs_core: false,
    },
    Profile {
        id: "bigpemu",
        name: "BigPEmu",
        exe_prefixes: &["bigpemu"],
        platforms: &["jaguar"],
        args: &["{rom}"],
        fullscreen: &[],
        needs_core: false,
    },
    Profile {
        id: "mame",
        name: "MAME",
        exe_prefixes: &["mame"],
        platforms: &[],
        args: &["{rom}"],
        fullscreen: &[],
        needs_core: false,
    },
    Profile {
        id: "retroarch",
        name: "RetroArch",
        exe_prefixes: &["retroarch"],
        platforms: &["n64", "snes", "gb", "gbc", "gba", "ds", "ps1", "ps2", "psp", "nes", "megadrive", "mastersystem", "gamegear", "saturn", "atari2600", "dreamcast"],
        args: &["{fullscreen}", "-L", "{core}", "{rom}"],
        fullscreen: &["-f"],
        needs_core: true,
    },
    Profile {
        id: "custom",
        name: "Personnalisé",
        exe_prefixes: &[],
        platforms: &[],
        args: &["{rom}"],
        fullscreen: &[],
        needs_core: false,
    },
];

/// Cœurs libretro suggérés (fichiers du dossier `cores` de RetroArch).
pub fn suggested_cores(platform: &str) -> &'static [&'static str] {
    match platform {
        "n64" => &["mupen64plus_next_libretro.dll", "parallel_n64_libretro.dll"],
        "snes" => &["snes9x_libretro.dll", "bsnes_libretro.dll"],
        "gb" | "gbc" => &["gambatte_libretro.dll", "sameboy_libretro.dll", "mgba_libretro.dll"],
        "gba" => &["mgba_libretro.dll", "vbam_libretro.dll"],
        "ds" => &["melondsds_libretro.dll", "melonds_libretro.dll", "desmume_libretro.dll"],
        "ps1" => &["pcsx_rearmed_libretro.dll", "swanstation_libretro.dll", "mednafen_psx_hw_libretro.dll"],
        "ps2" => &["play_libretro.dll"],
        "psp" => &["ppsspp_libretro.dll"],
        "nes" => &["mesen_libretro.dll", "nestopia_libretro.dll", "fceumm_libretro.dll"],
        "megadrive" | "mastersystem" | "gamegear" => &["genesis_plus_gx_libretro.dll", "picodrive_libretro.dll"],
        "saturn" => &["yabause_libretro.dll", "mednafen_saturn_libretro.dll"],
        "atari2600" => &["stella_libretro.dll", "stella2014_libretro.dll"],
        "dreamcast" => &["flycast_libretro.dll"],
        "arcade" => &["fbneo_libretro.dll"],
        _ => &[],
    }
}

pub fn profile(id: &str) -> &'static Profile {
    PROFILES.iter().find(|p| p.id == id).unwrap_or_else(|| PROFILES.iter().find(|p| p.id == "custom").expect("profil personnalisé"))
}

/// Profil d'après le nom de l'exécutable (« Dolphin.exe » → dolphin).
pub fn detect_profile(exe_file_name: &str) -> &'static Profile {
    let lower = exe_file_name.to_lowercase();
    PROFILES
        .iter()
        .find(|p| p.exe_prefixes.iter().any(|prefix| lower.starts_with(prefix)))
        .unwrap_or_else(|| profile("custom"))
}

#[derive(Debug, PartialEq)]
pub enum ArgsError {
    MissingRom,
    MissingCore,
}

/// Construit la liste d'arguments. `{rom}` et `{core}` doivent être des
/// arguments entiers ; `{fullscreen}` se développe en zéro ou plusieurs arguments.
pub fn build_args(template: &[String], fullscreen: Option<&[&str]>, rom: &str, core: Option<&str>) -> Result<Vec<String>, ArgsError> {
    if !template.iter().any(|a| a == "{rom}") {
        return Err(ArgsError::MissingRom);
    }
    let mut out = Vec::with_capacity(template.len() + 2);
    for token in template {
        match token.as_str() {
            "{rom}" => out.push(rom.to_string()),
            "{fullscreen}" => out.extend(fullscreen.unwrap_or(&[]).iter().map(|s| s.to_string())),
            "{core}" => out.push(core.ok_or(ArgsError::MissingCore)?.to_string()),
            other => out.push(other.to_string()),
        }
    }
    Ok(out)
}

/// Découpe une saisie de l'utilisateur en arguments (espaces, guillemets doubles).
/// Aucun caractère n'a de sens spécial au-delà des guillemets : pas de shell.
pub fn split_args(input: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut has_token = false;
    for c in input.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                has_token = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has_token {
                    out.push(std::mem::take(&mut current));
                    has_token = false;
                }
            }
            c => {
                current.push(c);
                has_token = true;
            }
        }
    }
    if has_token {
        out.push(current);
    }
    out
}

/// Affichage d'une liste d'arguments (guillemets si nécessaire).
pub fn join_args(args: &[String]) -> String {
    args.iter()
        .map(|a| if a.is_empty() || a.chars().any(char::is_whitespace) { format!("\"{a}\"") } else { a.clone() })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn detection_par_nom_d_executable() {
        assert_eq!(detect_profile("Dolphin.exe").id, "dolphin");
        assert_eq!(detect_profile("pcsx2-qtx64-avx2.exe").id, "pcsx2");
        assert_eq!(detect_profile("duckstation-qt-x64-ReleaseLTCG.exe").id, "duckstation");
        assert_eq!(detect_profile("PPSSPPWindows64.exe").id, "ppsspp");
        assert_eq!(detect_profile("melonDS.exe").id, "melonds");
        assert_eq!(detect_profile("retroarch.exe").id, "retroarch");
        assert_eq!(detect_profile("azahar.exe").id, "azahar");
        assert_eq!(detect_profile("citra-qt.exe").id, "azahar");
        assert_eq!(detect_profile("lichii.exe").id, "lichii");
        assert_eq!(detect_profile("Mesen.exe").id, "mesen");
        assert_eq!(detect_profile("RMG.exe").id, "rmg");
        assert_eq!(detect_profile("xenia_canary.exe").id, "xenia");
        assert_eq!(detect_profile("rpcs3.exe").id, "rpcs3");
        assert_eq!(detect_profile("flycast.exe").id, "flycast");
        assert_eq!(detect_profile("Stella.exe").id, "stella");
        assert_eq!(detect_profile("eden-cli.exe").id, "custom");
        assert_eq!(detect_profile("notepad.exe").id, "custom");
    }

    #[test]
    fn profils_dolphin_et_pcsx2() {
        let d = profile("dolphin");
        let args = build_args(&t(d.args), Some(d.fullscreen), r"D:\Jeux\Pikmin (Europe).iso", None).unwrap();
        assert_eq!(args, t(&["-b", "-C", "Dolphin.Display.Fullscreen=True", "-e", r"D:\Jeux\Pikmin (Europe).iso"]));
        let p = profile("pcsx2");
        assert_eq!(build_args(&t(p.args), None, "x.iso", None).unwrap(), t(&["-batch", "--", "x.iso"]));
    }

    #[test]
    fn noms_de_fichiers_pieges_restent_un_seul_argument() {
        let rom = r#"D:\Jeux\Tom & Jerry "Edition" -fullscreen; del C:\*.iso"#;
        let args = build_args(&t(&["{rom}"]), None, rom, None).unwrap();
        assert_eq!(args, vec![rom.to_string()]);
    }

    #[test]
    fn retroarch_exige_un_coeur() {
        let r = profile("retroarch");
        assert_eq!(build_args(&t(r.args), None, "mario.z64", None), Err(ArgsError::MissingCore));
        assert_eq!(
            build_args(&t(r.args), Some(r.fullscreen), "mario.z64", Some(r"C:\RA\cores\mupen64plus_next_libretro.dll")).unwrap(),
            t(&["-f", "-L", r"C:\RA\cores\mupen64plus_next_libretro.dll", "mario.z64"])
        );
    }

    #[test]
    fn modele_sans_jeu_refuse() {
        assert_eq!(build_args(&t(&["-f"]), None, "x", None), Err(ArgsError::MissingRom));
    }

    #[test]
    fn decoupage_de_la_saisie() {
        assert_eq!(split_args(r#"-f  --config "C:\Mes jeux\a.cfg" {rom}"#), t(&["-f", "--config", r"C:\Mes jeux\a.cfg", "{rom}"]));
        assert_eq!(split_args(r#""" {rom}"#), t(&["", "{rom}"]));
        assert_eq!(join_args(&t(&["-e", r"D:\Mes jeux\a.iso"])), r#"-e "D:\Mes jeux\a.iso""#);
    }
}
