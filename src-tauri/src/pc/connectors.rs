//! Connecteurs des boutiques PC.
//!
//! Chaque connecteur est indépendant et déclare honnêtement ce qu'il sait faire.
//! À cette étape, seule la présence de chaque boutique est vérifiée (emplacements
//! d'installation habituels) ; l'import de leurs jeux arrive connecteur par
//! connecteur, une fois vérifié sur une vraie installation. Aucun connecteur ne
//! prétend synchroniser une bibliothèque qu'il ne lit pas.

use serde::Serialize;
use std::path::{Path, PathBuf};

/// Ce qu'un connecteur sait réellement faire aujourd'hui.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// Repère la boutique sur l'ordinateur.
    pub detect: bool,
    /// Liste les jeux installés.
    pub scan_installed: bool,
    /// Liste les jeux possédés mais non installés (via une méthode autorisée).
    pub owned_library: bool,
    /// Lance un jeu.
    pub launch: bool,
}

/// État d'un connecteur, affiché dans les paramètres.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub capabilities: Capabilities,
    /// Boutique trouvée sur cet ordinateur (None : détection impossible).
    pub present: Option<bool>,
    /// Emplacement trouvé.
    pub location: Option<String>,
    /// Ce qui reste à faire, en clair.
    pub note: &'static str,
    /// Clé personnelle enregistrée (None : le connecteur n'en utilise pas).
    pub has_key: Option<bool>,
}

/// Interface commune : une nouvelle boutique s'ajoute sans toucher au reste.
pub trait Connector: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn capabilities(&self) -> Capabilities;
    /// Présence sur l'ordinateur (None : impossible à déterminer).
    fn detect(&self) -> (Option<bool>, Option<PathBuf>);
    fn note(&self) -> &'static str;
    fn has_key(&self) -> Option<bool> {
        None
    }

    fn info(&self) -> ConnectorInfo {
        let (present, location) = self.detect();
        ConnectorInfo {
            id: self.id(),
            name: self.name(),
            capabilities: self.capabilities(),
            present,
            location: location.map(|p| p.to_string_lossy().to_string()),
            note: self.note(),
            has_key: self.has_key(),
        }
    }
}

/// Ajout manuel : exécutables choisis par l'utilisateur (fonctionnel).
pub struct Manual;

impl Connector for Manual {
    fn id(&self) -> &'static str {
        "manual"
    }
    fn name(&self) -> &'static str {
        "Ajout manuel"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { detect: true, scan_installed: false, owned_library: false, launch: true }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        (Some(true), None)
    }
    fn note(&self) -> &'static str {
        "Ajoutez un exécutable (.exe) : iBox le lance directement."
    }
}

/// Boutique repérée par ses emplacements d'installation habituels.
pub struct Store {
    pub id: &'static str,
    pub name: &'static str,
    /// (variable d'environnement, chemin relatif) à tester dans l'ordre.
    pub markers: &'static [(&'static str, &'static str)],
    pub note: &'static str,
}

impl Connector for Store {
    fn id(&self) -> &'static str {
        self.id
    }
    fn name(&self) -> &'static str {
        self.name
    }
    fn capabilities(&self) -> Capabilities {
        let shortcuts = super::shortcuts::SOURCES.contains(&self.id);
        Capabilities { detect: true, scan_installed: shortcuts, launch: shortcuts, ..Default::default() }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        for (var, rel) in self.markers {
            if let Ok(base) = std::env::var(var) {
                let p = Path::new(&base).join(rel);
                if p.exists() {
                    return (Some(true), Some(p));
                }
            }
        }
        (Some(false), None)
    }
    fn note(&self) -> &'static str {
        if ["xbox", "rsi", "ea", "battlenet", "rockstar", "ubisoft"].contains(&self.id) { self.note } else if super::shortcuts::SOURCES.contains(&self.id) { SHORTCUTS } else { self.note }
    }
}

/// Steam : jeux installés lus dans ses fichiers locaux, lancement par Steam.
pub struct SteamConnector;

