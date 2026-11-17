//! Validation stricte : toute donnée externe est non fiable. Un paramètre
//! n'est accepté que s'il figure dans la liste blanche de l'adaptateur, avec
//! le bon type, dans la plage permise, et compatible avec le matériel.
//! Les valeurs sont typées : aucun texte reçu n'est jamais écrit tel quel.

use super::hardware::HardwareInfo;
use super::model::{Setting, Value};
use serde::Serialize;

/// Nombre maximal de paramètres acceptés dans un profil.
pub const MAX_SETTINGS: usize = 64;
const MAX_KEY_LEN: usize = 64;

#[derive(Debug, Clone, Copy)]
pub enum Kind {
    Bool,
    Int { min: i64, max: i64 },
    /// Identifiants internes autorisés.
    Choice(&'static [&'static str]),
}

/// Risque d'un paramètre : `High` n'est jamais appliqué automatiquement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Risk {
    Low,
    Medium,
    High,
}

/// Contrôle propre au matériel : `Some(raison)` = refusé.
pub type HardwareCheck = fn(&Value, &HardwareInfo) -> Option<String>;

#[derive(Debug, Clone, Copy)]
pub struct SettingSpec {
    pub key: &'static str,
    /// Libellé français (traduit par l'interface).
    pub label: &'static str,
    pub kind: Kind,
    pub risk: Risk,
    pub check: Option<HardwareCheck>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rejected {
    pub key: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Validated {
    pub accepted: Vec<Setting>,
    pub rejected: Vec<Rejected>,
}

impl Validated {
    pub fn max_risk(&self, specs: &[SettingSpec]) -> Option<Risk> {
        self.accepted.iter().filter_map(|s| spec(specs, &s.key)).map(|s| s.risk).max()
    }
}

pub fn spec<'a>(specs: &'a [SettingSpec], key: &str) -> Option<&'a SettingSpec> {
    specs.iter().find(|s| s.key == key)
}

pub fn validate(settings: &[Setting], specs: &[SettingSpec], hw: &HardwareInfo) -> Validated {
    validate_with(settings, specs, Some(hw))
}

/// Liste blanche, types et plages seulement, sans contrôle matériel : pour
/// des profils livrés avec iBox (`providers::verified`), vérifiés au
/// chargement puis revalidés avec le matériel réel au moment de recommander.
pub fn validate_format(settings: &[Setting], specs: &[SettingSpec]) -> Validated {
    validate_with(settings, specs, None)
}

fn validate_with(settings: &[Setting], specs: &[SettingSpec], hw: Option<&HardwareInfo>) -> Validated {
    let mut out = Validated::default();
    if settings.len() > MAX_SETTINGS {
        out.rejected.push(Rejected { key: "*".into(), reason: format!("profil refusé : plus de {MAX_SETTINGS} paramètres") });
        return out;
    }
    for s in settings {
        let reject = |reason: String| Rejected { key: s.key.chars().take(MAX_KEY_LEN).collect(), reason };
        if s.key.len() > MAX_KEY_LEN {
            out.rejected.push(reject("clé trop longue".into()));
            continue;
        }
        // deux valeurs pour une même clé : contradiction, aucune n'est retenue
        if settings.iter().filter(|o| o.key == s.key).count() > 1 {
            if !out.rejected.iter().any(|r| r.key == s.key) {
                out.rejected.push(reject("valeurs contradictoires pour ce paramètre".into()));
            }
            continue;
        }
        let Some(sp) = spec(specs, &s.key) else {
            out.rejected.push(reject("paramètre hors de la liste autorisée".into()));
            continue;
        };
        if let Err(reason) = check_kind(&sp.kind, &s.value) {
            out.rejected.push(reject(reason));
            continue;
        }
        if let Some(reason) = hw.and_then(|hw| sp.check.and_then(|c| c(&s.value, hw))) {
            out.rejected.push(reject(reason));
            continue;
        }
        out.accepted.push(s.clone());
    }
    out
}

fn check_kind(kind: &Kind, v: &Value) -> Result<(), String> {
    match (kind, v) {
        (Kind::Bool, Value::Bool(_)) => Ok(()),
        (Kind::Int { min, max }, Value::Int(i)) if i >= min && i <= max => Ok(()),
        (Kind::Int { min, max }, Value::Int(i)) => Err(format!("valeur {i} hors de la plage {min}–{max}")),
        (Kind::Choice(allowed), Value::Choice(c)) if allowed.contains(&c.as_str()) => Ok(()),
        (Kind::Choice(_), Value::Choice(_)) => Err("option inconnue".into()),
        _ => Err("type de valeur inattendu".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPECS: &[SettingSpec] = &[
        SettingSpec { key: "x.res", label: "Résolution", kind: Kind::Int { min: 1, max: 8 }, risk: Risk::Low, check: None },
        SettingSpec { key: "x.on", label: "Option", kind: Kind::Bool, risk: Risk::Medium, check: None },
        SettingSpec { key: "x.api", label: "API", kind: Kind::Choice(&["vulkan", "d3d11"]), risk: Risk::High, check: Some(|v, hw| (v == &Value::Choice("vulkan".into()) && hw.apis.vulkan_loader != Some(true)).then(|| "Vulkan non disponible".into())) },
    ];

    fn s(key: &str, value: Value) -> Setting {
        Setting { key: key.into(), value }
    }

    #[test]
    fn liste_blanche_types_plages() {
        let v = validate(
            &[s("x.res", Value::Int(3)), s("x.res2", Value::Int(3)), s("x.on", Value::Int(1)), s("x.api", Value::Choice("d3d11\n[Core]".into()))],
            SPECS,
            &HardwareInfo::default(),
        );
        assert_eq!(v.accepted, vec![s("x.res", Value::Int(3))]);
        assert_eq!(v.rejected.len(), 3);
        assert_eq!(validate(&[s("x.res", Value::Int(99))], SPECS, &HardwareInfo::default()).accepted.len(), 0);
    }

    #[test]
    fn controle_materiel_et_contradictions() {
        let hw = HardwareInfo::default();
        let v = validate(&[s("x.api", Value::Choice("vulkan".into()))], SPECS, &hw);
        assert_eq!(v.rejected[0].reason, "Vulkan non disponible");
        let v = validate(&[s("x.on", Value::Bool(true)), s("x.on", Value::Bool(false))], SPECS, &hw);
        assert!(v.accepted.is_empty());
        assert_eq!(v.rejected.len(), 1);
        let many: Vec<Setting> = (0..MAX_SETTINGS + 1).map(|i| s(&format!("k{i}"), Value::Bool(true))).collect();
        assert_eq!(validate(&many, SPECS, &hw).rejected[0].key, "*");
    }

    #[test]
    fn risque_maximal() {
        let v = validate(&[s("x.res", Value::Int(2)), s("x.on", Value::Bool(true))], SPECS, &HardwareInfo::default());
        assert_eq!(v.max_risk(SPECS), Some(Risk::Medium));
    }
}
