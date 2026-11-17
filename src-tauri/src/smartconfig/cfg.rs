//! Édition ciblée d'un fichier `.cfg` de RetroArch (`clé = "valeur"`, une
//! entrée par ligne, `#` pour les commentaires et `#include`). Seules les
//! clés demandées changent ; commentaires, inclusions, ordre et fins de ligne
//! sont conservés. Un fichier où une clé apparaît deux fois est refusé
//! (laquelle l'emporte n'est pas garanti).

use crate::smartconfig::adapters::common::Doc;
use crate::smartconfig::ini::MAX_INI_BYTES;

#[derive(Debug, Clone, PartialEq)]
pub struct Cfg {
    lines: Vec<String>,
    crlf: bool,
    trailing_newline: bool,
}

fn entry(line: &str) -> Option<(&str, &str)> {
    let t = line.trim();
    if t.is_empty() || t.starts_with('#') {
        return None;
    }
    let (k, v) = t.split_once('=')?;
    Some((k.trim(), v.trim()))
}

fn unquote(v: &str) -> String {
    let v = v.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        v[1..v.len() - 1].to_string()
    } else {
        v.to_string()
    }
}

impl Cfg {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_INI_BYTES {
            return Err("fichier de réglages trop volumineux".into());
        }
        let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
        let text = std::str::from_utf8(bytes).map_err(|_| "fichier de réglages illisible (encodage)".to_string())?;
        if text.contains('\0') {
            return Err("fichier de réglages invalide".into());
        }
        let lines: Vec<String> = if text.is_empty() { Vec::new() } else { text.lines().map(str::to_string).collect() };
        let mut seen: Vec<&str> = Vec::new();
        for l in &lines {
            if let Some((k, _)) = entry(l) {
                if seen.contains(&k) {
                    return Err("fichier de réglages RetroArch avec une clé en double : non modifié".into());
                }
                seen.push(k);
            }
        }
        Ok(Self { crlf: text.contains("\r\n"), trailing_newline: text.is_empty() || text.ends_with('\n'), lines })
    }

    pub fn empty() -> Self {
        Self { lines: Vec::new(), crlf: false, trailing_newline: true }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let nl = if self.crlf { "\r\n" } else { "\n" };
        let mut s = self.lines.join(nl);
        if self.trailing_newline && !self.lines.is_empty() {
            s.push_str(nl);
        }
        s.into_bytes()
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.lines.iter().find_map(|l| entry(l).filter(|(k, _)| *k == key).map(|(_, v)| unquote(v)))
    }

    pub fn set(&mut self, key: &str, value: &str) -> Result<(), String> {
        if value.is_empty() || !value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) || !key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
            return Err("valeur non transposable".into());
        }
        let line = format!("{key} = \"{value}\"");
        match self.lines.iter().position(|l| entry(l).is_some_and(|(k, _)| k == key)) {
            Some(i) => self.lines[i] = line,
            None => {
                while self.lines.last().is_some_and(|l| l.trim().is_empty()) {
                    self.lines.pop();
                    self.trailing_newline = true;
                }
                self.lines.push(line);
            }
        }
        Ok(())
    }
}

impl Doc for Cfg {
    fn get(&self, _section: &str, key: &str) -> Option<String> {
        Cfg::get(self, key)
    }
    fn set(&mut self, _section: &str, key: &str, value: &str) -> Result<(), String> {
        Cfg::set(self, key, value)
    }
    fn to_bytes(&self) -> Vec<u8> {
        Cfg::to_bytes(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modification_ciblee_conserve_le_reste() {
        let src = "#include \"commun.cfg\"\r\n# note\r\nvideo_vsync = \"true\"\r\ninput_player1_a = \"x\"\r\n";
        let mut c = Cfg::parse(src.as_bytes()).unwrap();
        assert_eq!(c.get("video_vsync").as_deref(), Some("true"));
        assert_eq!(c.get("include"), None);
        c.set("video_vsync", "false").unwrap();
        c.set("video_frame_delay", "4").unwrap();
        assert_eq!(String::from_utf8(c.to_bytes()).unwrap(), src.replace("vsync = \"true\"", "vsync = \"false\"") + "video_frame_delay = \"4\"\r\n");
        assert_eq!(Cfg::parse(src.as_bytes()).unwrap().to_bytes(), src.as_bytes());
        let mut e = Cfg::empty();
        e.set("rewind_enable", "true").unwrap();
        assert_eq!(e.to_bytes(), b"rewind_enable = \"true\"\n");
        assert_eq!(Cfg::parse(b"video_hard_sync = true\n").unwrap().get("video_hard_sync").as_deref(), Some("true"));
    }

    #[test]
    fn valeurs_malveillantes_et_doublons_refuses() {
        assert!(Cfg::parse(b"video_vsync = \"true\"\nvideo_vsync = \"false\"\n").is_err());
        assert!(Cfg::parse(b"a\0").is_err());
        let mut c = Cfg::empty();
        for v in ["true\"\nsavefile_directory = \"C:\\x", "a b", "", "C:\\x", "\"x\""] {
            assert!(c.set("video_vsync", v).is_err(), "{v:?}");
        }
        assert!(c.set("Video_Vsync\n", "true").is_err());
        assert!(c.to_bytes().is_empty());
    }
}
