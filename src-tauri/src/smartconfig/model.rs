//! Modèle de données commun de SmartConfig : tout fournisseur renvoie ces
//! structures, quel que soit son format d'origine. Aucune dépendance à un
//! système d'exploitation ni à un émulateur particulier.

use serde::{Deserialize, Serialize};

/// Valeur typée d'un paramètre. Jamais de texte libre écrit tel quel dans un
/// fichier : chaque adaptateur le convertit lui-même depuis ces types.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum Value {
    Bool(bool),
    Int(i64),
    /// Choix parmi une liste fermée (identifiant interne de l'option).
    Choice(String),
}

impl std::fmt::Display for Value {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Value::Bool(b) => write!(f, "{b}"),
            Value::Int(i) => write!(f, "{i}"),
            Value::Choice(c) => write!(f, "{c}"),
        }
    }
}

/// Un paramètre normalisé : `key` appartient à l'espace de noms d'un
/// adaptateur (ex. `dolphin.internal_resolution`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: Value,
}

/// Nature de la donnée renvoyée par un fournisseur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileKind {
    /// Paramètres structurés exploitables par un adaptateur.
    Configuration,
    /// Rapport de compatibilité sans réglages applicables (note, performance).
    Report,
}

/// Fournisseurs connus. `Community` et `Verified` sont réservés aux phases 5–6.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceId {
    EmuReady,
    Community,
    Verified,
    Official,
}

impl SourceId {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceId::EmuReady => "emuready",
            SourceId::Community => "community",
            SourceId::Verified => "verified",
            SourceId::Official => "official",
        }
    }
}

/// Machine sur laquelle le rapport a été établi (tel que décrit par la source).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceHardware {
    /// `windows`, `linux`, `macos`, `android`… ou inconnu.
    pub os: Option<String>,
    /// `x86_64`, `arm64`…
    pub arch: Option<String>,
    /// Texte d'affichage (« Steam Deck OLED », « Ryzen 5 7430U + RTX 4050 »).
    pub label: Option<String>,
    pub cpu: Option<String>,
    pub gpu: Option<String>,
    /// Appareil portable / téléphone (rapports « handheld » d'EmuReady).
    pub handheld: bool,
}

/// Performance rapportée, sur l'échelle propre à la source. `rank` : 1 = meilleur.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedPerformance {
    pub label: String,
    pub rank: u8,
    /// Nombre de paliers de l'échelle (8 chez EmuReady).
    pub scale: u8,
}

/// Profil normalisé, provenance comprise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub source: SourceId,
    /// Identifiant du profil chez la source (UUID EmuReady…).
    pub source_ref: String,
    /// Lien public de consultation, s'il existe.
    pub source_url: Option<String>,
    pub kind: ProfileKind,
    /// Identifiant de l'adaptateur visé (`dolphin`, `pcsx2`…).
    pub emulator: String,
    pub emulator_version: Option<String>,
    /// Variante non officielle (fork Android…) : rarement transposable.
    pub emulator_fork: Option<String>,
    /// Comment la source désigne le jeu.
    pub game: GameRef,
    pub hardware: ReferenceHardware,
    pub performance: Option<ReportedPerformance>,
    /// Réglages déjà normalisés (clés de l'adaptateur), non encore validés.
    pub settings: Vec<Setting>,
    /// Libellés de la source pour les paramètres d'une fiche à appliquer à la main
    /// (émulateurs Android autonomes) : (clé, libellé). Vide ailleurs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<(String, String)>,
    /// Champs reçus mais non transposables (ambiguïté, autre OS…), avec la raison.
    pub ignored: Vec<IgnoredField>,
    pub notes: Option<String>,
    pub votes_up: u32,
    pub votes_down: u32,
    /// Vérifications par un développeur de l'émulateur (EmuReady).
    pub verified_by_developer: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IgnoredField {
    pub field: String,
    pub reason: String,
}

/// Identification du jeu côté source.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRef {
    pub title: String,
    /// Clé de console de la source (`nintendo_gamecube`…).
    pub system: Option<String>,
    /// Numéro de série / identifiant de disque s'il est connu de la source.
    pub serial: Option<String>,
}

/// Jeu local tel qu'iBox le connaît (aucun chemin).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameQuery {
    pub game_id: i64,
    pub platform: String,
    pub title: String,
    pub serial: Option<String>,
    pub region: Option<String>,
    /// Certitude de l'identification iBox (0..1).
    pub id_confidence: f64,
}

/// Les trois modes proposés à l'utilisateur, plus le mode manuel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Performance,
    Balanced,
    Quality,
    /// Ne rien recommander : les réglages actuels sont conservés.
    Manual,
}

/// Classement d'une recommandation (voir `recommend.rs`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchKind {
    Exact,
    SimilarHardware,
    Generic,
    Experimental,
    Insufficient,
    Incompatible,
}
