//! Fournisseur iBox SmartConfig Community : profils publiés par les joueurs sur
//! iNetbox (`services/inetbox/src/smartconfig.ts`).
//!
//! - Lecture **publique** (aucun jeton envoyé), à la demande uniquement.
//! - Le jeu est cherché par **console + numéro de série exact** : un jeu sans
//!   numéro de série n'envoie aucune requête. Données envoyées : console,
//!   numéro de série du jeu, identifiant de l'émulateur. Rien d'autre.
//! - Cache via le trait `Cache` (profils normalisés, 1 h) ; hors ligne, le
//!   cache expiré est servi et signalé (`stale`).
//! - Les réglages reçus restent non fiables : ils repassent par la validation
//!   de l'adaptateur comme ceux de toute autre source.
//! - Le serveur valide par la même liste blanche typée que les adaptateurs :
//!   `services/inetbox/src/smartconfigSettings.ts` est généré par
//!   `server_whitelist_ts()` (test `liste_blanche_serveur_a_jour`).

use super::{Cache, Fetched, Provider, ProviderError, ProviderInfo};
use crate::smartconfig::model::{GameQuery, GameRef, IgnoredField, Profile, ProfileKind, ReferenceHardware, ReportedPerformance, Setting, SourceId};
use serde_json::Value;

pub const INFO: ProviderInfo = ProviderInfo {
    id: SourceId::Community,
    name: "iBox SmartConfig Community",
    website: "https://inetbox-server.onrender.com",
    docs: "https://github.com/atzski/ibox/blob/main/docs/SMARTCONFIG.md",
    terms: "https://github.com/atzski/ibox/blob/main/docs/SMARTCONFIG-CONTRIBUTIONS.md",
    provides: "Profils de réglages publiés par les joueurs d'iBox (matériel résumé, performances observées, votes), modérés sur iNetbox.",
    sends: "La console, le numéro de série du jeu et l'émulateur, uniquement quand vous consultez SmartConfig pour ce jeu. Aucun compte requis pour lire.",
};

/// Durée de fraîcheur du cache (profils et absence de profil).
const TTL: i64 = 3600;
/// Profils retenus au plus par jeu (le serveur en renvoie 50 au plus).
const MAX_PROFILES: usize = 50;
const MAX_NOTES: usize = 500;

/// Accès au service : `get(chemin)` renvoie le JSON ou une erreur de fournisseur.
pub trait Transport: Send + Sync {
    fn get(&self, path: &str) -> Result<Value, ProviderError>;
}

/// Transport réel : client natif iNetbox, sans jeton.
pub struct InetboxTransport;

impl Transport for InetboxTransport {
    fn get(&self, path: &str) -> Result<Value, ProviderError> {
        crate::inetbox::smartconfig_call(reqwest::Method::GET, path, None, false).map_err(|e| match e.code() {
            "NETWORK_ERROR" => ProviderError::Offline("iNetbox".into()),
            "RATE_LIMITED" => ProviderError::RateLimited { retry_after_s: e.retry_after().unwrap_or(60) },
            // ancien serveur sans la communauté SmartConfig
            "NOT_FOUND" => ProviderError::Invalid("la communauté SmartConfig n'est pas encore ouverte sur iNetbox".into()),
            "INVALID_INPUT" => ProviderError::Http { status: 400 },
            _ => ProviderError::Http { status: 503 },
        })
    }
}

pub struct Community {
    transport: Box<dyn Transport>,
}

impl Community {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self { transport }
    }
}

/// Numéro de série de jeu accepté par le serveur (`GMSE01`, `SLUS-20312`).
pub fn valid_serial(s: &str) -> bool {
    (4..=16).contains(&s.len()) && s.bytes().enumerate().all(|(i, b)| b.is_ascii_uppercase() || b.is_ascii_digit() || (i > 0 && (b == b'-' || b == b'_')))
}

