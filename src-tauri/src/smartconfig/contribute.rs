//! Contribution à iBox SmartConfig Community (iNetbox) : publier, voter,
//! signaler, retirer. Authentification : la session iNetbox existante du
//! profil local (le jeton reste dans le natif, `inetbox::smartconfig_call`).
//!
//! Publication en deux temps, sans surprise :
//! 1. `smartconfig_community_preview` construit **exactement** le corps JSON qui
//!    partira (`PublicSummary` + réglages validés + observations) et son empreinte ;
//! 2. `smartconfig_community_publish` le reconstruit et refuse de l'envoyer si
//!    l'empreinte diffère de celle de l'aperçu montré (matériel, réglages ou
//!    texte changés entre-temps).
//!
//! Rien n'est envoyé automatiquement. Aucun chemin, aucun numéro de série
//! matériel, aucune clé : seuls les champs ci-dessous existent.

use super::adapters::{self, Adapter};
use super::hardware::HardwareInfo;
use super::model::{GameQuery, Mode, Setting};
use super::validation::{self, Rejected};
use crate::library::commands::LibraryState;
use crate::library::LibraryError;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

type Res<T> = Result<T, String>;

const MAX_TITLE: usize = 160;
const MAX_BUGS: usize = 500;
const MAX_DESCRIPTION: usize = 1000;

/// Ce que l'utilisateur a choisi ou décrit (formulaire de publication).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// Réglages proposés (en pratique : ceux de l'optimisation appliquée ou du fichier actuel).
    pub settings: Vec<Setting>,
    pub mode: Mode,
    /// `perfect`, `great`, `playable`, `poor`, `unplayable`.
    pub performance: String,
    /// `stable`, `minor_issues`, `crashes`.
    pub stability: String,
    #[serde(default)]
    pub bugs: String,
    #[serde(default)]
    pub description: String,
    /// Profil existant de l'utilisateur pour ce jeu : publie une nouvelle version.
    #[serde(default)]
    pub profile_id: Option<String>,
}

/// Aperçu exact d'une publication.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributionPreview {
    /// Service iNetbox destinataire.
    pub service: String,
    pub method: &'static str,
    pub path: String,
    /// Corps JSON envoyé, à l'octet près.
    pub body: Value,
    /// Empreinte SHA-256 du corps, à renvoyer à la publication.
    pub digest: String,
    /// Réglages retirés avant l'envoi (hors liste blanche, contrôle matériel…).
    pub rejected: Vec<Rejected>,
}

fn one_of(value: &str, allowed: &[&str], what: &str) -> Res<()> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(format!("{what} invalide"))
    }
}

fn clean(s: &str, max: usize) -> String {
    s.trim().replace("\r\n", "\n").chars().take(max).collect()
}

/// Version d'émulateur publiable telle quelle (sinon : non communiquée).
fn emulator_version(v: Option<&str>) -> Option<String> {
    let v = v?.trim();
    let ok = !v.is_empty()
        && v.len() <= 40
        && v.bytes().enumerate().all(|(i, b)| b.is_ascii_alphanumeric() || (i > 0 && matches!(b, b' ' | b'.' | b'_' | b'+' | b'-')));
    ok.then(|| v.to_string())
}

