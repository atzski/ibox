//! Exécution des messages **déjà autorisés** par `permissions::Session` : clavier par codes de
//! balayage, souris absolue/relative, boutons, molettes, manettes. L'accès au système passe par
//! les traits [`Sink`], [`Screen`] et [`Pads`] : les tests utilisent des enregistreurs factices,
//! seul `win.rs` appelle `SendInput`.

use std::fmt;
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};

use super::geometry::{to_desktop, Rect};
use super::local::LocalActivity;
use super::pads::{PadError, Pads};
use crate::remote_play::protocol::{Message, MouseButton};

/// Une entrée élémentaire, telle qu'elle sera passée à `SendInput`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OsInput {
    /// `scan` = octet bas du code de balayage ; `extended` = préfixe 0xE0.
    Key { scan: u8, extended: bool, up: bool },
    /// Coordonnées absolues 0–65535 sur le bureau virtuel entier.
    MoveAbs { x: u16, y: u16 },
    MoveRel { dx: i32, dy: i32 },
    Button { button: MouseButton, down: bool },
    /// Positif = vers l'avant (défilement vers le haut), en unités `WHEEL_DELTA` (120 = un cran).
    Wheel { delta: i32 },
    /// Positif = vers la droite.
    HWheel { delta: i32 },
}

/// Code de balayage du protocole (0xE0xx = étendu) → entrée clavier ; `None` si hors domaine.
pub fn key_input(scancode: u16, down: bool) -> Option<OsInput> {
    let scan = (scancode & 0xFF) as u8;
    let extended = match scancode >> 8 {
        0 => false,
        0xE0 => true,
        _ => return None,
    };
    (1..=0x7F).contains(&scan).then_some(OsInput::Key { scan, extended, up: !down })
}

// Indicateurs Win32 (`KEYEVENTF_*`, `MOUSEEVENTF_*`, `XBUTTON*`), vérifiés contre windows-sys dans `win.rs`.
pub const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
pub const KEYEVENTF_KEYUP: u32 = 0x0002;
pub const KEYEVENTF_SCANCODE: u32 = 0x0008;
pub const MOUSEEVENTF_MOVE: u32 = 0x0001;
pub const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
pub const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
pub const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
pub const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;
pub const MOUSEEVENTF_MIDDLEDOWN: u32 = 0x0020;
pub const MOUSEEVENTF_MIDDLEUP: u32 = 0x0040;
pub const MOUSEEVENTF_XDOWN: u32 = 0x0080;
pub const MOUSEEVENTF_XUP: u32 = 0x0100;
pub const MOUSEEVENTF_WHEEL: u32 = 0x0800;
pub const MOUSEEVENTF_HWHEEL: u32 = 0x1000;
pub const MOUSEEVENTF_VIRTUALDESK: u32 = 0x4000;
pub const MOUSEEVENTF_ABSOLUTE: u32 = 0x8000;
pub const XBUTTON1: i32 = 0x0001;
pub const XBUTTON2: i32 = 0x0002;

/// Champs d'une structure `INPUT` (clavier : `scan` dans `data` ; souris : `mouseData` dans `data`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawInput {
    pub mouse: bool,
    pub flags: u32,
    pub data: i32,
    pub dx: i32,
    pub dy: i32,
}

