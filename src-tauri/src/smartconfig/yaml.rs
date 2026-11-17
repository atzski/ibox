//! Édition ciblée d'un fichier YAML de configuration à deux niveaux, tel
//! qu'en écrit RPCS3 (yaml-cpp, blocs indentés de deux espaces) :
//!
//! ```yaml
//! Video:
//!   Renderer: Vulkan
//!   Resolution Scale: 100
//! ```
//!
//! Seules les lignes `  Clé: valeur` demandées changent ; tout le reste
//! (autres sections, sous-sections, ordre, fins de ligne) est conservé à
//! l'identique. Tout ce qui sort de cette forme simple (style « flux »
//! `{…}`, tabulations, documents multiples, ancres, clés en double) est
//! refusé plutôt que deviné. Pas de réécriture complète, aucune dépendance.

use crate::smartconfig::adapters::common::Doc;
use crate::smartconfig::ini::MAX_INI_BYTES;

#[derive(Debug, Clone, PartialEq)]
pub struct Yaml {
    lines: Vec<String>,
    crlf: bool,
    trailing_newline: bool,
}

fn indent(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

fn is_blank(line: &str) -> bool {
    let t = line.trim();
    t.is_empty() || t.starts_with('#')
}

/// `Clé: valeur` → (clé, valeur brute) ; `Clé:` → (clé, "").
fn split_entry(t: &str) -> Option<(&str, &str)> {
    if let Some(k) = t.strip_suffix(':') {
        return Some((k, ""));
    }
    let (k, v) = t.split_once(": ")?;
    Some((k, v.trim()))
}

/// Valeur scalaire sans guillemets ni commentaire final.
fn unquote(v: &str) -> String {
    let v = v.trim();
    for q in ['"', '\''] {
        if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) {
            return v[1..v.len() - 1].to_string();
        }
    }
    v.split(" #").next().unwrap_or_default().trim().to_string()
}

/// Valeur que l'éditeur sait écrire sans guillemets ni ambiguïté.
fn plain_safe(v: &str) -> bool {
    !v.is_empty() && !v.starts_with(' ') && !v.ends_with(' ') && v.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b' ' | b'.' | b'_' | b'-')) && !v.starts_with(['-', '.'])
}

impl Yaml {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_INI_BYTES {
            return Err("fichier de réglages trop volumineux".into());
        }
        let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
        let text = std::str::from_utf8(bytes).map_err(|_| "fichier de réglages illisible (encodage)".to_string())?;
        if text.contains(['\0', '\t']) {
            return Err("fichier de réglages invalide".into());
        }
        let crlf = text.contains("\r\n");
        let trailing_newline = text.is_empty() || text.ends_with('\n');
        let lines: Vec<String> = if text.is_empty() { Vec::new() } else { text.lines().map(str::to_string).collect() };
        let y = Self { lines, crlf, trailing_newline };
        y.check()?;
        Ok(y)
    }

    pub fn empty() -> Self {
        Self { lines: Vec::new(), crlf: false, trailing_newline: true }
    }

    /// Forme attendue : sections de premier niveau `Nom:` en bloc, clés
    /// directes uniques. Sinon refus (format non géré).
    fn check(&self) -> Result<(), String> {
        let bad = || Err::<(), String>("fichier YAML dans une forme inattendue : non modifié".into());
        let mut sections: Vec<&str> = Vec::new();
        let mut keys: Vec<&str> = Vec::new();
        for l in &self.lines {
            if is_blank(l) {
                continue;
            }
            let t = l.trim();
            if t.starts_with("---") || t.starts_with("...") || t.starts_with('%') || t.contains(['&', '*', '{', '[', '|', '>']) && indent(l) == 0 {
                return bad();
            }
            match indent(l) {
                0 => {
                    let Some((name, rest)) = split_entry(t) else { return bad() };
                    if sections.contains(&name) {
                        return bad();
                    }
                    sections.push(name);
                    keys.clear();
                    // scalaire au premier niveau : toléré (non modifié), sauf flux
                    if rest.starts_with(['{', '[', '&', '*', '|', '>']) {
                        return bad();
                    }
                }
                2 if !sections.is_empty() => {
                    let Some((k, _)) = split_entry(t) else { return bad() };
                    if keys.contains(&k) {
                        return bad();
                    }
                    keys.push(k);
                }
                n if n > 2 && !sections.is_empty() => {}
                _ => return bad(),
            }
        }
        Ok(())
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let nl = if self.crlf { "\r\n" } else { "\n" };
        let mut s = self.lines.join(nl);
        if self.trailing_newline && !self.lines.is_empty() {
            s.push_str(nl);
        }
        s.into_bytes()
    }

    /// Bornes `[début, fin)` du corps de la section `name`.
    fn section_range(&self, name: &str) -> Option<(usize, usize)> {
        let start = self.lines.iter().position(|l| indent(l) == 0 && !is_blank(l) && split_entry(l.trim()).is_some_and(|(k, v)| k == name && v.is_empty()))? + 1;
        let end = self.lines[start..].iter().position(|l| !is_blank(l) && indent(l) == 0).map(|i| start + i).unwrap_or(self.lines.len());
        Some((start, end))
    }

    fn key_line(&self, a: usize, b: usize, key: &str) -> Option<usize> {
        (a..b).find(|&i| {
            let l = &self.lines[i];
            !is_blank(l) && indent(l) == 2 && split_entry(l.trim()).is_some_and(|(k, _)| k == key)
        })
    }

    pub fn get(&self, section: &str, key: &str) -> Option<String> {
        let (a, b) = self.section_range(section)?;
        let i = self.key_line(a, b, key)?;
        let (_, v) = split_entry(self.lines[i].trim())?;
        let v = unquote(v);
        (!v.is_empty()).then_some(v)
    }

    pub fn set(&mut self, section: &str, key: &str, value: &str) -> Result<(), String> {
        if !plain_safe(value) || key.contains([':', '#', '\r', '\n']) || section.contains([':', '#', '\r', '\n']) {
            return Err("valeur non transposable".into());
        }
        let line = format!("  {key}: {value}");
        match self.section_range(section) {
            Some((a, b)) => match self.key_line(a, b, key) {
                Some(i) => {
                    // une clé qui ouvre un sous-bloc n'est pas un scalaire
                    let nested = split_entry(self.lines[i].trim()).is_some_and(|(_, v)| v.is_empty()) && self.lines.get(i + 1).is_some_and(|n| !is_blank(n) && indent(n) > 2);
                    if nested {
                        return Err("fichier YAML dans une forme inattendue : non modifié".into());
                    }
                    self.lines[i] = line;
                }
                None => {
                    let mut at = b;
                    while at > a && is_blank(&self.lines[at - 1]) {
                        at -= 1;
                    }
                    self.lines.insert(at, line);
                }
            },
            None => {
                if self.lines.iter().any(|l| indent(l) == 0 && !is_blank(l) && split_entry(l.trim()).is_some_and(|(k, _)| k == section)) {
                    // section présente mais scalaire : forme inattendue
                    return Err("fichier YAML dans une forme inattendue : non modifié".into());
                }
                self.lines.push(format!("{section}:"));
                self.lines.push(line);
            }
        }
        Ok(())
    }
}

