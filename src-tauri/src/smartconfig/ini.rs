//! Édition ciblée de fichiers INI : seules les clés demandées changent ; les
//! commentaires, l'ordre, les autres sections et les fins de ligne sont
//! conservés à l'identique. Pas de réécriture complète.

/// Taille maximale d'un fichier de réglages lu ou écrit.
pub const MAX_INI_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Ini {
    lines: Vec<String>,
    crlf: bool,
    trailing_newline: bool,
    /// `clé=valeur` sans espaces (style QSettings) au lieu de `clé = valeur`.
    compact: bool,
}

impl Ini {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_INI_BYTES {
            return Err("fichier de réglages trop volumineux".into());
        }
        let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
        let text = std::str::from_utf8(bytes).map_err(|_| "fichier de réglages illisible (encodage)".to_string())?;
        if text.contains('\0') {
            return Err("fichier de réglages invalide".into());
        }
        let crlf = text.contains("\r\n");
        let trailing_newline = text.is_empty() || text.ends_with('\n');
        let lines: Vec<String> = if text.is_empty() { Vec::new() } else { text.lines().map(str::to_string).collect() };
        // style du fichier : celui de la première ligne « clé=valeur »
        let compact = lines.iter().find(|l| Self::key_of(l).is_some()).is_some_and(|l| !l.contains(" = "));
        Ok(Self { lines, crlf, trailing_newline, compact })
    }

    pub fn empty() -> Self {
        Self { lines: Vec::new(), crlf: true, trailing_newline: true, compact: false }
    }

    /// Nouveau fichier au style QSettings (`clé=valeur`).
    pub fn empty_compact() -> Self {
        Self { compact: true, ..Self::empty() }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let nl = if self.crlf { "\r\n" } else { "\n" };
        let mut s = self.lines.join(nl);
        if self.trailing_newline && !self.lines.is_empty() {
            s.push_str(nl);
        }
        s.into_bytes()
    }

    fn section_of(line: &str) -> Option<&str> {
        let t = line.trim();
        t.strip_prefix('[').and_then(|r| r.strip_suffix(']')).map(str::trim)
    }

    fn key_of(line: &str) -> Option<(&str, &str)> {
        let t = line.trim_start();
        if t.starts_with(';') || t.starts_with('#') || t.starts_with('$') || t.starts_with('+') || t.starts_with('*') {
            return None;
        }
        let (k, v) = t.split_once('=')?;
        Some((k.trim(), v.trim()))
    }

    /// Bornes `[début, fin)` du corps de la première section `name` (sans casse).
    fn section_range(&self, name: &str) -> Option<(usize, usize)> {
        let start = self.lines.iter().position(|l| Self::section_of(l).is_some_and(|s| s.eq_ignore_ascii_case(name)))? + 1;
        let end = self.lines[start..].iter().position(|l| Self::section_of(l).is_some()).map(|i| start + i).unwrap_or(self.lines.len());
        Some((start, end))
    }

    pub fn get(&self, section: &str, key: &str) -> Option<String> {
        let (a, b) = self.section_range(section)?;
        self.lines[a..b].iter().rev().find_map(|l| Self::key_of(l).filter(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v.to_string()))
    }

    /// Écrit `key = value`. `value` ne doit venir que d'un adaptateur (valeur typée sérialisée).
    pub fn set(&mut self, section: &str, key: &str, value: &str) {
        debug_assert!(!value.contains(['\r', '\n']) && !key.contains(['=', '[', ']', '\r', '\n']));
        let line = if self.compact { format!("{key}={value}") } else { format!("{key} = {value}") };
        match self.section_range(section) {
            Some((a, b)) => {
                if let Some(i) = (a..b).rev().find(|&i| Self::key_of(&self.lines[i]).is_some_and(|(k, _)| k.eq_ignore_ascii_case(key))) {
                    self.lines[i] = line;
                } else {
                    // après la dernière ligne non vide de la section
                    let mut at = b;
                    while at > a && self.lines[at - 1].trim().is_empty() {
                        at -= 1;
                    }
                    self.lines.insert(at, line);
                }
            }
            None => {
                if self.lines.last().is_some_and(|l| !l.trim().is_empty()) {
                    self.lines.push(String::new());
                }
                self.lines.push(format!("[{section}]"));
                self.lines.push(line);
            }
        }
    }

    /// Retire `key` de `section` (et la section si elle devient vide).
    pub fn remove(&mut self, section: &str, key: &str) {
        let Some((a, b)) = self.section_range(section) else { return };
        if let Some(i) = (a..b).rev().find(|&i| Self::key_of(&self.lines[i]).is_some_and(|(k, _)| k.eq_ignore_ascii_case(key))) {
            self.lines.remove(i);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modification_ciblee_conserve_le_reste() {
        let src = b"# GMSE01 - Super Mario Sunshine\r\n[Core]\r\n# Values set here will override the main Dolphin settings.\r\nCPUThread = True\r\n\r\n[OnFrame]\r\n$Infinite lives\r\n[Video_Settings]\r\nSafeTextureCacheColorSamples = 512\r\n";
        let mut ini = Ini::parse(src).unwrap();
        ini.set("Core", "CPUThread", "False");
        ini.set("Video_Settings", "InternalResolution", "3");
        ini.set("Video_Hacks", "EFBAccessEnable", "False");
        let out = String::from_utf8(ini.to_bytes()).unwrap();
        assert!(out.contains("CPUThread = False\r\n"));
        assert!(out.contains("$Infinite lives\r\n"));
        assert!(out.contains("SafeTextureCacheColorSamples = 512\r\nInternalResolution = 3\r\n"));
        assert!(out.ends_with("[Video_Hacks]\r\nEFBAccessEnable = False\r\n"));
        assert!(out.starts_with("# GMSE01 - Super Mario Sunshine\r\n"));
        assert_eq!(ini.get("core", "cputhread").as_deref(), Some("False"));
        // les lignes de codes ($, +, *) ne sont jamais prises pour des clés
        assert_eq!(ini.get("OnFrame", "$Infinite lives"), None);
    }

    #[test]
    fn aller_retour_identique_et_garde_fous() {
        let src = b"[A]\nx=1\n; note\n";
        assert_eq!(Ini::parse(src).unwrap().to_bytes(), src);
        assert!(Ini::parse(&vec![b'a'; MAX_INI_BYTES + 1]).is_err());
        assert!(Ini::parse(&[0xFF, 0xFE, 0x00]).is_err());
        let mut e = Ini::empty();
        e.set("Core", "DSPHLE", "True");
        assert_eq!(e.to_bytes(), b"[Core]\r\nDSPHLE = True\r\n");
        e.remove("Core", "DSPHLE");
        assert_eq!(e.get("Core", "DSPHLE"), None);
    }
}
