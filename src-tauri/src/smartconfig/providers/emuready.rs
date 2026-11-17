//! Fournisseur EmuReady (API publique « mobile » tRPC, sans compte ni clé).
//!
//! Vérifié le 2026-11-17 sur https://www.emuready.com/api-docs/mobile-openapi.json
//! et par appels réels :
//! - requêtes GET `…/trpc/<procédure>?input=<{"json":{…}} encodé>` ; réponse
//!   `{"result":{"data":{"json":…}}}`, erreur `{"error":{"json":{…}}}` ;
//! - quota annoncé : `x-ratelimit-limit: 100` par fenêtre de 180 s ;
//!   iBox s'impose 45 requêtes / 180 s et respecte `Retry-After` ;
//! - `listings.byGame` (rapports « appareil », surtout Android) ne contient
//!   pas les réglages : ils sont dans `customFieldValues` de `listings.byId` ;
//! - `pcListings.get` (rapports PC) : performance et matériel ; leurs réglages
//!   sont dans `customFieldValues` de `pcListings.byId` (vérifié le 2026-11-17) ;
//! - `games.findSwitchTitleId` : identifiant de titre Switch d'après le nom ;
//! - `listings.getEmulatorConfig` ne couvre qu'Azahar/Eden/GameNative (Android),
//!   donc pas utilisé pour Windows.
//!
//! Confidentialité : seul le titre du jeu (et des identifiants EmuReady) est
//! envoyé, à la demande. Les réponses brutes ne sont jamais conservées : on
//! garde les profils normalisés, sans aucune donnée sur les contributeurs.

use super::{Cache, Fetched, Provider, ProviderError, ProviderInfo};
use crate::smartconfig::model::*;
use serde_json::{json, Value as J};
use std::collections::VecDeque;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const BASE: &str = "https://www.emuready.com/api/mobile/trpc/";
const SITE: &str = "https://www.emuready.com";
const MAX_BODY: usize = 2 * 1024 * 1024;
/// Rapports « appareil » détaillés lus par jeu (une requête chacun).
const DEVICE_DETAILS: usize = 4;
/// Rapports PC détaillés lus par jeu (une requête chacun), Windows d'abord.
const PC_DETAILS: usize = 6;
/// Identifiant de titre Switch trouvé par nom : stable, gardé longtemps.
pub const TTL_TITLE_ID: i64 = 30 * 86_400;
const TTL_GAME: i64 = 7 * 86_400;
const TTL_PROFILES: i64 = 86_400;
const TTL_PARTIAL: i64 = 600;

pub const INFO: ProviderInfo = ProviderInfo {
    id: SourceId::EmuReady,
    name: "EmuReady",
    website: "https://www.emuready.com",
    docs: "https://www.emuready.com/docs/api",
    terms: "https://www.emuready.com/terms",
    provides: "Rapports de compatibilité de la communauté EmuReady et, pour certains émulateurs, les réglages utilisés.",
    sends: "Le titre du jeu recherché, uniquement quand vous consultez SmartConfig pour ce jeu.",
};

pub struct Response {
    pub status: u16,
    pub retry_after: Option<u64>,
    pub body: Vec<u8>,
}

/// Transport HTTP (remplacé par des fixtures en test). `Err` = réseau injoignable.
pub trait Transport: Send + Sync {
    fn get(&self, url: &str) -> Result<Response, String>;
}

pub struct HttpTransport(reqwest::blocking::Client);

impl HttpTransport {
    pub fn new() -> Result<Self, String> {
        reqwest::blocking::Client::builder()
            .user_agent(crate::metadata::http::USER_AGENT)
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            .build()
            .map(Self)
            .map_err(|e| e.to_string())
    }
}

impl Transport for HttpTransport {
    fn get(&self, url: &str) -> Result<Response, String> {
        let resp = self.0.get(url).header("Accept", "application/json").send().map_err(|e| e.without_url().to_string())?;
        let status = resp.status().as_u16();
        let retry_after = resp.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|s| s.trim().parse().ok());
        let mut body = Vec::new();
        resp.take(MAX_BODY as u64 + 1).read_to_end(&mut body).map_err(|e| e.to_string())?;
        if body.len() > MAX_BODY {
            return Ok(Response { status: 413, retry_after: None, body: Vec::new() });
        }
        Ok(Response { status, retry_after, body })
    }
}

struct Gate {
    sent: VecDeque<Instant>,
    cooldown_until: Option<Instant>,
}

pub struct EmuReady {
    transport: Box<dyn Transport>,
    gate: Mutex<Gate>,
    /// Une recherche à la fois : un second appel identique trouve le cache rempli.
    serial: Mutex<()>,
    budget: usize,
    window: Duration,
    backoff: Duration,
}

impl EmuReady {
    pub fn new(transport: Box<dyn Transport>) -> Self {
        Self { transport, gate: Mutex::new(Gate { sent: VecDeque::new(), cooldown_until: None }), serial: Mutex::new(()), budget: 45, window: Duration::from_secs(180), backoff: Duration::from_millis(500) }
    }

    #[cfg(test)]
    fn for_tests(transport: Box<dyn Transport>, budget: usize) -> Self {
        Self { budget, backoff: Duration::ZERO, ..Self::new(transport) }
    }

    fn admit(&self) -> Result<(), ProviderError> {
        let mut g = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        if let Some(until) = g.cooldown_until {
            if until > now {
                return Err(ProviderError::RateLimited { retry_after_s: (until - now).as_secs().max(1) });
            }
            g.cooldown_until = None;
        }
        while g.sent.front().is_some_and(|t| now.duration_since(*t) >= self.window) {
            g.sent.pop_front();
        }
        if g.sent.len() >= self.budget {
            let wait = self.window.saturating_sub(now.duration_since(g.sent[0]));
            return Err(ProviderError::RateLimited { retry_after_s: wait.as_secs().max(1) });
        }
        g.sent.push_back(now);
        Ok(())
    }

    /// Appel tRPC (requête GET), avec relances exponentielles sur erreurs réseau/5xx.
    pub fn call(&self, procedure: &str, input: J) -> Result<J, ProviderError> {
        let encoded = crate::metadata::http::encode_segment(&json!({ "json": input }).to_string());
        let url = format!("{BASE}{procedure}?input={encoded}");
        let mut last = ProviderError::Offline("EmuReady".into());
        for attempt in 0..3u32 {
            if attempt > 0 {
                std::thread::sleep(self.backoff * 2u32.pow(attempt - 1));
            }
            self.admit()?;
            match self.transport.get(&url) {
                Err(_) => last = ProviderError::Offline("EmuReady".into()),
                Ok(r) if r.status == 429 => {
                    let secs = r.retry_after.unwrap_or(60).clamp(1, 3600);
                    self.gate.lock().unwrap_or_else(|e| e.into_inner()).cooldown_until = Some(Instant::now() + Duration::from_secs(secs));
                    return Err(ProviderError::RateLimited { retry_after_s: secs });
                }
                Ok(r) if r.status >= 500 => last = ProviderError::Http { status: r.status },
                Ok(r) if r.status != 200 => return Err(ProviderError::Http { status: r.status }),
                Ok(r) => return unwrap_envelope(&r.body),
            }
        }
        Err(last)
    }

    fn game_id(&self, game: &GameQuery, system: &str) -> Result<Option<String>, ProviderError> {
        let query: String = strip_tags(&game.title).chars().take(100).collect();
        if query.trim().is_empty() {
            return Ok(None);
        }
        let data = self.call("games.searchGames", json!({ "query": query.trim() }))?;
        let list = data.as_array().ok_or_else(|| ProviderError::Invalid("liste de jeux attendue".into()))?;
        let wanted = normalize_title(&game.title);
        let hits: Vec<&str> = list
            .iter()
            .filter(|g| g.pointer("/system/key").and_then(J::as_str) == Some(system))
            .filter(|g| g.get("title").and_then(J::as_str).map(normalize_title).as_deref() == Some(wanted.as_str()))
            .filter_map(|g| g.get("id").and_then(J::as_str))
            .collect();
        // plusieurs fiches au même titre : ambigu, on s'abstient
        Ok((hits.len() == 1).then(|| hits[0].to_string()))
    }

