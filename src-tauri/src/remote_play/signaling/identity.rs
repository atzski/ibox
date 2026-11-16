//! Identité d'appareil : une paire Ed25519 par iBox. La graine (32 octets) est gardée dans le
//! coffre Windows via `metadata::keys` (jamais dans la base ni les réglages) ; seule la clé
//! publique quitte la machine.

use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

use super::{Result, SignalError};

/// Nom de l'entrée dans le coffre Windows.
pub const VAULT_ENTRY: &str = "remote-play-device-key";
/// Contexte de la preuve de possession envoyée à iNetbox (même chaîne côté serveur).
pub const DEVICE_PROOF_CONTEXT: &str = "ibox-rp-device/1";

pub struct DeviceKey {
    signing: SigningKey,
}

impl DeviceKey {
    /// Nouvelle clé tirée de l'aléa du système.
    pub fn generate() -> Result<Self> {
        let mut seed = [0u8; 32];
        getrandom::fill(&mut seed).map_err(|e| SignalError::Vault(e.to_string()))?;
        let key = DeviceKey { signing: SigningKey::from_bytes(&seed) };
        seed.fill(0);
        Ok(key)
    }

    pub fn from_seed(seed: &[u8; 32]) -> Self {
        DeviceKey { signing: SigningKey::from_bytes(seed) }
    }

    /// Lit la clé du coffre ou en crée une (enregistrée avant d'être utilisée).
    /// `get`/`set` sont injectés pour tester sans toucher au vrai coffre.
    pub fn load_or_create_with(
        get: impl FnOnce() -> std::result::Result<Option<String>, String>,
        set: impl FnOnce(&str) -> std::result::Result<(), String>,
    ) -> Result<Self> {
        if let Some(stored) = get().map_err(SignalError::Vault)? {
            let bytes = B64.decode(stored.trim()).map_err(|_| SignalError::BadKey)?;
            let seed: [u8; 32] = bytes.as_slice().try_into().map_err(|_| SignalError::BadKey)?;
            return Ok(Self::from_seed(&seed));
        }
        let key = Self::generate()?;
        set(&B64.encode(key.signing.to_bytes())).map_err(SignalError::Vault)?;
        Ok(key)
    }

    /// Clé de cet appareil dans le coffre Windows (créée au premier appel).
    pub fn load_or_create() -> Result<Self> {
        use crate::metadata::keys;
        Self::load_or_create_with(
            || keys::get(VAULT_ENTRY).map_err(|e| e.to_string()),
            |secret| keys::set(VAULT_ENTRY, secret).map_err(|e| e.to_string()),
        )
    }

    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing.verifying_key()
    }

    /// Clé publique brute, base64url sans remplissage (43 caractères), format d'iNetbox.
    pub fn public_b64(&self) -> String {
        B64.encode(self.verifying_key().to_bytes())
    }

    pub fn sign(&self, data: &[u8]) -> String {
        B64.encode(self.signing.sign(data).to_bytes())
    }

    /// Preuve de possession pour `POST /v1/remote-play/devices`, liée au compte.
    pub fn device_proof(&self, account_id: &str) -> String {
        self.sign(format!("{DEVICE_PROOF_CONTEXT}\n{account_id}\n{}", self.public_b64()).as_bytes())
    }
}

/// Clé publique reçue d'iNetbox (32 octets base64url), refusée si ce n'est pas un point valide.
pub fn parse_public(b64: &str) -> Result<VerifyingKey> {
    let bytes = B64.decode(b64.trim()).map_err(|_| SignalError::BadKey)?;
    let raw: [u8; 32] = bytes.as_slice().try_into().map_err(|_| SignalError::BadKey)?;
    let key = VerifyingKey::from_bytes(&raw).map_err(|_| SignalError::BadKey)?;
    if key.is_weak() {
        return Err(SignalError::BadKey);
    }
    Ok(key)
}

/// Vérification stricte (rejette les signatures malléables et les clés faibles).
pub fn verify(key: &VerifyingKey, data: &[u8], signature_b64: &str) -> Result<()> {
    let bytes = B64.decode(signature_b64).map_err(|_| SignalError::BadSignature)?;
    let raw: [u8; 64] = bytes.as_slice().try_into().map_err(|_| SignalError::BadSignature)?;
    key.verify_strict(data, &Signature::from_bytes(&raw)).map_err(|_| SignalError::BadSignature)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn cle_creee_une_fois_puis_relue_du_coffre() {
        let vault = RefCell::new(None::<String>);
        let first = DeviceKey::load_or_create_with(|| Ok(vault.borrow().clone()), |s| { *vault.borrow_mut() = Some(s.into()); Ok(()) }).unwrap();
        let stored = vault.borrow().clone().unwrap();
        assert_eq!(B64.decode(&stored).unwrap().len(), 32);
        let again = DeviceKey::load_or_create_with(|| Ok(Some(stored.clone())), |_| panic!("ne doit pas réécrire")).unwrap();
        assert_eq!(first.public_b64(), again.public_b64());
        assert_eq!(first.public_b64().len(), 43);
    }

    #[test]
    fn coffre_abime_ou_indisponible() {
        assert_eq!(DeviceKey::load_or_create_with(|| Ok(Some("pas-une-cle".into())), |_| Ok(())).err(), Some(SignalError::BadKey));
        assert!(matches!(DeviceKey::load_or_create_with(|| Err("verrouillé".into()), |_| Ok(())), Err(SignalError::Vault(_))));
        // une clé qu'on ne peut pas enregistrer n'est pas utilisée
        assert!(matches!(DeviceKey::load_or_create_with(|| Ok(None), |_| Err("refus".into())), Err(SignalError::Vault(_))));
    }

    #[test]
    fn signature_et_preuve() {
        let key = DeviceKey::from_seed(&[7; 32]);
        let public = parse_public(&key.public_b64()).unwrap();
        let sig = key.sign(b"bonjour");
        assert!(verify(&public, b"bonjour", &sig).is_ok());
        assert_eq!(verify(&public, b"bonjouR", &sig), Err(SignalError::BadSignature));
        assert_eq!(verify(&public, b"bonjour", "AAAA"), Err(SignalError::BadSignature));
        let proof = key.device_proof("acc");
        let text = format!("{DEVICE_PROOF_CONTEXT}\nacc\n{}", key.public_b64());
        assert!(verify(&public, text.as_bytes(), &proof).is_ok());
        assert!(verify(&public, text.replace("acc", "autre").as_bytes(), &proof).is_err());
    }

    #[test]
    fn cles_publiques_invalides() {
        assert_eq!(parse_public("court").err(), Some(SignalError::BadKey));
        // point d'ordre faible (identité) : refusé
        let mut identity = [0u8; 32];
        identity[0] = 1;
        assert_eq!(parse_public(&B64.encode(identity)).err(), Some(SignalError::BadKey));
    }
}
