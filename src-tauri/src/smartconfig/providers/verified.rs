//! Profils officiels « Vérifié par iBox » : livrés avec l'application
//! (`smartconfig/verified/profiles.json`, embarqué à la compilation), aucun
//! accès réseau.
//!
//! Un profil n'entre dans ce fichier qu'après un **essai réel en jeu** puis une
//! relecture (procédure et format : docs/SMARTCONFIG.md §17). Le fichier livré
//! est vide tant qu'aucun essai n'a été fait : aucun profil n'est inventé.
//!
//! Le fichier est validé en entier au chargement (format, identifiants, même
//! liste blanche typée que les adaptateurs, dates, durée d'essai) ; une seule
//! entrée invalide le rend inutilisable — le test `fichier_livre_valide`
//! empêche de livrer un tel fichier. Les réglages repassent ensuite par la
//! validation matérielle comme ceux de toute autre source.

use super::{Cache, Fetched, Provider, ProviderError, ProviderInfo};
use crate::smartconfig::adapters;
use crate::smartconfig::model::{GameQuery, GameRef, Profile, ProfileKind, ReferenceHardware, ReportedPerformance, Setting, SourceId};
use crate::smartconfig::validation;
use serde::Deserialize;
use std::sync::OnceLock;

pub const INFO: ProviderInfo = ProviderInfo {
    id: SourceId::Verified,
    name: "Vérifié par iBox",
    website: "https://github.com/atzski/ibox",
    docs: "https://github.com/atzski/ibox/blob/main/docs/SMARTCONFIG.md",
    terms: "https://github.com/atzski/ibox/blob/main/docs/SMARTCONFIG.md",
    provides: "Profils essayés en jeu par l'équipe iBox sur un matériel et une version d'émulateur précis, puis relus. Livrés avec iBox.",
    sends: "Rien : les profils sont inclus dans l'application.",
};

