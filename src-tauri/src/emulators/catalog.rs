//! Catalogue des émulateurs qu'iBox sait installer : source officielle,
//! archive attendue, exécutable, profil de lancement. Source de vérité côté
//! natif : le frontend ne fournit jamais d'URL, seulement un identifiant de
//! paquet de cette liste.
//!
//! Distributions vérifiées le 2026-11-17 (voir docs/PLATFORMS.md) :
//! GitHub Releases (empreinte SHA-256 publiée par GitHub pour chaque fichier),
//! API de mise à jour officielle de Dolphin, serveur officiel de libretro.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Archive {
    Zip,
    SevenZ,
}

/// Fichier attendu dans une release GitHub (comparaison sans casse).
#[derive(Debug, Clone, Copy)]
pub struct AssetMatch {
    pub starts: &'static str,
    pub ends: &'static str,
    pub excludes: &'static [&'static str],
}

impl AssetMatch {
    pub fn matches(&self, name: &str) -> bool {
        let n = name.to_lowercase();
        n.starts_with(&self.starts.to_lowercase())
            && n.ends_with(&self.ends.to_lowercase())
            && !self.excludes.iter().any(|x| n.contains(&x.to_lowercase()))
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Source {
    /// Dernière release stable (non « prerelease ») d'un dépôt GitHub officiel.
    GitHub { repo: &'static str, asset: AssetMatch },
    /// API de mise à jour officielle (dolphin-emu.org/update/latest/beta/).
    Dolphin,
    /// Dernière version stable sur buildbot.libretro.com.
    RetroArch,
    /// Cœur libretro du serveur officiel (même source que le « Online Updater » de RetroArch).
    LibretroCore { file: &'static str },
    /// Pas de distribution automatisable : parcours assisté vers le site officiel.
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Maturity {
    /// Émulation mûre : la grande majorité des jeux fonctionne.
    Mature,
    /// Bonne compatibilité, quelques jeux exigeants posent problème.
    Good,
    /// Projet expérimental : beaucoup de jeux ne démarrent pas encore.
    Experimental,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub id: &'static str,
    pub name: &'static str,
    /// Profil de lancement (launcher::profiles).
    pub profile_id: &'static str,
    #[serde(skip)]
    pub source: Source,
    pub archive: Archive,
    /// Noms possibles de l'exécutable principal (sans casse, nom exact).
    #[serde(skip)]
    pub exe: &'static [&'static str],
    pub platforms: &'static [&'static str],
    pub homepage: &'static str,
    pub docs: &'static str,
    pub compatibility: Option<&'static str>,
    pub license: &'static str,
    pub maturity: Maturity,
    /// Taille maximale acceptée pour le téléchargement (octets).
    #[serde(skip)]
    pub max_download: u64,
    /// Fichiers créés après installation pour que l'émulateur range ses données
    /// dans le dossier utilisateur habituel (et non à côté du programme).
    #[serde(skip)]
    pub markers: &'static [&'static str],
    /// Paquet requis avant celui-ci (cœur libretro → RetroArch).
    pub requires: Option<&'static str>,
    /// Installation automatique possible.
    pub automatic: bool,
}

const MB: u64 = 1024 * 1024;

const fn gh(repo: &'static str, starts: &'static str, ends: &'static str, excludes: &'static [&'static str]) -> Source {
    Source::GitHub { repo, asset: AssetMatch { starts, ends, excludes } }
}

pub const PACKAGES: &[Package] = &[
    Package {
        id: "ppsspp",
        name: "PPSSPP",
        profile_id: "ppsspp",
        source: gh("hrydgard/ppsspp", "PPSSPP-", "-Windows-x64.zip", &[]),
        archive: Archive::Zip,
        exe: &["PPSSPPWindows64.exe"],
        platforms: &["psp"],
        homepage: "https://www.ppsspp.org/",
        docs: "https://www.ppsspp.org/docs/getting-started/",
        compatibility: Some("https://report.ppsspp.org/games"),
        license: "GPL-2.0",
        maturity: Maturity::Mature,
        max_download: 200 * MB,
        // « installed.txt » : données dans Documents\PPSSPP (sinon « memstick » à côté du programme)
        markers: &["installed.txt"],
        requires: None,
        automatic: true,
    },
    Package {
        id: "duckstation",
        name: "DuckStation",
        profile_id: "duckstation",
        source: gh("stenzek/duckstation", "duckstation-windows-x64-release.zip", "duckstation-windows-x64-release.zip", &[]),
        archive: Archive::Zip,
        exe: &["duckstation-qt-x64-ReleaseLTCG.exe", "duckstation-qt-x64-Release.exe"],
        platforms: &["ps1"],
        homepage: "https://www.duckstation.org/",
        docs: "https://github.com/stenzek/duckstation/wiki",
        compatibility: Some("https://docs.google.com/spreadsheets/d/1H66MxViRjjE5f8hOl5RQmF5woS1murio2dsLn14kEqo"),
        license: "CC BY-NC-ND 4.0",
        maturity: Maturity::Mature,
        max_download: 400 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "pcsx2",
        name: "PCSX2",
        profile_id: "pcsx2",
        source: gh("PCSX2/pcsx2", "pcsx2-", "-windows-x64-Qt.7z", &["symbols"]),
        archive: Archive::SevenZ,
        exe: &["pcsx2-qt.exe"],
        platforms: &["ps2"],
        homepage: "https://pcsx2.net/",
        docs: "https://pcsx2.net/docs/",
        compatibility: Some("https://pcsx2.net/compat/"),
        license: "GPL-3.0",
        maturity: Maturity::Mature,
        max_download: 300 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "dolphin",
        name: "Dolphin",
        profile_id: "dolphin",
        source: Source::Dolphin,
        archive: Archive::SevenZ,
        exe: &["Dolphin.exe"],
        platforms: &["gamecube", "wii"],
        homepage: "https://dolphin-emu.org/",
        docs: "https://dolphin-emu.org/docs/guides/",
        compatibility: Some("https://dolphin-emu.org/compat/"),
        license: "GPL-2.0+",
        maturity: Maturity::Mature,
        max_download: 300 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "cemu",
        name: "Cemu",
        profile_id: "cemu",
        source: gh("cemu-project/Cemu", "cemu-", "-windows-x64.zip", &[]),
        archive: Archive::Zip,
        exe: &["Cemu.exe"],
        platforms: &["wiiu"],
        homepage: "https://cemu.info/",
        docs: "https://cemu.cfw.guide/",
        compatibility: Some("https://compat.cemu.info/"),
        license: "MPL-2.0",
        maturity: Maturity::Good,
        max_download: 300 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "melonds",
        name: "melonDS",
        profile_id: "melonds",
        source: gh("melonDS-emu/melonDS", "melonDS-", "-windows-x86_64.zip", &[]),
        archive: Archive::Zip,
        exe: &["melonDS.exe"],
        platforms: &["ds"],
        homepage: "https://melonds.kuribo64.net/",
        docs: "https://melonds.kuribo64.net/faq.php",
        compatibility: None,
        license: "GPL-3.0",
        maturity: Maturity::Mature,
        max_download: 150 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "azahar",
        name: "Azahar",
        profile_id: "azahar",
        source: gh("azahar-emu/azahar", "azahar-windows-msvc-", ".zip", &["installer", "libretro"]),
        archive: Archive::Zip,
        exe: &["azahar.exe"],
        platforms: &["3ds"],
        homepage: "https://azahar-emu.org/",
        docs: "https://azahar-emu.org/pages/faq/",
        compatibility: None,
        license: "GPL-2.0",
        maturity: Maturity::Good,
        max_download: 300 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "mgba",
        name: "mGBA",
        profile_id: "mgba",
        source: gh("mgba-emu/mgba", "mGBA-", "-win64.7z", &[]),
        archive: Archive::SevenZ,
        exe: &["mGBA.exe"],
        platforms: &["gba", "gb", "gbc"],
        homepage: "https://mgba.io/",
        docs: "https://mgba.io/faq.html",
        compatibility: None,
        license: "MPL-2.0",
        maturity: Maturity::Mature,
        max_download: 120 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "sameboy",
        name: "SameBoy",
        profile_id: "sameboy",
        source: gh("LIJI32/SameBoy", "sameboy_winsdl_", ".zip", &[]),
        archive: Archive::Zip,
        exe: &["sameboy.exe"],
        platforms: &["gb", "gbc"],
        homepage: "https://sameboy.github.io/",
        docs: "https://sameboy.github.io/features/",
        compatibility: None,
        license: "Expat (MIT)",
        maturity: Maturity::Mature,
        max_download: 60 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "mesen",
        name: "Mesen",
        profile_id: "mesen",
        source: gh("SourMesen/Mesen2", "Mesen_", "_Windows.zip", &[]),
        archive: Archive::Zip,
        exe: &["Mesen.exe"],
        platforms: &["nes", "snes"],
        homepage: "https://www.mesen.ca/",
        docs: "https://www.mesen.ca/docs/",
        compatibility: None,
        license: "GPL-3.0",
        maturity: Maturity::Mature,
        max_download: 150 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "rmg",
        name: "Rosalie's Mupen GUI",
        profile_id: "rmg",
        source: gh("Rosalie241/RMG", "RMG-Portable-Windows64-", ".zip", &[]),
        archive: Archive::Zip,
        exe: &["RMG.exe"],
        platforms: &["n64"],
        homepage: "https://github.com/Rosalie241/RMG",
        docs: "https://github.com/Rosalie241/RMG#readme",
        compatibility: None,
        license: "GPL-3.0",
        maturity: Maturity::Good,
        max_download: 250 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "rpcs3",
        name: "RPCS3",
        profile_id: "rpcs3",
        source: gh("RPCS3/rpcs3-binaries-win", "rpcs3-", "_win64_msvc.7z", &[".sha256"]),
        archive: Archive::SevenZ,
        exe: &["rpcs3.exe"],
        platforms: &["ps3"],
        homepage: "https://rpcs3.net/",
        docs: "https://rpcs3.net/quickstart",
        compatibility: Some("https://rpcs3.net/compatibility"),
        license: "GPL-2.0",
        maturity: Maturity::Good,
        max_download: 250 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "xemu",
        name: "xemu",
        profile_id: "xemu",
        source: gh("xemu-project/xemu", "xemu-win-x86_64-release", ".zip", &["pdb", "dbg"]),
        archive: Archive::Zip,
        exe: &["xemu.exe"],
        platforms: &["xbox"],
        homepage: "https://xemu.app/",
        docs: "https://xemu.app/docs/required-files/",
        compatibility: Some("https://xemu.app/titles/"),
        license: "GPL-2.0",
        maturity: Maturity::Good,
        max_download: 150 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "xenia",
        name: "Xenia Canary",
        profile_id: "xenia",
        source: gh("xenia-canary/xenia-canary-releases", "xenia_canary_windows", ".zip", &[]),
        archive: Archive::Zip,
        exe: &["xenia_canary.exe"],
        platforms: &["xbox360"],
        homepage: "https://xenia.jp/",
        docs: "https://github.com/xenia-canary/xenia-canary/wiki/Quickstart",
        compatibility: Some("https://github.com/xenia-canary/game-compatibility/issues"),
        license: "BSD-3-Clause",
        maturity: Maturity::Experimental,
        max_download: 100 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "vita3k",
        name: "Vita3K",
        profile_id: "vita3k",
        source: gh("Vita3K/Vita3K", "windows-latest", ".zip", &["arm64"]),
        archive: Archive::Zip,
        exe: &["Vita3K.exe"],
        platforms: &["vita"],
        homepage: "https://vita3k.org/",
        docs: "https://vita3k.org/quickstart.html",
        compatibility: Some("https://vita3k.org/compatibility.html"),
        license: "GPL-2.0",
        maturity: Maturity::Experimental,
        max_download: 200 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "shadps4",
        name: "shadPS4",
        profile_id: "shadps4",
        source: gh("shadps4-emu/shadPS4", "shadps4-win64-sdl-", ".zip", &[]),
        archive: Archive::Zip,
        exe: &["shadPS4.exe"],
        platforms: &["ps4"],
        homepage: "https://shadps4.net/",
        docs: "https://github.com/shadps4-emu/shadPS4#readme",
        compatibility: Some("https://github.com/shadps4-compatibility/shadps4-game-compatibility/issues"),
        license: "GPL-2.0",
        maturity: Maturity::Experimental,
        max_download: 200 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "flycast",
        name: "Flycast",
        profile_id: "flycast",
        source: gh("flyinghead/flycast", "flycast-win64-", ".zip", &[]),
        archive: Archive::Zip,
        exe: &["flycast.exe"],
        platforms: &["dreamcast"],
        homepage: "https://github.com/flyinghead/flycast",
        docs: "https://github.com/flyinghead/flycast/wiki",
        compatibility: None,
        license: "GPL-2.0",
        maturity: Maturity::Mature,
        max_download: 100 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "stella",
        name: "Stella",
        profile_id: "stella",
        source: gh("stella-emu/stella", "Stella-", "-windows.zip", &[]),
        archive: Archive::Zip,
        exe: &["Stella.exe"],
        platforms: &["atari2600"],
        homepage: "https://stella-emu.github.io/",
        docs: "https://stella-emu.github.io/docs/index.html",
        compatibility: None,
        license: "GPL-2.0",
        maturity: Maturity::Mature,
        max_download: 60 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "retroarch",
        name: "RetroArch",
        profile_id: "retroarch",
        source: Source::RetroArch,
        archive: Archive::SevenZ,
        exe: &["retroarch.exe"],
        platforms: &["megadrive", "mastersystem", "gamegear", "saturn", "arcade", "ps1", "ps2"],
        homepage: "https://www.retroarch.com/",
        docs: "https://docs.libretro.com/",
        compatibility: None,
        license: "GPL-3.0",
        maturity: Maturity::Mature,
        max_download: 450 * MB,
        markers: &[],
        requires: None,
        automatic: true,
    },
    Package {
        id: "core-genesis-plus-gx",
        name: "Genesis Plus GX",
        profile_id: "retroarch",
        source: Source::LibretroCore { file: "genesis_plus_gx_libretro.dll" },
        archive: Archive::Zip,
        exe: &[],
        platforms: &["megadrive", "mastersystem", "gamegear"],
        homepage: "https://github.com/libretro/Genesis-Plus-GX",
        docs: "https://docs.libretro.com/library/genesis_plus_gx/",
        compatibility: None,
        license: "Non commerciale (licence Genesis Plus GX)",
        maturity: Maturity::Mature,
        max_download: 40 * MB,
        markers: &[],
        requires: Some("retroarch"),
        automatic: true,
    },
    Package {
        id: "core-beetle-saturn",
        name: "Beetle Saturn",
        profile_id: "retroarch",
        source: Source::LibretroCore { file: "mednafen_saturn_libretro.dll" },
        archive: Archive::Zip,
        exe: &[],
        platforms: &["saturn"],
        homepage: "https://github.com/libretro/beetle-saturn-libretro",
        docs: "https://docs.libretro.com/library/beetle_saturn/",
        compatibility: None,
        license: "GPL-2.0",
        maturity: Maturity::Good,
        max_download: 40 * MB,
        markers: &[],
        requires: Some("retroarch"),
        automatic: true,
    },
    Package {
        id: "core-fbneo",
        name: "FinalBurn Neo",
        profile_id: "retroarch",
        source: Source::LibretroCore { file: "fbneo_libretro.dll" },
        archive: Archive::Zip,
        exe: &[],
        platforms: &["arcade"],
        homepage: "https://github.com/finalburnneo/FBNeo",
        docs: "https://docs.libretro.com/library/fbneo/",
        compatibility: None,
        license: "Non commerciale (licence FBNeo)",
        maturity: Maturity::Mature,
        max_download: 80 * MB,
        markers: &[],
        requires: Some("retroarch"),
        automatic: true,
    },
    // Cœurs sans BIOS (0.1.72) : le BIOS de la console est remplacé par une
    // réimplémentation libre (HLE), rien à extraire d'une console.
    Package {
        id: "core-play",
        name: "Play!",
        profile_id: "retroarch",
        source: Source::LibretroCore { file: "play_libretro.dll" },
        archive: Archive::Zip,
        exe: &[],
        platforms: &["ps2"],
        homepage: "https://purei.org/",
        docs: "https://docs.libretro.com/library/play/",
        compatibility: Some("https://playcompatibility.com/"),
        license: "BSD-2-Clause",
        maturity: Maturity::Good,
        max_download: 60 * MB,
        markers: &[],
        requires: Some("retroarch"),
        automatic: true,
    },
    Package {
        id: "core-pcsx-rearmed",
        name: "PCSX ReARMed",
        profile_id: "retroarch",
        source: Source::LibretroCore { file: "pcsx_rearmed_libretro.dll" },
        archive: Archive::Zip,
        exe: &[],
        platforms: &["ps1"],
        homepage: "https://github.com/libretro/pcsx_rearmed",
        docs: "https://docs.libretro.com/library/pcsx_rearmed/",
        compatibility: None,
        license: "GPL-2.0",
        maturity: Maturity::Mature,
        max_download: 40 * MB,
        markers: &[],
        requires: Some("retroarch"),
        automatic: true,
    },
    Package {
        id: "core-yabause",
        name: "Yabause",
        profile_id: "retroarch",
        source: Source::LibretroCore { file: "yabause_libretro.dll" },
        archive: Archive::Zip,
        exe: &[],
        platforms: &["saturn"],
        homepage: "https://github.com/libretro/yabause",
        docs: "https://docs.libretro.com/library/yabause/",
        compatibility: None,
        license: "GPL-2.0",
        maturity: Maturity::Good,
        max_download: 40 * MB,
        markers: &[],
        requires: Some("retroarch"),
        automatic: true,
    },
    Package {
        id: "bigpemu",
        name: "BigPEmu",
        profile_id: "bigpemu",
        source: Source::Manual,
        archive: Archive::Zip,
        exe: &["BigPEmu.exe"],
        platforms: &["jaguar"],
        homepage: "https://www.richwhitehouse.com/jaguar/",
        docs: "https://www.richwhitehouse.com/jaguar/index.php?content=faq",
        compatibility: None,
        license: "Propriétaire, gratuit",
        maturity: Maturity::Mature,
        max_download: 0,
        markers: &[],
        requires: None,
        automatic: false,
    },
    Package {
        id: "mame",
        name: "MAME",
        profile_id: "mame",
        source: Source::Manual,
        archive: Archive::SevenZ,
        exe: &["mame.exe"],
        platforms: &["arcade"],
        homepage: "https://www.mamedev.org/",
        docs: "https://docs.mamedev.org/",
        compatibility: None,
        license: "GPL-2.0+",
        maturity: Maturity::Mature,
        max_download: 0,
        markers: &[],
        requires: None,
        automatic: false,
    },
];

pub fn package(id: &str) -> Option<&'static Package> {
    PACKAGES.iter().find(|p| p.id == id)
}

/// Hôtes officiels autorisés (téléchargement et redirections).
pub const ALLOWED_HOSTS: &[&str] = &[
    "api.github.com",
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "dolphin-emu.org",
    "dl.dolphin-emu.org",
    "buildbot.libretro.com",
];

pub fn host_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiants_uniques_et_profils_connus() {
        let mut ids: Vec<&str> = PACKAGES.iter().map(|p| p.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), PACKAGES.len());
        for p in PACKAGES {
            assert_eq!(crate::launcher::profiles::profile(p.profile_id).id, p.profile_id, "profil manquant pour {}", p.id);
            if let Some(r) = p.requires {
                assert!(package(r).is_some());
            }
        }
    }

