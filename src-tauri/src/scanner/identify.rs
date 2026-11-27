//! Combine les indices dans l'ordre demandé : identifiants internes (en-têtes),
//! dossier associé par l'utilisateur, extension non ambiguë, nom des dossiers
//! parents, puis (phase 3) base de données et enfin correction manuelle.
//!
//! En cas de doute, la console la plus probable est proposée avec une faible
//! confiance et la liste des alternatives : l'interface demandera à l'utilisateur
//! plutôt que d'attribuer une mauvaise console en silence.

use super::filename::{self, ParsedName};
use super::formats;
use super::headers::HeaderInfo;
use super::{IdMethod, Region};
use serde::Serialize;
use std::path::Path;

/// Sous ce seuil, le jeu est marqué « à vérifier ».
pub const REVIEW_THRESHOLD: f32 = 0.5;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identification {
    pub platform_id: String,
    pub title: String,
    pub serial: Option<String>,
    pub region: Option<Region>,
    pub disc: Option<u32>,
    pub method: IdMethod,
    pub confidence: f32,
    /// Autres consoles possibles (ambiguïté d'extension).
    pub alternatives: Vec<String>,
}

impl Identification {
    pub fn needs_review(&self) -> bool {
        self.confidence < REVIEW_THRESHOLD
    }
}

#[derive(Debug, Default, Clone)]
pub struct Context<'a> {
    /// Console associée au dossier racine par l'utilisateur.
    pub folder_platform: Option<&'a str>,
    /// Noms des dossiers parents, du plus proche au plus lointain.
    pub parent_dirs: Vec<&'a str>,
}

pub fn identify(path: &Path, header: Option<&HeaderInfo>, ctx: &Context) -> Option<Identification> {
    // Jeu Switch extrait : le fichier s'appelle « main », le nom est celui du dossier du jeu
    let extracted = super::is_extracted_main(path);
    let ext = if extracted { String::new() } else { formats::extension_of(path)? };
    let mut candidates = if extracted {
        vec!["switch2", "switch"]
    } else {
        formats::platforms_for_extension(&ext)
    };
    if candidates.is_empty() {
        return None;
    }
    if header.is_none() {
        match ext.as_str() {
            // .zip : la console vient du jeu qu'elle contient (lu dans `read_header`)
            ".zip" => return None,
            // .7z / .rar : contenu illisible sans décompression ; seul un dossier
            // associé à une console (ou nommé d'après elle) permet de trancher
            ".7z" | ".rar" => {
                let folder = ctx
                    .folder_platform
                    .or_else(|| formats::platform_from_folder_names(ctx.parent_dirs.iter().copied()));
                candidates = folder.filter(|f| candidates.contains(f)).into_iter().collect();
                if candidates.is_empty() {
                    return None;
                }
            }
            // image de CD sans en-tête reconnu : PlayStation 1 ou 2
            ".bin" | ".img" | ".mdf" => candidates.retain(|c| matches!(*c, "ps1" | "ps2")),
            _ => {}
        }
        if candidates.is_empty() {
            return None;
        }
    }
    let file_stem = path.file_stem()?.to_string_lossy().to_string();
    let stem = if extracted {
        extracted_title(path)
    } else if file_stem.eq_ignore_ascii_case("eboot") {
        // homebrew PSP « dossier du jeu + EBOOT.PBP » : le nom est celui du dossier
        path.parent().and_then(Path::file_name).map(|n| n.to_string_lossy().to_string()).unwrap_or(file_stem)
    } else {
        file_stem
    };
    let name: ParsedName = filename::parse(&stem);

    let others = |chosen: &str| {
        candidates
            .iter()
            .filter(|c| **c != chosen)
            .map(|c| c.to_string())
            .collect()
    };

    // Une « Switch 2 Edition » garde l'identifiant de son jeu Switch : le dossier
    // (associé à la Switch 2, ou nommé « Switch 2 », « NSW2 »…) le précise.
    let switch2_folder = ctx.folder_platform == Some("switch2")
        || formats::platform_from_folder_names(ctx.parent_dirs.iter().copied()) == Some("switch2")
        || ctx.parent_dirs.iter().take(4).any(|d| names_switch2(d))
        || (extracted && names_switch2(&stem));

    let (platform, method, confidence, alternatives): (String, IdMethod, f32, Vec<String>) =
        if header.is_some_and(|h| h.platform_id == "switch") && switch2_folder {
            ("switch2".to_string(), IdMethod::Folder, 0.9, vec!["switch".to_string()])
        } else if let Some(h) = header {
            // L'en-tête fait foi, même si le dossier dit autre chose
            (
                h.platform_id.to_string(),
                IdMethod::Header,
                0.98,
                Vec::new(),
            )
        } else if let Some(fp) = ctx.folder_platform.filter(|fp| candidates.contains(fp)) {
            (fp.to_string(), IdMethod::Folder, 0.9, others(fp))
        } else if candidates.len() == 1 {
            (
                candidates[0].to_string(),
                IdMethod::Filename,
                0.85,
                Vec::new(),
            )
        } else if let Some(hint) =
            formats::platform_from_folder_names(ctx.parent_dirs.iter().copied())
                .filter(|h| candidates.contains(h))
        {
            (hint.to_string(), IdMethod::Folder, 0.7, others(hint))
        } else {
            // Ambigu : proposition prudente, à confirmer par l'utilisateur
            (
                candidates[0].to_string(),
                IdMethod::Filename,
                0.3,
                others(candidates[0]),
            )
        };

    // Titre : le nom de fichier est généralement plus lisible que l'en-tête
    // (« POKEMON EMER »), sauf s'il est vide ou n'est qu'un identifiant.
    let header_title = header.and_then(|h| h.title.clone());
    // Les conteneurs Switch stockent le vrai nom du jeu (avec ponctuation) : il prime
    let full_name_header = header.is_some_and(|h| matches!(h.platform_id, "switch" | "switch2"));
    let title = if full_name_header && header_title.is_some() {
        header_title.unwrap_or_default()
    } else if name.title.is_empty() || looks_like_serial(&name.title) {
        header_title.unwrap_or_else(|| stem.to_string())
    } else {
        name.title.clone()
    };

    Some(Identification {
        platform_id: platform,
        title,
        serial: header.and_then(|h| h.serial.clone()).or(name.serial),
        region: header.and_then(|h| h.region).or(name.region),
        disc: name
            .disc
            .or_else(|| header.and_then(|h| h.disc).filter(|d| *d > 1)),
        method,
        confidence,
        alternatives,
    })
}

