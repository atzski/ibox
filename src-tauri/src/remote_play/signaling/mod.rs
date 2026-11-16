//! Signalisation Remote Play (phase 4) : identité d'appareil, enveloppes signées, épinglage des
//! clés et code de sécurité. Voir `docs/REMOTE-PLAY.md` §4–§6.
//!
//! iNetbox ne fait que relayer des enveloppes **opaques** entre deux participants : il vérifie la
//! signature Ed25519 (défense en profondeur), mais l'iBox ne lui fait jamais confiance. Chaque
//! enveloppe est signée par la clé d'appareil, liée à la session, au destinataire, au jeton
//! d'invitation et à l'empreinte DTLS ; la clé du pair est épinglée au premier contact.

pub mod envelope;
pub mod identity;
pub mod pinning;
pub mod safety;

use thiserror::Error;

/// Taille maximale d'une enveloppe signée (identique à la limite d'iNetbox).
pub const MAX_ENVELOPE_BYTES: usize = 16 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SignalError {
    #[error("Coffre Windows indisponible : {0}")]
    Vault(String),
    #[error("Clé d'appareil illisible.")]
    BadKey,
    #[error("Signature invalide : message altéré ou appareil inconnu.")]
    BadSignature,
    #[error("Message de signalisation trop gros.")]
    TooLarge,
    #[error("Message de signalisation mal formé.")]
    Malformed,
    #[error("Message étranger à ce protocole.")]
    BadContext,
    #[error("Message destiné à une autre session.")]
    WrongSession,
    #[error("Message qui ne vient pas du participant attendu ou ne vous est pas destiné.")]
    WrongParticipant,
    #[error("Message trop ancien ou daté du futur.")]
    Stale,
    #[error("Message rejoué.")]
    Replay,
    #[error("Jeton d'invitation invalide, expiré ou déjà utilisé.")]
    BadToken,
    #[error("Empreinte DTLS absente ou différente de celle signée.")]
    FingerprintMismatch,
    #[error("La clé de cet appareil a changé : session bloquée. Comparez le code de sécurité.")]
    KeyChanged,
    #[error("Réglages Remote Play illisibles : {0}")]
    Store(String),
}

pub type Result<T> = std::result::Result<T, SignalError>;
