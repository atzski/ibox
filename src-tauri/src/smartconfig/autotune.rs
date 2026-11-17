//! Fondations d'iBox AutoTune (phase 6) : **types seulement**.
//!
//! AutoTune mesurera, pendant une partie, ce qui se passe réellement (vitesse
//! d'émulation, images par seconde, temps d'image, charge et température du
//! processeur et de la carte graphique, consommation), pour proposer *après
//! la session* d'ajuster un réglage. Feuille de route : docs/SMARTCONFIG.md §18.
//!
//! Règles inscrites dans les types :
//! - chaque mesure dit **d'où elle vient** (`MetricSource`) et **à quel point
//!   elle est fiable** (`Reliability`) ; une mesure non fiable n'entre jamais
//!   dans un résumé ;
//! - **aucune cadence n'est supposée** : la fréquence d'images visée vient de
//!   l'émulateur ou du jeu (50 Hz PAL, 59,94 Hz NTSC, 30 images/s voulues par
//!   le jeu…), jamais d'une valeur par défaut comme 60 ; sans elle, aucun
//!   jugement « fluide / saccadé » n'est porté ;
//! - **aucune collecte réelle** n'existe encore : aucun `Collector` n'est
//!   branché tant qu'une source fiable (interface de l'émulateur, compteurs du
//!   système) n'a pas été vérifiée ;
//! - **aucune modification de réglage** ici, et jamais en cours de partie :
//!   AutoTune ne fera que proposer, après la session, un profil passant par
//!   l'aperçu, la sauvegarde et la restauration habituels de SmartConfig.

use serde::Serialize;

/// Grandeur mesurée, avec son unité.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Metric {
    /// Vitesse d'émulation en % de la console d'origine (100 = vitesse réelle).
    EmulationSpeedPercent,
    /// Images affichées par seconde.
    Fps,
    /// Temps d'une image, en millisecondes.
    FrameTimeMs,
    /// Charge du processeur (processus de l'émulateur), en %.
    CpuUsagePercent,
    /// Charge de la carte graphique, en %.
    GpuUsagePercent,
    CpuTempCelsius,
    GpuTempCelsius,
    /// Consommation de l'appareil ou du composant, en watts.
    PowerWatts,
}

/// Origine d'une mesure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MetricSource {
    /// Rapportée par l'émulateur lui-même (`adapter` : identifiant d'adaptateur).
    Emulator { adapter: String },
    /// Compteurs du système d'exploitation.
    OperatingSystem,
    /// Interface du pilote graphique.
    GpuDriver,
    /// Capteur matériel (température, consommation).
    Sensor,
}

/// Fiabilité d'une mesure. Seules `Measured` entrent dans un résumé.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reliability {
    /// Mesure directe d'une source vérifiée.
    Measured,
    /// Valeur dérivée ou échantillonnée grossièrement : affichable, jamais décisive.
    Approximate,
    /// Source connue pour être inexacte dans ce contexte (pilote, fenêtre masquée…).
    Unreliable,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub metric: Metric,
    pub value: f64,
    /// Millisecondes depuis le début de la session.
    pub at_ms: u64,
    pub source: MetricSource,
    pub reliability: Reliability,
}

/// Cadence visée par le jeu, telle que fournie par l'émulateur ou le jeu.
/// Jamais construite par défaut : il n'existe pas de « 60 FPS » implicite.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetRate {
    pub fps: f64,
    pub source: MetricSource,
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum CollectError {
    #[error("Mesure indisponible : {0}")]
    Unavailable(String),
}

/// Source de mesures pendant une session. Lecture seule : un collecteur ne
/// modifie rien, ni réglage, ni processus.
pub trait Collector: Send {
    fn id(&self) -> &'static str;
    /// Grandeurs que ce collecteur sait réellement fournir.
    fn metrics(&self) -> &'static [Metric];
    /// Cadence visée, si la source la connaît.
    fn target_rate(&self) -> Option<TargetRate>;
    /// Mesures prises depuis le dernier appel.
    fn poll(&mut self) -> Result<Vec<Sample>, CollectError>;
}

/// Résumé d'une grandeur sur une session (mesures fiables uniquement).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricSummary {
    pub metric: Metric,
    pub samples: usize,
    pub median: f64,
    pub min: f64,
    pub max: f64,
}

/// Résume une grandeur ; `None` s'il n'y a aucune mesure fiable (rien n'est
/// extrapolé). Les valeurs non finies sont écartées.
pub fn summarize(samples: &[Sample], metric: Metric) -> Option<MetricSummary> {
    let mut v: Vec<f64> = samples.iter().filter(|s| s.metric == metric && s.reliability == Reliability::Measured && s.value.is_finite()).map(|s| s.value).collect();
    if v.is_empty() {
        return None;
    }
    v.sort_by(f64::total_cmp);
    let n = v.len();
    let median = if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 };
    Some(MetricSummary { metric, samples: n, median, min: v[0], max: v[n - 1] })
}

/// Part des images tenues par rapport à la cadence visée (1.0 = toutes).
/// `None` sans cadence fournie par une source : jamais de valeur supposée.
pub fn frame_rate_ratio(fps: &MetricSummary, target: Option<&TargetRate>) -> Option<f64> {
    let t = target?;
    (fps.metric == Metric::Fps && t.fps.is_finite() && t.fps > 0.0).then(|| fps.median / t.fps)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(metric: Metric, value: f64, reliability: Reliability) -> Sample {
        Sample { metric, value, at_ms: 0, source: MetricSource::Emulator { adapter: "dolphin".into() }, reliability }
    }

    #[test]
    fn resume_sur_mesures_fiables_seulement() {
        let samples = vec![
            s(Metric::Fps, 50.0, Reliability::Measured),
            s(Metric::Fps, 48.0, Reliability::Measured),
            s(Metric::Fps, 10.0, Reliability::Unreliable),
            s(Metric::Fps, 99.0, Reliability::Approximate),
            s(Metric::Fps, f64::NAN, Reliability::Measured),
            s(Metric::CpuUsagePercent, 70.0, Reliability::Measured),
        ];
        let fps = summarize(&samples, Metric::Fps).unwrap();
        assert_eq!((fps.samples, fps.median, fps.min, fps.max), (2, 49.0, 48.0, 50.0));
        assert!(summarize(&samples, Metric::GpuTempCelsius).is_none());
        assert!(summarize(&[s(Metric::Fps, 30.0, Reliability::Unreliable)], Metric::Fps).is_none());
    }

    #[test]
    fn jamais_de_cadence_supposee() {
        let fps = summarize(&[s(Metric::Fps, 50.0, Reliability::Measured)], Metric::Fps).unwrap();
        // sans cadence fournie : aucun jugement (pas de 60 implicite)
        assert_eq!(frame_rate_ratio(&fps, None), None);
        // jeu PAL à 50 Hz annoncé par l'émulateur : tenu à 100 %
        let pal = TargetRate { fps: 50.0, source: MetricSource::Emulator { adapter: "pcsx2".into() } };
        assert_eq!(frame_rate_ratio(&fps, Some(&pal)), Some(1.0));
        let cpu = summarize(&[s(Metric::CpuUsagePercent, 50.0, Reliability::Measured)], Metric::CpuUsagePercent).unwrap();
        assert_eq!(frame_rate_ratio(&cpu, Some(&pal)), None);
    }
}
