//! Outils partagés par les adaptateurs à fichiers de réglages (INI ; YAML de
//! RPCS3 et CFG de RetroArch via `Doc`) : écriture ciblée, lecture, contrôle d'API graphique, extraits des
//! bases de jeux YAML livrées avec les émulateurs (lecture seule).

use super::Change;
use crate::smartconfig::hardware::HardwareInfo;
use crate::smartconfig::ini::Ini;
use crate::smartconfig::model::{Setting, Value};
use crate::smartconfig::validation::SettingSpec;
use std::path::Path;

/// Une écriture INI produite par un adaptateur à partir d'une valeur typée.
pub type Write = (&'static str, &'static str, String);

/// Taille maximale d'une base de jeux YAML lue (GameIndex.yaml ≈ 3 Mo, gamedb.yaml ≈ 5 Mo).
const MAX_DB_BYTES: u64 = 32 * 1024 * 1024;

/// Document de réglages modifiable de façon ciblée (INI, YAML, CFG).
pub trait Doc {
    fn get(&self, section: &str, key: &str) -> Option<String>;
    /// `value` ne vient que d'un adaptateur (valeur typée sérialisée).
    fn set(&mut self, section: &str, key: &str, value: &str) -> Result<(), String>;
    fn to_bytes(&self) -> Vec<u8>;
}

impl Doc for Ini {
    fn get(&self, section: &str, key: &str) -> Option<String> {
        Ini::get(self, section, key)
    }
    fn set(&mut self, section: &str, key: &str, value: &str) -> Result<(), String> {
        Ini::set(self, section, key, value);
        Ok(())
    }
    fn to_bytes(&self) -> Vec<u8> {
        Ini::to_bytes(self)
    }
}

/// Applique les écritures de chaque paramètre ; un paramètre dont toutes les
/// clés ont déjà la bonne valeur ne produit aucun changement.
pub fn render(current: Option<&[u8]>, settings: &[Setting], specs: &[SettingSpec], writes: impl Fn(&Setting) -> Option<Vec<Write>>) -> Result<(Vec<u8>, Vec<Change>), String> {
    let ini = match current {
        Some(b) => Ini::parse(b)?,
        None => Ini::empty(),
    };
    render_doc(ini, settings, specs, writes)
}

/// Comme `render`, pour tout document déjà lu.
pub fn render_doc<D: Doc>(mut ini: D, settings: &[Setting], specs: &[SettingSpec], writes: impl Fn(&Setting) -> Option<Vec<Write>>) -> Result<(Vec<u8>, Vec<Change>), String> {
    let mut changes = Vec::new();
    for s in settings {
        let w = writes(s).ok_or("valeur non transposable")?;
        let before: Vec<Option<String>> = w.iter().map(|(sec, k, _)| ini.get(sec, k)).collect();
        if w.iter().zip(&before).all(|((_, _, v), b)| b.as_deref() == Some(v.as_str())) {
            continue;
        }
        let show = |vals: Vec<Option<&str>>| -> Option<String> {
            if w.len() == 1 {
                return vals[0].map(str::to_string);
            }
            vals.iter().any(Option::is_some).then(|| w.iter().zip(&vals).map(|((_, k, _), v)| format!("{k} = {}", v.unwrap_or("—"))).collect::<Vec<_>>().join(" ; "))
        };
        let before_s = show(before.iter().map(Option::as_deref).collect());
        let after_s = show(w.iter().map(|(_, _, v)| Some(v.as_str())).collect()).unwrap_or_default();
        for (sec, k, v) in &w {
            ini.set(sec, k, v)?;
        }
        let label = specs.iter().find(|p| p.key == s.key).map(|p| p.label).unwrap_or_default();
        changes.push(Change { key: s.key.clone(), label: label.into(), before: before_s, after: after_s });
    }
    Ok((ini.to_bytes(), changes))
}