/// Construit le corps exact envoyé au serveur. Pure : testée sans réseau.
pub fn build(adapter: &dyn Adapter, game: &GameQuery, version: Option<&str>, hw: &HardwareInfo, draft: &Draft) -> Res<ContributionPreview> {
    let serial = game.serial.as_deref().map(str::to_ascii_uppercase).filter(|s| super::providers::community::valid_serial(s));
    let serial = serial.ok_or("numéro de série du jeu inconnu : la communauté identifie les jeux par numéro de série")?;
    if !adapter.platforms().contains(&game.platform.as_str()) {
        return Err("console non prise en charge par cet émulateur".into());
    }
    let mode = match draft.mode {
        Mode::Performance => "performance",
        Mode::Balanced => "balanced",
        Mode::Quality => "quality",
        Mode::Manual => return Err("choisissez le mode correspondant à ces réglages".into()),
    };
    one_of(&draft.performance, &["perfect", "great", "playable", "poor", "unplayable"], "performance")?;
    one_of(&draft.stability, &["stable", "minor_issues", "crashes"], "stabilité")?;
    let checked = validation::validate(&draft.settings, adapter.specs(), hw);
    if checked.accepted.is_empty() {
        return Err("aucun réglage publiable".into());
    }
    let mut settings = checked.accepted;
    settings.sort_by(|a, b| a.key.cmp(&b.key));
    let s = hw.public_summary();
    let text = |v: Option<String>| v.map(|x| clean(&x, 120)).filter(|x| !x.is_empty());
    let hardware = json!({ "os": s.os, "arch": s.arch, "cpu": text(s.cpu), "gpu": text(s.gpu), "ramGb": s.ram_gb.filter(|g| (1..=1024).contains(g)), "device": s.device });
    let version_body = json!({
        "emulatorVersion": emulator_version(version),
        "hardware": hardware,
        "mode": mode,
        "settings": settings,
        "performance": draft.performance,
        "stability": draft.stability,
        "bugs": clean(&draft.bugs, MAX_BUGS),
        "description": clean(&draft.description, MAX_DESCRIPTION),
    });
    let (path, body) = match draft.profile_id.as_deref() {
        Some(id) if crate::inetbox::is_uuid(id) => (format!("/v1/smartconfig/profiles/{id}/versions"), version_body),
        Some(_) => return Err("identifiant de profil invalide".into()),
        None => (
            "/v1/smartconfig/profiles".to_string(),
            json!({ "game": { "platform": game.platform, "serial": serial, "title": clean(&game.title, MAX_TITLE) }, "emulator": adapter.id(), "version": version_body }),
        ),
    };
    let bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    Ok(ContributionPreview {
        service: crate::inetbox::service_url().to_string(),
        method: "POST",
        path,
        digest: super::backup::sha256(&bytes),
        body,
        rejected: checked.rejected,
    })
}

fn prepare(app: &AppHandle, game_id: i64, draft: &Draft) -> Res<ContributionPreview> {
    let lib = app.state::<LibraryState>();
    let (game, install) = lib.with(|c| super::storage::game_context(c, game_id)?.ok_or(LibraryError::NotFound))?;
    let install = install.ok_or("aucun émulateur associé à ce jeu")?;
    let adapter = adapters::by_id(&install.profile_id).ok_or("émulateur non pris en charge par SmartConfig")?;
    build(adapter.as_ref(), &game, install.version.as_deref(), &super::commands::hardware_snapshot(app), draft)
}

fn call(method: Method, path: &str, body: Option<&Value>, auth: bool) -> Res<Value> {
    crate::inetbox::smartconfig_call(method, path, body, auth).map_err(|e| e.message().to_string())
}

