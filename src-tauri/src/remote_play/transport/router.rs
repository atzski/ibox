//! Messages reçus sur les DataChannels : taille bornée **avant** décodage, décodage strict
//! (`protocol::decode`), puis vérification du canal attendu pour chaque type (§4 de
//! `docs/REMOTE-PLAY.md`). Le message accepté part ensuite vers `Session::authorize` (via
//! `input::Engine::handle`) : ce module ne donne aucun droit, il filtre seulement.

use crate::remote_play::protocol::{self, DecodeError, Message, MAX_CHAT_BYTES, MAX_INPUT_LEN};

pub const INPUT_LABEL: &str = "input";
pub const CONTROL_LABEL: &str = "control";

/// Taille maximale d'un message `control` : type + longueur + chat.
pub const MAX_CONTROL_LEN: usize = 1 + 2 + MAX_CHAT_BYTES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    /// Non ordonné, 0 retransmission : état le plus récent (souris, `KeyState`, manettes).
    Input,
    /// Fiable et ordonné : événements (touches, boutons, molette, chat, ping).
    Control,
}

impl Channel {
    pub fn from_label(label: &str) -> Option<Channel> {
        match label {
            INPUT_LABEL => Some(Channel::Input),
            CONTROL_LABEL => Some(Channel::Control),
            _ => None,
        }
    }

    pub fn max_len(self) -> usize {
        match self {
            Channel::Input => MAX_INPUT_LEN,
            Channel::Control => MAX_CONTROL_LEN,
        }
    }

    /// Canal sur lequel un type de message doit arriver.
    pub fn expected_for(msg: &Message) -> Channel {
        match msg {
            Message::MouseAbs { .. } | Message::MouseRel { .. } | Message::KeyState { .. } | Message::Gamepad { .. } => Channel::Input,
            Message::MouseButton { .. }
            | Message::Wheel { .. }
            | Message::Key { .. }
            | Message::Chat { .. }
            | Message::Ping { .. }
            | Message::Pong { .. }
            // l'invité n'a pas à l'envoyer : la session le refuse (`Denied::WrongDirection`)
            | Message::Rumble { .. } => Channel::Control,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    /// Message texte ou canal inconnu.
    NotBinary,
    TooLarge,
    Decode(DecodeError),
    /// Un événement sur le canal non fiable (il pourrait se perdre) ou l'inverse.
    WrongChannel,
}

/// Filtre un message reçu sur `channel`. Aucun effet de bord.
pub fn route(channel: Channel, binary: bool, bytes: &[u8]) -> Result<Message, Rejected> {
    if !binary {
        return Err(Rejected::NotBinary);
    }
    if bytes.len() > channel.max_len() {
        return Err(Rejected::TooLarge);
    }
    let msg = protocol::decode(bytes).map_err(Rejected::Decode)?;
    if Channel::expected_for(&msg) != channel {
        return Err(Rejected::WrongChannel);
    }
    Ok(msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_play::protocol::{encode, MouseButton, PadState};

    #[test]
    fn messages_valides_sur_le_bon_canal() {
        let abs = Message::MouseAbs { seq: 7, x: 100, y: 65535 };
        assert_eq!(route(Channel::Input, true, &encode(&abs)), Ok(abs));
        let pad = Message::Gamepad { pad: 1, seq: 3, state: PadState { buttons: 0x1000, lt: 255, ..Default::default() } };
        assert_eq!(route(Channel::Input, true, &encode(&pad)), Ok(pad));
        let key = Message::Key { scancode: 0xE048, down: true };
        assert_eq!(route(Channel::Control, true, &encode(&key)), Ok(key));
        let chat = Message::Chat { text: "é".repeat(MAX_CHAT_BYTES / 2) };
        assert_eq!(route(Channel::Control, true, &encode(&chat)), Ok(chat));
    }

    #[test]
    fn trop_long_refuse_avant_decodage() {
        assert_eq!(route(Channel::Input, true, &vec![0x10; MAX_INPUT_LEN + 1]), Err(Rejected::TooLarge));
        assert_eq!(route(Channel::Control, true, &vec![0x40; MAX_CONTROL_LEN + 1]), Err(Rejected::TooLarge));
        // un chat valide est trop long pour le canal input
        let chat = encode(&Message::Chat { text: "x".repeat(200) });
        assert_eq!(route(Channel::Input, true, &chat), Err(Rejected::TooLarge));
    }

    #[test]
    fn hors_limites_ou_malforme() {
        assert_eq!(route(Channel::Input, true, &[]), Err(Rejected::Decode(DecodeError::Empty)));
        assert_eq!(route(Channel::Control, true, &[0x99, 0, 0]), Err(Rejected::Decode(DecodeError::UnknownType(0x99))));
        // MouseAbs tronqué
        let mut abs = encode(&Message::MouseAbs { seq: 1, x: 1, y: 1 });
        abs.pop();
        assert_eq!(route(Channel::Input, true, &abs), Err(Rejected::Decode(DecodeError::BadLength)));
        // manette 9 : hors domaine (0–3)
        let mut pad = encode(&Message::Gamepad { pad: 0, seq: 1, state: PadState::default() });
        pad[1] = 9;
        assert_eq!(route(Channel::Input, true, &pad), Err(Rejected::Decode(DecodeError::OutOfRange)));
        // KeyState annonçant 17 touches
        let mut ks = vec![0x21, 0, 0, 0, 0, 17];
        ks.extend(std::iter::repeat_n(0u8, 34));
        assert_eq!(route(Channel::Input, true, &ks), Err(Rejected::Decode(DecodeError::OutOfRange)));
        // UTF-8 invalide
        assert_eq!(route(Channel::Control, true, &[0x40, 2, 0, 0xC3, 0x28]), Err(Rejected::Decode(DecodeError::BadText)));
    }

    #[test]
    fn mauvais_canal_ou_texte() {
        let key = encode(&Message::Key { scancode: 0x1E, down: true });
        assert_eq!(route(Channel::Input, true, &key), Err(Rejected::WrongChannel), "un appui ne doit pas pouvoir se perdre");
        let btn = encode(&Message::MouseButton { button: MouseButton::Left, down: false });
        assert_eq!(route(Channel::Input, true, &btn), Err(Rejected::WrongChannel));
        let abs = encode(&Message::MouseAbs { seq: 1, x: 0, y: 0 });
        assert_eq!(route(Channel::Control, true, &abs), Err(Rejected::WrongChannel));
        assert_eq!(route(Channel::Control, false, b"hello"), Err(Rejected::NotBinary));
        assert_eq!(Channel::from_label("chat"), None);
    }
}
