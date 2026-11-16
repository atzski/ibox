//! Clés API dans le Gestionnaire d'identifiants Windows (jamais dans la base,
//! ni dans les réglages, ni dans le code). L'interface ne relit jamais une clé :
//! elle sait seulement si une clé est enregistrée.
//!
//! Certains PC refusent l'écriture « Enterprise » (Windows error code 8, profils
//! itinérants, stratégies de domaine, coffre abîmé). On réessaie alors en
//! persistance locale, puis, en dernier recours, dans un fichier chiffré par
//! DPAPI (lisible uniquement par ce compte Windows sur ce PC).

use super::{MetaError, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Once, OnceLock};

const SERVICE: &str = "iBox";
static INIT: Once = Once::new();
static FALLBACK_DIR: OnceLock<PathBuf> = OnceLock::new();

fn init() {
    INIT.call_once(|| {
        if let Ok(store) = windows_native_keyring_store::Store::new() {
            keyring_core::set_default_store(store);
        }
    });
}

/// Dossier du coffre de secours (appelé une fois au démarrage).
pub fn set_fallback_dir(dir: PathBuf) {
    let _ = FALLBACK_DIR.set(dir);
}

fn entry(provider: &str) -> Result<keyring_core::Entry> {
    init();
    keyring_core::Entry::new(SERVICE, provider).map_err(|e| MetaError::Vault(e.to_string()))
}

fn local_entry(provider: &str) -> Result<keyring_core::Entry> {
    init();
    let mods = HashMap::from([("persistence", "Local")]);
    keyring_core::Entry::new_with_modifiers(SERVICE, provider, &mods).map_err(|e| MetaError::Vault(e.to_string()))
}

pub fn set(provider: &str, secret: &str) -> Result<()> {
    let first = match entry(provider).and_then(|e| e.set_password(secret).map_err(|e| MetaError::Vault(e.to_string()))) {
        Ok(()) => return Ok(fallback::remove(provider)),
        Err(e) => e,
    };
    if let Ok(e) = local_entry(provider) {
        if e.set_password(secret).is_ok() {
            fallback::remove(provider);
            return Ok(());
        }
    }
    eprintln!("iBox : Gestionnaire d'identifiants indisponible ({first}), coffre de secours chiffré utilisé");
    fallback::write(provider, secret).map_err(|e| MetaError::Vault(format!("{first} ; secours : {e}")))
}

pub fn get(provider: &str) -> Result<Option<String>> {
    let native = entry(provider).and_then(|e| match e.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(MetaError::Vault(e.to_string())),
    });
    match native {
        Ok(Some(s)) => Ok(Some(s)),
        Ok(None) => Ok(fallback::read(provider)),
        Err(e) => match fallback::read(provider) {
            Some(s) => Ok(Some(s)),
            None if fallback::available() => Ok(None),
            None => Err(e),
        },
    }
}

pub fn delete(provider: &str) -> Result<()> {
    fallback::remove(provider);
    match entry(provider)?.delete_credential() {
        Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(MetaError::Vault(e.to_string())),
    }
}

pub fn has(provider: &str) -> bool {
    matches!(get(provider), Ok(Some(_)))
}

/// Coffre de secours : un fichier par clé, chiffré par DPAPI (portée utilisateur).
mod fallback {
    use super::FALLBACK_DIR;
    use std::path::PathBuf;

    pub fn available() -> bool {
        FALLBACK_DIR.get().is_some()
    }

    fn path(provider: &str) -> Option<PathBuf> {
        let safe: String = provider.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' { c } else { '_' }).collect();
        FALLBACK_DIR.get().map(|d| d.join(format!("{safe}.bin")))
    }

    pub fn write(provider: &str, secret: &str) -> Result<(), String> {
        let path = path(provider).ok_or("dossier de secours inconnu")?;
        let data = dpapi::protect(secret.as_bytes())?;
        if let Some(dir) = path.parent() { std::fs::create_dir_all(dir).map_err(|e| e.to_string())?; }
        std::fs::write(&path, data).map_err(|e| e.to_string())
    }

    pub fn read(provider: &str) -> Option<String> {
        let data = std::fs::read(path(provider)?).ok()?;
        String::from_utf8(dpapi::unprotect(&data).ok()?).ok()
    }

    pub fn remove(provider: &str) {
        if let Some(p) = path(provider) { let _ = std::fs::remove_file(p); }
    }

    #[cfg(windows)]
    mod dpapi {
        use windows_sys::Win32::Foundation::{LocalFree, GetLastError};
        use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};

        fn run(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
            let mut inp = CRYPT_INTEGER_BLOB { cbData: input.len() as u32, pbData: input.as_ptr() as *mut u8 };
            let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
            let ok = unsafe {
                if protect {
                    CryptProtectData(&mut inp, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                } else {
                    CryptUnprotectData(&mut inp, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
                }
            };
            if ok == 0 {
                return Err(format!("DPAPI : erreur Windows {}", unsafe { GetLastError() }));
            }
            let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
            unsafe { LocalFree(out.pbData as _) };
            Ok(bytes)
        }

        pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> { run(data, true) }
        pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> { run(data, false) }
    }

    #[cfg(not(windows))]
    mod dpapi {
        pub fn protect(_: &[u8]) -> Result<Vec<u8>, String> { Err("indisponible".into()) }
        pub fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> { Err("indisponible".into()) }
    }

    #[cfg(all(test, windows))]
    #[test]
    fn dpapi_aller_retour() {
        let secret = "clé-test-123";
        let enc = dpapi::protect(secret.as_bytes()).unwrap();
        assert_ne!(enc, secret.as_bytes());
        assert_eq!(dpapi::unprotect(&enc).unwrap(), secret.as_bytes());
    }
}