/// Le nom désigne-t-il la Switch 2 ? (« NSW2 », « NS2 », « Switch 2 », « Switch2 »)
fn names_switch2(name: &str) -> bool {
    let tokens: Vec<String> = name
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect();
    tokens.iter().any(|t| matches!(t.as_str(), "nsw2" | "ns2" | "switch2"))
        || tokens.windows(2).any(|w| w[0] == "switch" && w[1] == "2")
}

/// Nom d'un jeu extrait : dossier qui contient `exefs` (en remontant les
/// dossiers techniques « base », « program », numéros), sans les mentions
/// de mise à jour ou de dump (« _Update_65536_DLC_Unlocker_NSW2_Dumped »).
fn extracted_title(main: &Path) -> String {
    let technical = |n: &str| {
        let n = n.to_lowercase();
        n == "base" || n == "program" || n == "exefs" || n.chars().all(|c| c.is_ascii_digit())
    };
    let folder = main
        .ancestors()
        .skip(1)
        .filter_map(|a| a.file_name().map(|n| n.to_string_lossy().to_string()))
        .find(|n| !technical(n))
        .unwrap_or_else(|| "Jeu Switch".to_string());
    let cleaned = folder.replace('_', " ");
    let stop = ["update", "dlc", "unlocker", "nsw2", "ns2", "dumped", "dump"];
    let mut words: Vec<&str> = Vec::new();
    for w in cleaned.split_whitespace() {
        if stop.contains(&w.to_lowercase().as_str()) {
            break;
        }
        words.push(w);
    }
    if words.is_empty() { folder } else { words.join(" ") }
}