    #[test]
    fn noms_de_fichiers_des_releases_reelles() {
        let pick = |id: &str| match package(id).unwrap().source {
            Source::GitHub { asset, .. } => asset,
            _ => unreachable!(),
        };
        assert!(pick("ppsspp").matches("PPSSPP-v1.20.4-Windows-x64.zip"));
        assert!(!pick("ppsspp").matches("PPSSPP-v1.20.4-Windows-ARM64.zip"));
        assert!(pick("pcsx2").matches("pcsx2-v2.9.181-windows-x64-Qt.7z"));
        assert!(!pick("pcsx2").matches("pcsx2-v2.9.181-windows-x64-Qt-symbols.7z"));
        assert!(pick("azahar").matches("azahar-windows-msvc-2126.2.zip"));
        assert!(!pick("azahar").matches("azahar-windows-msvc-2126.2-installer.exe"));
        assert!(pick("rpcs3").matches("rpcs3-v0.0.43-20607-fb6737b1_win64_msvc.7z"));
        assert!(!pick("rpcs3").matches("rpcs3-v0.0.43-20607-fb6737b1_win64_msvc.7z.sha256"));
        assert!(pick("xenia").matches("xenia_canary_windows_.zip"));
        assert!(pick("xemu").matches("xemu-win-x86_64-release.zip"));
        assert!(!pick("xemu").matches("xemu-0.8.139-windows-x86_64-pdb.zip"));
        assert!(pick("duckstation").matches("duckstation-windows-x64-release.zip"));
        assert!(!pick("duckstation").matches("duckstation-windows-x64-sse2-release.zip"));
        assert!(pick("melonds").matches("melonDS-1.1-windows-x86_64.zip"));
        assert!(pick("vita3k").matches("windows-latest.zip"));
        assert!(!pick("vita3k").matches("windows-arm64-latest.zip"));
    }

    #[test]
    fn seules_les_sources_officielles_en_https() {
        assert!(host_allowed(&"https://github.com/a/b".parse().unwrap()));
        assert!(!host_allowed(&"http://github.com/a/b".parse().unwrap()));
        assert!(!host_allowed(&"https://github.com.evil.io/a".parse().unwrap()));
        assert!(!host_allowed(&"https://example.com/x.zip".parse().unwrap()));
    }
}
