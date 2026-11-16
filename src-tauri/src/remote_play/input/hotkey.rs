//! Raccourci d'arrêt d'urgence (configurable) et événements de session Windows qui coupent tout.

use std::fmt;
use std::str::FromStr;

pub const DEFAULT_HOTKEY: &str = "Ctrl+Alt+Shift+F12";

// Valeurs de `RegisterHotKey` (MOD_*), recopiées pour garder ce module testable partout.
pub const MOD_ALT: u32 = 0x1;
pub const MOD_CONTROL: u32 = 0x2;
pub const MOD_SHIFT: u32 = 0x4;
pub const MOD_WIN: u32 = 0x8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hotkey {
    /// Combinaison de `MOD_*` (sans `MOD_NOREPEAT`, ajouté à l'enregistrement).
    pub modifiers: u32,
    /// Code de touche virtuelle Windows.
    pub vk: u32,
}

impl Default for Hotkey {
    fn default() -> Self {
        DEFAULT_HOTKEY.parse().expect("raccourci par défaut valide")
    }
}

const NAMED: &[(&str, u32)] = &[
    ("Pause", 0x13),
    ("ScrollLock", 0x91),
    ("Insert", 0x2D),
    ("Delete", 0x2E),
    ("Home", 0x24),
    ("End", 0x23),
    ("PageUp", 0x21),
    ("PageDown", 0x22),
    ("Backspace", 0x08),
];

fn key_code(name: &str) -> Option<u32> {
    if let Some(n) = name.strip_prefix(['F', 'f']).and_then(|n| n.parse::<u32>().ok()) {
        return (1..=24).contains(&n).then_some(0x70 + n - 1);
    }
    if name.len() == 1 {
        let c = name.chars().next()?.to_ascii_uppercase();
        return c.is_ascii_alphanumeric().then_some(c as u32);
    }
    NAMED.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, vk)| *vk)
}

fn key_name(vk: u32) -> String {
    match vk {
        0x70..=0x87 => format!("F{}", vk - 0x6F),
        0x30..=0x39 | 0x41..=0x5A => char::from_u32(vk).map(String::from).unwrap_or_default(),
        _ => NAMED.iter().find(|(_, v)| *v == vk).map_or_else(|| format!("0x{vk:02X}"), |(n, _)| (*n).to_owned()),
    }
}

impl FromStr for Hotkey {
    type Err = String;

    /// « Ctrl+Alt+Shift+F12 » : au moins deux modificateurs (un raccourci d'urgence ne doit pas
    /// voler un raccourci ordinaire) et exactement une touche.
    fn from_str(s: &str) -> Result<Self, String> {
        let mut modifiers = 0;
        let mut vk = None;
        for part in s.split('+').map(str::trim) {
            let m = match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => MOD_CONTROL,
                "alt" => MOD_ALT,
                "shift" | "maj" => MOD_SHIFT,
                "win" => MOD_WIN,
                _ => 0,
            };
            if m != 0 {
                modifiers |= m;
                continue;
            }
            let code = key_code(part).ok_or_else(|| format!("touche inconnue : « {part} »"))?;
            if vk.replace(code).is_some() {
                return Err("une seule touche en plus des modificateurs".into());
            }
        }
        let vk = vk.ok_or("touche manquante")?;
        if modifiers.count_ones() < 2 {
            return Err("au moins deux modificateurs (Ctrl, Alt, Maj, Win)".into());
        }
        Ok(Hotkey { modifiers, vk })
    }
}

impl fmt::Display for Hotkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (m, name) in [(MOD_CONTROL, "Ctrl"), (MOD_ALT, "Alt"), (MOD_SHIFT, "Shift"), (MOD_WIN, "Win")] {
            if self.modifiers & m != 0 {
                write!(f, "{name}+")?;
            }
        }
        f.write_str(&key_name(self.vk))
    }
}

/// Pourquoi toutes les entrées distantes ont été coupées.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// Raccourci d'arrêt d'urgence pressé sur l'hôte.
    Hotkey,
    /// Windows verrouillé (Win+L, mise en veille avec verrouillage…).
    Locked,
    /// Déconnexion de la console, fermeture de session ou changement d'utilisateur.
    SessionChanged,
    /// Arrêt demandé par l'interface d'iBox.
    Requested,
}

// Valeurs `wParam` de `WM_WTSSESSION_CHANGE`.
const WTS_CONSOLE_DISCONNECT: u32 = 0x2;
const WTS_REMOTE_DISCONNECT: u32 = 0x4;
const WTS_SESSION_LOGOFF: u32 = 0x6;
const WTS_SESSION_LOCK: u32 = 0x7;

/// Événement de session Windows qui impose l'arrêt (les autres sont ignorés).
pub fn stop_for_session_event(code: u32) -> Option<StopReason> {
    match code {
        WTS_SESSION_LOCK => Some(StopReason::Locked),
        WTS_CONSOLE_DISCONNECT | WTS_REMOTE_DISCONNECT | WTS_SESSION_LOGOFF => Some(StopReason::SessionChanged),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_ctrl_alt_shift_f12() {
        let h = Hotkey::default();
        assert_eq!(h, Hotkey { modifiers: MOD_CONTROL | MOD_ALT | MOD_SHIFT, vk: 0x7B });
        assert_eq!(h.to_string(), DEFAULT_HOTKEY);
    }

    #[test]
    fn parsing_is_tolerant_but_strict_on_meaning() {
        assert_eq!("ctrl + maj + pause".parse(), Ok(Hotkey { modifiers: MOD_CONTROL | MOD_SHIFT, vk: 0x13 }));
        assert_eq!("Win+Alt+s".parse::<Hotkey>().unwrap().to_string(), "Alt+Win+S");
        assert_eq!("Ctrl+Alt+F24".parse::<Hotkey>().unwrap().vk, 0x87);
        assert!("Ctrl+F12".parse::<Hotkey>().is_err(), "un seul modificateur");
        assert!("Ctrl+Alt".parse::<Hotkey>().is_err(), "pas de touche");
        assert!("Ctrl+Alt+A+B".parse::<Hotkey>().is_err(), "deux touches");
        assert!("Ctrl+Alt+F25".parse::<Hotkey>().is_err());
        assert!("Ctrl+Alt+Ω".parse::<Hotkey>().is_err());
        assert!("".parse::<Hotkey>().is_err());
    }

    #[test]
    fn lock_and_session_switch_stop_everything() {
        assert_eq!(stop_for_session_event(WTS_SESSION_LOCK), Some(StopReason::Locked));
        assert_eq!(stop_for_session_event(WTS_CONSOLE_DISCONNECT), Some(StopReason::SessionChanged));
        assert_eq!(stop_for_session_event(WTS_REMOTE_DISCONNECT), Some(StopReason::SessionChanged));
        assert_eq!(stop_for_session_event(WTS_SESSION_LOGOFF), Some(StopReason::SessionChanged));
        assert_eq!(stop_for_session_event(0x8), None, "déverrouillage : ne relance rien");
        assert_eq!(stop_for_session_event(0x1), None);
    }
}