/// Lit les paramètres connus : `decode` reçoit l'INI et renvoie la valeur typée.
pub fn read(current: Option<&[u8]>, specs: &[SettingSpec], decode: impl Fn(&str, &Ini) -> Option<Value>) -> Result<Vec<Setting>, String> {
    let Some(bytes) = current else { return Ok(Vec::new()) };
    let ini = Ini::parse(bytes)?;
    Ok(specs.iter().filter_map(|s| Some(Setting { key: s.key.into(), value: decode(s.key, &ini)? })).collect())
}

pub fn parse_bool(s: &str) -> Option<bool> {
    match s.trim().to_ascii_lowercase().as_str() {
        "true" | "1" => Some(true),
        "false" | "0" => Some(false),
        _ => None,
    }
}

/// Moteur graphique demandé disponible ici ? (`software` toujours accepté).
pub fn api_check(v: &Value, hw: &HardwareInfo) -> Option<String> {
    let Value::Choice(c) = v else { return None };
    let ok = match c.as_str() {
        "software" => Some(true),
        "vulkan" => hw.apis.vulkan_loader,
        "d3d11" => hw.apis.d3d11,
        "d3d12" => hw.apis.d3d12,
        "opengl" => hw.apis.opengl,
        _ => None,
    };
    match ok {
        Some(true) => None,
        Some(false) => Some("API graphique non disponible sur cet ordinateur".into()),
        None => Some("prise en charge de cette API graphique non vérifiée ici".into()),
    }
}

/// Lit une base de jeux YAML livrée avec l'émulateur (taille bornée).
pub fn read_db(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_DB_BYTES {
        return None;
    }
    std::fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

/// Bloc d'une entrée de premier niveau `KEY:` d'un fichier YAML de base de
/// jeux (GameIndex.yaml de PCSX2, gamedb.yaml de DuckStation) : lignes
/// indentées qui suivent, commentaires retirés.
pub fn yaml_entry<'a>(text: &'a str, key: &str) -> Option<Vec<&'a str>> {
    let mut lines = text.lines();
    lines.find(|l| l.split('#').next().map(str::trim_end) == Some(&format!("{key}:")))?;
    Some(lines.take_while(|l| l.is_empty() || l.starts_with(' ')).map(|l| l.split('#').next().unwrap_or_default().trim_end()).filter(|l| !l.trim().is_empty()).collect())
}

/// Dans un bloc d'entrée : éléments de la sous-section `name` (indentation 2),
/// sous forme `clé: valeur` ou `- élément` (indentation 4).
pub fn yaml_section<'a>(entry: &[&'a str], name: &str) -> Vec<&'a str> {
    let head = format!("  {name}:");
    let Some(start) = entry.iter().position(|l| *l == head) else { return Vec::new() };
    entry[start + 1..].iter().take_while(|l| l.starts_with("    ")).map(|l| l.trim()).collect()
}

/// Numéro de série Sony « AAAA-NNNNN » (PS1, PS2).
pub fn valid_sony_serial(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[..4].iter().all(u8::is_ascii_uppercase) && b[4] == b'-' && b[5..].iter().all(u8::is_ascii_digit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extraits_yaml() {
        let db = "SLUS-20312:\n  name: \"Jeu\" # titre\n  speedHacks:\n    eeCycleRate: 2 # corrige\n  gsHWFixes:\n    deinterlace: 9\nSLUS-20313:\n  name: \"Autre\"\n";
        let e = yaml_entry(db, "SLUS-20312").unwrap();
        assert_eq!(yaml_section(&e, "speedHacks"), vec!["eeCycleRate: 2"]);
        assert_eq!(yaml_section(&e, "gsHWFixes"), vec!["deinterlace: 9"]);
        assert!(yaml_entry(db, "SLUS-2031").is_none());
        assert!(yaml_section(&yaml_entry(db, "SLUS-20313").unwrap(), "speedHacks").is_empty());
        assert!(valid_sony_serial("SLUS-20312"));
        assert!(!valid_sony_serial("SLUS-2031/"));
        assert!(!valid_sony_serial("../../x"));
    }
}