pub fn raw(input: &OsInput) -> RawInput {
    let mouse = |flags: u32, data: i32, dx: i32, dy: i32| RawInput { mouse: true, flags, data, dx, dy };
    match *input {
        OsInput::Key { scan, extended, up } => RawInput {
            mouse: false,
            flags: KEYEVENTF_SCANCODE
                | if extended { KEYEVENTF_EXTENDEDKEY } else { 0 }
                | if up { KEYEVENTF_KEYUP } else { 0 },
            data: scan as i32,
            dx: 0,
            dy: 0,
        },
        OsInput::MoveAbs { x, y } => {
            mouse(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0, x as i32, y as i32)
        }
        OsInput::MoveRel { dx, dy } => mouse(MOUSEEVENTF_MOVE, 0, dx, dy),
        OsInput::Button { button, down } => {
            let (flags, data) = match (button, down) {
                (MouseButton::Left, true) => (MOUSEEVENTF_LEFTDOWN, 0),
                (MouseButton::Left, false) => (MOUSEEVENTF_LEFTUP, 0),
                (MouseButton::Right, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
                (MouseButton::Right, false) => (MOUSEEVENTF_RIGHTUP, 0),
                (MouseButton::Middle, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
                (MouseButton::Middle, false) => (MOUSEEVENTF_MIDDLEUP, 0),
                (MouseButton::X1, true) => (MOUSEEVENTF_XDOWN, XBUTTON1),
                (MouseButton::X1, false) => (MOUSEEVENTF_XUP, XBUTTON1),
                (MouseButton::X2, true) => (MOUSEEVENTF_XDOWN, XBUTTON2),
                (MouseButton::X2, false) => (MOUSEEVENTF_XUP, XBUTTON2),
            };
            mouse(flags, data, 0, 0)
        }
        OsInput::Wheel { delta } => mouse(MOUSEEVENTF_WHEEL, delta, 0, 0),
        OsInput::HWheel { delta } => mouse(MOUSEEVENTF_HWHEEL, delta, 0, 0),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InjectError {
    /// `SendInput` a refusé (code Win32) : fenêtre élevée (UIPI), bureau sécurisé ou session verrouillée.
    Refused(u32),
    /// La zone partagée n'existe plus (fenêtre fermée, réduite, écran débranché).
    AreaGone,
    BadScancode(u16),
    Pad(PadError),
}

impl fmt::Display for InjectError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            InjectError::Refused(code) => write!(
                f,
                "Windows a refusé l'entrée (code {code}) : fenêtre administrateur, bureau sécurisé (UAC) ou session verrouillée"
            ),
            InjectError::AreaGone => f.write_str("La fenêtre ou l'écran partagé n'est plus disponible"),
            InjectError::BadScancode(code) => write!(f, "Code de touche invalide 0x{code:04X}"),
            InjectError::Pad(e) => e.fmt(f),
        }
    }
}

/// Envoi des entrées au système.
pub trait Sink: Send {
    fn send(&mut self, inputs: &[OsInput]) -> Result<(), InjectError>;
    /// Repli de la priorité locale quand les crochets sont absents : une entrée étrangère
    /// (physique) a-t-elle eu lieu depuis notre dernier envoi ?
    fn foreign_input_since_last(&mut self) -> bool {
        false
    }
}

/// Zone partagée sur laquelle les coordonnées absolues de l'invité sont normalisées.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Area {
    /// Tout le bureau virtuel.
    Desktop,
    /// Un écran (`HMONITOR`).
    Monitor(isize),
    /// Zone client d'une fenêtre (`HWND`), relue à chaque mouvement : elle peut bouger.
    Window(isize),
    /// Rectangle fixe en pixels physiques.
    Rect(Rect),
}

/// Géométrie de l'écran.
pub trait Screen: Send {
    /// Bureau virtuel (tous les écrans) en pixels physiques.
    fn desktop(&self) -> Rect;
    /// Rectangle actuel d'un écran ou d'une fenêtre ; `None` s'il a disparu.
    fn resolve(&self, area: &Area) -> Option<Rect>;
}

/// Ce qu'il est advenu d'un message autorisé.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Injected,
    /// Ignoré : l'hôte utilise sa souris ou son clavier (priorité locale, 500 ms).
    LocalPriority,
    /// Rien à injecter (chat, ping, molette nulle) : traité ailleurs.
    NoInput,
}

pub struct Injector<S, D, P> {
    sink: S,
    screen: D,
    pads: P,
    area: Area,
    local: Arc<LocalActivity>,
}

impl<S: Sink, D: Screen, P: Pads> Injector<S, D, P> {
    pub fn new(sink: S, screen: D, pads: P, area: Area, local: Arc<LocalActivity>) -> Self {
        Injector { sink, screen, pads, area, local }
    }

    pub fn set_area(&mut self, area: Area) {
        self.area = area;
    }

    pub fn local(&self) -> &Arc<LocalActivity> {
        &self.local
    }

    pub fn sink(&self) -> &S {
        &self.sink
    }

    pub fn pads(&self) -> &P {
        &self.pads
    }

    #[cfg(test)]
    pub(crate) fn screen_mut_for_tests(&mut self) -> &mut D {
        &mut self.screen
    }

    fn area_rect(&self) -> Option<Rect> {
        let rect = match self.area {
            Area::Desktop => Some(self.screen.desktop()),
            Area::Rect(r) => Some(r),
            other => self.screen.resolve(&other),
        };
        rect.filter(|r| !r.is_empty())
    }

    fn local_has_priority(&mut self, now: Instant) -> bool {
        if !self.local.hooked() && self.sink.foreign_input_since_last() {
            self.local.note(now);
        }
        self.local.recent(now)
    }

    fn mouse(&mut self, input: OsInput, now: Instant) -> Result<Outcome, InjectError> {
        if self.local_has_priority(now) {
            return Ok(Outcome::LocalPriority);
        }
        self.sink.send(&[input])?;
        Ok(Outcome::Injected)
    }

