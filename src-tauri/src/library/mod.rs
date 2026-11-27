//! Bibliothèque réelle (phase 2) : dossiers, jeux, scans.
//!
//! - `repo`     : lecture / écriture SQLite (dossiers, jeux, corrections) ;
//! - `scan`     : pipeline de scan et application du rapprochement ;
//! - `iso`      : fichiers .iso dont la console est à demander à l'utilisateur ;
//! - `commands` : commandes Tauri exposées à l'interface.
//!
//! Garantie : seule la base est modifiée. Les fichiers de jeux ne sont jamais
//! déplacés, renommés ni supprimés ; « Retirer un dossier » ne touche pas au disque.

pub mod commands;
pub mod portable;
pub mod extras;
pub mod iso;
pub mod repo;
pub mod scan;
pub mod suggest;
pub mod time;

pub use time::now_iso;

/// Erreurs présentées telles quelles à l'utilisateur : messages en français, concrets.
#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("Le dossier « {0} » est introuvable ou inaccessible.")]
    FolderNotFound(String),
    #[error("Ce dossier est déjà inclus dans « {0} ».")]
    AlreadyIncluded(String),
    #[error("Ce dossier contient déjà « {0} ». Retirez-le d'abord pour éviter les doublons.")]
    ContainsExisting(String),
    #[error("Console inconnue : {0}.")]
    UnknownPlatform(String),
    #[error("Élément introuvable dans la collection.")]
    NotFound,
    #[error("Une actualisation est déjà en cours.")]
    ScanRunning,
    #[error("Actualisation annulée.")]
    Cancelled,
    #[error("Le titre ne peut pas être vide.")]
    EmptyTitle,
    #[error("Région inconnue : {0}.")]
    InvalidRegion(String),
    #[error("{0}")]
    Media(String),
    #[error(transparent)]
    Db(#[from] crate::db::DbError),
    #[error("Erreur de base de données : {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, LibraryError>;
