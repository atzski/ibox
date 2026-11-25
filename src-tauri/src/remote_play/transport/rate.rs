//! Adaptation du débit de l'encodeur à l'estimation de bande passante de str0m (TWCC/GCC).
//!
//! Règles (choisies pour un flux interactif, où une image en retard coûte plus qu'une image floue) :
//! - cible = estimation × 0,85 : marge pour les en-têtes RTP/SRTP, les DataChannels et l'audio ;
//! - pertes > 10 % : cible ramenée à 80 % du débit courant, même si l'estimation est plus haute ;
//! - baisse **immédiate** dès que la cible passe sous 95 % du débit courant ;
//! - hausse au plus toutes les secondes, de 25 % au plus, et seulement au-delà de 105 % ;
//! - toujours borné à [min, max] (réglages de l'hôte) ;
//! - **garde de délai** : l'estimateur doit dépasser la capacité du lien pour la trouver, et
//!   pendant ce temps une file se forme chez le routeur (mesuré : latence qui monte de 30 à
//!   300 ms en quelques secondes sur un lien à 8 Mbit/s). Dès que l'aller-retour mesuré dépasse
//!   de [`DELAY_EXCESS`] son plancher récent, le débit baisse de 15 % et ne remonte pas pendant
//!   [`DELAY_HOLD`] : on rend du débit plutôt que d'accumuler du retard.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Aller-retour au-dessus de son plancher qui déclenche une baisse : une file d'attente s'est
/// formée sur le trajet. Plus bas en « Priorité à la réactivité ».
pub const DELAY_EXCESS: Duration = Duration::from_millis(40);
pub const DELAY_EXCESS_RESPONSIVE: Duration = Duration::from_millis(25);
pub const DELAY_BACKOFF: f64 = 0.85;
/// Après une baisse pour délai, aucune hausse pendant ce temps.
pub const DELAY_HOLD: Duration = Duration::from_secs(3);
/// Mesures consécutives au-dessus du seuil avant de baisser (une mesure isolée ne prouve rien).
pub const DELAY_CONFIRM: u32 = 2;
/// Écart minimal entre deux baisses pour délai : le temps que la précédente fasse effet.
pub const DELAY_CUT_INTERVAL: Duration = Duration::from_millis(500);
/// Fenêtre du plancher d'aller-retour (le trajet peut changer en cours de session).
pub const DELAY_BASE_WINDOW: Duration = Duration::from_secs(30);
/// Baisses consécutives sans effet après lesquelles le délai est tenu pour le nouveau trajet
/// (changement de route, trafic d'un autre appareil) : le plancher repart de la mesure courante.
pub const DELAY_STRIKES: u32 = 4;

pub const HEADROOM: f64 = 0.85;
/// « Priorité à la réactivité » : l'encodeur vise 70 % de l'estimation au lieu de 85 %. Sur une
/// connexion qui limite le débit, chaque image est plus petite et traverse donc plus vite le
/// goulot (≈ 2,5 ms de moins à 60 i/s), avec plus de marge avant qu'une file ne se forme ; en
/// échange l'image est moins fine. Sans effet quand la connexion dépasse largement le plafond.
pub const HEADROOM_RESPONSIVE: f64 = 0.70;
/// Remontée plus prudente dans ce mode (+15 % par seconde au lieu de +25 %).
pub const MAX_STEP_UP_RESPONSIVE: f64 = 1.15;
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
    headroom: f64,
    step_up: f64,
    delay_excess: Duration,
    rtts: VecDeque<(Instant, Duration)>,
    no_increase_until: Option<Instant>,
    strikes: u32,
    over: u32,
    last_delay_cut: Option<Instant>,
}

impl RateController {
    pub fn new(initial_kbps: u32, min_kbps: u32, max_kbps: u32) -> Self {
        let max_kbps = max_kbps.max(min_kbps);
        RateController { min_kbps, max_kbps, current_kbps: initial_kbps.clamp(min_kbps, max_kbps), last_change: None, headroom: HEADROOM, step_up: MAX_STEP_UP, delay_excess: DELAY_EXCESS, rtts: VecDeque::new(), no_increase_until: None, strikes: 0, over: 0, last_delay_cut: None }
    }

    /// Réglage « Priorité à la réactivité » de l'hôte.
    pub fn responsive(mut self, on: bool) -> Self {
        (self.headroom, self.step_up, self.delay_excess) = if on { (HEADROOM_RESPONSIVE, MAX_STEP_UP_RESPONSIVE, DELAY_EXCESS_RESPONSIVE) } else { (HEADROOM, MAX_STEP_UP, DELAY_EXCESS) };
        self
    }

    /// Aller-retour mesuré sur le trajet de l'image (accusés de réception des paquets vidéo,
    /// plusieurs fois par seconde). Renvoie le nouveau débit de l'encodeur s'il faut le baisser.
    pub fn on_rtt(&mut self, rtt: Duration, now: Instant) -> Option<u32> {
        while self.rtts.front().is_some_and(|(t, _)| now.saturating_duration_since(*t) > DELAY_BASE_WINDOW) {
            self.rtts.pop_front();
        }
        self.rtts.push_back((now, rtt));
        let base = self.rtts.iter().map(|(_, r)| *r).min().unwrap_or(rtt);
        if rtt <= base + self.delay_excess {
            self.strikes = 0;
            self.over = 0;
            return None;
        }
        self.over += 1;
        if self.over < DELAY_CONFIRM || self.last_delay_cut.is_some_and(|t| now.saturating_duration_since(t) < DELAY_CUT_INTERVAL) {
            return None;
        }
        self.strikes += 1;
        if self.strikes > DELAY_STRIKES {
            // nos baisses n'y changent rien : ce délai est celui du trajet, pas de notre file
            self.rtts.clear();
            self.rtts.push_back((now, rtt));
            self.strikes = 0;
            self.over = 0;
            return None;
        }
        self.last_delay_cut = Some(now);
        self.no_increase_until = Some(now + DELAY_HOLD);
        let next = ((self.current_kbps as f64 * DELAY_BACKOFF).round() as u32).clamp(self.min_kbps, self.max_kbps);
        if next == self.current_kbps {
            return None;
        }
        self.current_kbps = next;
        self.last_change = Some(now);
        Some(next)
    }

