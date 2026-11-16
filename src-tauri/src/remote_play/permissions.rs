//! Droits des participants d'une session Remote Play, contrôlés dans le moteur natif.
//!
//! Principes : tout est refusé par défaut ; être ami ne donne aucun droit ; les droits effectifs
//! sont l'intersection des droits accordés et du plafond du mode de partage ; l'arrêt d'urgence
//! coupe toutes les entrées ; chaque retrait de droit, départ ou blocage relâche ce que le
//! participant tenait enfoncé.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use super::protocol::{newer, Message, MouseButton, MAX_HELD_KEYS, MAX_PADS};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Permission {
    View,
    Audio,
    Gamepad,
    Keyboard,
    Mouse,
    Voice,
    TextChat,
    Clipboard,
    Invite,
    SwitchScreen,
}

impl Permission {
    pub const ALL: [Permission; 10] = [
        Self::View,
        Self::Audio,
        Self::Gamepad,
        Self::Keyboard,
        Self::Mouse,
        Self::Voice,
        Self::TextChat,
        Self::Clipboard,
        Self::Invite,
        Self::SwitchScreen,
    ];
    fn bit(self) -> u16 {
        1 << (self as u16)
    }
}

/// Ensemble de droits (champ de bits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Grants(u16);

impl Grants {
    pub const NONE: Grants = Grants(0);
    pub fn of(list: &[Permission]) -> Self {
        Grants(list.iter().fold(0, |acc, p| acc | p.bit()))
    }
    pub fn has(self, p: Permission) -> bool {
        self.0 & p.bit() != 0
    }
    pub fn and(self, other: Grants) -> Grants {
        Grants(self.0 & other.0)
    }
    pub fn list(self) -> Vec<Permission> {
        Permission::ALL.into_iter().filter(|p| self.has(*p)).collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Profile {
    Spectator,
    Player,
    Collaborator,
    FullControl,
}

impl Profile {
    pub fn grants(self) -> Grants {
        use Permission::*;
        match self {
            Profile::Spectator => Grants::of(&[View, Audio]),
            Profile::Player => Grants::of(&[View, Audio, Gamepad]),
            Profile::Collaborator => Grants::of(&[View, Audio, Keyboard, Mouse]),
            Profile::FullControl => Grants::of(&[View, Audio, Gamepad, Keyboard, Mouse, SwitchScreen]),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    DesktopShare,
    GameShare,
    LocalMultiplayer,
    WatchParty,
    PersonalAccess,
}

impl Mode {
    /// Droits maximum qu'un mode autorise, quoi que l'hôte accorde.
    /// Game Share / Local Multiplayer : pas de clavier ni de souris tant que l'isolation des
    /// entrées dans la fenêtre partagée n'est pas garantie (Phase 3) — manettes uniquement.
    pub fn ceiling(self) -> Grants {
        use Permission::*;
        match self {
            Mode::DesktopShare => Grants::of(&Permission::ALL),
            Mode::GameShare | Mode::LocalMultiplayer => Grants::of(&[View, Audio, Gamepad, Voice, TextChat, Invite]),
            Mode::WatchParty => Grants::of(&[View, Audio, Voice, TextChat]),
            Mode::PersonalAccess => Grants::of(&[View, Audio, Gamepad, Keyboard, Mouse, Clipboard, SwitchScreen]),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denied {
    UnknownParticipant,
    Blocked,
    Suspended,
    Missing(Permission),
    PadNotAssigned,
    PadDisabled,
    Stale,
    TooManyKeys,
    NeedsConfirmation,
    PadTaken,
    /// Message réservé au sens hôte → invité (vibration).
    WrongDirection,
}

#[derive(Debug, Default)]
struct Participant {
    account: String,
    grants: Grants,
    pad: Option<u8>,
    pad_enabled: bool,
    keys: BTreeSet<u16>,
    buttons: Vec<MouseButton>,
    mouse_seq: Option<u32>,
    keys_seq: Option<u32>,
    pad_seq: Option<u32>,
}

impl Participant {
    /// Messages qui relâchent tout ce que le participant tient enfoncé.
    fn release_all(&mut self) -> Vec<Message> {
        let mut out: Vec<Message> = std::mem::take(&mut self.keys)
            .into_iter()
            .map(|scancode| Message::Key { scancode, down: false })
            .collect();
        out.extend(std::mem::take(&mut self.buttons).into_iter().map(|button| Message::MouseButton { button, down: false }));
        if let Some(pad) = self.pad {
            out.push(Message::Gamepad { pad, seq: 0, state: Default::default() });
        }
        out
    }
}

pub type ParticipantId = u64;

/// Ce que le moteur doit exécuter après autorisation : le message lui-même (s'il a un effet)
/// suivi des relâchements nécessaires.
pub type Actions = Vec<Message>;

#[derive(Debug)]
pub struct Session {
    mode: Mode,
    suspended: bool,
    participants: HashMap<ParticipantId, Participant>,
    blocked: HashSet<String>,
}

impl Session {
    pub fn new(mode: Mode, blocked: impl IntoIterator<Item = String>) -> Self {
        Session { mode, suspended: false, participants: HashMap::new(), blocked: blocked.into_iter().collect() }
    }

    pub fn mode(&self) -> Mode {
        self.mode
    }

    /// Un participant arrive sans aucun droit : l'hôte doit lui en accorder.
    pub fn join(&mut self, id: ParticipantId, account: &str) -> Result<(), Denied> {
        if self.blocked.contains(account) {
            return Err(Denied::Blocked);
        }
        self.participants.insert(id, Participant { account: account.to_owned(), ..Default::default() });
        Ok(())
    }

    pub fn effective(&self, id: ParticipantId) -> Grants {
        self.participants.get(&id).map_or(Grants::NONE, |p| p.grants.and(self.mode.ceiling()))
    }

    /// Remplace les droits ; Contrôle complet exige une confirmation distincte des risques.
    pub fn set_profile(&mut self, id: ParticipantId, profile: Profile, risks_acknowledged: bool) -> Result<Actions, Denied> {
        if profile == Profile::FullControl && !risks_acknowledged {
            return Err(Denied::NeedsConfirmation);
        }
        self.set_grants(id, profile.grants())
    }

    pub fn set_grants(&mut self, id: ParticipantId, grants: Grants) -> Result<Actions, Denied> {
        let p = self.participants.get_mut(&id).ok_or(Denied::UnknownParticipant)?;
        let before = p.grants;
        p.grants = grants;
        let mut out = Vec::new();
        if before.has(Permission::Keyboard) && !grants.has(Permission::Keyboard) {
            out.extend(std::mem::take(&mut p.keys).into_iter().map(|scancode| Message::Key { scancode, down: false }));
        }
        if before.has(Permission::Mouse) && !grants.has(Permission::Mouse) {
            out.extend(std::mem::take(&mut p.buttons).into_iter().map(|button| Message::MouseButton { button, down: false }));
        }
        if before.has(Permission::Gamepad) && !grants.has(Permission::Gamepad) {
            if let Some(pad) = p.pad {
                out.push(Message::Gamepad { pad, seq: 0, state: Default::default() });
            }
        }
        Ok(out)
    }

    pub fn assign_pad(&mut self, id: ParticipantId, pad: Option<u8>) -> Result<Actions, Denied> {
        if let Some(n) = pad {
            if n >= MAX_PADS {
                return Err(Denied::PadNotAssigned);
            }
            if self.participants.iter().any(|(other, p)| *other != id && p.pad == Some(n)) {
                return Err(Denied::PadTaken);
            }
        }
        let p = self.participants.get_mut(&id).ok_or(Denied::UnknownParticipant)?;
        let mut out = Vec::new();
        if let Some(old) = p.pad.filter(|old| Some(*old) != pad) {
            out.push(Message::Gamepad { pad: old, seq: 0, state: Default::default() });
        }
        p.pad = pad;
        p.pad_enabled = pad.is_some();
        p.pad_seq = None;
        Ok(out)
    }

    /// L'hôte désactive (ou réactive) la manette d'un participant sans la retirer.
    pub fn enable_pad(&mut self, id: ParticipantId, enabled: bool) -> Result<Actions, Denied> {
        let p = self.participants.get_mut(&id).ok_or(Denied::UnknownParticipant)?;
        p.pad_enabled = enabled && p.pad.is_some();
        Ok(match (enabled, p.pad) {
            (false, Some(pad)) => vec![Message::Gamepad { pad, seq: 0, state: Default::default() }],
            _ => Vec::new(),
        })
    }

    /// Arrêt d'urgence : plus aucune entrée distante, tout est relâché.
    pub fn suspend(&mut self) -> Actions {
        self.suspended = true;
        self.participants.values_mut().flat_map(Participant::release_all).collect()
    }

    pub fn resume(&mut self) {
        self.suspended = false;
    }

    pub fn is_suspended(&self) -> bool {
        self.suspended
    }

    pub fn leave(&mut self, id: ParticipantId) -> Actions {
        self.participants.remove(&id).map_or_else(Vec::new, |mut p| p.release_all())
    }

    /// Expulse et bloque le compte pour la suite de la session.
    pub fn block(&mut self, id: ParticipantId) -> Actions {
        if let Some(p) = self.participants.get(&id) {
            self.blocked.insert(p.account.clone());
        }
        self.leave(id)
    }

    /// Décide si un message reçu d'un participant peut être exécuté.
    pub fn authorize(&mut self, id: ParticipantId, msg: Message) -> Result<Actions, Denied> {
        let ceiling = self.mode.ceiling();
        let suspended = self.suspended;
        let p = self.participants.get_mut(&id).ok_or(Denied::UnknownParticipant)?;
        let grants = p.grants.and(ceiling);
        let need = |perm: Permission| if grants.has(perm) { Ok(()) } else { Err(Denied::Missing(perm)) };
        let input = !matches!(msg, Message::Chat { .. } | Message::Ping { .. } | Message::Pong { .. });
        if input && suspended {
            return Err(Denied::Suspended);
        }
        match &msg {
            Message::MouseAbs { seq, .. } | Message::MouseRel { seq, .. } => {
                need(Permission::Mouse)?;
                fresh(&mut p.mouse_seq, *seq)?;
            }
            Message::MouseButton { button, down } => {
                need(Permission::Mouse)?;
                if *down {
                    if !p.buttons.contains(button) {
                        p.buttons.push(*button);
                    }
                } else {
                    p.buttons.retain(|b| b != button);
                }
            }
            Message::Wheel { .. } => need(Permission::Mouse)?,
            Message::Key { scancode, down } => {
                need(Permission::Keyboard)?;
                if *down {
                    if !p.keys.contains(scancode) && p.keys.len() >= MAX_HELD_KEYS {
                        return Err(Denied::TooManyKeys);
                    }
                    p.keys.insert(*scancode);
                } else {
                    p.keys.remove(scancode);
                }
            }
            Message::KeyState { seq, held } => {
                need(Permission::Keyboard)?;
                fresh(&mut p.keys_seq, *seq)?;
                // seuls les relâchements sont déduits ; les appuis passent par le canal fiable
                let keep: BTreeSet<u16> = held.iter().copied().collect();
                let released: Vec<u16> = p.keys.difference(&keep).copied().collect();
                p.keys.retain(|k| keep.contains(k));
                return Ok(released.into_iter().map(|scancode| Message::Key { scancode, down: false }).collect());
            }
            Message::Gamepad { pad, seq, .. } => {
                need(Permission::Gamepad)?;
                if p.pad != Some(*pad) {
                    return Err(Denied::PadNotAssigned);
                }
                if !p.pad_enabled {
                    return Err(Denied::PadDisabled);
                }
                fresh(&mut p.pad_seq, *seq)?;
            }
            Message::Rumble { .. } => return Err(Denied::WrongDirection),
            Message::Chat { .. } => need(Permission::TextChat)?,
            Message::Ping { .. } | Message::Pong { .. } => {}
        }
        Ok(vec![msg])
    }
}

/// Une donnée continue plus ancienne que la dernière reçue est ignorée (la plus récente gagne).
fn fresh(last: &mut Option<u32>, seq: u32) -> Result<(), Denied> {
    match *last {
        Some(prev) if !newer(seq, prev) => Err(Denied::Stale),
        _ => {
            *last = Some(seq);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_play::protocol::PadState;

    fn key(scancode: u16, down: bool) -> Message {
        Message::Key { scancode, down }
    }
    fn pad(n: u8, seq: u32) -> Message {
        Message::Gamepad { pad: n, seq, state: PadState { buttons: 1, ..Default::default() } }
    }

    #[test]
    fn everything_is_denied_by_default() {
        let mut s = Session::new(Mode::DesktopShare, []);
        s.join(1, "ami").unwrap();
        assert_eq!(s.effective(1), Grants::NONE);
        assert_eq!(s.authorize(1, key(0x1E, true)), Err(Denied::Missing(Permission::Keyboard)));
        assert_eq!(s.authorize(1, Message::MouseAbs { seq: 1, x: 0, y: 0 }), Err(Denied::Missing(Permission::Mouse)));
        assert_eq!(s.authorize(1, Message::Chat { text: "a".into() }), Err(Denied::Missing(Permission::TextChat)));
        assert_eq!(s.authorize(2, key(0x1E, true)), Err(Denied::UnknownParticipant));
    }

    #[test]
    fn full_control_needs_separate_confirmation() {
        let mut s = Session::new(Mode::DesktopShare, []);
        s.join(1, "ami").unwrap();
        assert_eq!(s.set_profile(1, Profile::FullControl, false), Err(Denied::NeedsConfirmation));
        assert_eq!(s.effective(1), Grants::NONE);
        s.set_profile(1, Profile::FullControl, true).unwrap();
        assert!(s.effective(1).has(Permission::Keyboard));
    }

    #[test]
    fn mode_ceiling_wins_over_grants() {
        let mut s = Session::new(Mode::GameShare, []);
        s.join(1, "ami").unwrap();
        s.set_profile(1, Profile::FullControl, true).unwrap();
        assert!(!s.effective(1).has(Permission::Keyboard));
        assert_eq!(s.authorize(1, key(0x1E, true)), Err(Denied::Missing(Permission::Keyboard)));
        let mut w = Session::new(Mode::WatchParty, []);
        w.join(1, "ami").unwrap();
        w.set_profile(1, Profile::Player, false).unwrap();
        assert_eq!(w.effective(1).list(), vec![Permission::View, Permission::Audio]);
    }

    #[test]
    fn gamepads_must_be_assigned_enabled_and_unique() {
        let mut s = Session::new(Mode::LocalMultiplayer, []);
        s.join(1, "a").unwrap();
        s.join(2, "b").unwrap();
        s.set_profile(1, Profile::Player, false).unwrap();
        assert_eq!(s.authorize(1, pad(0, 1)), Err(Denied::PadNotAssigned));
        s.assign_pad(1, Some(0)).unwrap();
        assert_eq!(s.assign_pad(2, Some(0)), Err(Denied::PadTaken));
        assert!(s.authorize(1, pad(0, 1)).is_ok());
        assert_eq!(s.authorize(1, pad(1, 2)), Err(Denied::PadNotAssigned));
        assert_eq!(s.authorize(1, pad(0, 1)), Err(Denied::Stale));
        let released = s.enable_pad(1, false).unwrap();
        assert_eq!(released, vec![Message::Gamepad { pad: 0, seq: 0, state: PadState::default() }]);
        assert_eq!(s.authorize(1, pad(0, 3)), Err(Denied::PadDisabled));
        assert_eq!(s.authorize(1, Message::Rumble { pad: 0, large: 9, small: 9 }), Err(Denied::WrongDirection));
    }

    #[test]
    fn stale_continuous_input_is_dropped() {
        let mut s = Session::new(Mode::DesktopShare, []);
        s.join(1, "a").unwrap();
        s.set_profile(1, Profile::Collaborator, false).unwrap();
        assert!(s.authorize(1, Message::MouseAbs { seq: 10, x: 1, y: 1 }).is_ok());
        assert_eq!(s.authorize(1, Message::MouseRel { seq: 9, dx: 1, dy: 1 }), Err(Denied::Stale));
        assert!(s.authorize(1, Message::MouseRel { seq: 11, dx: 1, dy: 1 }).is_ok());
    }

    #[test]
    fn keys_are_released_on_every_exit_path() {
        let mut s = Session::new(Mode::DesktopShare, []);
        s.join(1, "a").unwrap();
        s.set_profile(1, Profile::Collaborator, false).unwrap();
        s.authorize(1, key(0x1E, true)).unwrap();
        s.authorize(1, key(0x2A, true)).unwrap();
        s.authorize(1, Message::MouseButton { button: MouseButton::Left, down: true }).unwrap();

        // resynchronisation : 0x2A n'est plus tenue
        let r = s.authorize(1, Message::KeyState { seq: 1, held: vec![0x1E] }).unwrap();
        assert_eq!(r, vec![key(0x2A, false)]);

        // retrait du clavier : 0x1E relâchée, la souris reste
        let r = s.set_profile(1, Profile::Spectator, false).unwrap();
        assert_eq!(r, vec![key(0x1E, false), Message::MouseButton { button: MouseButton::Left, down: false }]);

        s.set_profile(1, Profile::Collaborator, false).unwrap();
        s.authorize(1, key(0x10, true)).unwrap();
        assert_eq!(s.leave(1), vec![key(0x10, false)]);
    }

    #[test]
    fn emergency_stop_blocks_input_but_not_chat() {
        let mut s = Session::new(Mode::DesktopShare, []);
        s.join(1, "a").unwrap();
        s.set_grants(1, Grants::of(&[Permission::Keyboard, Permission::TextChat])).unwrap();
        s.authorize(1, key(0x1E, true)).unwrap();
        assert_eq!(s.suspend(), vec![key(0x1E, false)]);
        assert_eq!(s.authorize(1, key(0x1F, true)), Err(Denied::Suspended));
        assert!(s.authorize(1, Message::Chat { text: "pardon".into() }).is_ok());
        s.resume();
        assert!(s.authorize(1, key(0x1F, true)).is_ok());
    }

    #[test]
    fn held_keys_are_bounded() {
        let mut s = Session::new(Mode::DesktopShare, []);
        s.join(1, "a").unwrap();
        s.set_profile(1, Profile::Collaborator, false).unwrap();
        for code in 1..=MAX_HELD_KEYS as u16 {
            s.authorize(1, key(code, true)).unwrap();
        }
        assert_eq!(s.authorize(1, key(0x50, true)), Err(Denied::TooManyKeys));
        assert!(s.authorize(1, key(1, true)).is_ok(), "répétition d'une touche déjà tenue");
    }

    #[test]
    fn blocked_accounts_cannot_rejoin() {
        let mut s = Session::new(Mode::DesktopShare, ["ennemi".to_string()]);
        assert_eq!(s.join(1, "ennemi"), Err(Denied::Blocked));
        s.join(2, "ami").unwrap();
        s.block(2);
        assert_eq!(s.join(3, "ami"), Err(Denied::Blocked));
    }
}