impl Connector for SteamConnector {
    fn id(&self) -> &'static str {
        "steam"
    }
    fn name(&self) -> &'static str {
        "Steam"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { detect: true, scan_installed: true, owned_library: true, launch: true }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        match super::steam::root() {
            Some(p) => (Some(true), Some(p)),
            None => (Some(false), None),
        }
    }
    fn note(&self) -> &'static str {
        "Jeux installés et temps de jeu lus dans les fichiers de Steam ; lancement et installation par Steam. Jeux possédés non installés et Famille Steam : avec votre clé API Web Steam (facultative)."
    }
    fn has_key(&self) -> Option<bool> {
        Some(crate::metadata::keys::has(super::steam::KEY))
    }
}

/// Epic Games Store : jeux installés (manifestes du lanceur), lancement par Epic.
pub struct EpicConnector;

impl Connector for EpicConnector {
    fn id(&self) -> &'static str {
        "epic"
    }
    fn name(&self) -> &'static str {
        "Epic Games Store"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { detect: true, scan_installed: true, owned_library: false, launch: true }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        match super::epic::manifests_dir() {
            Some(p) => (Some(true), Some(p)),
            None => (Some(false), None),
        }
    }
    fn note(&self) -> &'static str {
        "Jeux installés lus dans les manifestes du lanceur Epic ; lancement par Epic. Jeux possédés jamais installés ici : Epic ne propose pas d'API publique pour les lire."
    }
}

/// GOG Galaxy : bibliothèque complète (base locale de Galaxy), lancement par Galaxy.
pub struct GogConnector;

impl Connector for GogConnector {
    fn id(&self) -> &'static str {
        "gog"
    }
    fn name(&self) -> &'static str {
        "GOG Galaxy"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { detect: true, scan_installed: true, owned_library: true, launch: true }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        match (super::gog::db_path(), super::gog::client()) {
            (Some(_), Some(c)) => (Some(true), Some(c)),
            _ => (Some(false), None),
        }
    }
    fn note(&self) -> &'static str {
        "Jeux possédés, installés ou non, et temps de jeu lus dans la base locale de GOG Galaxy ; lancement et installation par Galaxy."
    }
}

/// Heroic Games Launcher (Linux, Steam Deck) : jeux Epic, GOG et Amazon installés, lancement par Heroic.
pub struct HeroicConnector;

impl Connector for HeroicConnector {
    fn id(&self) -> &'static str {
        "heroic"
    }
    fn name(&self) -> &'static str {
        "Heroic (Epic, GOG, Amazon)"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { detect: true, scan_installed: true, owned_library: false, launch: true }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        match super::heroic::config_dir() {
            Some(p) => (Some(true), Some(p)),
            None => (Some(false), None),
        }
    }
    fn note(&self) -> &'static str {
        "Jeux Epic, GOG et Amazon installés par Heroic ; lancement par Heroic. Jeux possédés non installés : pas encore lus."
    }
}

/// Lutris (Linux, Steam Deck) : jeux installés avec Lutris, lancement par Lutris.
pub struct LutrisConnector;

impl Connector for LutrisConnector {
    fn id(&self) -> &'static str {
        "lutris"
    }
    fn name(&self) -> &'static str {
        "Lutris"
    }
    fn capabilities(&self) -> Capabilities {
        Capabilities { detect: true, scan_installed: true, owned_library: false, launch: true }
    }
    fn detect(&self) -> (Option<bool>, Option<PathBuf>) {
        match super::lutris::db_path() {
            Some(p) => (Some(true), p.parent().map(Path::to_path_buf)),
            None => (Some(false), None),
        }
    }
    fn note(&self) -> &'static str {
        "Jeux installés avec Lutris, avec leur temps de jeu ; lancement par Lutris. Les jeux Steam de Lutris viennent du connecteur Steam."
    }
}

const SHORTCUTS: &str = "Import des jeux installés disposant d’un raccourci compatible dans le menu Démarrer ou sur le Bureau. Les droits du compte et le catalogue en ligne ne sont pas lus.";

const LATER: &str = "Import des jeux : à étudier (format local à vérifier sur une vraie installation).";