    pub fn current_kbps(&self) -> u32 {
        self.current_kbps
    }

    /// Nouvelle estimation (bit/s) et fraction de pertes vue par l'invité. Renvoie le nouveau
    /// débit de l'encodeur (kbit/s) s'il faut le changer.
    pub fn on_estimate(&mut self, estimate_bps: u64, loss: Option<f32>, now: Instant) -> Option<u32> {
        let mut target = estimate_bps as f64 / 1000.0 * self.headroom;
        if loss.is_some_and(|l| l > LOSS_BACKOFF_THRESHOLD) {
            target = target.min(self.current_kbps as f64 * LOSS_BACKOFF);
        }
        let target = (target.round() as u32).clamp(self.min_kbps, self.max_kbps);
        let current = self.current_kbps as f64;
        let next = if (target as f64) < current * 0.95 {
            target
        } else if (target as f64) > current * 1.05 {
            if self.last_change.is_some_and(|t| now.duration_since(t) < INCREASE_INTERVAL) || self.no_increase_until.is_some_and(|t| now < t) {
                return None;
            }
            target.min((current * self.step_up).round() as u32).min(self.max_kbps)
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
    fn garde_de_delai_baisse_puis_attend_avant_de_remonter() {
        let (mut c, t) = ctl();
        let ms = Duration::from_millis;
        // plancher 20 ms ; jusqu'à +40 ms rien ne bouge
        assert_eq!(c.on_rtt(ms(20), t), None);
        assert_eq!(c.on_rtt(ms(55), t + ms(250)), None);
        // une mesure isolée au-dessus du seuil ne suffit pas
        assert_eq!(c.on_rtt(ms(90), t + ms(500)), None);
        assert_eq!(c.on_rtt(ms(30), t + ms(750)), None);
        // deux de suite : une file s'est formée, -15 % tout de suite
        assert_eq!(c.on_rtt(ms(75), t + ms(1000)), None);
        assert_eq!(c.on_rtt(ms(80), t + ms(1250)), Some(8_500));
        // pas deux baisses en moins de 500 ms, puis la suivante si la file est toujours là
        assert_eq!(c.on_rtt(ms(110), t + ms(1500)), None);
        assert_eq!(c.on_rtt(ms(120), t + ms(1750)), Some(7_225));
        // l'estimation a beau être haute, pas de hausse pendant 3 s après la dernière baisse
        assert_eq!(c.on_estimate(100_000_000, None, t + ms(3000)), None);
        assert_eq!(c.on_rtt(ms(22), t + ms(3000)), None);
        assert_eq!(c.on_estimate(100_000_000, None, t + ms(4800)), Some(9_031));
        // une baisse de l'estimation, elle, passe toujours
        assert_eq!(c.on_estimate(2_000_000, None, t + ms(4900)), Some(1_700));
    }

    #[test]
    fn delai_durable_tenu_pour_le_nouveau_trajet() {
        let (mut c, t) = ctl();
        let s = Duration::from_secs;
        c.on_rtt(Duration::from_millis(20), t);
        // la route change : +80 ms quoi qu'on fasse. Quatre baisses, puis on l'accepte.
        let cuts: Vec<u32> = (1..=12).filter_map(|i| c.on_rtt(Duration::from_millis(100), t + s(i))).collect();
        assert_eq!(cuts, vec![8_500, 7_225, 6_141, 5_220]);
        // le plancher s'oublie après 30 s : un ancien minimum ne fait plus baisser
        let (mut c, t) = ctl();
        c.on_rtt(Duration::from_millis(10), t);
        assert_eq!(c.on_rtt(Duration::from_millis(60), t + s(31)), None);
        // jamais sous le plancher de débit
        let mut c = RateController::new(520, 500, 2_000);
        c.on_rtt(Duration::from_millis(10), t);
        c.on_rtt(Duration::from_millis(200), t + s(1));
        assert_eq!(c.on_rtt(Duration::from_millis(200), t + s(2)), Some(500));
        assert_eq!(c.on_rtt(Duration::from_millis(200), t + s(3)), None);
    }

    #[test]
    fn priorite_a_la_reactivite_garde_plus_de_marge() {
        let t = Instant::now();
        let mut c = RateController::new(10_000, 500, 50_000).responsive(true);
        // 10 Mbit/s estimés → 7 000 kbit/s au lieu de 8 500
        assert_eq!(c.on_estimate(10_000_000, None, t), Some(7_000));
        // remontée de 15 % au plus
        assert_eq!(c.on_estimate(100_000_000, None, t + Duration::from_secs(2)), Some(8_050));
        // le plafond de l'hôte reste atteignable
        let mut c = RateController::new(1_900, 500, 2_000).responsive(true);
        assert_eq!(c.on_estimate(1_000_000_000, None, t), Some(2_000));
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
