//! Adaptation du débit de l'encodeur à l'estimation de bande passante de str0m (TWCC/GCC).
//!
//! Règles (choisies pour un flux interactif, où une image en retard coûte plus qu'une image floue) :
//! - cible = estimation × 0,85 : marge pour les en-têtes RTP/SRTP, les DataChannels et l'audio ;
//! - pertes > 10 % : cible ramenée à 80 % du débit courant, même si l'estimation est plus haute ;
//! - baisse **immédiate** dès que la cible passe sous 95 % du débit courant ;
//! - hausse au plus toutes les secondes, de 25 % au plus, et seulement au-delà de 105 % ;
//! - toujours borné à [min, max] (réglages de l'hôte).

use std::time::{Duration, Instant};

pub const HEADROOM: f64 = 0.85;
pub const LOSS_BACKOFF_THRESHOLD: f32 = 0.10;
pub const LOSS_BACKOFF: f64 = 0.80;
pub const INCREASE_INTERVAL: Duration = Duration::from_secs(1);
pub const MAX_STEP_UP: f64 = 1.25;

#[derive(Debug, Clone)]
pub struct RateController {
    min_kbps: u32,
    max_kbps: u32,
    current_kbps: u32,
    last_change: Option<Instant>,
}

impl RateController {
    pub fn new(initial_kbps: u32, min_kbps: u32, max_kbps: u32) -> Self {
        let max_kbps = max_kbps.max(min_kbps);
        RateController { min_kbps, max_kbps, current_kbps: initial_kbps.clamp(min_kbps, max_kbps), last_change: None }
    }

    pub fn current_kbps(&self) -> u32 {
        self.current_kbps
    }

    /// Nouvelle estimation (bit/s) et fraction de pertes vue par l'invité. Renvoie le nouveau
    /// débit de l'encodeur (kbit/s) s'il faut le changer.
    pub fn on_estimate(&mut self, estimate_bps: u64, loss: Option<f32>, now: Instant) -> Option<u32> {
        let mut target = estimate_bps as f64 / 1000.0 * HEADROOM;
        if loss.is_some_and(|l| l > LOSS_BACKOFF_THRESHOLD) {
            target = target.min(self.current_kbps as f64 * LOSS_BACKOFF);
        }
        let target = (target.round() as u32).clamp(self.min_kbps, self.max_kbps);
        let current = self.current_kbps as f64;
        let next = if (target as f64) < current * 0.95 {
            target
        } else if (target as f64) > current * 1.05 {
            if self.last_change.is_some_and(|t| now.duration_since(t) < INCREASE_INTERVAL) {
                return None;
            }
            target.min((current * MAX_STEP_UP).round() as u32).min(self.max_kbps)
        } else {
            return None;
        };
        if next == self.current_kbps {
            return None;
        }
        self.current_kbps = next;
        self.last_change = Some(now);
        Some(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctl() -> (RateController, Instant) {
        (RateController::new(10_000, 500, 50_000), Instant::now())
    }

    #[test]
    fn baisse_immediate_avec_marge() {
        let (mut c, t) = ctl();
        // 5 Mbit/s estimés → 4 250 kbit/s pour l'encodeur, sans attendre
        assert_eq!(c.on_estimate(5_000_000, None, t), Some(4_250));
        assert_eq!(c.on_estimate(2_000_000, None, t), Some(1_700));
    }

    #[test]
    fn hausse_limitee_en_pas_et_en_frequence() {
        let (mut c, t) = ctl();
        assert_eq!(c.on_estimate(100_000_000, None, t), Some(12_500), "+25 % au plus");
        assert_eq!(c.on_estimate(100_000_000, None, t + Duration::from_millis(500)), None, "une hausse par seconde");
        assert_eq!(c.on_estimate(100_000_000, None, t + Duration::from_millis(1000)), Some(15_625));
    }

    #[test]
    fn hysteresis_autour_du_debit_courant() {
        let (mut c, t) = ctl();
        // 10 000 / 0,85 ≈ 11 765 kbit/s estimés = cible égale au débit courant
        assert_eq!(c.on_estimate(11_765_000, None, t), None);
        assert_eq!(c.on_estimate(12_200_000, None, t), None, "< +5 %");
        assert_eq!(c.on_estimate(11_300_000, None, t), None, "> -5 %");
    }

    #[test]
    fn bornes_min_et_max() {
        let mut c = RateController::new(1_000, 500, 2_000);
        let t = Instant::now();
        assert_eq!(c.on_estimate(10_000, None, t), Some(500));
        let mut c = RateController::new(1_900, 500, 2_000);
        assert_eq!(c.on_estimate(1_000_000_000, None, t), Some(2_000));
        assert_eq!(c.on_estimate(1_000_000_000, None, t + Duration::from_secs(5)), None);
        assert_eq!(RateController::new(99_999, 500, 2_000).current_kbps(), 2_000);
    }

    #[test]
    fn pertes_fortes_font_baisser_meme_si_l_estimation_monte() {
        let (mut c, t) = ctl();
        assert_eq!(c.on_estimate(100_000_000, Some(0.2), t), Some(8_000));
        // pertes faibles : seule l'estimation compte
        let (mut c, t) = ctl();
        assert_eq!(c.on_estimate(100_000_000, Some(0.05), t), Some(12_500));
    }
}