    fn profiles(&self, game_id: &str, emulator: &str, emu_name: &str) -> Result<(Vec<Profile>, bool), ProviderError> {
        let data = self.call("listings.byGame", json!({ "gameId": game_id }))?;
        let listings = data.get("listings").and_then(J::as_array).or_else(|| data.as_array()).cloned().unwrap_or_default();
        let mut mine: Vec<&J> = listings.iter().filter(|l| emulator_is(l, emu_name) && approved(l)).collect();
        mine.sort_by_key(|l| (perf(l).map(|p| p.rank).unwrap_or(99), -(int(l, "upVotes") - int(l, "downVotes"))));
        let mut out = Vec::new();
        let mut partial = false;
        for l in mine.iter().take(DEVICE_DETAILS) {
            match self.detail("listings.byId", l, emulator, false) {
                Some(p) => out.push(p),
                None => {
                    partial = true;
                    out.push(normalize_listing(l, emulator, false));
                }
            }
        }
        match self.call("pcListings.get", json!({ "gameId": game_id, "limit": 50 })) {
            Ok(pc) => {
                let mut pcs: Vec<&J> = pc.get("listings").and_then(J::as_array).into_iter().flatten().filter(|l| emulator_is(l, emu_name) && approved(l)).collect();
                // Windows d'abord (la plateforme d'iBox), puis la meilleure performance et les votes
                pcs.sort_by_key(|l| (s(l, "/os") != Some("WINDOWS"), perf(l).map(|p| p.rank).unwrap_or(99), -(int(l, "upVotes") - int(l, "downVotes"))));
                for (i, l) in pcs.iter().enumerate() {
                    // les réglages des rapports PC ne sont que dans le détail (`pcListings.byId`)
                    let detailed = if i < PC_DETAILS { self.detail("pcListings.byId", l, emulator, true) } else { None };
                    if i < PC_DETAILS && detailed.is_none() {
                        partial = true;
                    }
                    out.push(detailed.unwrap_or_else(|| normalize_listing(l, emulator, true)));
                }
            }
            Err(ProviderError::RateLimited { .. }) | Err(ProviderError::Offline(_)) => partial = true,
            Err(e) => return Err(e),
        }
        Ok((out, partial))
    }

    /// Détail d'un rapport (réglages compris) ; `None` si le quota ou le réseau l'empêchent.
    fn detail(&self, procedure: &str, listing: &J, emulator: &str, pc: bool) -> Option<Profile> {
        let id = listing.get("id").and_then(J::as_str)?;
        self.call(procedure, json!({ "id": id })).ok().map(|d| normalize_listing(&d, emulator, pc))
    }

    /// Identifiant de titre Switch d'après le nom du jeu (`games.findSwitchTitleId`).
    /// Retenu seulement si **un seul** résultat porte exactement le même titre normalisé.
    pub fn switch_title_id(&self, title: &str) -> Result<Option<String>, ProviderError> {
        let name: String = strip_tags(title).trim().chars().take(120).collect();
        if name.chars().count() < 2 {
            return Ok(None);
        }
        let data = self.call("games.findSwitchTitleId", json!({ "gameName": name, "maxResults": 10 }))?;
        let wanted = normalize_title(title);
        let ids: Vec<String> = data
            .get("results")
            .and_then(J::as_array)
            .into_iter()
            .flatten()
            .filter(|r| [s(r, "/normalizedTitle"), s(r, "/name")].into_iter().flatten().any(|t| normalize_title(t) == wanted))
            .filter_map(|r| s(r, "/titleId").map(str::to_ascii_uppercase))
            .filter(|id| crate::smartconfig::adapters::eden::valid_title_id(id))
            .collect();
        let mut unique = ids;
        unique.sort();
        unique.dedup();
        Ok((unique.len() == 1).then(|| unique.remove(0)))
    }
}

/// Lit le cache frais, sinon appelle `f` ; en cas d'échec réseau, sert le cache expiré.
fn cached(cache: &dyn Cache, key: &str, f: impl FnOnce() -> Result<(String, i64), ProviderError>) -> Result<(String, bool), ProviderError> {
    let hit = cache.get(key);
    if let Some((body, true)) = &hit {
        return Ok((body.clone(), false));
    }
    match f() {
        Ok((body, ttl)) => {
            cache.put(key, &body, ttl);
            Ok((body, false))
        }
        Err(e @ (ProviderError::Offline(_) | ProviderError::RateLimited { .. } | ProviderError::Http { .. })) => match hit {
            Some((body, _)) => Ok((body, true)),
            None => Err(e),
        },
        Err(e) => Err(e),
    }
}

impl Provider for EmuReady {
    fn id(&self) -> SourceId {
        SourceId::EmuReady
    }

    fn supports(&self, emulator: &str, platform: &str) -> bool {
        system_key(platform).is_some() && emulator_name(emulator).is_some()
    }

    fn fetch(&self, game: &GameQuery, emulator: &str, cache: &dyn Cache) -> Result<Fetched, ProviderError> {
        let (Some(system), Some(emu_name)) = (system_key(&game.platform), emulator_name(emulator)) else {
            return Ok(Fetched::default());
        };
        let _one = self.serial.lock().unwrap_or_else(|e| e.into_inner());
        let key = format!("emuready:game:{system}:{}", normalize_title(&game.title));
        let (body, stale_a) = cached(cache, &key, || Ok((json!(self.game_id(game, system)?).to_string(), TTL_GAME)))?;
        let Some(game_id) = serde_json::from_str::<Option<String>>(&body).ok().flatten() else {
            return Ok(Fetched { profiles: Vec::new(), matched: false, stale: stale_a });
        };
        let key = format!("emuready:profiles:{game_id}:{emulator}");
        let (body, stale_b) = cached(cache, &key, || {
            let (profiles, partial) = self.profiles(&game_id, emulator, emu_name)?;
            Ok((serde_json::to_string(&profiles).unwrap_or_else(|_| "[]".into()), if partial { TTL_PARTIAL } else { TTL_PROFILES }))
        })?;
        let profiles: Vec<Profile> = serde_json::from_str(&body).map_err(|e| ProviderError::Invalid(e.to_string()))?;
        Ok(Fetched { profiles, matched: true, stale: stale_a || stale_b })
    }
}

fn unwrap_envelope(body: &[u8]) -> Result<J, ProviderError> {
    let v: J = serde_json::from_slice(body).map_err(|_| ProviderError::Invalid("JSON illisible".into()))?;
    if let Some(msg) = v.pointer("/error/json/message").and_then(J::as_str) {
        return Err(ProviderError::Invalid(msg.chars().take(200).collect()));
    }
    v.pointer("/result/data/json").cloned().ok_or_else(|| ProviderError::Invalid("enveloppe tRPC absente".into()))
}

/// Console iBox → clé de système EmuReady (consoles ayant un adaptateur).
pub fn system_key(platform: &str) -> Option<&'static str> {
    Some(match platform {
        "gamecube" => "nintendo_gamecube",
        "wii" => "nintendo_wii",
        "ps2" => "sony_playstation_2",
        "ps1" => "sony_playstation",
        "psp" => "sony_playstation_portable",
        "ps3" => "sony_playstation_3",
        "3ds" => "nintendo_3ds",
        "switch" => "nintendo_switch",
        _ => return None,
    })
}

/// Adaptateur iBox → nom de l'émulateur chez EmuReady.
pub fn emulator_name(adapter: &str) -> Option<&'static str> {
    Some(match adapter {
        "dolphin" => "Dolphin",
        "pcsx2" => "PCSX2",
        "duckstation" => "DuckStation",
        "ppsspp" => "PPSSPP",
        "rpcs3" => "RPCS3",
        "azahar" => "Azahar",
        "retroarch" => "RetroArch",
        "eden" => "Eden",
        _ => return None,
    })
}