const SHIPPED: &str = include_str!("../verified/profiles.json");
/// Durée minimale d'un essai en jeu pour qu'un profil soit dit vérifié.
pub const MIN_MINUTES_PLAYED: u32 = 30;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct File {
    format: u32,
    profiles: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entry {
    pub id: String,
    pub platform: String,
    pub serial: String,
    pub title: String,
    pub emulator: String,
    pub emulator_version: String,
    pub settings: Vec<Setting>,
    /// `perfect`, `great` ou `playable` : un essai raté ne devient pas un profil.
    pub performance: String,
    pub hardware: Hardware,
    pub verification: Verification,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Hardware {
    pub os: String,
    pub arch: String,
    pub cpu: String,
    pub gpu: String,
    /// `desktop`, `laptop`, `handheld`.
    pub device: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Verification {
    /// Date de l'essai en jeu (`AAAA-MM-JJ`).
    pub tested_on: String,
    pub minutes_played: u32,
    /// Ce qui a été observé pendant l'essai (scènes, effets, sons…).
    pub checked: Vec<String>,
    /// Date de la relecture par une seconde personne (≥ date d'essai).
    pub reviewed_on: String,
}

fn date_ok(d: &str) -> bool {
    let b = d.as_bytes();
    d.len() == 10 && b[4] == b'-' && b[7] == b'-' && d.bytes().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
}

fn text_ok(s: &str, max: usize) -> bool {
    let t = s.trim();
    !t.is_empty() && t.chars().count() <= max && !t.chars().any(char::is_control)
}

fn check(e: &Entry) -> Result<(), String> {
    let id_ok = !e.id.is_empty() && e.id.len() <= 64 && e.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !id_ok {
        return Err("identifiant invalide".into());
    }
    let adapter = adapters::by_id(&e.emulator).ok_or("émulateur sans adaptateur")?;
    if !adapter.platforms().contains(&e.platform.as_str()) {
        return Err("console non couverte par l'émulateur".into());
    }
    if !valid_serial(&e.serial) {
        return Err("numéro de série invalide".into());
    }
    if !text_ok(&e.title, 160) {
        return Err("titre invalide".into());
    }
    if e.emulator_version.is_empty() || e.emulator_version.len() > 40 || !e.emulator_version.bytes().all(|b| b.is_ascii_alphanumeric() || b" ._+-".contains(&b)) {
        return Err("version de l'émulateur invalide".into());
    }
    if e.settings.is_empty() {
        return Err("aucun réglage".into());
    }
    let v = validation::validate_format(&e.settings, adapter.specs());
    if let Some(r) = v.rejected.first() {
        return Err(format!("réglage {} refusé : {}", r.key, r.reason));
    }
    if !matches!(e.performance.as_str(), "perfect" | "great" | "playable") {
        return Err("performance invalide".into());
    }
    let h = &e.hardware;
    if !matches!(h.os.as_str(), "windows" | "linux" | "macos" | "android") || !matches!(h.arch.as_str(), "x86_64" | "aarch64") {
        return Err("système ou architecture invalides".into());
    }
    if !text_ok(&h.cpu, 120) || !text_ok(&h.gpu, 120) || !matches!(h.device.as_str(), "desktop" | "laptop" | "handheld") {
        return Err("matériel incomplet".into());
    }
    let ver = &e.verification;
    if !date_ok(&ver.tested_on) || !date_ok(&ver.reviewed_on) || ver.reviewed_on < ver.tested_on {
        return Err("dates d'essai ou de relecture invalides".into());
    }
    if ver.minutes_played < MIN_MINUTES_PLAYED {
        return Err(format!("essai en jeu trop court (minimum {MIN_MINUTES_PLAYED} min)"));
    }
    if ver.checked.is_empty() || ver.checked.len() > 10 || !ver.checked.iter().all(|c| text_ok(c, 120)) {
        return Err("points vérifiés manquants ou invalides".into());
    }
    if e.notes.as_deref().is_some_and(|n| !text_ok(n, 500)) {
        return Err("notes invalides".into());
    }
    Ok(())
}

/// Lit et valide un fichier de profils vérifiés : tout ou rien.
pub fn parse(json: &str) -> Result<Vec<Entry>, String> {
    let file: File = serde_json::from_str(json).map_err(|e| format!("profils vérifiés illisibles : {e}"))?;
    if file.format != 1 {
        return Err(format!("format de profils vérifiés inconnu ({})", file.format));
    }
    for (i, e) in file.profiles.iter().enumerate() {
        check(e).map_err(|r| format!("profil vérifié « {} » refusé : {r}", e.id))?;
        if file.profiles[..i].iter().any(|o| o.id == e.id) {
            return Err(format!("profil vérifié « {} » en double", e.id));
        }
    }
    Ok(file.profiles)
}

fn performance(label: &str) -> Option<ReportedPerformance> {
    let (rank, text) = match label {
        "perfect" => (1, "Parfait"),
        "great" => (2, "Très bon"),
        "playable" => (3, "Jouable"),
        _ => return None,
    };
    Some(ReportedPerformance { label: text.into(), rank, scale: 5 })
}

/// Entrée validée → profil normalisé (relié au jeu par numéro de série).
pub fn to_profile(e: &Entry) -> Profile {
    let v = &e.verification;
    let mut notes = format!("Essai en jeu le {} ({} min), relu le {} : {}.", v.tested_on, v.minutes_played, v.reviewed_on, v.checked.join(" ; "));
    if let Some(n) = e.notes.as_deref() {
        notes.push('\n');
        notes.push_str(n.trim());
    }
    Profile {
        source: SourceId::Verified,
        source_ref: e.id.clone(),
        source_url: None,
        kind: ProfileKind::Configuration,
        emulator: e.emulator.clone(),
        emulator_version: Some(e.emulator_version.clone()),
        emulator_fork: None,
        game: GameRef { title: e.title.clone(), system: Some(e.platform.clone()), serial: Some(e.serial.clone()) },
        hardware: ReferenceHardware {
            os: Some(e.hardware.os.clone()),
            arch: Some(e.hardware.arch.clone()),
            label: Some(format!("{} + {}", e.hardware.cpu, e.hardware.gpu)),
            cpu: Some(e.hardware.cpu.clone()),
            gpu: Some(e.hardware.gpu.clone()),
            handheld: e.hardware.device == "handheld",
        },
        performance: performance(&e.performance),
        settings: e.settings.clone(),
        ignored: vec![],
        notes: Some(notes.chars().take(500).collect()),
        votes_up: 0,
        votes_down: 0,
        verified_by_developer: false,
        created_at: Some(v.reviewed_on.clone()),
        updated_at: None,
    }
}

/// Profils correspondant exactement au jeu (console + numéro de série) et à l'émulateur.
pub fn matching(entries: &[Entry], game: &GameQuery, emulator: &str) -> Vec<Profile> {
    let Some(serial) = game.serial.as_deref() else { return Vec::new() };
    entries
        .iter()
        .filter(|e| e.emulator == emulator && e.platform == game.platform && e.serial.eq_ignore_ascii_case(serial))
        .map(to_profile)
        .collect()
}

/// Fournisseur sur le fichier embarqué (lu et validé une seule fois).
pub struct Verified;

fn shipped() -> &'static Result<Vec<Entry>, String> {
    static LOADED: OnceLock<Result<Vec<Entry>, String>> = OnceLock::new();
    LOADED.get_or_init(|| parse(SHIPPED))
}

impl Provider for Verified {
    fn id(&self) -> SourceId {
        SourceId::Verified
    }

    fn supports(&self, emulator: &str, platform: &str) -> bool {
        adapters::by_id(emulator).is_some_and(|a| a.platforms().contains(&platform))
    }

    fn fetch(&self, game: &GameQuery, emulator: &str, _cache: &dyn Cache) -> Result<Fetched, ProviderError> {
        let entries = shipped().as_ref().map_err(|e| ProviderError::Invalid(e.clone()))?;
        let profiles = matching(entries, game, emulator);
        Ok(Fetched { matched: !profiles.is_empty(), profiles, stale: false })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fichier_livre_valide() {
        // le fichier livré est vide tant qu'aucun profil n'a été essayé en jeu et relu
        let entries = parse(SHIPPED).expect("smartconfig/verified/profiles.json doit être valide");
        assert!(entries.is_empty(), "un profil vérifié doit suivre la procédure de docs/SMARTCONFIG.md §17");
    }

    fn sample() -> serde_json::Value {
        serde_json::json!({
            "id": "dolphin-gmse01-1",
            "platform": "gamecube",
            "serial": "GMSE01",
            "title": "Exemple de test",
            "emulator": "dolphin",
            "emulatorVersion": "2509",
            "settings": [{ "key": "dolphin.internal_resolution", "value": { "type": "int", "value": 2 } }],
            "performance": "great",
            "hardware": { "os": "windows", "arch": "x86_64", "cpu": "CPU de test", "gpu": "GPU de test", "device": "desktop" },
            "verification": { "testedOn": "2026-01-02", "minutesPlayed": 45, "checked": ["premier niveau"], "reviewedOn": "2026-01-03" }
        })
    }

    fn file(entries: Vec<serde_json::Value>) -> String {
        serde_json::json!({ "format": 1, "profiles": entries }).to_string()
    }

    #[test]
    fn validation_tout_ou_rien() {
        let ok = parse(&file(vec![sample()])).unwrap();
        assert_eq!(ok.len(), 1);
        let bad = |f: &dyn Fn(&mut serde_json::Value)| {
            let mut e = sample();
            f(&mut e);
            parse(&file(vec![sample_with_id("autre"), e])).unwrap_err()
        };
        assert!(bad(&|e| e["settings"][0]["key"] = "dolphin.inconnu".into()).contains("hors de la liste"));
        assert!(bad(&|e| e["settings"][0]["value"]["value"] = 99.into()).contains("hors de la plage"));
        assert!(bad(&|e| e["verification"]["minutesPlayed"] = 5.into()).contains("trop court"));
        assert!(bad(&|e| e["verification"]["reviewedOn"] = "2025-12-31".into()).contains("dates"));
        assert!(bad(&|e| e["serial"] = "gmse 01".into()).contains("série"));
        assert!(bad(&|e| e["platform"] = "ps2".into()).contains("console"));
        assert!(bad(&|e| e["performance"] = "unplayable".into()).contains("performance"));
        assert!(bad(&|e| e["settings"] = serde_json::json!([])).contains("aucun réglage"));
        assert!(bad(&|e| e["inventé"] = true.into()).contains("illisibles"));
        assert!(parse(&file(vec![sample(), sample()])).unwrap_err().contains("double"));
        assert!(parse(r#"{"format":2,"profiles":[]}"#).unwrap_err().contains("format"));
    }

    fn sample_with_id(id: &str) -> serde_json::Value {
        let mut e = sample();
        e["id"] = id.into();
        e
    }

    #[test]
    fn correspondance_par_numero_de_serie() {
        let entries = parse(&file(vec![sample()])).unwrap();
        let game = |serial: Option<&str>| GameQuery { platform: "gamecube".into(), serial: serial.map(str::to_string), ..Default::default() };
        let found = matching(&entries, &game(Some("gmse01")), "dolphin");
        assert_eq!(found.len(), 1);
        let p = &found[0];
        assert_eq!((p.source, p.game.serial.as_deref()), (SourceId::Verified, Some("GMSE01")));
        assert_eq!(p.performance.as_ref().map(|x| x.rank), Some(2));
        assert!(p.notes.as_deref().unwrap().contains("45 min"));
        assert!(matching(&entries, &game(None), "dolphin").is_empty());
        assert!(matching(&entries, &game(Some("GMSP01")), "dolphin").is_empty());
        assert!(matching(&entries, &game(Some("GMSE01")), "pcsx2").is_empty());
    }
}

/// Numéro de série de jeu accepté (`GMSE01`, `SLUS-20312`).
pub fn valid_serial(s: &str) -> bool {
    (4..=16).contains(&s.len()) && s.bytes().enumerate().all(|(i, b)| b.is_ascii_uppercase() || b.is_ascii_digit() || (i > 0 && (b == b'-' || b == b'_')))
}
