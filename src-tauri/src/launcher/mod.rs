//! Émulateurs et lancement des jeux (phase 4).
//!
//! iBox ne télécharge jamais d'émulateur : l'utilisateur désigne ceux qu'il a
//! installés. Les profils de lancement sont vérifiés dans le code source de
//! chaque émulateur (docs/EMULATORS.md).

pub mod android;
pub mod android_catalog;
pub mod android_table;
pub mod commands;
pub mod detect;
pub mod launch;
pub mod profiles;
pub mod repo;

#[derive(Debug, thiserror::Error)]
pub enum LaunchError {
    #[error("Aucun émulateur n'est associé à cette console ({0}). Choisissez-en un dans les paramètres.")]
    NoEmulator(String),
    #[error("Seuls les programmes .exe sont acceptés : {0}")]
    NotAnExe(String),
    /// Linux : le fichier choisi n'est pas un programme (AppImage, lanceur Flatpak, binaire).
    #[error("Ce fichier n'est pas un programme exécutable (AppImage, lanceur Flatpak ou programme Linux) : {0}")]
    #[cfg_attr(not(unix), allow(dead_code))]
    NotExecutable(String),
    #[error("L'émulateur est introuvable : {0}. A-t-il été déplacé ou désinstallé ?")]
    ExeMissing(String),
    #[error("Le fichier du jeu est introuvable : {0}. Le disque est peut-être débranché.")]
    GameMissing(String),
    #[error("{emulator} a besoin d'un cœur pour la console « {platform} » : choisissez-le dans les paramètres des émulateurs.")]
    NoCore { emulator: String, platform: String },
    #[error("Cœur introuvable : {0}")]
    CoreMissing(String),
    #[error("Un jeu est déjà en cours : {0}.")]
    AlreadyRunning(String),
    #[error("Impossible de démarrer {0}")]
    Spawn(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Élément introuvable.")]
    NotFound,
    #[error("Erreur de base de données : {0}")]
    Db(#[from] rusqlite::Error),
}

pub type Result<T> = std::result::Result<T, LaunchError>;