/// Retire les mentions entre parenthèses ou crochets (région, révision).
fn strip_tags(title: &str) -> String {
    let mut out = String::new();
    let mut depth = 0i32;
    for c in title.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Titre comparable : minuscules, sans accents, ponctuation ni mentions de région.
pub fn normalize_title(title: &str) -> String {
    let folded: String = strip_tags(title)
        .to_lowercase()
        .replace('&', " and ")
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'ö' | 'õ' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            'ñ' => 'n',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect();
    let words: Vec<&str> = folded.split_whitespace().collect();
    let words = if words.first() == Some(&"the") { &words[1..] } else { &words[..] };
    words.join(" ")
}

fn s<'a>(v: &'a J, ptr: &str) -> Option<&'a str> {
    v.pointer(ptr).and_then(J::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn short(v: Option<&str>, n: usize) -> Option<String> {
    v.map(|t| t.chars().take(n).collect())
}

fn int(v: &J, key: &str) -> i64 {
    v.get(key).and_then(J::as_i64).unwrap_or(0)
}

fn emulator_is(l: &J, name: &str) -> bool {
    s(l, "/emulator/name").is_some_and(|n| n.eq_ignore_ascii_case(name))
}

fn approved(l: &J) -> bool {
    s(l, "/status").is_none_or(|st| st == "APPROVED")
}

fn perf(l: &J) -> Option<ReportedPerformance> {
    Some(ReportedPerformance { label: short(s(l, "/performance/label"), 40)?, rank: l.pointer("/performance/rank")?.as_u64()?.min(99) as u8, scale: 8 })
}

/// Rapport EmuReady (détaillé ou non) → profil normalisé, sans données de contributeur.
pub fn normalize_listing(l: &J, emulator: &str, pc: bool) -> Profile {
    let id = short(s(l, "/id"), 64).unwrap_or_default();
    let mut fields: Vec<(String, J)> = Vec::new();
    for v in l.get("customFieldValues").and_then(J::as_array).into_iter().flatten() {
        if let (Some(name), Some(val)) = (s(v, "/customFieldDefinition/name"), v.get("value")) {
            fields.push((name.to_string(), val.clone()));
        }
    }
    let text = |name: &str| fields.iter().find(|(n, _)| n == name).and_then(|(_, v)| v.as_str()).map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(40).collect::<String>());
    let (settings, ignored) = match emulator {
        "dolphin" => dolphin_settings(&fields),
        "pcsx2" => pcsx2_settings(&fields),
        "duckstation" => duckstation_settings(&fields),
        "ppsspp" => ppsspp_settings(&fields),
        "rpcs3" => rpcs3_settings(&fields),
        "azahar" => azahar_settings(&fields),
        "retroarch" => retroarch_settings(&fields),
        "eden" => eden_settings(&fields),
        _ => (Vec::new(), Vec::new()),
    };
    let hardware = if pc {
        let cpu = [s(l, "/cpu/brand/name"), s(l, "/cpu/modelName")].into_iter().flatten().collect::<Vec<_>>().join(" ");
        let gpu = [s(l, "/gpu/brand/name"), s(l, "/gpu/modelName")].into_iter().flatten().collect::<Vec<_>>().join(" ");
        ReferenceHardware {
            os: s(l, "/os").map(str::to_lowercase),
            arch: None,
            label: Some([cpu.as_str(), gpu.as_str()].iter().filter(|t| !t.is_empty()).copied().collect::<Vec<_>>().join(" + ")).filter(|t| !t.is_empty()),
            cpu: (!cpu.is_empty()).then(|| cpu.chars().take(80).collect()),
            gpu: (!gpu.is_empty()).then(|| gpu.chars().take(80).collect()),
            handheld: false,
        }
    } else {
        let label = [s(l, "/device/brand/name"), s(l, "/device/modelName")].into_iter().flatten().collect::<Vec<_>>().join(" ");
        ReferenceHardware {
            os: None,
            arch: s(l, "/device/soc/architecture").map(|a| a.to_lowercase().replace("arm64", "aarch64")),
            label: (!label.is_empty()).then(|| label.chars().take(80).collect()),
            cpu: short(s(l, "/device/soc/name"), 80),
            gpu: short(s(l, "/device/soc/gpuModel"), 80),
            handheld: true,
        }
    };
    Profile {
        source: SourceId::EmuReady,
        source_url: (!id.is_empty()).then(|| format!("{SITE}/{}/{id}", if pc { "pc-listings" } else { "listings" })),
        source_ref: id,
        kind: if settings.is_empty() { ProfileKind::Report } else { ProfileKind::Configuration },
        emulator: emulator.into(),
        emulator_version: text("emulator_version"),
        emulator_fork: text("emulator_fork"),
        game: GameRef { title: short(s(l, "/game/title"), 120).unwrap_or_default(), system: short(s(l, "/game/system/key"), 40), serial: None },
        hardware,
        performance: perf(l),
        settings,
        ignored,
        notes: short(s(l, "/notes"), 500),
        votes_up: int(l, "upVotes").clamp(0, 1_000_000) as u32,
        votes_down: int(l, "downVotes").clamp(0, 1_000_000) as u32,
        verified_by_developer: l.get("developerVerifications").and_then(J::as_array).is_some_and(|a| !a.is_empty()),
        created_at: short(s(l, "/createdAt"), 30),
        updated_at: short(s(l, "/processedAt").or(s(l, "/updatedAt")), 30),
    }
}

/// Champs EmuReady de Dolphin → paramètres de l'adaptateur. Un champ ambigu
/// ou propre à un autre système est écarté avec sa raison, jamais deviné.
fn dolphin_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut out = Vec::new();
    let mut ignored = Vec::new();
    let mut skip = |f: &str, why: &str| ignored.push(IgnoredField { field: f.into(), reason: why.into() });
    let mut set = |k: &str, v: Value| out.push(Setting { key: format!("dolphin.{k}"), value: v });
    for (name, v) in fields {
        let txt = v.as_str().map(str::trim).unwrap_or_default();
        match name.as_str() {
            "graphics_backend" => match txt {
                "Vulkan" => set("gfx_backend", Value::Choice("vulkan".into())),
                "Direct3D 11 (PC)" => set("gfx_backend", Value::Choice("d3d11".into())),
                "Direct3D 12 (PC)" => set("gfx_backend", Value::Choice("d3d12".into())),
                "OpenGL" => set("gfx_backend", Value::Choice("opengl".into())),
                "" => {}
                _ => skip(name, "moteur de rendu propre à un autre système"),
            },
            "internal_resolution" => match v.as_i64() {
                Some(i @ 1..=8) => set("internal_resolution", Value::Int(i)),
                None if txt.is_empty() => {}
                _ => skip(name, "valeur hors de l'échelle de Dolphin"),
            },
            "enable_dual_core" => match v.as_bool() {
                Some(b) => set("cpu_thread", Value::Bool(b)),
                None => skip(name, "valeur non booléenne"),
            },
            "dsp_emulator" => match txt {
                "HLE (Fast, Default)" => set("dsp_hle", Value::Bool(true)),
                "LLE (Accurate, Slow)" => set("dsp_hle", Value::Bool(false)),
                "" => {}
                _ => skip(name, "option inconnue"),
            },
            "shader_compilation" => match txt {
                "Specialized (Default)" => set("shader_compilation", Value::Choice("specialized".into())),
                "Exclusive Ubershaders" => set("shader_compilation", Value::Choice("exclusive_ubershaders".into())),
                "Hybrid Ubershaders" => set("shader_compilation", Value::Choice("hybrid_ubershaders".into())),
                "Skip Drawing" => set("shader_compilation", Value::Choice("skip_drawing".into())),
                "" => {}
                _ => skip(name, "option inconnue"),
            },
            "anti_aliasing" => {
                let parsed = match txt {
                    "Off" => Some(("1", false)),
                    "2x MSAA" => Some(("2", false)),
                    "4x MSAA" => Some(("4", false)),
                    "8x MSAA" => Some(("8", false)),
                    "2x SSAA" => Some(("2", true)),
                    "4x SSAA" => Some(("4", true)),
                    _ => None,
                };
                match parsed {
                    Some((m, ss)) => {
                        set("msaa", Value::Choice(m.into()));
                        set("ssaa", Value::Bool(ss));
                    }
                    None if txt.is_empty() => {}
                    None => skip(name, "valeur non précise (« Other »)"),
                }
            }
            "anisotropic_filtering" => skip(name, "échelle ambiguë (multiplicateur ou exposant) : non appliqué"),
            "vsync" => match v.as_bool() {
                Some(b) => set("vsync", Value::Bool(b)),
                None => skip(name, "valeur non booléenne"),
            },
            "skip_efb_access" => match v.as_bool() {
                Some(b) => set("efb_access_enable", Value::Bool(!b)),
                None => skip(name, "valeur non booléenne"),
            },
            "ignore_format_changes" => match v.as_bool() {
                Some(b) => set("efb_emulate_format_changes", Value::Bool(!b)),
                None => skip(name, "valeur non booléenne"),
            },
            // informations, pas des réglages
            "emulator_version" | "emulator_fork" | "driver_version" | "youtube" | "media_url" | "game_version" | "average_fps" => {}
            other => skip(other, "champ inconnu d'iBox"),
        }
    }
    (out, ignored)
}

/// Champs purement informatifs communs à tous les émulateurs EmuReady.
fn informative(name: &str) -> bool {
    matches!(name, "emulator_version" | "emulator_fork" | "driver_version" | "youtube" | "media_url" | "game_version" | "average_fps")
}

/// Accumulateur commun : paramètres retenus et champs écartés avec leur raison.
struct Norm {
    prefix: &'static str,
    out: Vec<Setting>,
    ignored: Vec<IgnoredField>,
}

