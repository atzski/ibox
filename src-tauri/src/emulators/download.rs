//! Résolution des versions et téléchargement depuis les seules sources
//! officielles (HTTPS, hôtes autorisés, redirections vérifiées une à une),
//! avec taille plafonnée, empreinte SHA-256 calculée au fil de l'eau,
//! progression et annulation.

use super::catalog::{self, Package, Source};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Version précise à installer, déterminée côté natif.
#[derive(Debug, Clone, PartialEq)]
pub struct Resolved {
    pub version: String,
    pub url: String,
    pub file_name: String,
    pub size: Option<u64>,
    /// Empreinte publiée par la source officielle (GitHub) : « sha256 » en hexadécimal.
    pub sha256: Option<String>,
}

pub fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(concat!("iBox/", env!("CARGO_PKG_VERSION"), " (+https://github.com/atzski/ibox)"))
        .https_only(true)
        .connect_timeout(Duration::from_secs(20))
        .timeout(None)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 6 {
                attempt.error("trop de redirections")
            } else if catalog::host_allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("redirection vers une source non autorisée")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

fn get_json(http: &reqwest::blocking::Client, url: &str) -> Result<serde_json::Value, String> {
    let parsed: reqwest::Url = url.parse().map_err(|_| "adresse invalide".to_string())?;
    if !catalog::host_allowed(&parsed) {
        return Err("source non autorisée".into());
    }
    http.get(parsed)
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(30))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| net_message(&e))?
        .json()
        .map_err(|_| "réponse illisible de la source officielle".into())
}

fn get_text(http: &reqwest::blocking::Client, url: &str) -> Result<String, String> {
    http.get(url)
        .timeout(Duration::from_secs(30))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| net_message(&e))
}

pub fn net_message(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "la source officielle ne répond pas (délai dépassé)".into()
    } else if e.is_connect() {
        "connexion impossible : vérifiez votre accès à Internet".into()
    } else if let Some(s) = e.status() {
        if s.as_u16() == 403 || s.as_u16() == 429 {
            "la source officielle limite temporairement les requêtes, réessayez dans quelques minutes".into()
        } else {
            format!("la source officielle a répondu {}", s.as_u16())
        }
    } else if e.is_redirect() {
        "redirection refusée (source non officielle)".into()
    } else {
        "erreur réseau pendant le téléchargement".into()
    }
}

