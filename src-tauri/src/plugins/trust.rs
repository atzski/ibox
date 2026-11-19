//! Confiance : SHA-256 et signature ed25519 de l'éditeur, vérifiés avant toute extraction.
//!
//! Message signé : `ibox-plugin-v1\n<id>\n<version>\n<sha256 hex>` (voir `scripts/plugin-sign.mjs`).
//! La clé privée de l'éditeur reste hors du dépôt et du coffre ; seule la clé publique est ici.

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use sha2::{Digest, Sha256};

pub struct Publisher {
    pub id: &'static str,
    /// Clé publique ed25519 brute, en base64.
    pub key: &'static str,
}

/// Éditeurs reconnus. Au départ, un seul : atzski.
pub const PUBLISHERS: &[Publisher] = &[Publisher { id: "atzski", key: "hX6Up74oPxQ7ZjgQXE/PEDbfl1+a9UdiRSlnuLxQsJg=" }];

/// Clé de test (graine fixe) reconnue seulement par les tests unitaires.
#[cfg(test)]
pub const TEST_SEED: [u8; 32] = [7; 32];

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

pub fn message(id: &str, version: &str, sha256: &str) -> String {
    format!("ibox-plugin-v1\n{id}\n{version}\n{sha256}")
}

fn publisher_key(id: &str) -> Option<VerifyingKey> {
    #[cfg(test)]
    if id == "test" {
        return Some(ed25519_dalek::SigningKey::from_bytes(&TEST_SEED).verifying_key());
    }
    let p = PUBLISHERS.iter().find(|p| p.id == id)?;
    let raw = base64::engine::general_purpose::STANDARD.decode(p.key).ok()?;
    VerifyingKey::from_bytes(&raw.try_into().ok()?).ok()
}

/// Vérifie l'empreinte annoncée puis la signature de l'éditeur. Toute erreur refuse le paquet.
pub fn verify(bytes: &[u8], id: &str, version: &str, sha256: &str, signature_b64: &str, publisher: &str) -> Result<(), String> {
    let actual = sha256_hex(bytes);
    if !actual.eq_ignore_ascii_case(sha256.trim()) {
        return Err("Paquet modifié : son empreinte ne correspond pas.".into());
    }
    let key = publisher_key(publisher).ok_or("Éditeur inconnu : paquet refusé.")?;
    let raw = base64::engine::general_purpose::STANDARD.decode(signature_b64.trim()).map_err(|_| "Signature illisible.")?;
    let sig = Signature::from_slice(&raw).map_err(|_| "Signature illisible.")?;
    key.verify_strict(message(id, version, &actual).as_bytes(), &sig).map_err(|_| "Signature invalide : paquet refusé.".to_string())
}

#[cfg(test)]
pub fn sign_for_tests(bytes: &[u8], id: &str, version: &str) -> (String, String) {
    use ed25519_dalek::Signer;
    let sha = sha256_hex(bytes);
    let sig = ed25519_dalek::SigningKey::from_bytes(&TEST_SEED).sign(message(id, version, &sha).as_bytes());
    (sha, base64::engine::general_purpose::STANDARD.encode(sig.to_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_signed_package_passes_and_any_change_is_refused() {
        let bytes = b"paquet".to_vec();
        let (sha, sig) = sign_for_tests(&bytes, "demo", "1.0.0");
        assert!(verify(&bytes, "demo", "1.0.0", &sha, &sig, "test").is_ok());
        // contenu modifié
        assert!(verify(b"paqueT", "demo", "1.0.0", &sha, &sig, "test").is_err());
        // empreinte recalculée mais signature d'origine
        assert!(verify(b"paqueT", "demo", "1.0.0", &sha256_hex(b"paqueT"), &sig, "test").is_err());
        // autre version ou autre identifiant que ceux signés
        assert!(verify(&bytes, "demo", "1.0.1", &sha, &sig, "test").is_err());
        assert!(verify(&bytes, "other", "1.0.0", &sha, &sig, "test").is_err());
        // éditeur inconnu, ou clé d'un autre éditeur
        assert!(verify(&bytes, "demo", "1.0.0", &sha, &sig, "nobody").is_err());
        assert!(verify(&bytes, "demo", "1.0.0", &sha, &sig, "atzski").is_err());
    }

    #[test]
    fn the_embedded_publisher_keys_are_valid() {
        for p in PUBLISHERS {
            assert!(publisher_key(p.id).is_some(), "{}", p.id);
        }
    }
}
