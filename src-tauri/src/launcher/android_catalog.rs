//! Ce qu'iBox sait des émulateurs Android en plus de la table d'ES-DE (docs/ANDROID.md §9) :
//! où les installer (Play Store, versions GitHub officielles, site, Obtainium), ce qu'ils demandent
//! au premier démarrage, et les BIOS attendus par console avec leur vérification.
//!
//! Android interdit l'installation silencieuse : iBox ouvre la page choisie, l'utilisateur confirme.
//! Les BIOS restent dans les dossiers de l'utilisateur : iBox ne télécharge ni ne copie rien, il
//! vérifie leur présence par nom et taille.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Sources officielles d'un émulateur (clé ES-DE : `RETROARCH`, `DOLPHIN`…).
pub struct Info {
    pub key: &'static str,
    /// Paquet du Play Store.
    pub play: Option<&'static str>,
    /// Dépôt GitHub des versions officielles (« propriétaire/dépôt »).
    pub github: Option<&'static str>,
    /// Page de téléchargement du site officiel.
    pub site: Option<&'static str>,
    /// Ce que l'émulateur demande au premier démarrage, ou ce qu'il faut savoir.
    pub note: Option<&'static str>,
    /// BIOS sans lesquels il ne démarre pas (identifiants de `BIOS`).
    pub needs_bios: &'static [&'static str],
}

const fn info(key: &'static str) -> Info {
    Info { key, play: None, github: None, site: None, note: None, needs_bios: &[] }
}

/// Émulateurs les plus courants ; les autres de la table d'ES-DE n'ont qu'une recherche Play Store.
pub const INFOS: &[Info] = &[
    Info {
        play: Some("com.retroarch"),
        site: Some("https://www.retroarch.com/?page=platforms"),
        note: Some("Chaque console a besoin de son cœur : dans RetroArch, Menu principal › Mise à jour en ligne › Télécharger des cœurs."),
        ..info("RETROARCH")
    },
    Info {
        play: Some("org.dolphinemu.dolphinemu"),
        site: Some("https://dolphin-emu.org/download/"),
        note: Some("Au premier démarrage, Dolphin demande l'accès aux fichiers : acceptez."),
        ..info("DOLPHIN")
    },
    Info { play: Some("org.ppsspp.ppsspp"), site: Some("https://www.ppsspp.org/download/"), ..info("PPSSPP") },
    Info {
        play: Some("com.github.stenzek.duckstation"),
        site: Some("https://www.duckstation.org/"),
        note: Some("DuckStation a besoin d'un BIOS PlayStation : au premier démarrage, indiquez le dossier qui le contient."),
        needs_bios: &["ps1-bios"],
        ..info("DUCKSTATION")
    },
    Info {
        github: Some("Trixarian/NetherSX2-patch"),
        note: Some("NetherSX2 demande d'importer un BIOS PlayStation 2 au premier démarrage."),
        needs_bios: &["ps2-bios"],
        ..info("NETHERSX2")
    },
    Info { note: Some("Importez un BIOS PlayStation 2 au premier démarrage."), needs_bios: &["ps2-bios"], ..info("ARMSX2") },
    Info {
        play: Some("org.azahar_emu.azahar"),
        github: Some("azahar-emu/azahar"),
        note: Some("Au premier démarrage, Azahar demande l'accès à tous les fichiers et un dossier utilisateur : accordez les deux, sinon il se ferme au lancement d'un jeu."),
        ..info("AZAHAR")
    },
    Info {
        play: Some("me.magnum.melonds"),
        github: Some("rafaelvcaetano/melonDS-android"),
        note: Some("Fonctionne sans BIOS ; les BIOS de la DS améliorent la compatibilité."),
        ..info("MELONDS")
    },
    Info {
        play: Some("com.flycast.emulator"),
        github: Some("flyinghead/flycast"),
        note: Some("Fonctionne sans BIOS ; le BIOS de la Dreamcast est conseillé pour certains jeux."),
        ..info("FLYCAST")
    },
    Info { play: Some("io.recompiled.redream"), site: Some("https://redream.io/download"), ..info("REDREAM") },
    Info { play: Some("com.dsemu.drastic"), ..info("DRASTIC") },
    Info { play: Some("org.mupen64plusae.v3.fzurita"), ..info("M64PLUS-FZ") },
    Info { github: Some("mupen64plus-ae/mupen64plus-ae"), ..info("MUPEN64PLUS-AE") },
    Info { play: Some("com.epsxe.ePSXe"), ..info("EPSXE") },
];

