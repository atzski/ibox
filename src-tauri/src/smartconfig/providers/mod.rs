//! Fournisseurs de profils. Chacun renvoie des `Profile` normalisés ; aucun
//! n'est indispensable (désactivable, panne tolérée). EmuReady (phase 2) est la
//! seule source externe : iNetbox ne stocke aucun profil. Profils « Vérifié par
//! iBox » livrés avec l'application (phase 6). Réservé : recommandations
//! officielles des émulateurs.

pub mod emuready;
pub mod verified;

use super::model::{GameQuery, Profile, SourceId};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ProviderError {
    #[error("Pas de connexion à {0}.")]
    Offline(String),
    #[error("Trop de requêtes : nouvel essai possible dans {retry_after_s} s.")]
    RateLimited { retry_after_s: u64 },
    #[error("Le service a répondu {status}.")]
    Http { status: u16 },
    #[error("Réponse inattendue : {0}")]
    Invalid(String),
}

/// Sérialisation pour l'interface : `{ kind, message, … }`. Écrite à la main :
/// serde ne sait pas étiqueter une variante qui ne contient qu'une chaîne
/// (l'erreur « hors ligne » faisait échouer toute la réponse).
impl Serialize for ProviderError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(None)?;
        match self {
            ProviderError::Offline(service) => {
                m.serialize_entry("kind", "offline")?;
                m.serialize_entry("service", service)?;
            }
            ProviderError::RateLimited { retry_after_s } => {
                m.serialize_entry("kind", "rateLimited")?;
                m.serialize_entry("retryAfterS", retry_after_s)?;
            }
            ProviderError::Http { status } => {
                m.serialize_entry("kind", "http")?;
                m.serialize_entry("status", status)?;
            }
            ProviderError::Invalid(_) => m.serialize_entry("kind", "invalid")?,
        }
        m.serialize_entry("message", &self.to_string())?;
        m.end()
    }
}

/// Cache persistant, fourni par l'appelant (SQLite en production, mémoire en test).
pub trait Cache {
    /// (contenu, encore frais ?)
    fn get(&self, key: &str) -> Option<(String, bool)>;
    fn put(&self, key: &str, body: &str, ttl_secs: i64);
}

/// Résultat d'une recherche : profils, et s'ils viennent d'un cache expiré (hors ligne).
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fetched {
    pub profiles: Vec<Profile>,
    /// Jeu reconnu chez la source (sinon : aucune donnée pour ce jeu).
    pub matched: bool,
    /// Données anciennes servies faute de réseau.
    pub stale: bool,
}

pub trait Provider: Send + Sync {
    fn id(&self) -> SourceId;
    /// Émulateurs (identifiants d'adaptateur) couverts.
    fn supports(&self, emulator: &str, platform: &str) -> bool;
    fn fetch(&self, game: &GameQuery, emulator: &str, cache: &dyn Cache) -> Result<Fetched, ProviderError>;
}

/// Description affichée dans Paramètres › SmartConfig › Sources de données.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: SourceId,
    pub name: &'static str,
    pub website: &'static str,
    pub docs: &'static str,
    pub terms: &'static str,
    /// Ce que la source partage réellement avec iBox.
    pub provides: &'static str,
    /// Ce qu'iBox envoie à la source.
    pub sends: &'static str,
}

pub fn infos() -> Vec<ProviderInfo> {
    vec![verified::INFO, emuready::INFO]
}

#[cfg(test)]
#[test]
fn erreurs_serialisables() {
    let j = serde_json::to_value(ProviderError::Offline("EmuReady".into())).unwrap();
    assert_eq!(j["kind"], "offline");
    assert_eq!(j["message"], "Pas de connexion à EmuReady.");
    assert_eq!(serde_json::to_value(ProviderError::RateLimited { retry_after_s: 3 }).unwrap()["retryAfterS"], 3);
    assert_eq!(serde_json::to_value(ProviderError::Invalid("x".into())).unwrap()["kind"], "invalid");
}

#[cfg(test)]
pub mod memory {
    use super::Cache;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    pub struct MemCache(pub RefCell<HashMap<String, (String, bool)>>);

    impl Cache for MemCache {
        fn get(&self, key: &str) -> Option<(String, bool)> {
            self.0.borrow().get(key).cloned()
        }
        fn put(&self, key: &str, body: &str, ttl: i64) {
            self.0.borrow_mut().insert(key.into(), (body.into(), ttl > 0));
        }
    }
}