fn uuid(id: &str) -> Res<&str> {
    crate::inetbox::is_uuid(id).then_some(id).ok_or_else(|| "identifiant invalide".to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Aperçu exact de la publication : rien n'est envoyé.
#[tauri::command]
pub async fn smartconfig_community_preview(app: AppHandle, game_id: i64, draft: Draft) -> Res<ContributionPreview> {
    blocking(move || prepare(&app, game_id, &draft)).await
}

/// Publie ce que l'aperçu a montré (empreinte identique), avec le compte iNetbox connecté.
#[tauri::command]
pub async fn smartconfig_community_publish(app: AppHandle, game_id: i64, draft: Draft, digest: String) -> Res<Value> {
    blocking(move || {
        let preview = prepare(&app, game_id, &draft)?;
        if preview.digest != digest {
            return Err("Les données à publier ont changé depuis l'aperçu : vérifiez le nouvel aperçu.".into());
        }
        call(Method::POST, &preview.path, Some(&preview.body), true)
    })
    .await
}

/// Profils publiés d'un jeu, tels que le serveur les décrit (badge, versions, votes) — lecture publique.
#[tauri::command]
pub async fn smartconfig_community_profile(profile_id: String) -> Res<Value> {
    blocking(move || call(Method::GET, &format!("/v1/smartconfig/profiles/{}", uuid(&profile_id)?), None, false)).await
}

/// Contributions publiques d'un joueur.
#[tauri::command]
pub async fn smartconfig_community_player(account_id: String) -> Res<Value> {
    blocking(move || call(Method::GET, &format!("/v1/smartconfig/players/{}/profiles", uuid(&account_id)?), None, false)).await
}

/// Mes profils (masqués compris, avec leur statut).
#[tauri::command]
pub async fn smartconfig_community_mine() -> Res<Value> {
    blocking(|| call(Method::GET, "/v1/smartconfig/mine", None, true)).await
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vote {
    pub works: bool,
    pub stability: Option<u8>,
    pub quality: Option<u8>,
    pub performance: Option<u8>,
}

/// Confirme / évalue une version (un vote par compte, remplacé s'il est renvoyé).
#[tauri::command]
pub async fn smartconfig_community_vote(version_id: String, vote: Vote) -> Res<()> {
    blocking(move || {
        let ok = |n: Option<u8>| n.is_none_or(|n| (1..=5).contains(&n));
        if !(ok(vote.stability) && ok(vote.quality) && ok(vote.performance)) {
            return Err("note invalide (1 à 5)".into());
        }
        let body = json!({ "works": vote.works, "stability": vote.stability, "quality": vote.quality, "performance": vote.performance });
        call(Method::PUT, &format!("/v1/smartconfig/versions/{}/vote", uuid(&version_id)?), Some(&body), true).map(|_| ())
    })
    .await
}

#[tauri::command]
pub async fn smartconfig_community_unvote(version_id: String) -> Res<()> {
    blocking(move || call(Method::DELETE, &format!("/v1/smartconfig/versions/{}/vote", uuid(&version_id)?), None, true).map(|_| ())).await
}

/// Signale un profil (`broken`, `dangerous`, `personal_data`, `spam`, `offensive`, `other`).
#[tauri::command]
pub async fn smartconfig_community_report(profile_id: String, reason: String, version_id: Option<String>, comment: Option<String>) -> Res<Value> {
    blocking(move || {
        one_of(&reason, &["broken", "dangerous", "personal_data", "spam", "offensive", "other"], "motif")?;
        let version_id = version_id.as_deref().map(uuid).transpose()?;
        let body = json!({ "reason": reason, "versionId": version_id, "comment": clean(comment.as_deref().unwrap_or_default(), 300) });
        call(Method::POST, &format!("/v1/smartconfig/profiles/{}/report", uuid(&profile_id)?), Some(&body), true)
    })
    .await
}

/// Retire (efface) un de mes profils, toutes versions et votes compris.
#[tauri::command]
pub async fn smartconfig_community_withdraw(profile_id: String) -> Res<()> {
    blocking(move || call(Method::DELETE, &format!("/v1/smartconfig/profiles/{}", uuid(&profile_id)?), None, true).map(|_| ())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::dolphin::Dolphin;
    use crate::smartconfig::hardware::*;
    use crate::smartconfig::model::Value as V;

    fn hw() -> HardwareInfo {
        HardwareInfo {
            os: OsInfo { family: "windows".into(), version: Some("10.0.26100".into()), arch: "x86_64".into() },
            cpu: CpuInfo { brand: Some("AMD Ryzen 7 7800X3D 8-Core Processor".into()), threads: Some(16), ..Default::default() },
            gpus: vec![GpuInfo { name: "NVIDIA GeForce RTX 4070".into(), vendor: GpuVendor::Nvidia, dedicated_vram_mb: Some(12288), integrated: Some(false), driver_version: Some("32.0.15.6094".into()), software: false }],
            primary_gpu: Some(0),
            ram_mb: Some(32_600),
            device_model: Some("MS-7E26".into()),
            ..Default::default()
        }
    }

    fn game() -> GameQuery {
        GameQuery { game_id: 7, platform: "gamecube".into(), title: "Metroid Prime".into(), serial: Some("gmse01".into()), region: Some("USA".into()), id_confidence: 1.0 }
    }

    fn draft() -> Draft {
        Draft {
            settings: vec![
                Setting { key: "dolphin.internal_resolution".into(), value: V::Int(3) },
                Setting { key: "dolphin.gfx_backend".into(), value: V::Choice("vulkan".into()) },
                Setting { key: "dolphin.dump_path".into(), value: V::Choice("C:/x".into()) },
            ],
            mode: Mode::Quality,
            performance: "great".into(),
            stability: "stable".into(),
            bugs: "  ".into(),
            description: " Stable en 3x. ".into(),
            profile_id: None,
        }
    }

    #[test]
    fn apercu_exact_sans_donnee_identifiante() {
        let p = build(&Dolphin, &game(), Some("2506a"), &hw(), &draft()).unwrap();
        assert_eq!(p.path, "/v1/smartconfig/profiles");
        let expected = json!({
            "game": { "platform": "gamecube", "serial": "GMSE01", "title": "Metroid Prime" },
            "emulator": "dolphin",
            "version": {
                "emulatorVersion": "2506a",
                "hardware": { "os": "windows", "arch": "x86_64", "cpu": "AMD Ryzen 7 7800X3D 8-Core Processor", "gpu": "NVIDIA GeForce RTX 4070", "ramGb": 32, "device": "unknown" },
                "mode": "quality",
                "settings": [{ "key": "dolphin.internal_resolution", "value": { "type": "int", "value": 3 } }],
                "performance": "great", "stability": "stable", "bugs": "", "description": "Stable en 3x."
            }
        });
        assert_eq!(p.body, expected);
        // Vulkan non vérifié sur ce matériel, clé inconnue : retirés et signalés
        assert_eq!(p.rejected.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(), vec!["dolphin.gfx_backend", "dolphin.dump_path"]);
        let sent = p.body.to_string();
        for private in ["10.0.26100", "32.0.15.6094", "MS-7E26", "USA", "12288", "32600"] {
            assert!(!sent.contains(private), "{private} ne doit pas partir");
        }
        assert_eq!(p.digest, crate::smartconfig::backup::sha256(sent.as_bytes()));
    }

    #[test]
    fn nouvelle_version_et_refus() {
        let mut d = draft();
        d.profile_id = Some("11111111-1111-4111-8111-111111111111".into());
        let p = build(&Dolphin, &game(), None, &hw(), &d).unwrap();
        assert_eq!(p.path, "/v1/smartconfig/profiles/11111111-1111-4111-8111-111111111111/versions");
        assert!(p.body.get("game").is_none() && p.body["emulatorVersion"].is_null());
        d.profile_id = Some("../../v1/me".into());
        assert!(build(&Dolphin, &game(), None, &hw(), &d).is_err());
        let mut d = draft();
        d.mode = Mode::Manual;
        assert!(build(&Dolphin, &game(), None, &hw(), &d).is_err());
        let mut d = draft();
        d.performance = "ok\n".into();
        assert!(build(&Dolphin, &game(), None, &hw(), &d).is_err());
        let mut g = game();
        g.serial = None;
        assert!(build(&Dolphin, &g, None, &hw(), &draft()).is_err());
        let mut d = draft();
        d.settings.truncate(0);
        assert!(build(&Dolphin, &game(), None, &hw(), &d).is_err());
        assert_eq!(emulator_version(Some("5.0-21088")), Some("5.0-21088".into()));
        assert_eq!(emulator_version(Some("C:\\Dolphin")), None);
    }

    /// Bout en bout contre un serveur iNetbox **local** (jamais la production) :
    /// `SC_E2E_URL=http://127.0.0.1:4399 SC_E2E_TOKEN=<jeton> SC_E2E_VOTER=<jeton>`
    /// `cargo test --lib contribute::tests::bout_en_bout -- --ignored`
    #[test]
    #[ignore]
    fn bout_en_bout_serveur_local() {
        use crate::smartconfig::model::{MatchKind, ProfileKind};
        use crate::smartconfig::providers::community::{Community, Transport};
        use crate::smartconfig::providers::{memory::MemCache, Provider, ProviderError};
        let base = std::env::var("SC_E2E_URL").unwrap();
        assert!(base.starts_with("http://127.0.0.1:"), "serveur local uniquement");
        let (token, voter) = (std::env::var("SC_E2E_TOKEN").unwrap(), std::env::var("SC_E2E_VOTER").unwrap());
        let client = reqwest::blocking::Client::new();
        let p = build(&Dolphin, &game(), Some("2506a"), &hw(), &draft()).unwrap();
        let res = client.post(format!("{base}{}", p.path)).bearer_auth(&token).json(&p.body).send().unwrap();
        assert_eq!(res.status().as_u16(), 201, "{}", res.text().unwrap_or_default());
        let created: Value = res.json().unwrap();
        let version = created["versionId"].as_str().unwrap().to_string();
        let res = client.put(format!("{base}/v1/smartconfig/versions/{version}/vote")).bearer_auth(&voter).json(&json!({ "works": true, "stability": 5 })).send().unwrap();
        assert_eq!(res.status().as_u16(), 200);

        struct Local(String);
        impl Transport for Local {
            fn get(&self, path: &str) -> Result<Value, ProviderError> {
                let r = reqwest::blocking::get(format!("{}{path}", self.0)).map_err(|_| ProviderError::Offline("local".into()))?;
                r.json().map_err(|e| ProviderError::Invalid(e.to_string()))
            }
        }
        let f = Community::new(Box::new(Local(base))).fetch(&game(), "dolphin", &MemCache::default()).unwrap();
        assert!(f.matched);
        let profile = f.profiles.iter().find(|x| x.source_ref == version).expect("profil publié relu");
        assert_eq!(profile.kind, ProfileKind::Configuration);
        assert_eq!(profile.settings, vec![Setting { key: "dolphin.internal_resolution".into(), value: V::Int(3) }]);
        assert_eq!(profile.votes_up, 1);
        let g = game();
        let h = hw();
        let ctx = crate::smartconfig::recommend::Context {
            game: &g, game_match: crate::smartconfig::recommend::GameMatch::Title, hw: &h, emulator_version: Some("2506a"), preferred: Mode::Quality, today: "2027-01-10T00:00:00Z", local: &[],
        };
        let out = crate::smartconfig::recommend::recommend(&Dolphin, &f.profiles, &ctx);
        assert_eq!(out.recommendations[0].kind, MatchKind::Exact);
        eprintln!("bout en bout OK : version {version}, {}", out.recommendations[0].reasons.iter().map(|r| r.text.as_str()).collect::<Vec<_>>().join(" | "));
    }

    #[test]
    fn empreinte_change_si_le_contenu_change() {
        let a = build(&Dolphin, &game(), Some("2506a"), &hw(), &draft()).unwrap();
        let mut d = draft();
        d.description = "Autre texte".into();
        let b = build(&Dolphin, &game(), Some("2506a"), &hw(), &d).unwrap();
        assert_ne!(a.digest, b.digest);
        assert_eq!(a.digest, build(&Dolphin, &game(), Some("2506a"), &hw(), &draft()).unwrap().digest);
    }
}