pub fn info_of(key: &str) -> Option<&'static Info> {
    INFOS.iter().find(|i| i.key == key)
}

/// Lien d'installation proposé à l'utilisateur.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// `play`, `github`, `obtainium`, `site`, `search`.
    pub kind: &'static str,
    pub url: String,
}

/// Où installer un émulateur. `obtainium` : Obtainium est installé (suivi des versions GitHub).
pub fn sources(key: &str, name: &str, obtainium: bool) -> Vec<Source> {
    let mut out = Vec::new();
    let Some(i) = info_of(key) else {
        let q: String = name.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '+' }).collect();
        out.push(Source { kind: "search", url: format!("https://play.google.com/store/search?q={q}&c=apps") });
        return out;
    };
    if let Some(p) = i.play {
        out.push(Source { kind: "play", url: format!("https://play.google.com/store/apps/details?id={p}") });
    }
    if let Some(g) = i.github {
        out.push(Source { kind: "github", url: format!("https://github.com/{g}/releases") });
        if obtainium {
            out.push(Source { kind: "obtainium", url: format!("obtainium://add/https://github.com/{g}") });
        }
    }
    if let Some(s) = i.site {
        out.push(Source { kind: "site", url: s.to_string() });
    }
    out
}

/// Paquets d'Obtainium (versions F-Droid et GitHub).
pub const OBTAINIUM: &[&str] = &["dev.imranr.obtainium/dev.imranr.obtainium.MainActivity", "dev.imranr.obtainium.fdroid/dev.imranr.obtainium.MainActivity"];

/// Adresses qu'iBox accepte d'ouvrir (pages d'installation) : jamais un fichier ni un schéma inconnu.
pub fn openable(url: &str) -> bool {
    (url.starts_with("https://") && !url.contains(char::is_whitespace)) || url.starts_with("obtainium://add/https://") || url.starts_with("market://details?id=")
}

// ——— BIOS ———

/// Un BIOS attendu. `names` vides : n'importe quel `.bin` de la bonne taille (les BIOS PlayStation
/// ont des noms de modèle variés).
pub struct Bios {
    pub id: &'static str,
    pub platform: &'static str,
    pub names: &'static [&'static str],
    pub sizes: &'static [u64],
    /// Indispensable pour au moins un émulateur de la console (sinon conseillé).
    pub required: bool,
}

const KIB: u64 = 1024;

pub const BIOS: &[Bios] = &[
    Bios { id: "ps1-bios", platform: "ps1", names: &[], sizes: &[512 * KIB], required: true },
    Bios { id: "ps2-bios", platform: "ps2", names: &[], sizes: &[4096 * KIB, 8192 * KIB], required: true },
    Bios { id: "saturn-bios", platform: "saturn", names: &["sega_101.bin", "mpr-17933.bin"], sizes: &[512 * KIB], required: false },
    Bios { id: "dreamcast-bios", platform: "dreamcast", names: &["dc_boot.bin"], sizes: &[2048 * KIB], required: false },
    Bios { id: "ds-bios7", platform: "ds", names: &["bios7.bin"], sizes: &[16 * KIB], required: false },
    Bios { id: "ds-bios9", platform: "ds", names: &["bios9.bin"], sizes: &[4 * KIB], required: false },
    Bios { id: "ds-firmware", platform: "ds", names: &["firmware.bin"], sizes: &[256 * KIB, 512 * KIB], required: false },
    Bios { id: "gba-bios", platform: "gba", names: &["gba_bios.bin"], sizes: &[16 * KIB], required: false },
];

/// Dossiers où iBox cherche les BIOS : ceux choisis par l'utilisateur (celui de la console, puis
/// celui de toutes les consoles), puis le dossier système de RetroArch et `BIOS` à la racine de la
/// mémoire interne.
pub fn bios_dirs_for(chosen: &[&Path]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    for d in chosen {
        if !dirs.iter().any(|x| x == d) {
            dirs.push(d.to_path_buf());
        }
    }
    for d in bios_dirs(None) {
        if !dirs.contains(&d) {
            dirs.push(d);
        }
    }
    dirs
}

