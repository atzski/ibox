//! Messages échangés sur les DataChannels Remote Play (protocole v1).
//!
//! Format binaire petit-boutiste : un octet de type puis une charge de longueur **exacte**.
//! Le décodage refuse tout ce qui n'est pas parfaitement conforme (type inconnu, longueur
//! différente, valeur hors domaine, UTF-8 invalide) et ne panique jamais.
//! Spécification : `docs/REMOTE-PLAY.md` §4.

pub const VERSION: u8 = 1;
/// Taille maximale d'un message du canal `input` (non fiable).
pub const MAX_INPUT_LEN: usize = 64;
/// Taille maximale d'un message de chat, en octets UTF-8.
pub const MAX_CHAT_BYTES: usize = 500;
/// Nombre maximal de touches tenues décrites par un `KeyState`.
pub const MAX_HELD_KEYS: usize = 16;
/// Manettes par session (première architecture : 4 joueurs).
pub const MAX_PADS: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

impl MouseButton {
    fn from_u8(v: u8) -> Option<Self> {
        Some(match v {
            0 => Self::Left,
            1 => Self::Right,
            2 => Self::Middle,
            3 => Self::X1,
            4 => Self::X2,
            _ => return None,
        })
    }
    fn to_u8(self) -> u8 {
        self as u8
    }
}

/// État complet d'une manette, disposition XInput.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PadState {
    pub buttons: u16,
    pub lt: u8,
    pub rt: u8,
    pub lx: i16,
    pub ly: i16,
    pub rx: i16,
    pub ry: i16,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Message {
    MouseAbs { seq: u32, x: u16, y: u16 },
    MouseRel { seq: u32, dx: i16, dy: i16 },
    MouseButton { button: MouseButton, down: bool },
    Wheel { dx: i16, dy: i16 },
    /// Code de balayage (bit 0xE000 = touche étendue) : indépendant de la disposition.
    Key { scancode: u16, down: bool },
    /// Liste des touches tenues ; toute autre touche tenue par ce participant doit être relâchée.
    KeyState { seq: u32, held: Vec<u16> },
    Gamepad { pad: u8, seq: u32, state: PadState },
    Chat { text: String },
    Ping { id: u32, micros: u64 },
    Pong { id: u32, micros: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    Empty,
    UnknownType(u8),
    BadLength,
    OutOfRange,
    BadText,
}

/// Lecture bornée d'une charge ; chaque lecture vérifie la place restante.
struct Reader<'a> {
    buf: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], DecodeError> {
        if self.buf.len() < N {
            return Err(DecodeError::BadLength);
        }
        let (head, rest) = self.buf.split_at(N);
        self.buf = rest;
        Ok(head.try_into().expect("longueur vérifiée"))
    }
    fn u8(&mut self) -> Result<u8, DecodeError> {
        Ok(self.take::<1>()?[0])
    }
    fn u16(&mut self) -> Result<u16, DecodeError> {
        Ok(u16::from_le_bytes(self.take()?))
    }
    fn i16(&mut self) -> Result<i16, DecodeError> {
        Ok(i16::from_le_bytes(self.take()?))
    }
    fn u32(&mut self) -> Result<u32, DecodeError> {
        Ok(u32::from_le_bytes(self.take()?))
    }
    fn u64(&mut self) -> Result<u64, DecodeError> {
        Ok(u64::from_le_bytes(self.take()?))
    }
    fn bool(&mut self) -> Result<bool, DecodeError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(DecodeError::OutOfRange),
        }
    }
    fn end(&self) -> Result<(), DecodeError> {
        if self.buf.is_empty() {
            Ok(())
        } else {
            Err(DecodeError::BadLength)
        }
    }
}

fn valid_scancode(code: u16) -> bool {
    // octet bas = code de balayage (1..=0x7F), octet haut = 0 ou préfixe étendu 0xE0
    let low = code & 0xFF;
    let high = code >> 8;
    (1..=0x7F).contains(&low) && (high == 0 || high == 0xE0)
}