impl Doc for Yaml {
    fn get(&self, section: &str, key: &str) -> Option<String> {
        Yaml::get(self, section, key)
    }
    fn set(&mut self, section: &str, key: &str, value: &str) -> Result<(), String> {
        Yaml::set(self, section, key, value)
    }
    fn to_bytes(&self) -> Vec<u8> {
        Yaml::to_bytes(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RPCS3: &str = "Core:\n  PPU Decoder: Recompiler (LLVM)\n  SPU Block Size: Safe\nVideo:\n  Renderer: Vulkan\n  Resolution: 1280x720\n  Vulkan:\n    Adapter: \"\"\n    Force FIFO present mode: false\n  Performance Overlay:\n    Enabled: false\nMiscellaneous:\n  Automatically start games after boot: true\n";

    #[test]
    fn modification_ciblee_conserve_le_reste() {
        let mut y = Yaml::parse(RPCS3.as_bytes()).unwrap();
        assert_eq!(y.get("Video", "Renderer").as_deref(), Some("Vulkan"));
        assert_eq!(y.get("Video", "Adapter"), None, "clé d'un sous-bloc : jamais lue comme clé directe");
        assert_eq!(y.get("Video", "Vulkan"), None);
        y.set("Video", "Renderer", "OpenGL").unwrap();
        y.set("Video", "Resolution Scale", "150").unwrap();
        y.set("Core", "SPU Block Size", "Mega").unwrap();
        y.set("Audio", "Buffering", "true").unwrap();
        let out = String::from_utf8(y.to_bytes()).unwrap();
        assert_eq!(
            out,
            RPCS3
                .replace("Renderer: Vulkan", "Renderer: OpenGL")
                .replace("SPU Block Size: Safe", "SPU Block Size: Mega")
                .replace("    Enabled: false\n", "    Enabled: false\n  Resolution Scale: 150\n")
                + "Audio:\n  Buffering: true\n"
        );
        // relu tel quel par l'éditeur
        let again = Yaml::parse(out.as_bytes()).unwrap();
        assert_eq!(again.get("Video", "Resolution Scale").as_deref(), Some("150"));
        // aller-retour identique, CRLF conservé
        let crlf = RPCS3.replace('\n', "\r\n");
        assert_eq!(Yaml::parse(crlf.as_bytes()).unwrap().to_bytes(), crlf.as_bytes());
    }

    #[test]
    fn formes_inattendues_et_valeurs_malveillantes_refusees() {
        for bad in ["Video: {Renderer: Vulkan}\n", "---\nVideo:\n  Renderer: Vulkan\n", "Video:\n\tRenderer: Vulkan\n", "Video:\n  Renderer: Vulkan\n  Renderer: OpenGL\n", "Video:\n  Renderer: Vulkan\nVideo:\n  X: 1\n", " Video:\n", "Video: &a\n"] {
            assert!(Yaml::parse(bad.as_bytes()).is_err(), "{bad:?}");
        }
        let mut y = Yaml::parse(RPCS3.as_bytes()).unwrap();
        for v in ["Vulkan\nCore:", "a: b", "{x}", "\"q\"", "", " x", "-1x", "a#b"] {
            assert!(y.set("Video", "Renderer", v).is_err(), "{v:?}");
        }
        assert!(y.set("Video", "Vulkan", "x").is_err(), "sous-bloc jamais remplacé");
        assert_eq!(y.to_bytes(), RPCS3.as_bytes());
        let mut e = Yaml::empty();
        e.set("Video", "Renderer", "Vulkan").unwrap();
        assert_eq!(e.to_bytes(), b"Video:\n  Renderer: Vulkan\n");
        assert_eq!(Yaml::parse(b"Video:\n  Frame limit: \"Auto\" \n").unwrap().get("Video", "Frame limit").as_deref(), Some("Auto"));
    }
}
