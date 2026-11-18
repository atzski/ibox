//! Clés API dans le Gestionnaire d'identifiants Windows (jamais dans la base,
//! ni dans les réglages, ni dans le code). L'interface ne relit jamais une clé :
//! elle sait seulement si une clé est enregistrée.
//!
//! Certains PC refusent l'écriture « Enterprise » (Windows error code 8, profils
//! itinérants, stratégies de domaine, coffre abîmé). On réessaie alors en
//! persistance locale, puis, en dernier recours, dans un fichier chiffré par
//! DPAPI (lisible uniquement par ce compte Windows sur ce PC).
//!
//! Linux (Steam Deck) : pas de coffre système fiable en Mode Jeu (le trousseau KWallet n'y est pas
//! déverrouillé). Les secrets vont dans le dossier de secours, un fichier par clé, **non chiffré**
//! mais lisible par ce seul utilisateur (droits 0600, dossier 0700), comme Steam et la plupart
//! des applications Linux. docs/STEAMDECK.md §12 (D4).

use super::{MetaError, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Once, OnceLock};

const SERVICE: &str = "iBox";
static INIT: Once = Once::new();
static FALLBACK_DIR: OnceLock<PathBuf> = OnceLock::new();

fn init() {
    INIT.call_once(|| {
        // Linux (Steam Deck) : pas encore de coffre (Secret Service ou fichier chiffré, phase D5
        // de docs/STEAMDECK.md) ; sans magasin par défaut, l'enregistrement d'une clé échoue proprement.
        #[cfg(windows)]
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
        write_private(&path, &data)
    }

    /// Écrit le fichier lisible par ce seul utilisateur (Linux : 0600 dès la création, dossier 0700).
    fn write_private(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            if let Some(dir) = path.parent() {
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
            let tmp = path.with_extension("tmp");
            let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp).map_err(|e| e.to_string())?;
            f.write_all(data).map_err(|e| e.to_string())?;
            f.sync_all().map_err(|e| e.to_string())?;
            std::fs::rename(&tmp, path).map_err(|e| e.to_string())
        }
        #[cfg(not(unix))]
        {
            std::fs::write(path, data).map_err(|e| e.to_string())
        }
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

    /// Linux : pas de chiffrement de session comparable à DPAPI ; la protection est celle des
    /// droits du fichier (`write_private`).
    #[cfg(not(windows))]
    mod dpapi {
        pub fn protect(data: &[u8]) -> Result<Vec<u8>, String> { Ok(data.to_vec()) }
        pub fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> { Ok(data.to_vec()) }
    }

    #[cfg(all(test, unix))]
    #[test]
    fn fichier_prive_sous_linux() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("coffre").join("cle.bin");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_private(&path, b"secret").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"secret");
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
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
