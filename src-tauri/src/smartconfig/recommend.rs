//! Moteur de recommandation déterministe et explicable (aucun service d'IA).
//!
//! 1. Barrières (jamais compensées par la popularité) :
//!    autre émulateur → `Incompatible` ; rapport d'échec (« Ingame » ou pire)
//!    → `Incompatible` ; aucun paramètre valide → `Insufficient`.
//! 2. Catégorie : version non officielle (fork), autre architecture/système
//!    ou votes majoritairement négatifs → `Experimental` ; jeu identifié par
//!    son numéro de série + matériel proche → `Exact` ; matériel proche →
//!    `SimilarHardware` ; sinon `Generic`.
//! 3. Score (ordre à catégorie égale), chaque point est justifié dans `reasons`.
//!
//! Retours locaux (`sc_feedback`) : un profil déjà appliqué puis jugé « ne
//! fonctionne pas » est exclu pour ce jeu (`Incompatible`), ou rétrogradé
//! (`Experimental`) si c'était avec une autre version de l'émulateur ; des
//! ralentissements ou défauts d'image signalés le pénalisent. Chaque fois, la
//! raison est affichée et l'application automatique est refusée.
//!
//! L'application automatique n'est permise que pour `Exact`/`SimilarHardware`,
//! jeu identifié par numéro de série (jamais par le seul titre), paramètres
//! à risque faible et performance « Great » ou mieux.

use super::adapters::Adapter;
use super::hardware::{classify, GpuVendor, HardwareInfo, Tier};
use super::model::*;
use super::validation::{self, Risk, Validated};
use serde::Serialize;

/// Comment iBox a relié le jeu au profil.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GameMatch {
    /// Numéro de série identique.
    Serial,
    /// Titre normalisé et console identiques (EmuReady).
    Title,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    pub text: String,
    pub points: i32,
}

/// Dernier retour de l'utilisateur sur un profil appliqué à ce jeu
/// (`storage::local_feedback`, un par profil, le plus récent).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LocalFeedback {
    /// `SourceId::as_str` (`emuready`, `community`, `verified`…).
    pub source: String,
    pub source_ref: String,
    /// Version de l'émulateur lors de l'application.
    pub emulator_version: Option<String>,
    pub worked: Option<bool>,
    pub performance_ok: Option<bool>,
    pub graphics_issues: Option<bool>,
}

/// Effet d'un retour local sur une recommandation (affiché par l'interface).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalVerdict {
    /// « Ne fonctionne pas » avec cette version de l'émulateur (ou version inconnue) : exclu.
    Failed,
    /// « Ne fonctionne pas » avec une autre version : rétrogradé en expérimental.
    FailedOtherVersion,
    /// Fonctionnait, avec ralentissements ou défauts d'image : pénalisé.
    Issues,
    /// Fonctionnait sans problème signalé.
    Worked,
}