pub fn decode(bytes: &[u8]) -> Result<Message, DecodeError> {
    let (&kind, payload) = bytes.split_first().ok_or(DecodeError::Empty)?;
    if kind != 0x40 && bytes.len() > MAX_INPUT_LEN {
        return Err(DecodeError::BadLength);
    }
    let mut r = Reader { buf: payload };
    let msg = match kind {
        0x10 => Message::MouseAbs { seq: r.u32()?, x: r.u16()?, y: r.u16()? },
        0x11 => Message::MouseRel { seq: r.u32()?, dx: r.i16()?, dy: r.i16()? },
        0x12 => {
            let button = MouseButton::from_u8(r.u8()?).ok_or(DecodeError::OutOfRange)?;
            Message::MouseButton { button, down: r.bool()? }
        }
        0x13 => Message::Wheel { dx: r.i16()?, dy: r.i16()? },
        0x20 => {
            let scancode = r.u16()?;
            if !valid_scancode(scancode) {
                return Err(DecodeError::OutOfRange);
            }
            Message::Key { scancode, down: r.bool()? }
        }
        0x21 => {
            let seq = r.u32()?;
            let n = r.u8()? as usize;
            if n > MAX_HELD_KEYS {
                return Err(DecodeError::OutOfRange);
            }
            let mut held = Vec::with_capacity(n);
            for _ in 0..n {
                let code = r.u16()?;
                if !valid_scancode(code) {
                    return Err(DecodeError::OutOfRange);
                }
                held.push(code);
            }
            Message::KeyState { seq, held }
        }
        0x30 => {
            let pad = r.u8()?;
            if pad >= MAX_PADS {
                return Err(DecodeError::OutOfRange);
            }
            let seq = r.u32()?;
            let state = PadState {
                buttons: r.u16()?,
                lt: r.u8()?,
                rt: r.u8()?,
                lx: r.i16()?,
                ly: r.i16()?,
                rx: r.i16()?,
                ry: r.i16()?,
            };
            Message::Gamepad { pad, seq, state }
        }
        0x40 => {
            let len = r.u16()? as usize;
            if len == 0 || len > MAX_CHAT_BYTES {
                return Err(DecodeError::OutOfRange);
            }
            if r.buf.len() != len {
                return Err(DecodeError::BadLength);
            }
            let text = std::str::from_utf8(r.buf).map_err(|_| DecodeError::BadText)?;
            if text.chars().any(|c| c.is_control() && c != '\n') {
                return Err(DecodeError::BadText);
            }
            r.buf = &[];
            Message::Chat { text: text.to_owned() }
        }
        0x50 => Message::Ping { id: r.u32()?, micros: r.u64()? },
        0x51 => Message::Pong { id: r.u32()?, micros: r.u64()? },
        other => return Err(DecodeError::UnknownType(other)),
    };
    r.end()?;
    Ok(msg)
}

pub fn encode(msg: &Message) -> Vec<u8> {
    let mut out = Vec::with_capacity(24);
    match msg {
        Message::MouseAbs { seq, x, y } => {
            out.push(0x10);
            out.extend(seq.to_le_bytes());
            out.extend(x.to_le_bytes());
            out.extend(y.to_le_bytes());
        }
        Message::MouseRel { seq, dx, dy } => {
            out.push(0x11);
            out.extend(seq.to_le_bytes());
            out.extend(dx.to_le_bytes());
            out.extend(dy.to_le_bytes());
        }
        Message::MouseButton { button, down } => out.extend([0x12, button.to_u8(), *down as u8]),
        Message::Wheel { dx, dy } => {
            out.push(0x13);
            out.extend(dx.to_le_bytes());
            out.extend(dy.to_le_bytes());
        }
        Message::Key { scancode, down } => {
            out.push(0x20);
            out.extend(scancode.to_le_bytes());
            out.push(*down as u8);
        }
        Message::KeyState { seq, held } => {
            out.push(0x21);
            out.extend(seq.to_le_bytes());
            let held = &held[..held.len().min(MAX_HELD_KEYS)];
            out.push(held.len() as u8);
            for code in held {
                out.extend(code.to_le_bytes());
            }
        }
        Message::Gamepad { pad, seq, state } => {
            out.push(0x30);
            out.push(*pad);
            out.extend(seq.to_le_bytes());
            out.extend(state.buttons.to_le_bytes());
            out.extend([state.lt, state.rt]);
            for axis in [state.lx, state.ly, state.rx, state.ry] {
                out.extend(axis.to_le_bytes());
            }
        }
        Message::Chat { text } => {
            // tronqué à une frontière de caractère pour rester décodable
            let mut end = text.len().min(MAX_CHAT_BYTES);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            out.push(0x40);
            out.extend((end as u16).to_le_bytes());
            out.extend(&text.as_bytes()[..end]);
        }
        Message::Ping { id, micros } | Message::Pong { id, micros } => {
            out.push(if matches!(msg, Message::Ping { .. }) { 0x50 } else { 0x51 });
            out.extend(id.to_le_bytes());
            out.extend(micros.to_le_bytes());
        }
    }
    out
}

/// Numéros de séquence avec bouclage : `a` est-il plus récent que `b` ?
pub fn newer(a: u32, b: u32) -> bool {
    a != b && a.wrapping_sub(b) < 0x8000_0000
}

