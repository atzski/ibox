//! Priorité aux entrées physiques de l'hôte.
//!
//! Choix (voir `docs/REMOTE-PLAY.md` §9) : un crochet bas niveau `WH_MOUSE_LL` + `WH_KEYBOARD_LL`
//! installé sur le fil de garde marque toute entrée **sans** l'indicateur `LLMHF_INJECTED` /
//! `LLKHF_INJECTED` comme activité locale. Tant que la dernière activité locale date de moins de
//! [`LOCAL_PRIORITY`], les mouvements, la molette et les appuis de boutons de la souris distante
//! sont ignorés (les relâchements passent toujours, pour ne rien laisser enfoncé). Le clavier et
//! les manettes distants ne sont pas concernés.
//!
//! Repli si les crochets ne peuvent pas être posés : heuristique `GetLastInputInfo`. Windows y
//! compte aussi nos propres injections ; une entrée postérieure de plus de [`FOREIGN_TOLERANCE_MS`]
//! à notre dernier `SendInput` est donc attribuée à l'hôte. Moins fiable (résolution ~16 ms,
//! toute autre injection compte aussi), d'où le crochet en premier choix.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub const LOCAL_PRIORITY: Duration = Duration::from_millis(500);
pub const FOREIGN_TOLERANCE_MS: u32 = 30;

/// Horodatage partagé entre le fil de garde (crochets) et l'injecteur.
#[derive(Debug)]
pub struct LocalActivity {
    base: Instant,
    /// millisecondes depuis `base` + 1 ; 0 = jamais
    last: AtomicU64,
    hooked: AtomicBool,
}

impl Default for LocalActivity {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalActivity {
    pub fn new() -> Self {
        LocalActivity { base: Instant::now(), last: AtomicU64::new(0), hooked: AtomicBool::new(false) }
    }

    pub fn note(&self, now: Instant) {
        let ms = now.saturating_duration_since(self.base).as_millis() as u64 + 1;
        self.last.fetch_max(ms, Ordering::Relaxed);
    }

    /// L'hôte a-t-il touché sa souris ou son clavier il y a moins de [`LOCAL_PRIORITY`] ?
    pub fn recent(&self, now: Instant) -> bool {
        match self.last.load(Ordering::Relaxed) {
            0 => false,
            last => {
                let now_ms = now.saturating_duration_since(self.base).as_millis() as u64 + 1;
                now_ms.saturating_sub(last) < LOCAL_PRIORITY.as_millis() as u64
            }
        }
    }

    pub fn set_hooked(&self, hooked: bool) {
        self.hooked.store(hooked, Ordering::Relaxed);
    }

    /// Vrai si les crochets bas niveau sont actifs (sinon l'heuristique de repli s'applique).
    pub fn hooked(&self) -> bool {
        self.hooked.load(Ordering::Relaxed)
    }
}

/// Heuristique de repli : la dernière entrée vue par Windows (`GetLastInputInfo`, en ticks)
/// est-elle nettement postérieure à notre dernière injection ? Compatible avec le bouclage des ticks.
pub fn foreign_input(last_input_tick: u32, last_injected_tick: u32) -> bool {
    let delta = last_input_tick.wrapping_sub(last_injected_tick) as i32;
    delta > FOREIGN_TOLERANCE_MS as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_activity_lasts_500_ms() {
        let a = LocalActivity::new();
        let t0 = Instant::now();
        assert!(!a.recent(t0), "aucune activité au départ");
        a.note(t0);
        assert!(a.recent(t0));
        assert!(a.recent(t0 + Duration::from_millis(499)));
        assert!(!a.recent(t0 + Duration::from_millis(500)));
        // une note plus ancienne ne recule pas l'horodatage
        a.note(t0 + Duration::from_millis(400));
        a.note(t0);
        assert!(a.recent(t0 + Duration::from_millis(899)));
        assert!(!a.recent(t0 + Duration::from_millis(900)));
    }

    #[test]
    fn heuristic_ignores_our_own_injections_and_wraps() {
        assert!(!foreign_input(1000, 1000));
        assert!(!foreign_input(1000 + FOREIGN_TOLERANCE_MS, 1000), "notre injection traitée un peu plus tard");
        assert!(foreign_input(1100, 1000));
        assert!(!foreign_input(900, 1000), "entrée antérieure à l'injection");
        assert!(foreign_input(50, u32::MAX - 50), "bouclage des ticks après 49,7 jours");
    }
}