impl Norm {
    fn new(prefix: &'static str) -> Self {
        Self { prefix, out: Vec::new(), ignored: Vec::new() }
    }
    fn set(&mut self, k: &str, v: Value) {
        self.out.push(Setting { key: format!("{}.{k}", self.prefix), value: v });
    }
    fn choice(&mut self, k: &str, c: &str) {
        self.set(k, Value::Choice(c.into()));
    }
    fn skip(&mut self, f: &str, why: &str) {
        self.ignored.push(IgnoredField { field: f.into(), reason: why.into() });
    }
    /// Booléen strict.
    fn boolean(&mut self, name: &str, v: &J, k: &str) {
        match v.as_bool() {
            Some(b) => self.set(k, Value::Bool(b)),
            None => self.skip(name, "valeur non booléenne"),
        }
    }
    /// Entier strict dans une plage (une valeur décimale ou hors plage est écartée).
    fn int(&mut self, name: &str, v: &J, k: &str, range: std::ops::RangeInclusive<i64>) {
        match v.as_i64() {
            Some(i) if range.contains(&i) => self.set(k, Value::Int(i)),
            None if v.is_null() || v.as_str().is_some_and(|t| t.trim().is_empty()) => {}
            _ => self.skip(name, "valeur hors de l'échelle de l'émulateur"),
        }
    }
    /// Option fermée : correspondance exacte du libellé EmuReady.
    fn select(&mut self, name: &str, v: &J, k: &str, table: &[(&str, &str)]) {
        let txt = v.as_str().map(str::trim).unwrap_or_default();
        match table.iter().find(|(label, _)| *label == txt) {
            Some((_, id)) => self.choice(k, id),
            None if txt.is_empty() => {}
            None => self.skip(name, "option inconnue ou propre à un autre système"),
        }
    }
    fn done(self) -> (Vec<Setting>, Vec<IgnoredField>) {
        (self.out, self.ignored)
    }
}