fn local_verdict(p: &Profile, ctx: &Context) -> Option<(LocalVerdict, &'static str)> {
    let f = ctx.local.iter().find(|f| f.source == p.source.as_str() && f.source_ref == p.source_ref)?;
    Some(if f.worked == Some(false) {
        let other = matches!((f.emulator_version.as_deref(), ctx.emulator_version), (Some(a), Some(b)) if a != b);
        if other {
            (LocalVerdict::FailedOtherVersion, "Vous l'aviez signalé comme ne fonctionnant pas avec une autre version de l'émulateur : rétrogradé.")
        } else {
            (LocalVerdict::Failed, "Vous avez appliqué ce profil et indiqué qu'il ne fonctionnait pas : il n'est plus proposé pour ce jeu.")
        }
    } else {
        match (f.performance_ok == Some(false), f.graphics_issues == Some(true)) {
            (true, true) => (LocalVerdict::Issues, "Vous l'avez appliqué : ralentissements et défauts d'image signalés."),
            (true, false) => (LocalVerdict::Issues, "Vous l'avez appliqué : ralentissements signalés."),
            (false, true) => (LocalVerdict::Issues, "Vous l'avez appliqué : défauts d'image signalés."),
            (false, false) if f.worked == Some(true) => (LocalVerdict::Worked, "Vous l'avez déjà appliqué : il a bien fonctionné."),
            _ => return None,
        }
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub profile: Profile,
    pub kind: MatchKind,
    pub score: i32,
    pub mode: Option<Mode>,
    pub validated: Validated,
    pub max_risk: Option<Risk>,
    pub reasons: Vec<Reason>,
    pub auto_eligible: bool,
    /// Votre propre retour sur ce profil pour ce jeu, s'il y en a un.
    pub local: Option<LocalVerdict>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// Configurations classées (meilleure d'abord), incompatibles en fin de liste.
    pub recommendations: Vec<Recommendation>,
    /// Rapports sans réglages (informatifs).
    pub reports: Vec<Profile>,
    /// Meilleure configuration de chaque mode réellement disponible.
    pub best_by_mode: Vec<(Mode, usize)>,
    /// Indice de la recommandation conseillée, s'il y en a une suffisamment fiable.
    pub suggested: Option<usize>,
}

pub struct Context<'a> {
    pub game: &'a GameQuery,
    pub game_match: GameMatch,
    pub hw: &'a HardwareInfo,
    pub emulator_version: Option<&'a str>,
    pub preferred: Mode,
    /// Date du jour (« AAAA-MM-JJ… »), pour la fraîcheur.
    pub today: &'a str,
    /// Vos retours sur les profils déjà appliqués à ce jeu.
    pub local: &'a [LocalFeedback],
}

fn years_between(from: &str, to: &str) -> Option<f64> {
    let parse = |s: &str| -> Option<f64> {
        let y: f64 = s.get(0..4)?.parse().ok()?;
        let m: f64 = s.get(5..7)?.parse().ok()?;
        Some(y + (m - 1.0) / 12.0)
    };
    Some(parse(to)? - parse(from)?)
}

fn rank_points(rank: u8) -> i32 {
    match rank {
        1 => 40,
        2 => 32,
        3 => 22,
        4 => 8,
        _ => 0,
    }
}

pub fn evaluate(adapter: &dyn Adapter, p: &Profile, ctx: &Context) -> Recommendation {
    let mut reasons = Vec::new();
    let mut add = |text: String, points: i32| reasons.push(Reason { text, points });
    let validated = validation::validate(&p.settings, adapter.specs(), ctx.hw);
    let max_risk = validated.max_risk(adapter.specs());
    let mode = adapter.mode_of(&validated.accepted);
    let class = classify(ctx.hw);
    let rank = p.performance.as_ref().map(|x| x.rank);
    // un profil qui porte le numéro de série exact du jeu (communauté iBox) est relié par
    // numéro de série, quel que soit le mode de correspondance des autres sources
    let game_match = match (p.game.serial.as_deref(), ctx.game.serial.as_deref()) {
        (Some(a), Some(b)) if !a.is_empty() && a.eq_ignore_ascii_case(b) => GameMatch::Serial,
        _ => ctx.game_match,
    };

    let local = local_verdict(p, ctx);

    // 1. barrières
    let mut kind = None;
    if p.emulator != adapter.id() {
        add("Profil prévu pour un autre émulateur.".into(), 0);
        kind = Some(MatchKind::Incompatible);
    } else if let Some((LocalVerdict::Failed, text)) = local {
        add(text.into(), 0);
        kind = Some(MatchKind::Incompatible);
    } else if rank.is_some_and(|r| r >= 5) {
        add(format!("Rapport d'échec ({}) : ces réglages ne font pas fonctionner le jeu.", p.performance.as_ref().map(|x| x.label.as_str()).unwrap_or_default()), 0);
        kind = Some(MatchKind::Incompatible);
    } else if validated.accepted.is_empty() {
        add("Aucun paramètre transposable en toute sécurité.".into(), 0);
        kind = Some(MatchKind::Insufficient);
    }

    // 2. proximité matérielle
    let ours_arch = ctx.hw.os.arch.as_str();
    let same_arch = p.hardware.arch.as_deref().map(|a| a == ours_arch);
    let same_os = p.hardware.os.as_deref().map(|o| o == ctx.hw.os.family);
    let mut similar = 0;
    if same_os == Some(true) {
        add("Même système d'exploitation.".into(), 10);
        similar += 1;
    }
    if same_arch == Some(true) {
        add("Même architecture de processeur.".into(), 8);
        similar += 1;
    }
    if let (Some(g), Some(ours)) = (p.hardware.gpu.as_deref(), ctx.hw.primary()) {
        if GpuVendor::from_name(g) == Some(ours.vendor) {
            add("Carte graphique du même constructeur.".into(), 5);
            similar += 1;
        }
    }
    let foreign = same_arch == Some(false) || same_os == Some(false);
    if foreign {
        add("Testé sur un autre type d'appareil (architecture ou système différents).".into(), -10);
    }

    if kind.is_none() {
        let negative = p.votes_down > p.votes_up && p.votes_up + p.votes_down >= 3;
        let failed_before = matches!(local, Some((LocalVerdict::FailedOtherVersion, _)));
        kind = Some(if p.emulator_fork.is_some() || foreign || negative || failed_before {
            if let Some((LocalVerdict::FailedOtherVersion, text)) = local {
                add(text.into(), -20);
            }
            if p.emulator_fork.is_some() {
                add(format!("Version non officielle de l'émulateur ({}).", p.emulator_fork.as_deref().unwrap_or_default()), -8);
            }
            if negative {
                add("Avis majoritairement négatifs.".into(), -10);
            }
            MatchKind::Experimental
        } else if similar >= 2 && game_match == GameMatch::Serial {
            MatchKind::Exact
        } else if similar >= 2 {
            MatchKind::SimilarHardware
        } else {
            MatchKind::Generic
        });
    }

    // 3. score
    if let Some(r) = rank {
        add(format!("Performance rapportée : {}.", p.performance.as_ref().map(|x| x.label.as_str()).unwrap_or_default()), rank_points(r));
    } else {
        add("Performance non rapportée.".into(), 0);
    }
    if let Some(y) = p.updated_at.as_deref().or(p.created_at.as_deref()).and_then(|d| years_between(d, ctx.today)) {
        let pts = if y <= 0.5 { 10 } else if y <= 1.0 { 5 } else { 0 };
        add(if pts > 0 { "Rapport récent.".into() } else { "Rapport de plus d'un an.".to_string() }, pts);
    }
    let net = p.votes_up as i32 - p.votes_down as i32;
    if net != 0 {
        // la popularité est plafonnée : elle ne compense jamais une barrière
        add(format!("Votes de la communauté ({net:+})."), net.clamp(-10, 10));
    }
    if p.verified_by_developer {
        add("Vérifié par un développeur de l'émulateur.".into(), 8);
    }
    if p.source == SourceId::Verified {
        add("Vérifié par iBox : essayé en jeu puis relu.".into(), 12);
    }
    match local {
        Some((LocalVerdict::Issues, text)) => add(text.into(), -15),
        Some((LocalVerdict::Worked, text)) => add(text.into(), 5),
        _ => {}
    }
    if let (Some(theirs), Some(ours)) = (p.emulator_version.as_deref(), ctx.emulator_version) {
        if theirs == ours {
            add("Même version de l'émulateur.".into(), 6);
        }
    } else if p.emulator_version.is_none() {
        add("Version de l'émulateur non précisée.".into(), -2);
    }
    match max_risk {
        Some(Risk::High) => add("Contient un réglage sensible (moteur de rendu).".into(), -10),
        Some(Risk::Medium) => add("Contient des réglages de précision d'émulation.".into(), -3),
        _ => {}
    }
    if !validated.rejected.is_empty() {
        add(format!("{} paramètre(s) écarté(s) par la validation.", validated.rejected.len()), -(validated.rejected.len() as i32).min(6));
    }
    if mode == Some(ctx.preferred) {
        add("Correspond à votre mode préféré.".into(), 6);
    }
    if mode == Some(Mode::Quality) && class.gpu == Tier::Entry {
        add("Mode qualité exigeant pour cette carte graphique.".into(), -8);
    }

    let score = reasons.iter().map(|r| r.points).sum();
    let kind = kind.unwrap_or(MatchKind::Generic);
    let auto_eligible = matches!(kind, MatchKind::Exact | MatchKind::SimilarHardware)
        && game_match == GameMatch::Serial
        && max_risk.is_some_and(|r| r == Risk::Low)
        && rank.is_some_and(|r| r <= 2)
        && local.is_none_or(|(v, _)| v == LocalVerdict::Worked);
    Recommendation { profile: p.clone(), kind, score, mode, validated, max_risk, reasons, auto_eligible, local: local.map(|(v, _)| v) }
}

pub fn recommend(adapter: &dyn Adapter, profiles: &[Profile], ctx: &Context) -> Outcome {
    let (configs, reports): (Vec<&Profile>, Vec<&Profile>) = profiles.iter().partition(|p| p.kind == ProfileKind::Configuration);
    let mut recs: Vec<Recommendation> = configs.into_iter().map(|p| evaluate(adapter, p, ctx)).collect();
    recs.sort_by(|a, b| a.kind.cmp(&b.kind).then(b.score.cmp(&a.score)).then(a.profile.source_ref.cmp(&b.profile.source_ref)));
    let usable = |r: &Recommendation| matches!(r.kind, MatchKind::Exact | MatchKind::SimilarHardware | MatchKind::Generic);
    let mut best_by_mode = Vec::new();
    for m in [Mode::Performance, Mode::Balanced, Mode::Quality] {
        if let Some(i) = recs.iter().position(|r| usable(r) && r.mode == Some(m)) {
            best_by_mode.push((m, i));
        }
    }
    let suggested = if ctx.preferred == Mode::Manual {
        None
    } else {
        best_by_mode.iter().find(|(m, _)| *m == ctx.preferred).map(|(_, i)| *i).or_else(|| recs.iter().position(usable))
    };
    Outcome { recommendations: recs, reports: reports.into_iter().cloned().collect(), best_by_mode, suggested }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::dolphin::Dolphin;
    use crate::smartconfig::hardware::*;

    fn hw() -> HardwareInfo {
        HardwareInfo {
            os: OsInfo { family: "windows".into(), version: None, arch: "x86_64".into() },
            cpu: CpuInfo { threads: Some(16), ..Default::default() },
            gpus: vec![GpuInfo { name: "NVIDIA GeForce RTX 4070".into(), vendor: GpuVendor::Nvidia, dedicated_vram_mb: Some(12288), integrated: Some(false), driver_version: None, software: false }],
            primary_gpu: Some(0),
            apis: GraphicsApis { d3d11: Some(true), d3d12: Some(true), vulkan_loader: Some(true), opengl: None, metal: Some(false) },
            ..Default::default()
        }
    }

    fn profile(id: &str, rank: u8, settings: Vec<Setting>) -> Profile {
        Profile {
            source: SourceId::EmuReady,
            source_ref: id.into(),
            source_url: None,
            kind: ProfileKind::Configuration,
            emulator: "dolphin".into(),
            emulator_version: Some("2509".into()),
            emulator_fork: None,
            game: GameRef::default(),
            hardware: ReferenceHardware { os: Some("windows".into()), arch: Some("x86_64".into()), gpu: Some("NVIDIA GeForce RTX 3060".into()), ..Default::default() },
            performance: Some(ReportedPerformance { label: "Perfect".into(), rank, scale: 8 }),
            settings,
            ignored: vec![],
            notes: None,
            votes_up: 0,
            votes_down: 0,
            verified_by_developer: false,
            created_at: Some("2026-10-01T00:00:00Z".into()),
            updated_at: None,
        }
    }

    fn res(i: i64) -> Setting {
        Setting { key: "dolphin.internal_resolution".into(), value: Value::Int(i) }
    }

    fn ctx<'a>(g: &'a GameQuery, h: &'a HardwareInfo, m: GameMatch) -> Context<'a> {
        Context { game: g, game_match: m, hw: h, emulator_version: Some("2509"), preferred: Mode::Balanced, today: "2026-11-17", local: &[] }
    }

    #[test]
    fn barrieres_avant_popularite() {
        let g = GameQuery::default();
        let h = hw();
        let mut failing = profile("echec", 8, vec![res(2)]);
        failing.votes_up = 500;
        let mut other = profile("autre", 1, vec![res(2)]);
        other.emulator = "pcsx2".into();
        let good = profile("bon", 2, vec![res(2)]);
        let empty = profile("vide", 1, vec![Setting { key: "dolphin.inconnu".into(), value: Value::Bool(true) }]);
        let out = recommend(&Dolphin, &[failing, other, good, empty], &ctx(&g, &h, GameMatch::Title));
        let kinds: Vec<(&str, MatchKind)> = out.recommendations.iter().map(|r| (r.profile.source_ref.as_str(), r.kind)).collect();
        assert_eq!(kinds[0], ("bon", MatchKind::SimilarHardware));
        assert!(kinds.contains(&("echec", MatchKind::Incompatible)));
        assert!(kinds.contains(&("autre", MatchKind::Incompatible)));
        assert!(kinds.contains(&("vide", MatchKind::Insufficient)));
        assert_eq!(out.suggested, Some(0));
    }

    #[test]
    fn titre_seul_jamais_automatique_et_modes_reels() {
        let g = GameQuery::default();
        let h = hw();
        let p = vec![profile("perf", 1, vec![res(1)]), profile("qual", 2, vec![res(4)])];
        let out = recommend(&Dolphin, &p, &ctx(&g, &h, GameMatch::Title));
        assert!(out.recommendations.iter().all(|r| !r.auto_eligible));
        let modes: Vec<Mode> = out.best_by_mode.iter().map(|(m, _)| *m).collect();
        assert_eq!(modes, vec![Mode::Performance, Mode::Quality]);
        // pas de mode équilibré inventé : la suggestion retombe sur la meilleure
        assert!(out.suggested.is_some());
        let out = recommend(&Dolphin, &p, &ctx(&g, &h, GameMatch::Serial));
        assert!(out.recommendations.iter().any(|r| r.kind == MatchKind::Exact && r.auto_eligible));
    }

    #[test]
    fn appareil_android_et_fork_experimentaux() {
        let g = GameQuery::default();
        let h = hw();
        let mut android = profile("android", 1, vec![res(2)]);
        android.hardware = ReferenceHardware { arch: Some("aarch64".into()), handheld: true, ..Default::default() };
        android.emulator_fork = Some("MMJR2".into());
        let out = recommend(&Dolphin, &[android], &ctx(&g, &h, GameMatch::Title));
        assert_eq!(out.recommendations[0].kind, MatchKind::Experimental);
        assert_eq!(out.suggested, None);
    }

    #[test]
    fn mode_manuel_ne_suggere_rien_et_rapports_separes() {
        let g = GameQuery::default();
        let h = hw();
        let mut report = profile("rapport", 1, vec![]);
        report.kind = ProfileKind::Report;
        let mut c = ctx(&g, &h, GameMatch::Title);
        c.preferred = Mode::Manual;
        let out = recommend(&Dolphin, &[report, profile("p", 1, vec![res(2)])], &c);
        assert_eq!(out.reports.len(), 1);
        assert_eq!(out.suggested, None);
        // déterministe : même entrée, même sortie
        assert_eq!(out, recommend(&Dolphin, &[out.reports[0].clone(), profile("p", 1, vec![res(2)])], &c));
    }

    fn feedback(id: &str, version: &str, worked: bool, perf: Option<bool>, gfx: Option<bool>) -> LocalFeedback {
        LocalFeedback { source: "emuready".into(), source_ref: id.into(), emulator_version: Some(version.into()), worked: Some(worked), performance_ok: perf, graphics_issues: gfx }
    }

    #[test]
    fn retours_locaux_excluent_ou_retrogradent() {
        let g = GameQuery::default();
        let h = hw();
        let p = vec![profile("rate", 1, vec![res(2)]), profile("ancien", 1, vec![res(2)]), profile("lent", 1, vec![res(2)]), profile("ok", 3, vec![res(2)])];
        let local = vec![
            feedback("rate", "2509", false, None, None),
            feedback("ancien", "2412", false, None, None),
            feedback("lent", "2509", true, Some(false), None),
            feedback("ok", "2509", true, Some(true), Some(false)),
        ];
        let mut c = ctx(&g, &h, GameMatch::Serial);
        c.local = &local;
        let out = recommend(&Dolphin, &p, &c);
        let get = |id: &str| out.recommendations.iter().find(|r| r.profile.source_ref == id).unwrap();
        // même version : exclu, avec la raison
        assert_eq!(get("rate").kind, MatchKind::Incompatible);
        assert_eq!(get("rate").local, Some(LocalVerdict::Failed));
        assert!(get("rate").reasons.iter().any(|r| r.text.contains("ne fonctionnait pas")));
        // autre version : rétrogradé, jamais suggéré ni automatique
        assert_eq!(get("ancien").kind, MatchKind::Experimental);
        assert_eq!(get("ancien").local, Some(LocalVerdict::FailedOtherVersion));
        assert!(!get("ancien").auto_eligible);
        // ralentissements : pénalisé sous un profil moins bien noté mais sans problème
        assert_eq!(get("lent").local, Some(LocalVerdict::Issues));
        assert!(!get("lent").auto_eligible);
        assert!(get("lent").score < get("ok").score);
        assert_eq!(get("ok").local, Some(LocalVerdict::Worked));
        assert_eq!(out.recommendations[out.suggested.unwrap()].profile.source_ref, "ok");
        // sans retour : comportement inchangé
        let plain = recommend(&Dolphin, &p, &ctx(&g, &h, GameMatch::Serial));
        assert!(plain.recommendations.iter().all(|r| r.local.is_none() && r.kind == MatchKind::Exact));
    }

    #[test]
    fn retour_d_une_autre_source_ignore() {
        let g = GameQuery::default();
        let h = hw();
        let mut other = feedback("p", "2509", false, None, None);
        other.source = "community".into();
        let local = [other];
        let mut c = ctx(&g, &h, GameMatch::Title);
        c.local = &local;
        let out = recommend(&Dolphin, &[profile("p", 1, vec![res(2)])], &c);
        assert_eq!(out.recommendations[0].local, None);
        assert_eq!(out.recommendations[0].kind, MatchKind::SimilarHardware);
    }

    #[test]
    fn verifie_par_ibox_bonifie() {
        let g = GameQuery::default();
        let h = hw();
        let mut v = profile("v", 2, vec![res(2)]);
        v.source = SourceId::Verified;
        let out = recommend(&Dolphin, &[profile("e", 2, vec![res(2)]), v], &ctx(&g, &h, GameMatch::Title));
        assert_eq!(out.recommendations[0].profile.source, SourceId::Verified);
        assert!(out.recommendations[0].reasons.iter().any(|r| r.points == 12));
    }
}
