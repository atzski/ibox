//! Mises à jour d'iBox sur Android (appelé par `shell.rs`).
//!
//! Même `latest.json` que le bureau, avec une entrée `android` de premier niveau, que le plugin
//! updater des iBox de bureau ignore (champ inconnu) :
//!
//! ```json
//! { "version": "1.0.29", "notes": "…", "pub_date": "…", "platforms": { … },
//!   "android": { "version": "1.0.29", "url": "https://…/iBox_1.0.29_android.apk",
//!                "sha256": "<64 chiffres hexadécimaux>", "size": 123456789 } }
//! ```
//!
//! L'APK est téléchargé dans le cache d'iBox (`updates/`), sa somme SHA-256 et sa taille sont
//! vérifiées, puis l'installeur d'Android s'ouvre : l'utilisateur confirme toujours, et Android
//! refuse de lui-même un APK signé par une autre clé que celle d'iBox installé.

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Entrée Android de `latest.json`.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AndroidRelease {
    /// Version de l'APK (à défaut, celle du manifeste).
    #[serde(default)]
    pub version: Option<String>,
    pub url: String,
    pub sha256: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub android: Option<AndroidRelease>,
}

/// Version Android disponible : (version, notes, entrée), seulement si plus récente que `current`.
pub fn available(manifest: &Manifest, current: &str) -> Option<(String, Option<String>, AndroidRelease)> {
    let a = manifest.android.clone()?;
    let version = a.version.clone().unwrap_or_else(|| manifest.version.clone());
    newer(&version, current).then(|| (version.trim_start_matches('v').to_string(), manifest.notes.clone(), a))
}

pub fn parse_manifest(text: &str) -> Result<Manifest, String> {
    serde_json::from_str(text).map_err(|e| format!("manifeste de mise à jour illisible ({e})"))
}

/// Numéros d'une version « 1.0.28 » (préfixe `v` et suffixe `-beta…`/`+…` ignorés).
fn numbers(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches('v').split(['-', '+']).next().unwrap_or("").split('.').map(|n| n.parse().unwrap_or(0)).collect()
}

/// `candidate` est-elle plus récente que `current` ?
pub fn newer(candidate: &str, current: &str) -> bool {
    let (a, b) = (numbers(candidate), numbers(current));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// Somme attendue valide (64 chiffres hexadécimaux), en minuscules.
pub fn expected_sha(release: &AndroidRelease) -> Result<String, String> {
    let s = release.sha256.trim().to_ascii_lowercase();
    if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(s)
    } else {
        Err("Somme de contrôle de la mise à jour absente ou invalide.".into())
    }
}

/// Adresse de l'APK acceptée : HTTPS, ou HTTP vers l'hôte de l'émulateur / la machine locale
/// (essais avec un serveur local, `10.0.2.2` dans l'émulateur Android).
pub fn url_allowed(url: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }
    let Some(rest) = url.strip_prefix("http://") else { return false };
    let host = rest.split(['/', ':']).next().unwrap_or("");
    matches!(host, "10.0.2.2" | "127.0.0.1" | "localhost")
}

pub fn hex(digest: &[u8]) -> String {
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// Somme SHA-256 de données (tests, vérification d'un fichier déjà téléchargé).
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(Sha256::digest(bytes).as_slice())
}

/// Contrôle final du fichier téléchargé.
pub fn verify(release: &AndroidRelease, received: u64, digest_hex: &str) -> Result<(), String> {
    if let Some(size) = release.size {
        if size != received {
            return Err(format!("Mise à jour incomplète ({received} octets reçus sur {size})."));
        }
    }
    if expected_sha(release)? != digest_hex {
        return Err("La mise à jour téléchargée est abîmée (somme de contrôle différente). Réessayez.".into());
    }
    Ok(())
}

/// Adresse du manifeste : `update-endpoint.txt` du dossier de données d'iBox s'il existe
/// (essais : seul iBox, ou `adb shell run-as` sur un APK de débogage, peut l'écrire), sinon
/// celle fixée à la compilation d'une version publiée.
pub fn endpoint(data_dir: Option<&std::path::Path>, built_in: Option<&str>) -> Option<String> {
    let local = data_dir
        .and_then(|d| std::fs::read_to_string(d.join("update-endpoint.txt")).ok())
        .and_then(|t| t.lines().next().map(|l| l.trim().to_string()))
        .filter(|l| url_allowed(l));
    local.or_else(|| built_in.map(str::to_string))
}