/// Champs EmuReady de PCSX2 (définitions vérifiées le 2026-11-17 par
/// `customFieldDefinitions.getByEmulator`).
fn pcsx2_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("pcsx2");
    for (name, v) in fields {
        let txt = v.as_str().map(str::trim).unwrap_or_default();
        match name.as_str() {
            "renderer" => n.select(name, v, "renderer", &[("Vulkan (Fastest)", "vulkan"), ("OpenGL (Balance)", "opengl"), ("Direct3D 11 (Fallback)", "d3d11"), ("Direct3D 12 (Fallback)", "d3d12"), ("Software (Most Accurate)", "software")]),
            "internal_resolution" => n.int(name, v, "upscale_multiplier", 1..=8),
            "aspect_ratio" => n.select(name, v, "aspect_ratio", &[("Auto (4:3) Recommended", "auto"), ("Fit to Window/Fullscreen", "stretch"), ("Widescreen (16:9)", "16_9")]),
            "texture_filtering" => n.select(name, v, "texture_filtering", &[("Bilinear (PS2) Default", "bilinear_ps2"), ("Force Bilinear", "bilinear_forced"), ("Off", "nearest")]),
            "anisotropic_filtering" => n.skip(name, "échelle ambiguë (multiplicateur ou exposant) : non appliqué"),
            "anti_aliasing" => n.boolean(name, v, "fxaa"),
            "anti_blur" => n.boolean(name, v, "pcrtc_antiblur"),
            "deinterlacing" => match txt {
                "Automatic (Default)" => n.choice("deinterlacing", "automatic"),
                "" => {}
                "Weave" | "Bob" | "Blend" => n.skip(name, "variante (trame paire ou impaire) non précisée"),
                _ => n.skip(name, "option sans équivalent exact dans PCSX2"),
            },
            "ee_cyclerate" => n.int(name, v, "ee_cyclerate", -3..=3),
            // ancien nom (PCSX2 1.6) de « EE Cycle Skipping »
            "vu_cycle_stealing" => n.int(name, v, "ee_cycleskip", 0..=3),
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

/// Champs EmuReady de DuckStation.
fn duckstation_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("duckstation");
    for (name, v) in fields {
        let txt = v.as_str().map(str::trim).unwrap_or_default();
        match name.as_str() {
            "renderer" => n.select(name, v, "renderer", &[("Vulkan (Recommended)", "vulkan"), ("OpenGL", "opengl"), ("Direct3D 11 (PC)", "d3d11"), ("Direct3D 12 (PC)", "d3d12"), ("Software", "software")]),
            "internal_resolution" => n.int(name, v, "resolution_scale", 1..=16),
            "texture_filtering" => n.select(name, v, "texture_filter", &[("Nearest-Neighbor", "nearest"), ("Bilinear", "bilinear"), ("Bilinear (No Edge Blending)", "bilinear_bin_alpha"), ("JINC2 (Slow)", "jinc2"), ("xBR (Very Slow)", "xbr")]),
            "anti_aliasing" => {
                let parsed = match txt {
                    "Disabled" => Some(("1", false)),
                    t => t.strip_suffix("x MSAA").map(|m| (m, false)).or_else(|| t.strip_suffix("x SSAA").map(|m| (m, true))).filter(|(m, _)| ["2", "4", "8", "16"].contains(m)),
                };
                match parsed {
                    Some((m, ss)) => {
                        n.choice("msaa", m);
                        n.set("ssaa", Value::Bool(ss));
                    }
                    None if txt.is_empty() => {}
                    None => n.skip(name, "option inconnue"),
                }
            }
            "pgxp_geometry" => n.boolean(name, v, "pgxp"),
            "pgxp_texture" => n.boolean(name, v, "pgxp_texture_correction"),
            "widescreen_hack" => n.boolean(name, v, "widescreen_hack"),
            "cpu_overclock" => n.int(name, v, "cpu_overclock", 10..=1000),
            "gpu_overclock" => n.skip(name, "réglage sans équivalent dans DuckStation"),
            "cdrom_read_speedup" => n.int(name, v, "cdrom_read_speedup", 1..=6),
            "cdrom_seek_speedup" => n.int(name, v, "cdrom_seek_speedup", 1..=6),
            "vsync" => n.boolean(name, v, "vsync"),
            // les libellés EmuReady sont mal ordonnés, mais nomment le mode sans ambiguïté
            "recompiler" => n.select(name, v, "cpu_execution_mode", &[("Fastest (Cached Interpreter)", "cached_interpreter"), ("Fast (Recompiler)", "recompiler"), ("Accurate (Interpreter)", "interpreter")]),
            "audio_backend" => n.skip(name, "sortie audio : propre à chaque ordinateur, jamais modifiée"),
            "memory_card_type" => n.skip(name, "cartes mémoire (sauvegardes) : jamais modifiées"),
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

/// Champs EmuReady de PPSSPP.
fn ppsspp_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("ppsspp");
    for (name, v) in fields {
        let txt = v.as_str().map(str::trim).unwrap_or_default();
        match name.as_str() {
            "backend" => n.skip(name, "moteur de rendu : réglage global de PPSSPP, pas par jeu"),
            "rendering_resolution" => n.int(name, v, "internal_resolution", 0..=10),
            "software_rendering" => n.boolean(name, v, "software_rendering"),
            "msaa" => n.select(name, v, "msaa", &[("Off", "1"), ("2x MSAA", "2"), ("4x MSAA", "4"), ("8x MSAA", "8")]),
            "vsync" => n.boolean(name, v, "vsync"),
            "frame_skipping" => n.skip(name, "sens dépendant du type de saut d'images (nombre ou pourcentage) : non appliqué"),
            "texture_filtering" => n.select(name, v, "texture_filtering", &[("Auto (Default)", "auto"), ("Nearest", "nearest"), ("Linear", "linear"), ("Auto Max Quality", "auto_max_quality")]),
            "anisotropic_filtering" => n.skip(name, "échelle ambiguë (multiplicateur ou exposant) : non appliqué"),
            "texture_scaling" => {
                let ty = match txt {
                    "xBRZ (Sharp)" => Some("xbrz"),
                    "Bicubic (Smooth)" => Some("bicubic"),
                    "Hybrid" => Some("hybrid"),
                    _ => None,
                };
                match (txt, ty) {
                    ("Off", _) => n.set("texture_scaling_level", Value::Int(1)),
                    ("", _) => {}
                    (_, Some(ty)) => {
                        n.choice("texture_scaling_type", ty);
                        n.skip(name, "niveau d'agrandissement non précisé : seule la méthode est appliquée");
                    }
                    _ => n.skip(name, "option inconnue"),
                }
            }
            "lower_resolution_effects" => n.select(name, v, "lower_resolution_effects", &[("Off", "off"), ("Safe", "safe"), ("Balanced", "balanced"), ("Aggressive", "aggressive")]),
            "multithreaded" => n.skip(name, "réglage retiré des versions actuelles de PPSSPP"),
            "fast_memory" => n.boolean(name, v, "fast_memory"),
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

/// Champs EmuReady de RPCS3 (définitions relevées le 2026-11-17 par
/// `customFieldDefinitions.getByEmulator` ; valeurs des options comparées).
fn rpcs3_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("rpcs3");
    for (name, v) in fields {
        match name.as_str() {
            "renderer" => n.select(name, v, "renderer", &[("Vulkan", "vulkan"), ("OpenGL", "opengl")]),
            "resolution_scale" => n.int(name, v, "resolution_scale", 25..=800),
            // RPCS3 stocke le multiplicateur lui-même (0 = automatique)
            "anisotropic_filter" => n.select(name, v, "anisotropic_filter", &[("Automatic", "0"), ("2x", "2"), ("4x", "4"), ("8x", "8"), ("16x", "16")]),
            "anti_aliasing" => n.skip(name, "FXAA/SMAA sans équivalent dans RPCS3 (seul le MSAA existe)"),
            "vsync" => match v.as_bool() {
                Some(false) => n.choice("vsync", "off"),
                Some(true) => n.skip(name, "mode de synchronisation (adaptatif ou complet) non précisé"),
                None => n.skip(name, "valeur non booléenne"),
            },
            "frame_limit" => n.select(name, v, "frame_limit", &[("Off", "off"), ("30", "30"), ("60", "60"), ("Auto", "auto")]),
            "spu_threads" => n.int(name, v, "preferred_spu_threads", 0..=6),
            "spu_block_size" => n.select(name, v, "spu_block_size", &[("Safe", "safe"), ("Mega", "mega"), ("Giga", "giga")]),
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

/// Champs EmuReady d'Azahar (surtout des rapports Android).
fn azahar_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("azahar");
    for (name, v) in fields {
        let txt = v.as_str().map(str::trim).unwrap_or_default();
        match name.as_str() {
            "graphics_api" => match txt {
                "Vulkan" => n.choice("graphics_api", "vulkan"),
                "Software" => n.choice("graphics_api", "software"),
                "OpenGLES" => n.skip(name, "OpenGL ES : propre à Android"),
                "" => {}
                _ => n.skip(name, "option inconnue"),
            },
            "internal_resolution" => match txt {
                "auto" | "Auto (Screen Size)" => n.set("resolution_factor", Value::Int(0)),
                "native" | "Native (400x240)" => n.set("resolution_factor", Value::Int(1)),
                "" => {}
                t => match t.split('x').next().and_then(|m| m.parse::<i64>().ok()).filter(|m| (2..=10).contains(m) && (t == m.to_string() || t.starts_with(&format!("{m}x Native")))) {
                    Some(m) => n.set("resolution_factor", Value::Int(m)),
                    None => n.skip(name, "option inconnue"),
                },
            },
            "texture_filter" => n.select(name, v, "texture_filter", &[("None", "none"), ("Anime4K", "anime4k"), ("Bicubic", "bicubic"), ("ScaleForce", "scaleforce"), ("xBRZ", "xbrz"), ("MMPX", "mmpx")]),
            "linear_filtering" => n.boolean(name, v, "linear_filtering"),
            "accurate_multiplication" => n.boolean(name, v, "accurate_mul"),
            "disk_shader_cache" => n.boolean(name, v, "disk_shader_cache"),
            "enable_spiri_v_shader_generation" => n.boolean(name, v, "spirv_shader_gen"),
            "disable_spir_v_optimizer" => n.boolean(name, v, "disable_spirv_optimizer"),
            "enable_async_shader_compilation" => n.boolean(name, v, "async_shader_compilation"),
            "enable_hardware_shader" => n.boolean(name, v, "hw_shader"),
            "enable_vsync" => n.boolean(name, v, "vsync"),
            "cpu_jit" | "delay_start_with_lle_modules" => n.skip(name, "réglage global d'Azahar, pas par jeu"),
            "delay_game_render_thread" => n.skip(name, "unité non précisée (microsecondes ou autre) : non appliqué"),
            "stereoscopic_3d_mode" => n.skip(name, "affichage 3D : dépend de l'écran de chacun"),
            "dynamic_driver_version" => {}
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

/// Champs EmuReady d'Eden (vérifiés le 2026-11-17 par `customFieldDefinitions.getByEmulator`).
/// Correspondances avec les énumérations d'Eden (`settings_enums.h`) ; les champs
/// propres à Android (pilotes Turnip, moteur audio oboe…) ou sans équivalent
/// vérifié dans Eden sont écartés avec leur raison.
fn eden_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("eden");
    for (name, v) in fields {
        match name.as_str() {
            "gpu_api" => n.select(name, v, "backend", &[("Vulkan", "vulkan"), ("OpenGL", "opengl")]),
            "resolution" => n.select(name, v, "resolution", &[("0.25", "0.25"), ("0.5", "0.5"), ("0.75", "0.75"), ("1", "1"), ("1.5", "1.5"), ("2", "2"), ("3", "3"), ("4", "4")]),
            "vsync_mode" => n.select(name, v, "vsync", &[("Immediate (Off)", "immediate"), ("Mailbox", "mailbox"), ("FIFO (On)", "fifo"), ("FIFO Relaxed", "fifo_relaxed")]),
            "anti_aliasing_method" => n.select(name, v, "anti_aliasing", &[("None", "none"), ("FXAA", "fxaa"), ("SMAA", "smaa")]),
            // « NVIDIA » n'a pas d'équivalent unique dans Eden : écarté
            "window_adapting_filter" => n.select(name, v, "scaling_filter", &[("Nearest Neighbor", "nearest"), ("Bilinear", "bilinear"), ("Bicubic", "bicubic"), ("Gaussian", "gaussian"), ("ScaleForce", "scaleforce"), ("AMD FidelityFX - Super Resolution", "fsr")]),
            "anisotropic_filtering" => n.select(name, v, "anisotropy", &[("Auto", "auto"), ("Default", "default"), ("2x", "2x"), ("4x", "4x"), ("8x", "8x"), ("16x", "16x")]),
            "disk_shader_cache" => n.boolean(name, v, "disk_shader_cache"),
            "use_async_shaders" => n.boolean(name, v, "async_shaders"),
            "use_reactive_flushing" => n.boolean(name, v, "reactive_flushing"),
            "vram_usage_mode" => n.select(name, v, "vram_usage", &[("Conservative", "conservative"), ("Aggressive", "aggressive")]),
            "nvdec_emulation" => n.select(name, v, "nvdec", &[("None", "off"), ("CPU", "cpu"), ("GPU", "gpu")]),
            "astc_recompression_method" => n.select(name, v, "astc_recompression", &[("Uncompressed", "uncompressed"), ("BC1 (Low Quality)", "bc1"), ("BC3 (Medium Quality)", "bc3")]),
            "extended_dynamic_state" => match v.as_i64() {
                Some(i @ 0..=3) => n.choice("dyna_state", crate::smartconfig::adapters::eden::DYNA_STATE[i as usize]),
                None if v.is_null() || v.as_str().is_some_and(|s| s.trim().is_empty()) => {}
                _ => n.skip(name, "valeur hors de l'échelle d'Eden"),
            },
            "cpu_accuracy" => n.select(name, v, "cpu_accuracy", &[("Auto", "auto"), ("Accurate", "accurate"), ("Unsafe", "unsafe"), ("Paranoid (Slow)", "paranoid")]),
            "cpu_backend" => n.select(name, v, "cpu_backend", &[("Dynamic (Slow)", "dynarmic"), ("Native code execution (NCE)", "nce")]),
            "limit_speed" => n.boolean(name, v, "speed_limit"),
            "synchronize_core_speed" => n.boolean(name, v, "sync_core_speed"),
            "docked_mode" => match v.as_bool() {
                Some(b) => n.choice("console_mode", if b { "docked" } else { "handheld" }),
                None => n.skip(name, "valeur non booléenne"),
            },
            "accuracy_level" => n.skip(name, "niveaux EmuReady (Normal/High/Extreme) différents de ceux d'Eden (Low/High) : non appliqué"),
            "fast_cpu_time" | "use_fast_gpu_time" => n.skip(name, "réglage à plusieurs niveaux dans Eden, booléen chez EmuReady : non appliqué"),
            "enhanced_frame_pacing" => n.skip(name, "mode de cadence à plusieurs valeurs dans Eden : non appliqué"),
            "provoking_vertex" | "descriptor_indexing" | "enable_lru_cache" | "optimize_spirv_output" => n.skip(name, "pas d'équivalent vérifié dans Eden pour Windows"),
            "audio_output_engine" => n.skip(name, "sortie audio : propre à chaque appareil"),
            "dynamic_driver_version" => {}
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

/// Champs EmuReady de RetroArch (réglages de l'interface, communs aux cœurs ;
/// le cœur du rapport, texte libre, n'est pas comparé).
fn retroarch_settings(fields: &[(String, J)]) -> (Vec<Setting>, Vec<IgnoredField>) {
    let mut n = Norm::new("retroarch");
    for (name, v) in fields {
        match name.as_str() {
            "video_driver" => n.select(name, v, "video_driver", &[("Vulkan", "vulkan"), ("OpenGL", "opengl"), ("Direct3D 11", "d3d11"), ("Direct3D 12", "d3d12")]),
            "vsync" => n.boolean(name, v, "vsync"),
            "hard_gpu_sync" => n.boolean(name, v, "hard_sync"),
            "gpu_sync_frames" => n.int(name, v, "hard_sync_frames", 0..=3),
            "frame_delay" => n.int(name, v, "frame_delay", 0..=15),
            "rewind" => n.boolean(name, v, "rewind"),
            "run_ahead" => n.skip(name, "dépend du cœur, qui peut différer de celui du rapport"),
            "video_scale" => n.skip(name, "taille de fenêtre : propre à chaque écran"),
            "core" => {}
            other if informative(other) => {}
            other => n.skip(other, "champ inconnu d'iBox"),
        }
    }
    n.done()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::smartconfig::providers::memory::MemCache;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const SEARCH: &str = include_str!("../fixtures/emuready_search.json");
    const BY_GAME: &str = include_str!("../fixtures/emuready_by_game.json");
    const BY_ID: &str = include_str!("../fixtures/emuready_by_id.json");
    const PC: &str = include_str!("../fixtures/emuready_pc.json");

    /// Serveur simulé : répond selon la procédure, ou panne / quota.
    struct Fake {
        calls: Arc<AtomicUsize>,
        mode: &'static str,
    }

    impl Transport for Fake {
        fn get(&self, url: &str) -> Result<Response, String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            assert!(url.starts_with(BASE) && url.contains("?input=%7B%22json%22%3A"));
            let ok = |b: &str| Ok(Response { status: 200, retry_after: None, body: b.as_bytes().to_vec() });
            match self.mode {
                "offline" => Err("dns".into()),
                "429" => Ok(Response { status: 429, retry_after: Some(42), body: Vec::new() }),
                "500" => Ok(Response { status: 503, retry_after: None, body: Vec::new() }),
                _ if url.contains("games.searchGames") => ok(SEARCH),
                _ if url.contains("listings.byGame") => ok(BY_GAME),
                // détail d'un rapport PC : ici, le premier rapport de la liste PC
                _ if url.contains("pcListings.byId") => {
                    let pc: J = serde_json::from_str(PC).unwrap();
                    Ok(Response { status: 200, retry_after: None, body: json!({ "result": { "data": { "json": pc["result"]["data"]["json"]["listings"][0] } } }).to_string().into_bytes() })
                }
                _ if url.contains("listings.byId") => ok(BY_ID),
                // forme réelle de `games.findSwitchTitleId` (2026-11-17), un homonyme ajouté
                _ if url.contains("games.findSwitchTitleId") => ok(r#"{"result":{"data":{"json":{"success":true,"results":[
                    {"titleId":"0100F2C0115B6000","name":"The Legend of Zelda™: Tears of the Kingdom","normalizedTitle":"The Legend of Zelda: Tears of the Kingdom","score":100},
                    {"titleId":"01009AB00BDFE000","name":"The Stillness of the Wind","normalizedTitle":"The Stillness of the Wind","score":47},
                    {"titleId":"0100AAAA00000000","name":"Mario Kart 8 Deluxe","normalizedTitle":"Mario Kart 8 Deluxe","score":100},
                    {"titleId":"0100BBBB00000000","name":"Mario Kart 8 Deluxe","normalizedTitle":"Mario Kart 8 Deluxe","score":100}]}}}}"#),
                _ if url.contains("pcListings.get") => ok(PC),
                _ => Ok(Response { status: 404, retry_after: None, body: Vec::new() }),
            }
        }
    }

    fn client(mode: &'static str, budget: usize) -> (EmuReady, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        (EmuReady::for_tests(Box::new(Fake { calls: calls.clone(), mode }), budget), calls)
    }

    fn sunshine() -> GameQuery {
        GameQuery { game_id: 1, platform: "gamecube".into(), title: "Super Mario Sunshine (USA)".into(), serial: Some("GMSE01".into()), region: None, id_confidence: 1.0 }
    }

    #[test]
    fn titres_normalises() {
        assert_eq!(normalize_title("The Legend of Zelda: Wind Waker (Europe) [!]"), "legend of zelda wind waker");
        assert_eq!(normalize_title("Pokémon Colosseum"), "pokemon colosseum");
        assert_eq!(normalize_title("Ratchet & Clank"), "ratchet and clank");
    }

    /// Rapport réel d'Eden pour Tears of the Kingdom (Galaxy S25 Ultra, Android) :
    /// réglages transposables gardés, champs Android ou ambigus écartés avec raison.
    #[test]
    fn rapport_eden_reel() {
        let detail = unwrap_envelope(include_str!("../fixtures/emuready_eden_by_id.json").as_bytes()).unwrap();
        let p = normalize_listing(&detail, "eden", false);
        assert_eq!(p.kind, ProfileKind::Configuration);
        assert_eq!(p.game.title, "The Legend of Zelda: Tears of the Kingdom");
        let has = |k: &str, c: &str| p.settings.contains(&Setting { key: k.into(), value: Value::Choice(c.into()) });
        assert!(has("eden.backend", "vulkan"));
        assert!(has("eden.resolution", "1"));
        assert!(has("eden.vsync", "immediate"));
        assert!(has("eden.anisotropy", "16x"));
        assert!(has("eden.console_mode", "handheld"));
        assert!(has("eden.dyna_state", "disabled"));
        assert!(has("eden.cpu_backend", "nce")); // gardé ici, refusé ensuite sur PC x86 par la validation
        assert!(p.settings.contains(&Setting { key: "eden.async_shaders".into(), value: Value::Bool(true) }));
        for f in ["accuracy_level", "provoking_vertex", "audio_output_engine", "enhanced_frame_pacing"] {
            assert!(p.ignored.iter().any(|i| i.field == f), "{f} devrait être écarté");
        }
        let hw = crate::smartconfig::hardware::HardwareInfo { os: crate::smartconfig::hardware::OsInfo { family: "windows".into(), version: None, arch: "x86_64".into() }, ..Default::default() };
        use crate::smartconfig::adapters::Adapter;
        let v = crate::smartconfig::validation::validate(&p.settings, crate::smartconfig::adapters::eden::Eden.specs(), &hw);
        assert!(v.rejected.iter().any(|r| r.key == "eden.cpu_backend"));
        assert!(v.rejected.iter().any(|r| r.key == "eden.backend")); // Vulkan non vérifié sur ce matériel fictif
    }

    #[test]
    fn rapport_reel_normalise_sans_contributeur() {
        let detail = unwrap_envelope(BY_ID.as_bytes()).unwrap();
        let p = normalize_listing(&detail, "dolphin", false);
        assert_eq!(p.kind, ProfileKind::Configuration);
        assert_eq!(p.emulator_fork.as_deref(), Some("MMJR2"));
        assert_eq!(p.performance.as_ref().map(|x| x.rank), Some(2));
        assert_eq!(p.hardware.arch.as_deref(), Some("aarch64"));
        assert!(p.hardware.handheld);
        let has = |k: &str, v: Value| p.settings.contains(&Setting { key: k.into(), value: v });
        assert!(has("dolphin.gfx_backend", Value::Choice("vulkan".into())));
        assert!(has("dolphin.internal_resolution", Value::Int(1)));
        assert!(has("dolphin.efb_access_enable", Value::Bool(false)));
        assert!(has("dolphin.msaa", Value::Choice("1".into())));
        assert!(p.ignored.iter().any(|i| i.field == "anisotropic_filtering"));
        let json = serde_json::to_string(&p).unwrap();
        assert!(!json.contains("author") && !json.contains("trustScore"));
        assert_eq!(p.source_url.as_deref(), Some("https://www.emuready.com/listings/3ea34cd9-6193-40f0-9f1e-30259ca5cad6"));
    }

    #[test]
    fn valeurs_malveillantes_ecartees() {
        let fields = vec![
            ("graphics_backend".to_string(), json!("Vulkan\r\n[Core]\r\nGFXBackend = x")),
            ("internal_resolution".to_string(), json!(4096)),
            ("vsync".to_string(), json!("true; rm -rf")),
            ("save_path".to_string(), json!("..\\..\\Windows")),
        ];
        let (settings, ignored) = dolphin_settings(&fields);
        assert!(settings.is_empty());
        assert_eq!(ignored.len(), 4);
    }

    fn f(pairs: &[(&str, J)]) -> Vec<(String, J)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
    }

    fn has(s: &[Setting], k: &str, v: Value) -> bool {
        s.contains(&Setting { key: k.into(), value: v })
    }

    #[test]
    fn normalisation_pcsx2() {
        let (s, ig) = pcsx2_settings(&f(&[
            ("renderer", json!("Vulkan (Fastest)")),
            ("internal_resolution", json!(3)),
            ("aspect_ratio", json!("Widescreen (16:9)")),
            ("texture_filtering", json!("Off")),
            ("anisotropic_filtering", json!(16)),
            ("anti_aliasing", json!(true)),
            ("anti_blur", json!(false)),
            ("deinterlacing", json!("Bob")),
            ("ee_cyclerate", json!(-1)),
            ("vu_cycle_stealing", json!(7)),
            ("average_fps", json!("60")),
        ]));
        assert!(has(&s, "pcsx2.renderer", Value::Choice("vulkan".into())));
        assert!(has(&s, "pcsx2.upscale_multiplier", Value::Int(3)));
        assert!(has(&s, "pcsx2.aspect_ratio", Value::Choice("16_9".into())));
        assert!(has(&s, "pcsx2.texture_filtering", Value::Choice("nearest".into())));
        assert!(has(&s, "pcsx2.fxaa", Value::Bool(true)));
        assert!(has(&s, "pcsx2.pcrtc_antiblur", Value::Bool(false)));
        assert!(has(&s, "pcsx2.ee_cyclerate", Value::Int(-1)));
        assert_eq!(s.len(), 7);
        let skipped: Vec<&str> = ig.iter().map(|i| i.field.as_str()).collect();
        assert_eq!(skipped, ["anisotropic_filtering", "deinterlacing", "vu_cycle_stealing"]);
        // valeurs malveillantes ou décimales
        let (s, ig) = pcsx2_settings(&f(&[("renderer", json!("Vulkan (Fastest)\n[Folders]")), ("internal_resolution", json!(1.5)), ("anti_blur", json!("true")), ("bios", json!("C:\\bios"))]));
        assert!(s.is_empty());
        assert_eq!(ig.len(), 4);
    }

    #[test]
    fn normalisation_duckstation_et_ppsspp() {
        let (s, ig) = duckstation_settings(&f(&[
            ("renderer", json!("Direct3D 12 (PC)")),
            ("internal_resolution", json!(4)),
            ("anti_aliasing", json!("4x SSAA")),
            ("texture_filtering", json!("Bilinear (No Edge Blending)")),
            ("pgxp_geometry", json!(true)),
            ("cpu_overclock", json!(200)),
            ("cdrom_read_speedup", json!(0)),
            ("recompiler", json!("Fast (Recompiler)")),
            ("memory_card_type", json!("Per Game")),
            ("audio_backend", json!("Cubeb")),
            ("gpu_overclock", json!(150)),
        ]));
        assert!(has(&s, "duckstation.renderer", Value::Choice("d3d12".into())));
        assert!(has(&s, "duckstation.msaa", Value::Choice("4".into())));
        assert!(has(&s, "duckstation.ssaa", Value::Bool(true)));
        assert!(has(&s, "duckstation.texture_filter", Value::Choice("bilinear_bin_alpha".into())));
        assert!(has(&s, "duckstation.cpu_execution_mode", Value::Choice("recompiler".into())));
        assert!(has(&s, "duckstation.cpu_overclock", Value::Int(200)));
        assert_eq!(s.len(), 8);
        assert_eq!(ig.len(), 4);
        let (s, ig) = ppsspp_settings(&f(&[
            ("backend", json!("Vulkan (Recommended)")),
            ("rendering_resolution", json!(0)),
            ("msaa", json!("2x MSAA")),
            ("texture_scaling", json!("xBRZ (Sharp)")),
            ("lower_resolution_effects", json!("Safe")),
            ("frame_skipping", json!(2)),
            ("multithreaded", json!(true)),
            ("fast_memory", json!(true)),
        ]));
        assert!(has(&s, "ppsspp.internal_resolution", Value::Int(0)));
        assert!(has(&s, "ppsspp.msaa", Value::Choice("2".into())));
        assert!(has(&s, "ppsspp.texture_scaling_type", Value::Choice("xbrz".into())));
        assert!(has(&s, "ppsspp.lower_resolution_effects", Value::Choice("safe".into())));
        assert!(has(&s, "ppsspp.fast_memory", Value::Bool(true)));
        assert_eq!(s.len(), 5);
        assert_eq!(ig.len(), 4);
        // chaque paramètre produit passe la liste blanche de son adaptateur
        for (adapter, list) in [("pcsx2", pcsx2_settings(&f(&[("renderer", json!("Software (Most Accurate)"))])).0), ("ppsspp", s)] {
            let a = crate::smartconfig::adapters::by_id(adapter).unwrap();
            let v = crate::smartconfig::validation::validate(&list, a.specs(), &crate::smartconfig::hardware::HardwareInfo::default());
            assert_eq!(v.accepted.len(), list.len(), "{adapter}: {:?}", v.rejected);
        }
        assert_eq!(system_key("ps1"), Some("sony_playstation"));
        assert_eq!(emulator_name("ppsspp"), Some("PPSSPP"));
    }

    #[test]
    fn normalisation_rpcs3_azahar_retroarch() {
        let (s, ig) = rpcs3_settings(&f(&[
            ("renderer", json!("Vulkan")),
            ("resolution_scale", json!(150)),
            ("anisotropic_filter", json!("16x")),
            ("anti_aliasing", json!("FXAA")),
            ("vsync", json!(true)),
            ("frame_limit", json!("Auto")),
            ("spu_threads", json!(2)),
            ("spu_block_size", json!("Mega\nCore:")),
        ]));
        assert!(has(&s, "rpcs3.renderer", Value::Choice("vulkan".into())));
        assert!(has(&s, "rpcs3.resolution_scale", Value::Int(150)));
        assert!(has(&s, "rpcs3.anisotropic_filter", Value::Choice("16".into())));
        assert!(has(&s, "rpcs3.frame_limit", Value::Choice("auto".into())));
        assert!(has(&s, "rpcs3.preferred_spu_threads", Value::Int(2)));
        assert_eq!(s.len(), 5);
        assert_eq!(ig.iter().map(|i| i.field.as_str()).collect::<Vec<_>>(), ["anti_aliasing", "vsync", "spu_block_size"]);
        assert!(has(&rpcs3_settings(&f(&[("vsync", json!(false))])).0, "rpcs3.vsync", Value::Choice("off".into())));

        let (s2, ig2) = azahar_settings(&f(&[
            ("graphics_api", json!("OpenGLES")),
            ("internal_resolution", json!("3")),
            ("texture_filter", json!("xBRZ")),
            ("enable_hardware_shader", json!(true)),
            ("accurate_multiplication", json!(false)),
            ("cpu_jit", json!(true)),
            ("delay_game_render_thread", json!(50)),
            ("dynamic_driver_version", json!("Turnip")),
        ]));
        assert!(has(&s2, "azahar.resolution_factor", Value::Int(3)));
        assert!(has(&s2, "azahar.texture_filter", Value::Choice("xbrz".into())));
        assert!(has(&s2, "azahar.hw_shader", Value::Bool(true)));
        assert!(has(&s2, "azahar.accurate_mul", Value::Bool(false)));
        assert_eq!(s2.len(), 4);
        assert_eq!(ig2.len(), 3);
        for (txt, want) in [("auto", Some(0)), ("native", Some(1)), ("10x Native (4000x2400)", Some(10)), ("11", None), ("3x", None), ("2.5", None)] {
            let got = azahar_settings(&f(&[("internal_resolution", json!(txt))])).0.first().map(|s| s.value.clone());
            assert_eq!(got, want.map(Value::Int), "{txt}");
        }

        let (s3, ig3) = retroarch_settings(&f(&[
            ("core", json!("Genesis Plus GX")),
            ("video_driver", json!("Direct3D 11")),
            ("vsync", json!(true)),
            ("frame_delay", json!(30)),
            ("gpu_sync_frames", json!(1)),
            ("run_ahead", json!(2)),
            ("video_scale", json!(3)),
            ("rewind", json!(false)),
        ]));
        assert!(has(&s3, "retroarch.video_driver", Value::Choice("d3d11".into())));
        assert!(has(&s3, "retroarch.hard_sync_frames", Value::Int(1)));
        assert_eq!(s3.len(), 4);
        assert_eq!(ig3.len(), 3);

        // chaque paramètre produit passe la liste blanche de son adaptateur
        let mut hw = crate::smartconfig::hardware::HardwareInfo::default();
        hw.apis.vulkan_loader = Some(true);
        hw.apis.d3d11 = Some(true);
        for (adapter, list) in [("rpcs3", s), ("azahar", s2), ("retroarch", s3)] {
            let a = crate::smartconfig::adapters::by_id(adapter).unwrap();
            let v = crate::smartconfig::validation::validate(&list, a.specs(), &hw);
            assert_eq!(v.accepted.len(), list.len(), "{adapter}: {:?}", v.rejected);
        }
        assert_eq!(system_key("ps3"), Some("sony_playstation_3"));
        assert_eq!(system_key("3ds"), Some("nintendo_3ds"));
        assert_eq!(emulator_name("azahar"), Some("Azahar"));
    }

    /// Rapport PC réel d'Eden (Ryzen 7 5700X + RTX 5060, Windows) : réglages lus dans `pcListings.byId`.
    #[test]
    fn rapport_pc_eden_reel() {
        let detail = unwrap_envelope(include_str!("../fixtures/emuready_eden_pc_by_id.json").as_bytes()).unwrap();
        let p = normalize_listing(&detail, "eden", true);
        assert_eq!(p.kind, ProfileKind::Configuration);
        assert_eq!(p.hardware.os.as_deref(), Some("windows"));
        assert!(p.hardware.gpu.as_deref().is_some_and(|g| g.contains("RTX 5060")));
        assert_eq!(p.emulator_version.as_deref(), Some("v0.2.1"));
        assert!(p.settings.contains(&Setting { key: "eden.vsync".into(), value: Value::Choice("fifo".into()) }));
        assert!(p.settings.contains(&Setting { key: "eden.resolution".into(), value: Value::Choice("1".into()) }));
        assert_eq!(p.source_url.as_deref().map(|u| u.contains("/pc-listings/")), Some(true));
    }

    #[test]
    fn identifiant_de_titre_switch_seulement_si_univoque() {
        let (er, _) = client("ok", 30);
        assert_eq!(er.switch_title_id("The Legend of Zelda - Tears of the Kingdom (Europe)").unwrap().as_deref(), Some("0100F2C0115B6000"));
        // deux identifiants pour le même titre : on s'abstient
        assert_eq!(er.switch_title_id("Mario Kart 8 Deluxe").unwrap(), None);
        // aucun titre identique (le score seul ne suffit pas)
        assert_eq!(er.switch_title_id("Tears").unwrap(), None);
    }

    #[test]
    fn recherche_complete_puis_cache() {
        let (er, calls) = client("ok", 30);
        let cache = MemCache::default();
        let f = er.fetch(&sunshine(), "dolphin", &cache).unwrap();
        assert!(f.matched && !f.stale);
        // 1 recherche + 1 byGame + 4 détails « appareil » + 1 liste PC + 2 détails PC (2 rapports Dolphin)
        assert_eq!(calls.load(Ordering::SeqCst), 9);
        assert_eq!(f.profiles.iter().filter(|p| p.kind == ProfileKind::Configuration).count(), 4);
        // les rapports PC détaillés sont bien lus (Windows d'abord)
        assert_eq!(f.profiles.iter().filter(|p| p.hardware.os.as_deref() == Some("windows")).count(), 2);
        // second appel : aucun réseau
        er.fetch(&sunshine(), "dolphin", &cache).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 9);
    }

    #[test]
    fn hors_ligne_quota_et_pannes() {
        let cache = MemCache::default();
        let (er, _) = client("offline", 30);
        assert_eq!(er.fetch(&sunshine(), "dolphin", &cache), Err(ProviderError::Offline("EmuReady".into())));
        // cache expiré servi hors ligne
        let (ok, _) = client("ok", 30);
        ok.fetch(&sunshine(), "dolphin", &cache).unwrap();
        for v in cache.0.borrow_mut().values_mut() {
            v.1 = false;
        }
        let f = er.fetch(&sunshine(), "dolphin", &cache).unwrap();
        assert!(f.stale && !f.profiles.is_empty());
        // 429 : temporisation imposée, plus aucun appel pendant ce temps
        let (limited, calls) = client("429", 30);
        assert_eq!(limited.call("games.searchGames", json!({"query": "x"})), Err(ProviderError::RateLimited { retry_after_s: 42 }));
        assert!(matches!(limited.call("games.searchGames", json!({"query": "x"})), Err(ProviderError::RateLimited { .. })));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        // 5xx : trois essais puis erreur
        let (down, calls) = client("500", 30);
        assert_eq!(down.call("games.searchGames", json!({"query": "x"})), Err(ProviderError::Http { status: 503 }));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        // budget local épuisé
        let (tight, _) = client("ok", 1);
        tight.call("games.searchGames", json!({"query": "x"})).unwrap();
        assert!(matches!(tight.call("games.searchGames", json!({"query": "x"})), Err(ProviderError::RateLimited { .. })));
    }

    #[test]
    fn console_ou_emulateur_non_couverts() {
        let (er, calls) = client("ok", 30);
        let f = er.fetch(&GameQuery { platform: "snes".into(), ..sunshine() }, "dolphin", &MemCache::default()).unwrap();
        assert!(!f.matched);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        // titre inconnu chez EmuReady
        let f = er.fetch(&GameQuery { title: "Jeu Inexistant".into(), ..sunshine() }, "dolphin", &MemCache::default()).unwrap();
        assert!(!f.matched && f.profiles.is_empty());
    }

    /// Appel réel (réseau) : `cargo test --lib emuready_reel -- --ignored`.
    #[test]
    #[ignore]
    fn emuready_reel() {
        let er = EmuReady::new(Box::new(HttpTransport::new().unwrap()));
        let f = er.fetch(&sunshine(), "dolphin", &MemCache::default()).unwrap();
        assert!(f.matched);
        eprintln!("{} profils, dont {} configurations", f.profiles.len(), f.profiles.iter().filter(|p| p.kind == ProfileKind::Configuration).count());
    }

    /// Appel réel : Tears of the Kingdom sous Eden. `cargo test --lib emuready_eden_reel -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn emuready_eden_reel() {
        let er = EmuReady::new(Box::new(HttpTransport::new().unwrap()));
        let totk = GameQuery { game_id: 1, platform: "switch".into(), title: "The Legend of Zelda: Tears of the Kingdom".into(), serial: Some("0100F2C0115B6000".into()), region: None, id_confidence: 1.0 };
        let f = er.fetch(&totk, "eden", &MemCache::default()).unwrap();
        assert!(f.matched);
        let configs: Vec<_> = f.profiles.iter().filter(|p| p.kind == ProfileKind::Configuration).collect();
        eprintln!("{} profils, dont {} configurations", f.profiles.len(), configs.len());
        for p in configs {
            eprintln!("  {} · {} · {} réglages, {} écartés", p.hardware.label.as_deref().unwrap_or("?"), p.performance.as_ref().map(|x| x.label.as_str()).unwrap_or("?"), p.settings.len(), p.ignored.len());
        }
        // classement avec le matériel réel de cette machine
        let hw = crate::smartconfig::hardware::detect();
        let ctx = crate::smartconfig::recommend::Context { game: &totk, game_match: crate::smartconfig::recommend::GameMatch::Title, hw: &hw, emulator_version: Some("0.2.1"), preferred: Mode::Balanced, today: "2026-11-17", local: &[] };
        let out = crate::smartconfig::recommend::recommend(&crate::smartconfig::adapters::eden::Eden, &f.profiles, &ctx);
        for (i, r) in out.recommendations.iter().enumerate() {
            eprintln!("  #{i} {:?} score {} mode {:?} · {} · {} acceptés / {} refusés", r.kind, r.score, r.mode, r.profile.hardware.label.as_deref().unwrap_or("?"), r.validated.accepted.len(), r.validated.rejected.len());
        }
        eprintln!("  conseillée : {:?}", out.suggested);
    }
}