/// Choisit le fichier d'une release GitHub (JSON de l'API `releases/latest`).
pub fn pick_github_asset(release: &serde_json::Value, asset: &catalog::AssetMatch) -> Result<Resolved, String> {
    let tag = release["tag_name"].as_str().ok_or("release sans version")?;
    if release["prerelease"].as_bool() == Some(true) || release["draft"].as_bool() == Some(true) {
        return Err("seules les versions stables sont proposées".into());
    }
    let found = release["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str().is_some_and(|n| asset.matches(n)))
        .ok_or("aucun fichier Windows dans la dernière version officielle")?;
    let url = found["browser_download_url"].as_str().ok_or("adresse de téléchargement absente")?;
    let sha256 = found["digest"]
        .as_str()
        .and_then(|d| d.strip_prefix("sha256:"))
        .filter(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
        .map(|h| h.to_ascii_lowercase());
    // version lisible : l'étiquette si elle en est une, sinon le nom de la release, sinon sa date
    let clean = |s: &str| s.trim().trim_start_matches(['v', 'V']).trim_start_matches('.').to_string();
    let starts_digit = |s: &str| s.chars().next().is_some_and(|c| c.is_ascii_digit());
    let name = release["name"].as_str().map(clean).unwrap_or_default();
    let version = if starts_digit(&clean(tag)) {
        clean(tag)
    } else if starts_digit(&name) && name.len() <= 32 {
        name
    } else {
        release["published_at"].as_str().map(|d| d.chars().take(10).collect()).unwrap_or_else(|| clean(tag))
    };
    Ok(Resolved {
        version,
        url: url.to_string(),
        file_name: found["name"].as_str().unwrap_or_default().to_string(),
        size: found["size"].as_u64(),
        sha256,
    })
}

/// Version courante de Dolphin d'après son API officielle.
pub fn pick_dolphin(json: &serde_json::Value) -> Result<Resolved, String> {
    let version = json["shortrev"].as_str().ok_or("version de Dolphin absente")?;
    let url = json["artifacts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|a| a["url"].as_str())
        .find(|u| u.starts_with("https://dl.dolphin-emu.org/") && u.ends_with("-x64.7z"))
        .ok_or("aucune version Windows x64 de Dolphin")?;
    Ok(Resolved {
        version: version.to_string(),
        url: url.to_string(),
        file_name: url.rsplit('/').next().unwrap_or("dolphin.7z").to_string(),
        size: None,
        sha256: None,
    })
}

/// Dernière version stable listée sur buildbot.libretro.com/stable/.
pub fn pick_retroarch(listing: &str) -> Result<Resolved, String> {
    let mut best: Option<(Vec<u32>, String)> = None;
    for part in listing.split("stable/").skip(1) {
        let v: String = part.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let nums: Vec<u32> = v.split('.').filter_map(|n| n.parse().ok()).collect();
        if nums.len() == 3 && best.as_ref().is_none_or(|(b, _)| nums > *b) {
            best = Some((nums, v.trim_end_matches('.').to_string()));
        }
    }
    let (_, v) = best.ok_or("version de RetroArch introuvable")?;
    Ok(Resolved {
        url: format!("https://buildbot.libretro.com/stable/{v}/windows/x86_64/RetroArch.7z"),
        version: v,
        file_name: "RetroArch.7z".into(),
        size: None,
        sha256: None,
    })
}

pub fn resolve(http: &reqwest::blocking::Client, pkg: &Package) -> Result<Resolved, String> {
    match pkg.source {
        Source::GitHub { repo, asset } => {
            let json = get_json(http, &format!("https://api.github.com/repos/{repo}/releases/latest"))?;
            pick_github_asset(&json, &asset)
        }
        Source::Dolphin => pick_dolphin(&get_json(http, "https://dolphin-emu.org/update/latest/beta/")?),
        Source::RetroArch => pick_retroarch(&get_text(http, "https://buildbot.libretro.com/stable/")?),
        Source::LibretroCore { file } => Ok(Resolved {
            version: "nightly".into(),
            url: format!("https://buildbot.libretro.com/nightly/windows/x86_64/latest/{file}.zip"),
            file_name: format!("{file}.zip"),
            size: None,
            sha256: None,
        }),
        Source::Manual => Err("cet émulateur s'installe depuis son site officiel".into()),
    }
}

#[derive(Debug, PartialEq)]
pub enum DownloadError {
    Cancelled,
    Failed(String),
}

impl From<String> for DownloadError {
    fn from(s: String) -> Self {
        DownloadError::Failed(s)
    }
}

/// Télécharge `r.url` dans `dest` (fichier `.part` renommé à la fin).
/// `progress(reçu, total, octets/s)` est appelé au plus quatre fois par seconde.
/// Renvoie l'empreinte SHA-256 calculée ; si la source en publie une, elle doit correspondre.
pub fn download(
    http: &reqwest::blocking::Client,
    r: &Resolved,
    dest: &Path,
    max: u64,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, Option<u64>, u64),
) -> Result<String, DownloadError> {
    let url: reqwest::Url = r.url.parse().map_err(|_| "adresse invalide".to_string())?;
    if !catalog::host_allowed(&url) {
        return Err("source non autorisée".to_string().into());
    }
    if r.size.is_some_and(|s| s > max) {
        return Err("fichier plus volumineux que prévu pour cet émulateur".to_string().into());
    }
    let mut resp = http.get(url).send().and_then(|r| r.error_for_status()).map_err(|e| net_message(&e))?;
    if !catalog::host_allowed(resp.url()) {
        return Err("source finale non autorisée".to_string().into());
    }
    let total = resp.content_length().or(r.size);
    if total.is_some_and(|t| t > max) {
        return Err("fichier plus volumineux que prévu pour cet émulateur".to_string().into());
    }
    if let (Some(expected), Some(announced)) = (r.size, resp.content_length()) {
        if expected != announced {
            return Err("taille différente de celle annoncée par la source officielle".to_string().into());
        }
    }
    let part = dest.with_extension("part");
    let mut file = std::fs::File::create(&part).map_err(|e| disk_message(&e))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let (mut received, start) = (0u64, Instant::now());
    let (mut last_tick, mut window_bytes, mut window_start, mut speed) = (Instant::now() - Duration::from_secs(1), 0u64, Instant::now(), 0u64);
    let result = loop {
        if cancel.load(Ordering::Relaxed) {
            break Err(DownloadError::Cancelled);
        }
        let n = match resp.read(&mut buf) {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(_) => break Err(DownloadError::Failed("connexion interrompue pendant le téléchargement".into())),
        };
        received += n as u64;
        window_bytes += n as u64;
        if received > max {
            break Err(DownloadError::Failed("téléchargement plus volumineux que prévu, arrêté".into()));
        }
        hasher.update(&buf[..n]);
        if let Err(e) = file.write_all(&buf[..n]) {
            break Err(DownloadError::Failed(disk_message(&e)));
        }
        if last_tick.elapsed() >= Duration::from_millis(250) {
            let w = window_start.elapsed().as_secs_f64();
            if w >= 1.0 {
                speed = (window_bytes as f64 / w) as u64;
                window_bytes = 0;
                window_start = Instant::now();
            } else if speed == 0 {
                speed = (received as f64 / start.elapsed().as_secs_f64().max(0.05)) as u64;
            }
            progress(received, total, speed);
            last_tick = Instant::now();
        }
    };
    drop(file);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    if total.is_some_and(|t| t != received) {
        let _ = std::fs::remove_file(&part);
        return Err("téléchargement incomplet".to_string().into());
    }
    progress(received, Some(received), speed);
    let digest = hex(&hasher.finalize());
    if let Some(expected) = &r.sha256 {
        if !expected.eq_ignore_ascii_case(&digest) {
            let _ = std::fs::remove_file(&part);
            return Err("empreinte SHA-256 différente de celle publiée : fichier rejeté".to_string().into());
        }
    }
    std::fs::rename(&part, dest).map_err(|e| disk_message(&e))?;
    Ok(digest)
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn disk_message(e: &std::io::Error) -> String {
    // 112 = ERROR_DISK_FULL, 39 = ERROR_HANDLE_DISK_FULL
    match e.raw_os_error() {
        Some(112) | Some(39) => "espace disque insuffisant".into(),
        Some(5) => "accès refusé au dossier des émulateurs (droits insuffisants)".into(),
        Some(32) | Some(33) => "un fichier est utilisé par un autre programme (l'émulateur est-il ouvert ?)".into(),
        _ => match e.kind() {
            std::io::ErrorKind::PermissionDenied => "accès refusé au dossier des émulateurs".into(),
            _ => format!("erreur d'écriture sur le disque ({e})"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn release_github_et_empreinte() {
        let rel = json!({
            "tag_name": "v1.20.4", "prerelease": false, "draft": false,
            "assets": [
                {"name": "PPSSPP-v1.20.4-Windows-ARM64.zip", "browser_download_url": "https://github.com/x/arm.zip", "size": 1, "digest": "sha256:aa"},
                {"name": "PPSSPP-v1.20.4-Windows-x64.zip", "browser_download_url": "https://github.com/x/x64.zip", "size": 19, "digest": "sha256:FBC9CD2F5131B159A92424E5C458C35CE43BA603CDDED64DFC98E4BD4F17FF93"}
            ]
        });
        let Source::GitHub { asset, .. } = catalog::package("ppsspp").unwrap().source else { panic!() };
        let r = pick_github_asset(&rel, &asset).unwrap();
        assert_eq!(r.version, "1.20.4");
        assert_eq!(r.url, "https://github.com/x/x64.zip");
        assert_eq!(r.sha256.as_deref(), Some("fbc9cd2f5131b159a92424e5c458c35ce43ba603cdded64dfc98e4bd4f17ff93"));
        let mut pre = rel.clone();
        pre["prerelease"] = json!(true);
        assert!(pick_github_asset(&pre, &asset).is_err());
    }

    #[test]
    fn dolphin_et_retroarch() {
        let d = json!({"shortrev": "2609b", "artifacts": [
            {"system": "Windows arm64", "url": "https://dl.dolphin-emu.org/releases/2609b/dolphin-2609b-ARM64.7z"},
            {"system": "Windows x64", "url": "https://dl.dolphin-emu.org/releases/2609b/dolphin-2609b-x64.7z"}]});
        let r = pick_dolphin(&d).unwrap();
        assert_eq!((r.version.as_str(), r.file_name.as_str()), ("2609b", "dolphin-2609b-x64.7z"));
        let listing = r#"<a href="/stable/1.9.0/">1.9.0</a><a href="/stable/1.22.2/">1.22.2</a><a href="/stable/1.22.10/">x</a>"#;
        assert_eq!(pick_retroarch(listing).unwrap().version, "1.22.10");
    }

    #[test]
    fn telechargement_refuse_hors_sources_officielles() {
        let http = client().unwrap();
        let r = Resolved { version: "1".into(), url: "https://example.com/x.zip".into(), file_name: "x.zip".into(), size: None, sha256: None };
        let dir = tempfile::tempdir().unwrap();
        let err = download(&http, &r, &dir.path().join("x.zip"), 10, &AtomicBool::new(false), |_, _, _| {}).unwrap_err();
        assert_eq!(err, DownloadError::Failed("source non autorisée".into()));
    }
}
