//! Clés API dans le Gestionnaire d'identifiants Windows (jamais dans la base,
//! ni dans les réglages, ni dans le code). L'interface ne relit jamais une clé :
//! elle sait seulement si une clé est enregistrée.

use super::{MetaError, Result};
use std::sync::Once;

const SERVICE: &str = "iBox";
static INIT: Once = Once::new();

fn init() {
    INIT.call_once(|| {
        if let Ok(store) = windows_native_keyring_store::Store::new() {
            keyring_core::set_default_store(store);
        }
    });
}

fn entry(provider: &str) -> Result<keyring_core::Entry> {
    init();
    keyring_core::Entry::new(SERVICE, provider).map_err(|e| MetaError::Vault(e.to_string()))
}

pub fn set(provider: &str, secret: &str) -> Result<()> {
    entry(provider)?.set_password(secret).map_err(|e| MetaError::Vault(e.to_string()))
}

pub fn get(provider: &str) -> Result<Option<String>> {
    match entry(provider)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(MetaError::Vault(e.to_string())),
    }
}

pub fn delete(provider: &str) -> Result<()> {
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(MetaError::Vault(e.to_string())),
    }
}

pub fn has(provider: &str) -> bool {
    matches!(get(provider), Ok(Some(_)))
}