fn looks_like_serial(s: &str) -> bool {
    let s = s.trim();
    (s.len() == 6 || s.len() == 4 || s.len() == 10)
        && s.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gc_header() -> HeaderInfo {
        HeaderInfo {
            platform_id: "gamecube",
            title: Some("ZELDA THE WIND WAKER".into()),
            serial: Some("GZLP01".into()),
            region: Some(Region::Pal),
            disc: Some(1),
        }
    }

    #[test]
    fn l_en_tete_prime_sur_tout() {
        let ctx = Context {
            folder_platform: Some("ps2"),
            ..Default::default()
        };
        let id = identify(
            Path::new("D:/Jeux/Zelda (USA).iso"),
            Some(&gc_header()),
            &ctx,
        )
        .unwrap();
        assert_eq!(id.platform_id, "gamecube");
        assert_eq!(id.method, IdMethod::Header);
        assert_eq!(id.title, "Zelda");
        assert_eq!(
            id.region,
            Some(Region::Pal),
            "la région de l'en-tête prime sur l'étiquette"
        );
        assert_eq!(id.disc, None, "disque 1 implicite");
        assert!(!id.needs_review());
    }

    #[test]
    fn dossier_associe_pour_une_extension_ambigue() {
        let ctx = Context {
            folder_platform: Some("ps2"),
            ..Default::default()
        };
        let id = identify(Path::new("D:/PS2/Okami (Europe).iso"), None, &ctx).unwrap();
        assert_eq!(
            (id.platform_id.as_str(), id.method),
            ("ps2", IdMethod::Folder)
        );
        assert!(id.alternatives.contains(&"gamecube".to_string()));
    }

    #[test]
    fn homebrew_psp_nomme_d_apres_son_dossier() {
        let header = HeaderInfo::new("psp");
        let id = identify(Path::new("/storage/emulated/0/Roms/psp/joker-poker/EBOOT.PBP"), Some(&header), &Context::default()).unwrap();
        assert_eq!((id.platform_id.as_str(), id.title.as_str()), ("psp", "Joker Poker"));
    }

    #[test]
    fn extension_unique() {
        let id = identify(
            Path::new("Advance Wars (Europe).gba"),
            None,
            &Context::default(),
        )
        .unwrap();
        assert_eq!((id.platform_id.as_str(), id.confidence), ("gba", 0.85));
    }

    #[test]
    fn nom_de_dossier_parent() {
        let ctx = Context {
            parent_dirs: vec!["Okami", "PS2", "Emulation"],
            ..Default::default()
        };
        let id = identify(Path::new("Okami.iso"), None, &ctx).unwrap();
        assert_eq!(id.platform_id, "ps2");
        assert_eq!(id.confidence, 0.7);
    }

    #[test]
    fn ambiguite_signalee_au_lieu_d_une_attribution_silencieuse() {
        let id = identify(Path::new("Mystere.iso"), None, &Context::default()).unwrap();
        assert!(id.needs_review());
        assert!(!id.alternatives.is_empty());
    }

    #[test]
    fn titre_de_l_en_tete_si_le_nom_est_un_identifiant() {
        let id = identify(
            Path::new("GZLP01.iso"),
            Some(&gc_header()),
            &Context::default(),
        )
        .unwrap();
        assert_eq!(id.title, "ZELDA THE WIND WAKER");
    }

    #[test]
    fn nom_complet_d_un_conteneur_switch_2() {
        let header = HeaderInfo {
            platform_id: "switch2",
            title: Some("The Legend of Zelda: Ocarina of Time".into()),
            serial: Some("0400486024DEC000".into()),
            region: None,
            disc: None,
        };
        let id = identify(
            Path::new("The Legend of Zelda Ocarina of Time [0400486024dec000][v131072].nup"),
            Some(&header),
            &Context::default(),
        )
        .unwrap();
        assert_eq!(id.platform_id, "switch2");
        assert_eq!(id.title, "The Legend of Zelda: Ocarina of Time");
        assert_eq!(id.method, IdMethod::Header);
    }

    fn switch_header(serial: &str) -> HeaderInfo {
        HeaderInfo {
            platform_id: "switch",
            title: None,
            serial: Some(serial.into()),
            region: None,
            disc: None,
        }
    }

    #[test]
    fn switch_2_edition_precisee_par_le_dossier() {
        let ctx = Context {
            parent_dirs: vec!["Kirby_NSW2_Dumped", "Downloads"],
            ..Default::default()
        };
        let id = identify(Path::new("Kirby.nsp"), Some(&switch_header("01004D300C5AE000")), &ctx).unwrap();
        assert_eq!(id.platform_id, "switch2");
        // sans indice, l'identifiant Switch fait foi
        let id = identify(Path::new("Kirby.nsp"), Some(&switch_header("01004D300C5AE000")), &Context::default()).unwrap();
        assert_eq!(id.platform_id, "switch");
    }

    #[test]
    fn mots_designant_la_switch_2() {
        assert!(names_switch2("Kirby and the Forgotten Land_Update_65536_DLC_Unlocker_NSW2_Dumped"));
        assert!(names_switch2("Nintendo Switch 2"));
        assert!(names_switch2("switch2 games"));
        assert!(!names_switch2("Switch"));
        assert!(!names_switch2("Newsw2ap"));
    }

    #[test]
    fn titre_d_un_jeu_extrait() {
        assert_eq!(
            extracted_title(Path::new("D:/Kirby and the Forgotten Land_Update_65536_DLC_Unlocker_NSW2_Dumped/base/base/exefs/main")),
            "Kirby and the Forgotten Land"
        );
        assert_eq!(extracted_title(Path::new("D:/Games/mkw 1.0/base/exefs/main")), "mkw 1.0");
        assert_eq!(extracted_title(Path::new("D:/Dumps/Pikmin 4/base/program/0/exefs/main")), "Pikmin 4");
    }

    #[test]
    fn bin_sans_en_tete_limite_aux_playstation() {
        let id = identify(Path::new("Jeu.bin"), None, &Context::default()).unwrap();
        assert!(matches!(id.platform_id.as_str(), "ps1" | "ps2"), "{}", id.platform_id);
        assert!(id.alternatives.iter().all(|a| a == "ps1" || a == "ps2"));
    }

    #[test]
    fn archive_7z_seulement_dans_un_dossier_de_console() {
        assert!(identify(Path::new("Pokemon.7z"), None, &Context::default()).is_none());
        let ctx = Context {
            parent_dirs: vec!["GBA", "Emulation"],
            ..Default::default()
        };
        assert_eq!(identify(Path::new("Pokemon.7z"), None, &ctx).unwrap().platform_id, "gba");
        // .zip sans jeu reconnu à l'intérieur : ignoré
        assert!(identify(Path::new("photos.zip"), None, &Context::default()).is_none());
    }

    #[test]
    fn fichier_non_jeu_ignore() {
        assert!(identify(Path::new("notes.txt"), None, &Context::default()).is_none());
    }
}