/// Dossiers par défaut (voir `bios_dirs_for`), précédés de `user`.
pub fn bios_dirs(user: Option<&Path>) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = user.map(Path::to_path_buf).into_iter().collect();
    for d in ["/storage/emulated/0/RetroArch/system", "/storage/emulated/0/BIOS"] {
        let p = PathBuf::from(d);
        if !dirs.contains(&p) {
            dirs.push(p);
        }
    }
    dirs
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BiosState {
    pub id: &'static str,
    pub required: bool,
    /// Noms attendus (vide : n'importe quel nom).
    pub names: Vec<&'static str>,
    /// Fichier trouvé.
    pub found: Option<String>,
}

fn matches(b: &Bios, path: &Path) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let size_ok = std::fs::metadata(path).is_ok_and(|m| m.is_file() && b.sizes.contains(&m.len()));
    if b.names.is_empty() {
        size_ok && name.ends_with(".bin")
    } else {
        size_ok && b.names.iter().any(|n| *n == name)
    }
}

/// BIOS d'une console et ce qu'iBox en trouve dans `dirs`.
pub fn bios_for(platform: &str, dirs: &[PathBuf]) -> Vec<BiosState> {
    BIOS.iter()
        .filter(|b| b.platform == platform)
        .map(|b| {
            let found = dirs
                .iter()
                .filter_map(|d| std::fs::read_dir(d).ok())
                .flat_map(|rd| rd.flatten().map(|e| e.path()).collect::<Vec<_>>())
                .find(|p| matches(b, p))
                .map(|p| p.to_string_lossy().to_string());
            BiosState { id: b.id, required: b.required, names: b.names.to_vec(), found }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sources_officielles() {
        let s = sources("AZAHAR", "Azahar", false);
        assert_eq!(s.iter().map(|s| s.kind).collect::<Vec<_>>(), ["play", "github"]);
        assert_eq!(s[1].url, "https://github.com/azahar-emu/azahar/releases");
        let s = sources("AZAHAR", "Azahar", true);
        assert!(s.iter().any(|s| s.kind == "obtainium" && s.url == "obtainium://add/https://github.com/azahar-emu/azahar"));
        let s = sources("SKYEMU", "SkyEmu (Standalone)", true);
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].kind, "search");
        assert!(s[0].url.starts_with("https://play.google.com/store/search?q=SkyEmu"));
        for s in sources("RETROARCH", "RetroArch", true).iter().chain(&sources("MELONDS", "melonDS", true)) {
            assert!(openable(&s.url), "{}", s.url);
        }
        assert!(!openable("file:///sdcard/x.apk") && !openable("intent://x") && !openable("javascript:alert(1)"));
    }

    #[test]
    fn toutes_les_cles_existent_dans_la_table() {
        let table = super::super::android_table::table();
        for i in INFOS {
            assert!(table.emulators.contains_key(i.key), "{}", i.key);
        }
    }

    #[test]
    fn bios_par_nom_et_taille() {
        let t = tempfile::tempdir().unwrap();
        let dir = t.path().to_path_buf();
        std::fs::write(dir.join("SCPH5501.BIN"), vec![0u8; 512 * 1024]).unwrap();
        std::fs::write(dir.join("bios7.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("bios9.bin"), vec![0u8; 4096]).unwrap();
        let ps1 = bios_for("ps1", std::slice::from_ref(&dir));
        assert!(ps1[0].found.as_deref().is_some_and(|f| f.ends_with("SCPH5501.BIN")));
        let ds = bios_for("ds", &[dir.clone()]);
        assert_eq!(ds.iter().map(|b| (b.id, b.found.is_some())).collect::<Vec<_>>(), [("ds-bios7", false), ("ds-bios9", true), ("ds-firmware", false)]);
        assert!(bios_for("snes", &[dir]).is_empty());
        assert_eq!(bios_dirs(None).len(), 2);
        let console = Path::new("/storage/1A2B-3C4D/BIOS/PS2");
        let all = bios_dirs_for(&[console, Path::new("/storage/emulated/0/BIOS")]);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0], console);
        assert_eq!(bios_dirs(Some(Path::new("/storage/emulated/0/BIOS"))).len(), 2);
    }
}