    pub fn execute(&mut self, msg: &Message) -> Result<Outcome, InjectError> {
        self.execute_at(msg, Instant::now())
    }

    pub fn execute_at(&mut self, msg: &Message, now: Instant) -> Result<Outcome, InjectError> {
        match *msg {
            Message::Key { scancode, down } => {
                let input = key_input(scancode, down).ok_or(InjectError::BadScancode(scancode))?;
                self.sink.send(&[input])?;
                Ok(Outcome::Injected)
            }
            Message::MouseAbs { x, y, .. } => {
                let area = self.area_rect().ok_or(InjectError::AreaGone)?;
                let (x, y) = to_desktop(x, y, area, self.screen.desktop());
                self.mouse(OsInput::MoveAbs { x, y }, now)
            }
            Message::MouseRel { dx, dy, .. } => self.mouse(OsInput::MoveRel { dx: dx as i32, dy: dy as i32 }, now),
            // un relâchement passe toujours : rien ne doit rester enfoncé
            Message::MouseButton { button, down: false } => {
                self.sink.send(&[OsInput::Button { button, down: false }])?;
                Ok(Outcome::Injected)
            }
            Message::MouseButton { button, down: true } => self.mouse(OsInput::Button { button, down: true }, now),
            Message::Wheel { dx, dy } => {
                let mut inputs = Vec::with_capacity(2);
                if dy != 0 {
                    inputs.push(OsInput::Wheel { delta: dy as i32 });
                }
                if dx != 0 {
                    inputs.push(OsInput::HWheel { delta: dx as i32 });
                }
                if inputs.is_empty() {
                    return Ok(Outcome::NoInput);
                }
                if self.local_has_priority(now) {
                    return Ok(Outcome::LocalPriority);
                }
                self.sink.send(&inputs)?;
                Ok(Outcome::Injected)
            }
            Message::Gamepad { pad, ref state, .. } => {
                self.pads.update(pad, state).map_err(InjectError::Pad)?;
                Ok(Outcome::Injected)
            }
            // l'autorisation a déjà déduit les relâchements d'un KeyState ; le reste n'est pas une entrée
            Message::KeyState { .. } | Message::Rumble { .. } | Message::Chat { .. } | Message::Ping { .. } | Message::Pong { .. } => {
                Ok(Outcome::NoInput)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extended_scancodes_set_the_extended_flag() {
        // flèche gauche (E0 4B) contre pavé numérique 4 (4B) ; Ctrl droit (E0 1D) contre gauche (1D)
        assert_eq!(key_input(0xE04B, true), Some(OsInput::Key { scan: 0x4B, extended: true, up: false }));
        assert_eq!(key_input(0x004B, false), Some(OsInput::Key { scan: 0x4B, extended: false, up: true }));
        let right_ctrl = raw(&key_input(0xE01D, false).unwrap());
        assert_eq!(right_ctrl, RawInput { mouse: false, flags: KEYEVENTF_SCANCODE | KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, data: 0x1D, dx: 0, dy: 0 });
        let left_ctrl = raw(&key_input(0x1D, true).unwrap());
        assert_eq!(left_ctrl.flags, KEYEVENTF_SCANCODE);
        assert_eq!(key_input(0xE100 | 0x1D, true), None, "préfixe E1 (Pause) non pris en charge");
        assert_eq!(key_input(0x0080, true), None);
        assert_eq!(key_input(0, true), None);
    }

    #[test]
    fn mouse_flags() {
        assert_eq!(raw(&OsInput::MoveAbs { x: 10, y: 20 }).flags, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);
        assert_eq!(raw(&OsInput::MoveRel { dx: -3, dy: 4 }), RawInput { mouse: true, flags: MOUSEEVENTF_MOVE, data: 0, dx: -3, dy: 4 });
        assert_eq!(raw(&OsInput::Button { button: MouseButton::X2, down: true }).data, XBUTTON2);
        assert_eq!(raw(&OsInput::Button { button: MouseButton::X1, down: false }).flags, MOUSEEVENTF_XUP);
        assert_eq!(raw(&OsInput::Button { button: MouseButton::Right, down: false }).flags, MOUSEEVENTF_RIGHTUP);
        assert_eq!(raw(&OsInput::Wheel { delta: -120 }), RawInput { mouse: true, flags: MOUSEEVENTF_WHEEL, data: -120, dx: 0, dy: 0 });
        assert_eq!(raw(&OsInput::HWheel { delta: 120 }).flags, MOUSEEVENTF_HWHEEL);
    }
}