#[cfg(mobile)]
pub mod run {
    //! Téléchargement et installation (Android).
    use super::*;
    use crate::shell::UpdateProgress;
    use std::io::Write;
    use std::time::Duration;
    use tauri::{AppHandle, Manager};
    use tauri_plugin_ibox_android::apps::{IboxAppsExt, InstallOutcome};

    fn client(timeout: Duration) -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .timeout(timeout)
            .user_agent(concat!("iBox/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| e.to_string())
    }

    pub fn endpoint_of(app: &AppHandle, built_in: Option<&str>) -> Option<String> {
        super::endpoint(app.path().app_data_dir().ok().as_deref(), built_in)
    }

    /// iBox est à jour : l'APK d'une mise à jour déjà installée ne sert plus (`cache/updates`,
    /// le dossier que donne `AppsPlugin.updateDir`).
    pub fn clean_downloads(app: &AppHandle) {
        let Ok(dir) = app.path().app_cache_dir() else { return };
        if let Ok(entries) = std::fs::read_dir(dir.join("updates")) {
            for e in entries.flatten() {
                if e.path().extension().is_some_and(|x| x == "apk" || x == "part") {
                    let _ = std::fs::remove_file(e.path());
                }
            }
        }
    }

    pub async fn manifest(url: &str, timeout: Duration) -> Result<Manifest, String> {
        let text = client(timeout)?
            .get(url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("Impossible de joindre le serveur de mises à jour ({e})."))?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        parse_manifest(&text)
    }

    /// Télécharge l'APK annoncé, le vérifie et ouvre l'installeur d'Android.
    pub async fn install(
        app: &AppHandle,
        url: &str,
        check_timeout: Duration,
        download_timeout: Duration,
        up_to_date: &str,
        emit: &impl Fn(UpdateProgress),
        log: &impl Fn(&str),
    ) -> Result<(), String> {
        emit(UpdateProgress::Checking);
        log("recherche (Android)");
        let m = manifest(url, check_timeout).await?;
        let current = app.package_info().version.to_string();
        let (version, _, release) = available(&m, &current).ok_or_else(|| up_to_date.to_string())?;
        if !url_allowed(&release.url) {
            return Err("Adresse de la mise à jour refusée (HTTPS obligatoire).".into());
        }
        let expected = expected_sha(&release)?;
        log(&format!("trouvée : {version}"));

        let dir = std::path::PathBuf::from(app.ibox_apps().update_dir().map_err(|e| e.to_string())?);
        // anciens téléchargements
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let _ = std::fs::remove_file(e.path());
            }
        }
        let part = dir.join(format!("iBox-{version}.apk.part"));
        let apk = dir.join(format!("iBox-{version}.apk"));
        let mut file = std::fs::File::create(&part).map_err(|e| format!("Écriture impossible : {e}"))?;
        emit(UpdateProgress::Downloading { received: 0, total: release.size });
        let mut resp = client(download_timeout)?
            .get(&release.url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("Téléchargement impossible : {e}"))?;
        let total = release.size.or(resp.content_length());
        let mut hasher = Sha256::new();
        let (mut received, mut reported) = (0u64, 0u64);
        while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Téléchargement interrompu : {e}"))? {
            received += chunk.len() as u64;
            if release.size.is_some_and(|s| received > s) {
                let _ = std::fs::remove_file(&part);
                return Err("La mise à jour téléchargée est plus grande qu'annoncé.".into());
            }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| format!("Écriture impossible : {e}"))?;
            if received - reported >= 256 * 1024 || total == Some(received) {
                reported = received;
                emit(UpdateProgress::Downloading { received, total });
            }
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        emit(UpdateProgress::Verifying);
        if let Err(e) = verify(&release, received, &hex(hasher.finalize().as_slice())) {
            let _ = std::fs::remove_file(&part);
            return Err(e);
        }
        std::fs::rename(&part, &apk).map_err(|e| e.to_string())?;
        log(&format!("téléchargée ({received} octets, SHA-256 vérifiée {}…), installeur d'Android", &expected[..12]));
        emit(UpdateProgress::Installing);
        let path = apk.to_string_lossy().to_string();
        let worker = app.clone();
        // l'installeur d'Android répond au retour dans iBox (ou jamais, s'il remplace iBox)
        let outcome = tauri::async_runtime::spawn_blocking(move || worker.ibox_apps().install_apk(&path))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        log(&format!("installeur : {outcome:?}"));
        match outcome {
            InstallOutcome::Installed | InstallOutcome::Installer => Ok(()),
            InstallOutcome::Cancelled => Err("Installation annulée.".into()),
            InstallOutcome::Permission => Err("Autorisez iBox à installer des applications (page d'Android), puis réessayez.".into()),
            InstallOutcome::Failed => Err("Android a refusé la mise à jour. Si iBox a été installé depuis une autre source (clé différente), désinstallez-le puis installez le nouvel APK.".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
      "version": "1.0.29",
      "notes": "Corrections",
      "pub_date": "2026-11-27T10:00:00Z",
      "platforms": { "windows-x86_64": { "signature": "c2ln", "url": "https://github.com/atzski/ibox/releases/download/v1.0.29/iBox_1.0.29_x64-setup.exe" } },
      "android": { "url": "https://github.com/atzski/ibox/releases/download/v1.0.29/iBox_1.0.29_android.apk",
                   "sha256": "AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12", "size": 3 }
    }"#;

    #[test]
    fn versions() {
        assert!(newer("1.0.29", "1.0.28"));
        assert!(newer("v1.1", "1.0.99"));
        assert!(newer("2.0.0", "1.99.99"));
        assert!(!newer("1.0.28", "1.0.28"));
        assert!(!newer("1.0.28-beta", "1.0.28"));
        assert!(!newer("1.0.27", "1.0.28"));
    }

    #[test]
    fn manifeste_android() {
        let m = parse_manifest(MANIFEST).unwrap();
        let (v, notes, a) = available(&m, "1.0.28").unwrap();
        assert_eq!(v, "1.0.29");
        assert_eq!(notes.as_deref(), Some("Corrections"));
        assert_eq!(expected_sha(&a).unwrap().len(), 64);
        assert!(available(&m, "1.0.29").is_none());
        // ancien manifeste, sans entrée Android : rien à proposer
        let old = parse_manifest(r#"{"version":"1.0.29","platforms":{}}"#).unwrap();
        assert!(available(&old, "1.0.0").is_none());
    }

    /// Les iBox de bureau lisent le même fichier : l'entrée `android` ne doit pas les gêner.
    #[cfg(desktop)]
    #[test]
    fn bureau_ignore_l_entree_android() {
        let r: tauri_plugin_updater::RemoteRelease = serde_json::from_str(MANIFEST).unwrap();
        assert_eq!(r.version.to_string(), "1.0.29");
        assert!(r.download_url("windows-x86_64").is_ok());
    }

    #[test]
    fn verification() {
        let data = b"abc";
        let mut a = AndroidRelease { version: None, url: "https://x/y.apk".into(), sha256: sha256_hex(data).to_uppercase(), size: Some(3) };
        assert!(verify(&a, 3, &sha256_hex(data)).is_ok());
        assert!(verify(&a, 2, &sha256_hex(data)).unwrap_err().contains("incomplète"));
        assert!(verify(&a, 3, &sha256_hex(b"abd")).unwrap_err().contains("abîmée"));
        a.sha256 = "court".into();
        assert!(verify(&a, 3, &sha256_hex(data)).is_err());
    }

    #[test]
    fn adresses() {
        assert!(url_allowed("https://github.com/atzski/ibox/releases/download/v1/a.apk"));
        assert!(url_allowed("http://10.0.2.2:8765/latest.json"));
        assert!(url_allowed("http://127.0.0.1/a.apk"));
        assert!(!url_allowed("http://exemple.com/a.apk"));
        assert!(!url_allowed("http://10.0.2.2.exemple.com/a.apk"));
        assert!(!url_allowed("file:///sdcard/a.apk"));

        let dir = tempfile::tempdir().unwrap();
        assert_eq!(endpoint(Some(dir.path()), None), None);
        assert_eq!(endpoint(Some(dir.path()), Some("https://a/latest.json")).as_deref(), Some("https://a/latest.json"));
        std::fs::write(dir.path().join("update-endpoint.txt"), "http://10.0.2.2:8765/latest.json\n").unwrap();
        assert_eq!(endpoint(Some(dir.path()), Some("https://a/latest.json")).as_deref(), Some("http://10.0.2.2:8765/latest.json"));
        std::fs::write(dir.path().join("update-endpoint.txt"), "http://exemple.com/latest.json").unwrap();
        assert_eq!(endpoint(Some(dir.path()), None), None);
    }
}