pub fn all() -> Vec<Box<dyn Connector>> {
    // Linux (Steam Deck) : ajout manuel, Steam et Heroic (Epic, GOG, Amazon) ; les autres
    // boutiques n'existent que sous Windows (docs/STEAMDECK.md §4.1)
    if !cfg!(windows) {
        return vec![Box::new(Manual), Box::new(SteamConnector), Box::new(HeroicConnector), Box::new(LutrisConnector)];
    }
    vec![
        Box::new(Manual),
        Box::new(SteamConnector),
        Box::new(EpicConnector),
        Box::new(GogConnector),
        Box::new(Store {
            id: "ubisoft",
            name: "Ubisoft Connect",
            markers: &[("ProgramFiles(x86)", "Ubisoft\\Ubisoft Game Launcher\\upc.exe")],
            note: "Installations Ubisoft enregistrées dans Windows. Les raccourcis sans dossier vérifié restent dans la collection.",
        }),
        Box::new(Store {
            id: "ea",
            name: "EA app",
            markers: &[("ProgramFiles", "Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe")],
            note: "Installations EA déclarées dans Windows avec un exécutable vérifiable, et raccourcis compatibles.",
        }),
        Box::new(Store {
            id: "xbox",
            name: "Xbox app / PC Game Pass",
            markers: &[("LOCALAPPDATA", "Packages\\Microsoft.GamingApp_8wekyb3d8bbwe")],
            note: "Jeux Xbox installés et inscrits dans Windows avec un manifeste MicrosoftGame.config accessible, ou raccourcis compatibles. Lancement via Windows.",
        }),
        Box::new(Store {
            id: "battlenet",
            name: "Battle.net",
            markers: &[("ProgramFiles(x86)", "Battle.net\\Battle.net.exe")],
            note: "Installations Blizzard déclarées dans Windows avec un exécutable vérifiable, et raccourcis compatibles.",
        }),
        Box::new(Store {
            id: "rockstar",
            name: "Rockstar Games Launcher",
            markers: &[("ProgramFiles", "Rockstar Games\\Launcher\\Launcher.exe")],
            note: "Installations Rockstar déclarées dans Windows avec un exécutable vérifiable, et raccourcis compatibles.",
        }),
        Box::new(Store {
            id: "riot",
            name: "Riot Games",
            markers: &[("ProgramData", "Riot Games")],
            note: SHORTCUTS,
        }),
        Box::new(Store {
            id: "rsi",
            name: "RSI Launcher",
            markers: &[("ProgramFiles", r"Roberts Space Industries\RSI Launcher\RSI Launcher.exe")],
            note: "Détecte Star Citizen LIVE dans les dossiers habituels des lecteurs. Le bouton ouvre RSI Launcher.",
        }),
        Box::new(Store {
            id: "itch",
            name: "itch.io",
            markers: &[("LOCALAPPDATA", "itch\\itch.exe")],
            note: LATER,
        }),
    ]
}

/// Nom lisible d'une source (badge des jeux).
pub fn source_name(id: &str) -> &'static str {
    match id {
        "manual" => "Ajout manuel",
        "steam" => "Steam",
        "epic" => "Epic Games",
        "gog" => "GOG",
        "heroic" => "Heroic",
        "lutris" => "Lutris",
        "ubisoft" => "Ubisoft Connect",
        "ea" => "EA app",
        "xbox" => "Xbox",
        "battlenet" => "Battle.net",
        "rockstar" => "Rockstar",
        "riot" => "Riot Games",
        "rsi" => "RSI Launcher",
        "itch" => "itch.io",
        _ => "Autre",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chaque_connecteur_declare_ses_capacites_honnetement() {
        let all = all();
        let ids: Vec<_> = all.iter().map(|c| c.id()).collect();
        assert!(ids.contains(&"manual") && ids.contains(&"steam"));
        // Windows : toutes les boutiques ; Linux (Steam Deck) : ajout manuel, Steam et Heroic
        assert_eq!(ids.contains(&"xbox"), cfg!(windows));
        assert_eq!(ids.contains(&"heroic"), !cfg!(windows));
        for c in &all {
            let caps = c.capabilities();
            if super::super::shortcuts::SOURCES.contains(&c.id()) {
                assert!(caps.scan_installed && caps.launch && !caps.owned_library);
            } else if !["manual", "steam", "epic", "gog", "heroic", "lutris"].contains(&c.id()) {
                // tant que l'import n'est pas vérifié, aucune boutique ne prétend lister ou lancer
                assert!(!caps.scan_installed && !caps.owned_library && !caps.launch, "{}", c.id());
            }
        }
        assert!(Manual.capabilities().launch);
    }
}
