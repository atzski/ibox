//! Métadonnées et jaquettes (phase 3).
//!
//! Sources vérifiées (voir docs/PROVIDERS.md) :
//! - `libretro_thumbs` : jaquettes, écrans-titres, captures, logos (sans clé) ;
//! - `steamgriddb`     : jaquettes et logos (clé personnelle, coffre Windows) ;
//! - `gametdb`         : bases de titres GameCube / Wii / DS / 3DS (texte) ;
//! - `libretro_meta`   : libretro-database, CC BY-SA 4.0 (texte) ;
//! - `launchbox`       : LaunchBox Games Database, images de boîte (dos, tranche, face).
//!
//! Tout est mis en cache localement : l'application reste utilisable hors connexion.

pub mod commands;
pub mod gametdb;
pub mod http;
pub mod job;
pub mod keys;
pub mod launchbox;
pub mod libretro_meta;
pub mod libretro_thumbs;
pub mod matching;
pub mod media;
pub mod steamgriddb;
mod text;

use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum MetaError {
    #[error("Connexion impossible : {0}. Vérifiez votre accès à Internet.")]
    Network(String),
    #[error("Le service a répondu « {status} » pour {what}.")]
    Http { status: u16, what: String },
    #[error("Clé API refusée par {0}. Vérifiez-la dans les paramètres.")]
    BadKey(&'static str),
    #[error("Aucune clé API enregistrée pour {0}.")]
    MissingKey(&'static str),
    #[error("Coffre d'identifiants Windows : {0}")]
    Vault(String),
    #[error("Fichier non pris en charge : {0}")]
    Invalid(String),
    #[error("Adresse non autorisée : {0}")]
    ForbiddenUrl(String),
    #[error("Élément introuvable.")]
    NotFound,
    #[error("Une récupération est déjà en cours.")]
    Busy,
    #[error("Récupération annulée.")]
    Cancelled,
    #[error("Erreur de base de données : {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Erreur de fichier : {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, MetaError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Front,
    Back,
    Spine,
    Full,
    Disc,
    Logo,
    Title,
    Screenshot,
    /// Fond large affiché derrière le jeu (SteamGridDB « heroes »).
    Hero,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Front => "front",
            MediaKind::Back => "back",
            MediaKind::Spine => "spine",
            MediaKind::Full => "full",
            MediaKind::Disc => "disc",
            MediaKind::Logo => "logo",
            MediaKind::Title => "title",
            MediaKind::Screenshot => "screenshot",
            MediaKind::Hero => "hero",
        }
    }

    pub fn parse(s: &str) -> Option<MediaKind> {
        serde_json::from_value(serde_json::Value::String(s.to_string())).ok()
    }
}

/// Image proposée par une source (affichée dans le sélecteur de jaquettes).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub provider: &'static str,
    pub kind: MediaKind,
    pub url: String,
    pub thumb: String,
    pub label: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// Ressemblance avec le jeu (0..1).
    pub score: f32,
    /// Jeu SteamGridDB d'origine : permet d'ajouter son fond et son logo.
    pub source_game: Option<u64>,
}

/// Réglages transmis par l'interface (les clés restent dans le coffre Windows).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchOptions {
    /// Sources activées : « libretro », « steamgriddb », « gametdb », « libretro-db ».
    pub providers: Vec<String>,
    /// Région préférée : PAL | NTSC-U | NTSC-J.
    pub region: String,
}

impl FetchOptions {
    pub fn uses(&self, p: &str) -> bool {
        self.providers.iter().any(|x| x == p)
    }
    pub fn preferred_region(&self) -> crate::scanner::Region {
        match self.region.as_str() {
            "NTSC-U" => crate::scanner::Region::NtscU,
            "NTSC-J" => crate::scanner::Region::NtscJ,
            _ => crate::scanner::Region::Pal,
        }
    }
}

/// Dossier des consoles sur thumbnails.libretro.com et dans libretro-database.
pub fn libretro_system(platform_id: &str) -> Option<&'static str> {
    Some(match platform_id {
        "gamecube" => "Nintendo - GameCube",
        "wii" => "Nintendo - Wii",
        "wiiu" => "Nintendo - Wii U",
        "ds" => "Nintendo - Nintendo DS",
        "3ds" => "Nintendo - Nintendo 3DS",
        "n64" => "Nintendo - Nintendo 64",
        "gb" => "Nintendo - Game Boy",
        "gbc" => "Nintendo - Game Boy Color",
        "gba" => "Nintendo - Game Boy Advance",
        "snes" => "Nintendo - Super Nintendo Entertainment System",
        "ps1" => "Sony - PlayStation",
        "ps2" => "Sony - PlayStation 2",
        "psp" => "Sony - PlayStation Portable",
        "ps3" => "Sony - PlayStation 3",
        "nes" => "Nintendo - Nintendo Entertainment System",
        "mastersystem" => "Sega - Master System - Mark III",
        "megadrive" => "Sega - Mega Drive - Genesis",
        "gamegear" => "Sega - Game Gear",
        "saturn" => "Sega - Saturn",
        "dreamcast" => "Sega - Dreamcast",
        "atari2600" => "Atari - 2600",
        "jaguar" => "Atari - Jaguar",
        "xbox" => "Microsoft - Xbox",
        "xbox360" => "Microsoft - Xbox 360",
        _ => return None,
    })
}
