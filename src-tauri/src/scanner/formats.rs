//! Formats reconnus, lus dans `shared/platform-formats.json` — la même table
//! que l'interface TypeScript. Une seule source de vérité pour les extensions.

use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;

const FORMATS_JSON: &str = include_str!("../../../shared/platform-formats.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformFormats {
    pub extensions: Vec<String>,
    pub folder_hints: Vec<String>,
}

#[derive(Deserialize)]
struct Table {
    platforms: HashMap<String, PlatformFormats>,
}

/// Table des formats, triée par identifiant de console pour un ordre stable.
pub fn table() -> &'static Vec<(String, PlatformFormats)> {
    static TABLE: OnceLock<Vec<(String, PlatformFormats)>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let t: Table =
            serde_json::from_str(FORMATS_JSON).expect("shared/platform-formats.json invalide");
        let mut v: Vec<_> = t.platforms.into_iter().collect();
        v.sort_by(|a, b| a.0.cmp(&b.0));
        v
    })
}

/// Extension en minuscules avec le point (« .iso »), ou None.
pub fn extension_of(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
}

/// Consoles pouvant correspondre à une extension (plusieurs = ambiguïté).
pub fn platforms_for_extension(ext: &str) -> Vec<&'static str> {
    let ext = ext.to_ascii_lowercase();
    table()
        .iter()
        .filter(|(_, f)| f.extensions.contains(&ext))
        .map(|(id, _)| id.as_str())
        .collect()
}

pub fn is_known_extension(ext: &str) -> bool {
    !platforms_for_extension(ext).is_empty()
}

/// Devine la console d'après le nom d'un dossier parent (« D:/Emulation/GameCube/… »).
/// Comparaison exacte du nom de dossier pour éviter les faux positifs
/// (« ds » ne doit pas correspondre à « Downloads »). Le parent le plus proche l'emporte.
pub fn platform_from_folder_names<'a, I>(dir_names: I) -> Option<&'static str>
where
    I: IntoIterator<Item = &'a str>,
{
    for name in dir_names {
        let name = name.trim().to_lowercase();
        for (id, f) in table() {
            if f.folder_hints.contains(&name) {
                return Some(id.as_str());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn charge_la_table_partagee() {
        assert_eq!(table().len(), 27);
    }

    #[test]
    fn extensions_ambigues_et_uniques() {
        let iso = platforms_for_extension(".ISO");
        assert!(
            iso.contains(&"gamecube")
                && iso.contains(&"wii")
                && iso.contains(&"ps2")
                && iso.contains(&"psp")
        );
        assert_eq!(platforms_for_extension(".nds"), vec!["ds"]);
        assert!(platforms_for_extension(".txt").is_empty());
    }

    #[test]
    fn indice_par_nom_de_dossier() {
        assert_eq!(
            platform_from_folder_names(["Wind Waker", "GameCube", "Emulation"]),
            Some("gamecube")
        );
        assert_eq!(platform_from_folder_names(["Nintendo DS"]), Some("ds"));
        assert_eq!(platform_from_folder_names(["Downloads"]), None);
    }
}