#[cfg(test)]
mod tests {
    use super::*;

    fn samples() -> Vec<Message> {
        vec![
            Message::MouseAbs { seq: 7, x: 65535, y: 0 },
            Message::MouseRel { seq: u32::MAX, dx: -300, dy: 12 },
            Message::MouseButton { button: MouseButton::X2, down: true },
            Message::Wheel { dx: 0, dy: -120 },
            Message::Key { scancode: 0x1E, down: true },
            Message::Key { scancode: 0xE04B, down: false },
            Message::KeyState { seq: 3, held: vec![0x1E, 0x2A, 0xE01D] },
            Message::KeyState { seq: 4, held: vec![] },
            Message::Gamepad {
                pad: 3,
                seq: 99,
                state: PadState { buttons: 0xF00F, lt: 255, rt: 1, lx: i16::MIN, ly: i16::MAX, rx: 0, ry: -1 },
            },
            Message::Chat { text: "Salut ! On joue ? 🎮\nGo".into() },
            Message::Ping { id: 1, micros: 123_456_789 },
            Message::Pong { id: 1, micros: u64::MAX },
        ]
    }

    #[test]
    fn round_trip() {
        for msg in samples() {
            assert_eq!(decode(&encode(&msg)), Ok(msg));
        }
    }

    #[test]
    fn truncated_and_padded_messages_are_rejected() {
        for msg in samples() {
            let bytes = encode(&msg);
            for cut in 0..bytes.len() {
                assert!(decode(&bytes[..cut]).is_err(), "tronqué {msg:?} à {cut}");
            }
            let mut longer = bytes.clone();
            longer.push(0);
            assert!(decode(&longer).is_err(), "octet en trop {msg:?}");
        }
    }

    #[test]
    fn out_of_range_values_are_rejected() {
        assert_eq!(decode(&[0x12, 5, 1]), Err(DecodeError::OutOfRange));
        assert_eq!(decode(&[0x12, 0, 2]), Err(DecodeError::OutOfRange));
        assert_eq!(decode(&[0x20, 0x00, 0x00, 1]), Err(DecodeError::OutOfRange));
        assert_eq!(decode(&[0x20, 0x1E, 0x12, 1]), Err(DecodeError::OutOfRange));
        let mut pad = encode(&samples()[8]);
        pad[1] = MAX_PADS;
        assert_eq!(decode(&pad), Err(DecodeError::OutOfRange));
        let mut keys = vec![0x21, 0, 0, 0, 0, 17];
        keys.extend(std::iter::repeat([0x1E, 0]).take(17).flatten());
        assert_eq!(decode(&keys), Err(DecodeError::OutOfRange));
        assert_eq!(decode(&[0x99]), Err(DecodeError::UnknownType(0x99)));
        assert_eq!(decode(&[]), Err(DecodeError::Empty));
    }

    #[test]
    fn chat_is_bounded_and_clean() {
        let mut bad = vec![0x40, 2, 0, 0xC3, 0x28];
        assert_eq!(decode(&bad), Err(DecodeError::BadText));
        bad = vec![0x40, 1, 0, 0x07];
        assert_eq!(decode(&bad), Err(DecodeError::BadText));
        assert_eq!(decode(&[0x40, 0, 0]), Err(DecodeError::OutOfRange));
        let long = "é".repeat(400); // 800 octets
        let bytes = encode(&Message::Chat { text: long });
        assert!(bytes.len() <= 3 + MAX_CHAT_BYTES);
        assert!(matches!(decode(&bytes), Ok(Message::Chat { .. })));
        let mut huge = vec![0x40];
        huge.extend(((MAX_CHAT_BYTES + 1) as u16).to_le_bytes());
        huge.extend(vec![b'a'; MAX_CHAT_BYTES + 1]);
        assert_eq!(decode(&huge), Err(DecodeError::OutOfRange));
    }

    #[test]
    fn oversized_input_is_rejected_before_parsing() {
        let mut big = vec![0x10];
        big.extend([0u8; MAX_INPUT_LEN]);
        assert_eq!(decode(&big), Err(DecodeError::BadLength));
    }

    #[test]
    fn random_bytes_never_panic() {
        // générateur congruentiel : déterministe, sans dépendance
        let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
        for _ in 0..20_000 {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let len = (s >> 58) as usize;
            let bytes: Vec<u8> = (0..len).map(|i| (s >> (i % 8 * 8)) as u8 ^ i as u8).collect();
            let _ = decode(&bytes);
        }
    }

    #[test]
    fn sequence_wraps() {
        assert!(newer(1, 0));
        assert!(newer(0, u32::MAX));
        assert!(!newer(5, 5));
        assert!(!newer(0, 1));
    }
}
