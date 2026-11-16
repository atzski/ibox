//! Manettes virtuelles Xbox 360 de l'hôte, via ViGEmBus **s'il est déjà installé**.
//!
//! iBox n'installe jamais de pilote. Sans ViGEmBus, toute manette distante renvoie
//! [`PadError::BusMissing`] avec un message clair. Choix du client (crate `vigem-client`, MIT,
//! Rust pur, aucune DLL) : `docs/REMOTE-PLAY.md` §9.

use std::fmt;
use std::sync::Arc;

use crate::remote_play::protocol::PadState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PadError {
    /// Le pilote ViGEmBus n'est pas installé.
    BusMissing,
    /// ViGEmBus est présent mais refuse ce client (version incompatible).
    BusVersion,
    /// Plus d'emplacement libre sur le bus.
    NoFreeSlot,
    Failed(String),
}

impl fmt::Display for PadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PadError::BusMissing => f.write_str(
                "Le pilote de manettes virtuelles ViGEmBus n'est pas installé sur cet ordinateur : les manettes \
                 des invités sont indisponibles. iBox n'installe jamais de pilote lui-même.",
            ),
            PadError::BusVersion => f.write_str("La version installée de ViGEmBus n'est pas compatible."),
            PadError::NoFreeSlot => f.write_str("ViGEmBus n'a plus d'emplacement libre pour une manette."),
            PadError::Failed(e) => write!(f, "Manette virtuelle indisponible : {e}"),
        }
    }
}

/// Reçoit l'état complet d'une manette distante (disposition XInput).
pub trait Pads: Send {
    fn update(&mut self, pad: u8, state: &PadState) -> Result<(), PadError>;
}

/// Vibration demandée par un jeu : (manette, gros moteur, petit moteur).
pub type RumbleFn = Arc<dyn Fn(u8, u8, u8) + Send + Sync>;

/// Aucune manette virtuelle possible (ViGEmBus absent) : erreur explicite à chaque état reçu.
#[derive(Debug, Default)]
pub struct NoPads;

impl Pads for NoPads {
    fn update(&mut self, _pad: u8, _state: &PadState) -> Result<(), PadError> {
        Err(PadError::BusMissing)
    }
}

#[cfg(windows)]
pub use vigem::{vigem_status, VigemPads};

#[cfg(windows)]
mod vigem {
    use std::thread::JoinHandle;

    use vigem_client::{Client, Error, TargetId, XButtons, XGamepad, XTarget};

    use super::{PadError, Pads, RumbleFn};
    use crate::remote_play::protocol::{PadState, MAX_PADS};

    fn map(e: Error) -> PadError {
        match e {
            Error::BusNotFound => PadError::BusMissing,
            Error::BusVersionMismatch => PadError::BusVersion,
            Error::NoFreeSlot => PadError::NoFreeSlot,
            other => PadError::Failed(other.to_string()),
        }
    }

    /// Vérifie que ViGEmBus répond (sans rien brancher).
    pub fn vigem_status() -> Result<(), PadError> {
        Client::connect().map(drop).map_err(map)
    }

    struct Target {
        x: Option<XTarget>,
        notify: Option<JoinHandle<()>>,
    }

    impl Drop for Target {
        fn drop(&mut self) {
            // débrancher la manette annule la demande de notification : le fil se termine
            self.x.take();
            if let Some(h) = self.notify.take() {
                let _ = h.join();
            }
        }
    }

    /// Une manette Xbox 360 virtuelle par emplacement de session, branchée au premier état reçu
    /// et débranchée quand `VigemPads` est détruit (fin de session).
    pub struct VigemPads {
        client: Client,
        targets: Vec<Option<Target>>,
        on_rumble: RumbleFn,
    }

    impl VigemPads {
        /// Échoue avec [`PadError::BusMissing`] si ViGEmBus n'est pas installé.
        pub fn connect(on_rumble: RumbleFn) -> Result<Self, PadError> {
            let client = Client::connect().map_err(map)?;
            Ok(VigemPads { client, targets: (0..MAX_PADS).map(|_| None).collect(), on_rumble })
        }

        fn plug(&self, pad: u8) -> Result<Target, PadError> {
            let mut x = XTarget::new(self.client.try_clone().map_err(map)?, TargetId::XBOX360_WIRED);
            x.plugin().map_err(map)?;
            x.wait_ready().map_err(map)?;
            let rumble = self.on_rumble.clone();
            // la vibration est un retour facultatif : son absence ne bloque pas la manette
            let notify = x
                .request_notification()
                .ok()
                .map(|req| req.spawn_thread(move |_, n| rumble(pad, n.large_motor, n.small_motor)));
            Ok(Target { x: Some(x), notify })
        }
    }

    impl Pads for VigemPads {
        fn update(&mut self, pad: u8, state: &PadState) -> Result<(), PadError> {
            let slot = self.targets.get(pad as usize).ok_or(PadError::Failed("manette hors limites".into()))?;
            if slot.is_none() {
                let target = self.plug(pad)?;
                self.targets[pad as usize] = Some(target);
            }
            let x = self.targets[pad as usize].as_mut().and_then(|t| t.x.as_mut()).expect("manette branchée");
            let report = XGamepad {
                buttons: XButtons { raw: state.buttons },
                left_trigger: state.lt,
                right_trigger: state.rt,
                thumb_lx: state.lx,
                thumb_ly: state.ly,
                thumb_rx: state.rx,
                thumb_ry: state.ry,
            };
            x.update(&report).map_err(map)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_bus_is_a_clear_error() {
        let err = NoPads.update(0, &PadState::default()).unwrap_err();
        assert_eq!(err, PadError::BusMissing);
        let text = err.to_string();
        assert!(text.contains("ViGEmBus") && text.contains("n'installe jamais"));
    }

    /// Branche une vraie manette virtuelle si ViGEmBus est installé ; à lancer à la main :
    /// `cargo test --lib vigem_real -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore = "pilote ViGEmBus réel : manuel"]
    fn vigem_real() {
        match VigemPads::connect(Arc::new(|_, _, _| {})) {
            Err(e) => assert_eq!(e, PadError::BusMissing, "seule absence attendue : {e}"),
            Ok(mut pads) => {
                pads.update(0, &PadState { buttons: 0x1000, ..Default::default() }).unwrap();
                pads.update(0, &PadState::default()).unwrap();
            }
        }
    }
}