fn valid_slug(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

/// Échelle de performance de la communauté (rang 1 = meilleur ; 5 = injouable → barrière du moteur).
fn performance(label: &str) -> Option<ReportedPerformance> {
    let (rank, text) = match label {
        "perfect" => (1, "Parfait"),
        "great" => (2, "Très bon"),
        "playable" => (3, "Jouable"),
        "poor" => (4, "Médiocre"),
        "unplayable" => (5, "Injouable"),
        _ => return None,
    };
    Some(ReportedPerformance { label: text.into(), rank, scale: 5 })
}

fn iso(ms: &Value) -> Option<String> {
    ms.as_i64().filter(|m| *m > 0).map(|m| crate::library::time::iso_from_unix(m / 1000))
}

fn short(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Profil publié (dernière version) → `Profile` normalisé. `None` si l'entrée ne
/// correspond pas exactement au jeu demandé ou est malformée.
pub fn normalize(item: &Value, game: &GameQuery, emulator: &str) -> Option<Profile> {
    let serial = game.serial.as_deref()?.to_ascii_uppercase();
    let g = &item["game"];
    if g["serial"].as_str()? != serial || g["platform"].as_str()? != game.platform || item["emulator"].as_str()? != emulator {
        return None;
    }
    let v = &item["latest"];
    let version_id = v["id"].as_str().filter(|s| crate::inetbox::is_uuid(s))?;
    item["id"].as_str().filter(|s| crate::inetbox::is_uuid(s))?;
    let mut settings = Vec::new();
    let mut ignored = Vec::new();
    for raw in v["settings"].as_array()?.iter().take(crate::smartconfig::validation::MAX_SETTINGS + 1) {
        match serde_json::from_value::<Setting>(raw.clone()) {
            Ok(s) => settings.push(s),
            Err(_) => ignored.push(IgnoredField { field: short(raw["key"].as_str().unwrap_or("?"), 64), reason: "valeur illisible".into() }),
        }
    }
    let h = &v["hardware"];
    let text = |x: &Value, max: usize| x.as_str().map(|s| short(s.trim(), max)).filter(|s| !s.is_empty());
    let (cpu, gpu) = (text(&h["cpu"], 120), text(&h["gpu"], 120));
    let label = match (&cpu, &gpu) {
        (Some(c), Some(g)) => Some(format!("{c} + {g}")),
        (c, g) => c.clone().or_else(|| g.clone()),
    };
    let mut notes = Vec::new();
    if let Some(d) = text(&v["description"], MAX_NOTES) {
        notes.push(d);
    }
    if let Some(b) = text(&v["bugs"], MAX_NOTES) {
        notes.push(format!("Problèmes observés : {b}"));
    }
    match v["stability"].as_str() {
        Some("minor_issues") => notes.push("Stabilité : petits problèmes.".into()),
        Some("crashes") => notes.push("Stabilité : plantages observés.".into()),
        _ => {}
    }
    let notes = (!notes.is_empty()).then(|| short(&notes.join("\n"), MAX_NOTES));
    let count = |x: &Value| x.as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    Some(Profile {
        source: SourceId::Community,
        // une recommandation (et un vote) porte sur une version précise
        source_ref: version_id.into(),
        source_url: None,
        kind: ProfileKind::Configuration,
        emulator: emulator.into(),
        emulator_version: text(&v["emulatorVersion"], 40),
        emulator_fork: None,
        game: GameRef { title: short(g["title"].as_str().unwrap_or_default(), 160), system: Some(game.platform.clone()), serial: Some(serial) },
        hardware: ReferenceHardware {
            os: text(&h["os"], 16),
            arch: text(&h["arch"], 16),
            label,
            cpu,
            gpu,
            handheld: h["device"].as_str() == Some("handheld"),
        },
        performance: v["performance"].as_str().and_then(performance),
        settings,
        ignored,
        notes,
        votes_up: count(&v["votes"]["works"]),
        votes_down: count(&v["votes"]["fails"]),
        // badge « Vérifié par iBox » : affiché par l'interface (commande de détail), pas un avis de développeur d'émulateur
        verified_by_developer: false,
        created_at: iso(&v["createdAt"]),
        updated_at: iso(&item["updatedAt"]),
    })
}

impl Provider for Community {
    fn id(&self) -> SourceId {
        SourceId::Community
    }

    fn supports(&self, emulator: &str, platform: &str) -> bool {
        crate::smartconfig::adapters::by_id(emulator).is_some_and(|a| a.platforms().contains(&platform))
    }

    fn fetch(&self, game: &GameQuery, emulator: &str, cache: &dyn Cache) -> Result<Fetched, ProviderError> {
        // sans numéro de série exact : aucune requête
        let Some(serial) = game.serial.as_deref().map(str::to_ascii_uppercase).filter(|s| valid_serial(s)) else { return Ok(Fetched::default()) };
        if !valid_slug(&game.platform, 40) || !valid_slug(emulator, 24) {
            return Ok(Fetched::default());
        }
        let key = format!("community:{}:{serial}:{emulator}", game.platform);
        let hit = cache.get(&key);
        let (body, stale) = match &hit {
            Some((body, true)) => (body.clone(), false),
            _ => match self.transport.get(&format!("/v1/smartconfig/profiles?platform={}&serial={serial}&emulator={emulator}", game.platform)) {
                Ok(json) => {
                    let items = json["items"].as_array().ok_or_else(|| ProviderError::Invalid("liste de profils absente".into()))?;
                    let profiles: Vec<Profile> = items.iter().filter_map(|i| normalize(i, game, emulator)).take(MAX_PROFILES).collect();
                    let body = serde_json::to_string(&profiles).map_err(|e| ProviderError::Invalid(e.to_string()))?;
                    cache.put(&key, &body, TTL);
                    (body, false)
                }
                Err(e @ (ProviderError::Offline(_) | ProviderError::RateLimited { .. } | ProviderError::Http { .. })) => match hit {
                    Some((body, _)) => (body, true),
                    None => return Err(e),
                },
                Err(e) => return Err(e),
            },
        };
        let profiles: Vec<Profile> = serde_json::from_str(&body).map_err(|e| ProviderError::Invalid(e.to_string()))?;
        Ok(Fetched { matched: !profiles.is_empty(), profiles, stale })
    }
}

/// Contenu attendu de `services/inetbox/src/smartconfigSettings.ts`, généré depuis
/// les adaptateurs : la liste blanche du serveur est exactement la leur.
pub fn server_whitelist_ts() -> String {
    use crate::smartconfig::validation::Kind;
    let quote = |s: &str| format!("'{s}'");
    let mut out = String::from(
        "// Fichier généré depuis les adaptateurs SmartConfig d'iBox (src-tauri/src/smartconfig/adapters).\n\
         // Ne pas modifier à la main : le test Rust `liste_blanche_serveur_a_jour` échoue s'il diverge\n\
         // et affiche le contenu attendu.\n\n\
         export type SettingKind =\n  | { type: 'bool' }\n  | { type: 'int'; min: number; max: number }\n  | { type: 'choice'; options: readonly string[] };\n\n\
         /** Émulateurs pris en charge et consoles couvertes. */\n\
         export const EMULATORS: Readonly<Record<string, readonly string[]>> = {\n",
    );
    let adapters = crate::smartconfig::adapters::all();
    for a in &adapters {
        out += &format!("  {}: [{}],\n", a.id(), a.platforms().iter().map(|p| quote(p)).collect::<Vec<_>>().join(", "));
    }
    out += "};\n\n/** Liste blanche typée des paramètres publiables. */\nexport const SETTINGS: Readonly<Record<string, SettingKind>> = {\n";
    for a in &adapters {
        for s in a.specs() {
            let kind = match s.kind {
                Kind::Bool => "{ type: 'bool' }".to_string(),
                Kind::Int { min, max } => format!("{{ type: 'int', min: {min}, max: {max} }}"),
                Kind::Choice(options) => format!("{{ type: 'choice', options: [{}] }}", options.iter().map(|o| quote(o)).collect::<Vec<_>>().join(", ")),
            };
            out += &format!("  '{}': {kind},\n", s.key);
        }
    }
    out += "};\n";
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::adapters::dolphin::Dolphin;
    use crate::smartconfig::hardware::*;
    use crate::smartconfig::model::{MatchKind, Mode, Value as V};
    use crate::smartconfig::providers::memory::MemCache;
    use crate::smartconfig::recommend::{self, Context, GameMatch};
    use serde_json::json;
    use std::sync::Mutex;

    struct Mock {
        calls: Mutex<Vec<String>>,
        reply: Mutex<Result<Value, ProviderError>>,
    }

    impl Transport for std::sync::Arc<Mock> {
        fn get(&self, path: &str) -> Result<Value, ProviderError> {
            self.calls.lock().unwrap().push(path.into());
            self.reply.lock().unwrap().clone()
        }
    }

    fn mock(reply: Result<Value, ProviderError>) -> std::sync::Arc<Mock> {
        std::sync::Arc::new(Mock { calls: Mutex::new(vec![]), reply: Mutex::new(reply) })
    }

    fn game(serial: Option<&str>) -> GameQuery {
        GameQuery { game_id: 1, platform: "gamecube".into(), title: "Metroid Prime".into(), serial: serial.map(Into::into), region: None, id_confidence: 1.0 }
    }

    /// Réponse telle que la renvoie le serveur (voir test serveur `smartconfig.test.ts`).
    fn item(serial: &str, performance: &str) -> Value {
        json!({
            "id": "11111111-1111-4111-8111-111111111111",
            "game": { "platform": "gamecube", "serial": serial, "title": "Metroid Prime" },
            "emulator": "dolphin",
            "author": { "id": "22222222-2222-4222-8222-222222222222", "displayName": "alice" },
            "verified": null, "createdAt": 1800000000000u64, "updatedAt": 1800000000000u64,
            "latest": {
                "id": "33333333-3333-4333-8333-333333333333", "number": 2, "emulatorVersion": "2506a",
                "hardware": { "os": "windows", "arch": "x86_64", "cpu": "AMD Ryzen 7 7800X3D", "gpu": "NVIDIA GeForce RTX 4070", "ramGb": 32, "device": "desktop" },
                "mode": "balanced",
                "settings": [
                    { "key": "dolphin.internal_resolution", "value": { "type": "int", "value": 2 } },
                    { "key": "dolphin.dsp_hle", "value": { "type": "bool", "value": true } },
                    { "key": "dolphin.weird", "value": { "type": "float", "value": 1.5 } }
                ],
                "performance": performance, "stability": "minor_issues", "bugs": "Saccades au premier chargement.", "description": "Stable en 2x.",
                "createdAt": 1800000000000u64,
                "votes": { "works": 4, "fails": 1, "stability": 4.5, "quality": null, "performance": 4 }, "verified": false
            }
        })
    }

    fn hw() -> HardwareInfo {
        HardwareInfo {
            os: OsInfo { family: "windows".into(), version: None, arch: "x86_64".into() },
            cpu: CpuInfo { threads: Some(16), ..Default::default() },
            gpus: vec![GpuInfo { name: "NVIDIA GeForce RTX 4080".into(), vendor: GpuVendor::Nvidia, dedicated_vram_mb: Some(16384), integrated: Some(false), driver_version: None, software: false }],
            primary_gpu: Some(0),
            ..Default::default()
        }
    }

    #[test]
    fn liste_blanche_serveur_a_jour() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../services/inetbox/src/smartconfigSettings.ts");
        let actual = std::fs::read_to_string(path).expect("liste blanche du serveur").replace("\r\n", "\n");
        let expected = server_whitelist_ts();
        assert!(actual == expected, "services/inetbox/src/smartconfigSettings.ts n'est plus à jour ; contenu attendu :\n{expected}");
    }

    #[test]
    fn recherche_par_numero_de_serie_seulement() {
        let m = mock(Ok(json!({ "items": [item("GMSE01", "great")] })));
        let c = Community::new(Box::new(m.clone()));
        let cache = MemCache::default();
        assert_eq!(c.fetch(&game(None), "dolphin", &cache).unwrap(), Fetched::default());
        assert_eq!(c.fetch(&game(Some("../x")), "dolphin", &cache).unwrap(), Fetched::default());
        assert!(m.calls.lock().unwrap().is_empty(), "aucun appel sans numéro de série valide");
        let f = c.fetch(&game(Some("gmse01")), "dolphin", &cache).unwrap();
        assert_eq!(*m.calls.lock().unwrap(), vec!["/v1/smartconfig/profiles?platform=gamecube&serial=GMSE01&emulator=dolphin".to_string()]);
        assert!(f.matched && !f.stale);
        let p = &f.profiles[0];
        assert_eq!(p.source, SourceId::Community);
        assert_eq!(p.source_ref, "33333333-3333-4333-8333-333333333333");
        assert_eq!(p.game.serial.as_deref(), Some("GMSE01"));
        assert_eq!(p.settings, vec![Setting { key: "dolphin.internal_resolution".into(), value: V::Int(2) }, Setting { key: "dolphin.dsp_hle".into(), value: V::Bool(true) }]);
        assert_eq!(p.ignored[0].field, "dolphin.weird");
        assert_eq!((p.votes_up, p.votes_down), (4, 1));
        assert_eq!(p.performance.as_ref().unwrap().rank, 2);
        assert!(p.notes.as_deref().unwrap().contains("Saccades"));
        assert_eq!(p.hardware.label.as_deref(), Some("AMD Ryzen 7 7800X3D + NVIDIA GeForce RTX 4070"));
        // deuxième consultation : cache
        c.fetch(&game(Some("GMSE01")), "dolphin", &cache).unwrap();
        assert_eq!(m.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn entrees_d_un_autre_jeu_ecartees() {
        let m = mock(Ok(json!({ "items": [item("GALE01", "great"), { "id": "x" }] })));
        let f = Community::new(Box::new(m)).fetch(&game(Some("GMSE01")), "dolphin", &MemCache::default()).unwrap();
        assert!(f.profiles.is_empty() && !f.matched);
    }

    #[test]
    fn hors_ligne_cache_expire_servi() {
        let cache = MemCache::default();
        let m = mock(Ok(json!({ "items": [item("GMSE01", "great")] })));
        let c = Community::new(Box::new(m.clone()));
        c.fetch(&game(Some("GMSE01")), "dolphin", &cache).unwrap();
        for v in cache.0.borrow_mut().values_mut() {
            v.1 = false;
        }
        *m.reply.lock().unwrap() = Err(ProviderError::Offline("iNetbox".into()));
        let f = c.fetch(&game(Some("GMSE01")), "dolphin", &cache).unwrap();
        assert!(f.stale && f.profiles.len() == 1);
        let err = Community::new(Box::new(mock(Err(ProviderError::Offline("iNetbox".into()))))).fetch(&game(Some("GMSE01")), "dolphin", &MemCache::default());
        assert_eq!(err, Err(ProviderError::Offline("iNetbox".into())));
    }

    #[test]
    fn moteur_correspondance_par_numero_de_serie() {
        let f = Community::new(Box::new(mock(Ok(json!({ "items": [item("GMSE01", "great")] }))))).fetch(&game(Some("GMSE01")), "dolphin", &MemCache::default()).unwrap();
        let g = game(Some("GMSE01"));
        let h = hw();
        // contexte global « titre » (EmuReady) : le profil communautaire reste reconnu par numéro de série
        let ctx = Context { game: &g, game_match: GameMatch::Title, hw: &h, emulator_version: Some("2506a"), preferred: Mode::Balanced, today: "2027-01-10T00:00:00Z", local: &[] };
        let out = recommend::recommend(&Dolphin, &f.profiles, &ctx);
        assert_eq!(out.recommendations[0].kind, MatchKind::Exact);
        assert!(out.recommendations[0].auto_eligible);
        // autre numéro de série côté jeu local : plus d'exactitude
        let other = game(Some("GMSP01"));
        let ctx = Context { game: &other, ..ctx };
        assert_eq!(recommend::recommend(&Dolphin, &f.profiles, &ctx).recommendations[0].kind, MatchKind::SimilarHardware);
    }

    #[test]
    fn injouable_est_une_barriere() {
        let f = Community::new(Box::new(mock(Ok(json!({ "items": [item("GMSE01", "unplayable")] }))))).fetch(&game(Some("GMSE01")), "dolphin", &MemCache::default()).unwrap();
        let g = game(Some("GMSE01"));
        let h = hw();
        let ctx = Context { game: &g, game_match: GameMatch::Title, hw: &h, emulator_version: None, preferred: Mode::Balanced, today: "2027-01-10T00:00:00Z", local: &[] };
        assert_eq!(recommend::recommend(&Dolphin, &f.profiles, &ctx).recommendations[0].kind, MatchKind::Incompatible);
    }
}
