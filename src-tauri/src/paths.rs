//! Dossiers de l'utilisateur, communs à Windows et Linux (Steam Deck).
//!
//! Windows : `%USERPROFILE%`. Linux : `$HOME`. Les autres dossiers (données d'iBox) passent
//! par Tauri (`app.path()`), qui suit déjà les conventions de chaque système.

use std::path::PathBuf;

/// Variable qui contient le dossier personnel sur ce système.
pub const HOME_VAR: &str = if cfg!(windows) { "USERPROFILE" } else { "HOME" };

/// Dossier personnel de l'utilisateur (`None` s'il est inconnu ou vide).
pub fn home() -> Option<PathBuf> {
    std::env::var_os(HOME_VAR).filter(|h| !h.is_empty()).map(PathBuf::from)
}

/// Dossier « Documents » de l'utilisateur (XDG `~/Documents` sous Linux).
pub fn documents() -> Option<PathBuf> {
    home().map(|h| h.join("Documents"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documents_sous_le_dossier_personnel() {
        if let Some(h) = home() {
            assert_eq!(documents(), Some(h.join("Documents")));
        }
    }
}
