//! Commandes Tauri de SmartConfig. Le réseau et la détection matérielle
//! tournent hors du fil principal (`spawn_blocking`) ; la base n'est jamais
//! verrouillée pendant un appel réseau.

use super::adapters::{self, Install, Plan};
use super::backup::{self, Entry};
use super::hardware::{self, HardwareClass, HardwareInfo};
use super::model::{GameQuery, Mode, Profile, SourceId};
use super::providers::emuready::{EmuReady, HttpTransport};
use super::providers::verified::Verified;
use super::providers::{Cache, Fetched, Provider, ProviderError, ProviderInfo};
use super::recommend::{self, Context, GameMatch, Outcome};
use super::storage;
use crate::library::commands::LibraryState;
use crate::library::LibraryError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

type Res<T> = Result<T, String>;

#[derive(Default)]
pub struct SmartConfigState {
    hardware: Mutex<Option<HardwareInfo>>,
    emuready: OnceLock<Result<EmuReady, String>>,
}

impl SmartConfigState {
    fn emuready(&self) -> Result<&EmuReady, String> {
        self.emuready.get_or_init(|| HttpTransport::new().map(|t| EmuReady::new(Box::new(t)))).as_ref().map_err(|e| e.clone())
    }
}

fn err(e: impl ToString) -> LibraryError {
    LibraryError::Media(e.to_string())
}

/// Cache SQLite : verrou de la base pris le temps d'une lecture ou écriture.
struct DbCache<'a>(&'a LibraryState);

impl Cache for DbCache<'_> {
    fn get(&self, key: &str) -> Option<(String, bool)> {
        self.0.with(|c| Ok(storage::cache_get(c, key)?)).ok().flatten().map(|h| (h.body, h.fresh))
    }
    fn put(&self, key: &str, body: &str, ttl: i64) {
        let _ = self.0.with(|c| Ok(storage::cache_put(c, key, body, ttl)?));
    }
}

fn backups_dir(app: &AppHandle) -> Res<PathBuf> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("smartconfig").join("backups"))
}

fn hardware_of(app: &AppHandle) -> HardwareInfo {
    let state = app.state::<SmartConfigState>();
    let mut cached = state.hardware.lock().unwrap_or_else(|e| e.into_inner());
    cached.get_or_insert_with(|| detect(app)).clone()
}

#[cfg(not(target_os = "android"))]
fn detect(_app: &AppHandle) -> HardwareInfo {
    hardware::detect()
}

/// Android : relevé des propriétés système. Builds de débogage : un relevé simulé
/// `smartconfig-device.txt` dans les données d'iBox le remplace (essais dans l'émulateur du PC).
#[cfg(target_os = "android")]
fn detect(app: &AppHandle) -> HardwareInfo {
    let sim = if cfg!(debug_assertions) { app.path().app_data_dir().ok().and_then(|d| std::fs::read_to_string(d.join("smartconfig-device.txt")).ok()) } else { None };
    hardware::android::detect(sim.as_deref())
}

/// Émulateur du jeu et adaptateur SmartConfig. Bureau : émulateur enregistré dans iBox.
/// Android : celui que le lanceur choisira (`android::resolve`) ; `install` sans adaptateur =
/// émulateur installé mais non couvert.
#[cfg(not(target_os = "android"))]
fn emulator_of(_app: &AppHandle, _game: &GameQuery, install: Option<Install>) -> Res<(Option<Install>, Option<Box<dyn adapters::Adapter>>)> {
    let adapter = install.as_ref().and_then(|i| adapters::by_id(&i.profile_id));
    Ok((install, adapter))
}

#[cfg(target_os = "android")]
fn emulator_of(app: &AppHandle, game: &GameQuery, _install: Option<Install>) -> Res<(Option<Install>, Option<Box<dyn adapters::Adapter>>)> {
    Ok(match super::android::resolve(app, &game.platform)? {
        None => (None, None),
        Some(None) => (Some(Install { profile_id: "android".into(), exe: PathBuf::new(), version: None, core: None }), None),
        Some(Some(l)) => {
            let install = Install { profile_id: l.emulator.id.into(), exe: PathBuf::from(&l.package), version: None, core: l.core.clone() };
            (Some(install), Some(super::android::adapter(&l)))
        }
    })
}

/// Un programme de l'émulateur est-il ouvert ? Android : iBox ne voit pas les autres
/// applications (seul compte le jeu lancé par iBox, vérifié à part).
fn emulator_open(install: &Install) -> bool {
    #[cfg(target_os = "android")]
    {
        let _ = install;
        false
    }
    #[cfg(not(target_os = "android"))]
    {
        install.exe.parent().is_some_and(crate::emulators::install::running_inside)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareReport {
    pub info: HardwareInfo,
    pub class: HardwareClass,
}

#[tauri::command]
pub async fn smartconfig_hardware(app: AppHandle, refresh: Option<bool>) -> Res<HardwareReport> {
    tauri::async_runtime::spawn_blocking(move || {
        if refresh == Some(true) {
            *app.state::<SmartConfigState>().hardware.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
        let info = hardware_of(&app);
        HardwareReport { class: hardware::classify(&info), info }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn smartconfig_providers() -> Vec<ProviderInfo> {
    super::providers::infos()
}

/// État SmartConfig d'un jeu (fiche du jeu) : rien de réseau.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStatus {
    /// `unsupported` (pas d'adaptateur), `noEmulator`, `noGameId`, `ready`.
    pub state: &'static str,
    pub adapter: Option<String>,
    pub emulator_version: Option<String>,
    /// Dernière optimisation active.
    pub active: Option<Entry>,
    /// Version de l'émulateur différente de celle de l'optimisation active.
    pub emulator_changed: bool,
    /// Questionnaire après session à proposer (identifiant de l'optimisation).
    pub ask_feedback: Option<i64>,
    /// `noGameId` : pourquoi l'identifiant du jeu est introuvable.
    pub reason: Option<String>,
    /// Identifiant du jeu fourni par EmuReady (fichier qui ne le contient pas, XCI).
    pub game_id_from_source: bool,
}

fn context(lib: &LibraryState, game_id: i64) -> Res<(GameQuery, Option<Install>)> {
    context_with_source(lib, game_id).map(|(g, i, _)| (g, i))
}

/// Comme `context`, en indiquant si l'identifiant de titre vient d'EmuReady.
fn context_with_source(lib: &LibraryState, game_id: i64) -> Res<(GameQuery, Option<Install>, bool)> {
    let mut from_source = false;
    let (mut game, install) = lib.with(|c| storage::game_context(c, game_id)?.ok_or(LibraryError::NotFound))?;
    // Switch en XCI : l'identifiant de titre n'est pas lisible dans le fichier ; on reprend celui
    // qu'EmuReady a donné pour ce titre exact lors d'une recherche (cache local, aucun réseau ici)
    if game.platform == "switch" && !game.serial.as_deref().is_some_and(super::adapters::eden::valid_title_id) {
        if let Some(id) = DbCache(lib).get(&title_id_key(&game.title)).and_then(|(body, _)| serde_json::from_str::<Option<String>>(&body).ok().flatten()) {
            if super::adapters::eden::valid_title_id(&id) {
                game.serial = Some(id);
                from_source = true;
            }
        }
    }
    Ok((game, install, from_source))
}

fn title_id_key(title: &str) -> String {
    format!("emuready:switch-title:{}", super::providers::emuready::normalize_title(title))
}

/// Cherche l'identifiant de titre Switch chez EmuReady (titre identique et univoque) et le garde en cache.
fn learn_switch_title_id(lib: &LibraryState, er: &EmuReady, game: &GameQuery) {
    if game.platform != "switch" || game.serial.as_deref().is_some_and(super::adapters::eden::valid_title_id) {
        return;
    }
    let key = title_id_key(&game.title);
    if DbCache(lib).get(&key).is_some_and(|(_, fresh)| fresh) {
        return;
    }
    if let Ok(id) = er.switch_title_id(&game.title) {
        DbCache(lib).put(&key, &serde_json::to_string(&id).unwrap_or_else(|_| "null".into()), super::providers::emuready::TTL_TITLE_ID);
    }
}

#[tauri::command]
pub async fn smartconfig_status(app: AppHandle, game_id: i64) -> Res<GameStatus> {
    // peut lire l'image du jeu (CRC PCSX2) : hors du fil principal
    tauri::async_runtime::spawn_blocking(move || status(&app, game_id)).await.map_err(|e| e.to_string())?
}

fn status(app: &AppHandle, game_id: i64) -> Res<GameStatus> {
    let lib = app.state::<LibraryState>();
    let (game, install, from_source) = context_with_source(&lib, game_id)?;
    let mut st = GameStatus { state: "unsupported", adapter: None, emulator_version: None, active: None, emulator_changed: false, ask_feedback: None, reason: None, game_id_from_source: from_source };
    let (install, adapter) = emulator_of(app, &game, install)?;
    let Some(install) = install else {
        st.state = "noEmulator";
        return Ok(st);
    };
    let Some(adapter) = adapter.filter(|a| a.platforms().contains(&game.platform.as_str())) else { return Ok(st) };
    st.adapter = Some(adapter.id().into());
    st.emulator_version = install.version.clone();
    // Android, émulateur autonome : fiche de réglages à appliquer à la main
    if adapter.id().starts_with("android.") {
        st.state = "manual";
        let history = lib.with(|c| backup::history(c, Some(game_id), 20).map_err(err))?;
        st.active = history.into_iter().find(|e| e.status == "applied" && e.adapter == adapter.id() && backup::is_sheet(&e.target));
        st.ask_feedback = lib.with(|c| Ok(storage::should_ask_feedback(c, game_id)?))?;
        return Ok(st);
    }
    let main = lib.with(|c| Ok(storage::main_file(c, game_id)?))?;
    let loc = super::platform::locate(adapter.as_ref(), &install).ok();
    if let Err(e) = adapter.game_key(&game, &adapters::KeyContext { install: &install, location: loc.as_ref(), main_file: main.as_deref() }) {
        st.state = "noGameId";
        st.reason = Some(e);
        return Ok(st);
    }
    st.state = "ready";
    let history = lib.with(|c| backup::history(c, Some(game_id), 20).map_err(err))?;
    st.active = history.into_iter().find(|e| e.status == "applied" && e.adapter == adapter.id());
    st.emulator_changed = st.active.as_ref().is_some_and(|e| e.emulator_version.is_some() && e.emulator_version != install.version);
    st.ask_feedback = lib.with(|c| Ok(storage::should_ask_feedback(c, game_id)?))?;
    Ok(st)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendResult {
    pub outcome: Outcome,
    /// Jeu reconnu par au moins une source.
    pub matched: bool,
    /// Données servies depuis un cache expiré (hors ligne).
    pub stale: bool,
    /// Erreurs par source (la recherche continue avec les autres).
    pub errors: Vec<(SourceId, ProviderError)>,
}

/// Recherche à la demande et classement. `sources` : fournisseurs activés par l'utilisateur.
#[tauri::command]
pub async fn smartconfig_recommend(app: AppHandle, game_id: i64, mode: Mode, sources: Vec<SourceId>) -> Res<RecommendResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let lib = app.state::<LibraryState>();
        let (game, install) = context(&lib, game_id)?;
        let (install, adapter) = emulator_of(&app, &game, install)?;
        let install = install.ok_or("aucun émulateur associé à ce jeu")?;
        let adapter = adapter.ok_or("émulateur non pris en charge par SmartConfig")?;
        let hw = hardware_of(&app);
        let state = app.state::<SmartConfigState>();
        let mut profiles: Vec<Profile> = Vec::new();
        let (mut matched, mut stale, mut errors) = (false, false, Vec::new());
        // Android : rapports « appareil » d'EmuReady, votre appareil puis votre puce d'abord
        #[cfg(target_os = "android")]
        {
            let emu = super::android::by_id(adapter.id()).ok_or("émulateur non pris en charge par SmartConfig")?;
            let system = super::android::system_key(&game.platform).ok_or("console non couverte par EmuReady")?;
            if sources.contains(&SourceId::EmuReady) {
                let d = hw.android.clone().unwrap_or_default();
                let hint = super::providers::emuready::DeviceHint::new(d.manufacturer.as_deref(), d.model.as_deref(), d.soc_name.as_deref().or(d.soc_code.as_deref()));
                match state.emuready()?.fetch_android(&game, system, adapter.id(), emu.emuready, &hint, &DbCache(&lib)) {
                    Ok(f) => {
                        profiles.extend(f.profiles);
                        matched |= f.matched;
                        stale |= f.stale;
                    }
                    Err(e) => errors.push((SourceId::EmuReady, e)),
                }
            }
        }
        #[cfg(not(target_os = "android"))]
        let mut run = |provider: &dyn Provider| {
            if !sources.contains(&provider.id()) || !provider.supports(adapter.id(), &game.platform) {
                return;
            }
            match provider.fetch(&game, adapter.id(), &DbCache(&lib)) {
                Ok(Fetched { profiles: p, matched: m, stale: s }) => {
                    profiles.extend(p);
                    matched |= m;
                    stale |= s;
                }
                Err(e) => errors.push((provider.id(), e)),
            }
        };
        #[cfg(not(target_os = "android"))]
        {
            // profils « Vérifié par iBox » : livrés avec l'application, aucun réseau
            run(&Verified);
            if sources.contains(&SourceId::EmuReady) {
                run(state.emuready()?);
            }
            // Switch en XCI : apprendre l'identifiant de titre pour pouvoir appliquer ensuite
            if sources.contains(&SourceId::EmuReady) {
                if let Ok(er) = state.emuready() {
                    learn_switch_title_id(&lib, er, &game);
                }
            }
        }
        // vos retours après session : profils déjà essayés exclus ou rétrogradés
        let local = lib.with(|c| Ok(storage::local_feedback(c, game_id, adapter.id())?))?;
        let today = crate::library::now_iso();
        let ctx = Context { game: &game, game_match: GameMatch::Title, hw: &hw, emulator_version: install.version.as_deref(), preferred: mode, today: &today, local: &local };
        let outcome = recommend::recommend(adapter.as_ref(), &profiles, &ctx);
        Ok(RecommendResult { outcome, matched, stale, errors })
    })
    .await
    .map_err(|e| e.to_string())?
}

struct Resolved {
    game: GameQuery,
    install: Install,
    adapter: Box<dyn adapters::Adapter>,
    main_file: Option<PathBuf>,
}

fn resolve(app: &AppHandle, game_id: i64) -> Res<Resolved> {
    let lib = app.state::<LibraryState>();
    let (game, install) = context(&lib, game_id)?;
    let (install, adapter) = emulator_of(app, &game, install)?;
    let install = install.ok_or("aucun émulateur associé à ce jeu")?;
    let adapter = adapter.ok_or("émulateur non pris en charge par SmartConfig")?;
    let main_file = lib.with(|c| Ok(storage::main_file(c, game_id)?))?;
    Ok(Resolved { game, install, adapter, main_file })
}

/// Aperçu exact des modifications, sans rien écrire.
#[tauri::command]
pub async fn smartconfig_preview(app: AppHandle, game_id: i64, profile: Profile) -> Res<Plan> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = resolve(&app, game_id)?;
        adapters::plan(r.adapter.as_ref(), &r.install, &r.game, r.main_file.as_deref(), &profile.settings, &hardware_of(&app))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Applique un profil (validé à nouveau ici) avec sauvegarde. `force` :
/// écraser des modifications manuelles signalées par une erreur précédente.
#[tauri::command]
pub async fn smartconfig_apply(app: AppHandle, game_id: i64, profile: Profile, mode: Option<Mode>, force: bool) -> Res<i64> {
    tauri::async_runtime::spawn_blocking(move || {
        let Resolved { game, install, adapter, main_file } = resolve(&app, game_id)?;
        if crate::launcher::commands::launch_status(app.state()).is_some() {
            return Err("Un jeu est en cours : fermez-le avant de modifier ses réglages.".into());
        }
        if emulator_open(&install) {
            return Err(format!("{} est ouvert : fermez-le avant de modifier ses réglages.", adapter.name()));
        }
        let hw = hardware_of(&app);
        let plan = adapters::plan(adapter.as_ref(), &install, &game, main_file.as_deref(), &profile.settings, &hw)?;
        if plan.changes.is_empty() {
            return Err("Ces réglages sont déjà en place : rien à modifier.".into());
        }
        let accepted: Vec<_> = super::validation::validate(&profile.settings, adapter.specs(), &hw).accepted.into_iter().filter(|s| plan.changes.iter().any(|c| c.key == s.key)).collect();
        let applied = Profile { settings: accepted.clone(), ..profile.clone() };
        let profile_json = serde_json::to_string(&applied).map_err(|e| e.to_string())?;
        let changes_json = serde_json::to_string(&plan.changes).map_err(|e| e.to_string())?;
        let mode_s = mode.map(|m| serde_json::to_value(m).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default());
        let backups = backups_dir(&app)?;
        let lib = app.state::<LibraryState>();
        let id = lib.with(|c| {
            backup::apply(
                c,
                &backups,
                &plan.target,
                &plan.after,
                &backup::NewEntry {
                    game_id,
                    adapter: adapter.id(),
                    emulator_version: install.version.as_deref(),
                    source: profile.source.as_str(),
                    source_ref: &profile.source_ref,
                    mode: mode_s.as_deref(),
                    profile_json: &profile_json,
                    changes_json: &changes_json,
                },
                force,
            )
            .map_err(err)
        })?;
        if !adapters::verify(adapter.as_ref(), &plan.target, &accepted) {
            return Err("Réglages écrits mais relus différemment : utilisez « Restaurer » puis signalez-le.".into());
        }
        Ok(id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn smartconfig_restore(app: AppHandle, application_id: i64, force: bool) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let lib = app.state::<LibraryState>();
        let entry = lib.with(|c| backup::entry(c, application_id).map_err(err))?.ok_or("optimisation introuvable")?;
        if let Ok(Resolved { install, adapter, .. }) = resolve(&app, entry.game_id) {
            if emulator_open(&install) {
                return Err(format!("{} est ouvert : fermez-le avant de restaurer.", adapter.name()));
            }
        }
        lib.with(|c| backup::restore(c, application_id, force).map_err(err))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn smartconfig_history(app: AppHandle, game_id: Option<i64>) -> Res<Vec<Entry>> {
    app.state::<LibraryState>().with(|c| backup::history(c, game_id, 200).map_err(err))
}

#[tauri::command]
pub fn smartconfig_cache_clear(app: AppHandle) -> Res<usize> {
    app.state::<LibraryState>().with(|c| Ok(storage::cache_clear(c, None)?))
}

#[tauri::command]
pub fn smartconfig_feedback(app: AppHandle, game_id: i64, application_id: Option<i64>, worked: Option<bool>, performance_ok: Option<bool>, graphics_issues: Option<bool>) -> Res<i64> {
    app.state::<LibraryState>().with(|c| Ok(storage::feedback_add(c, game_id, application_id, worked, performance_ok, graphics_issues)?))
}

/// Au démarrage : reprise des optimisations interrompues. Renvoie le nombre de conflits.
pub fn recover(app: &AppHandle) -> usize {
    app.state::<LibraryState>().with(|c| backup::recover(c).map_err(err)).unwrap_or(0)
}

/// Une ligne de fiche manuelle (forme de `adapters::Change`, plus l'état coché).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetLine {
    pub key: String,
    pub label: String,
    pub before: Option<String>,
    pub after: String,
    #[serde(default)]
    pub done: bool,
}

/// Android, émulateur autonome : enregistre la fiche des réglages d'un profil, à appliquer à la
/// main (rien n'est écrit sur le disque). Renvoie l'identifiant de l'entrée du journal.
#[tauri::command]
pub async fn smartconfig_sheet(app: AppHandle, game_id: i64, profile: Profile, mode: Option<Mode>) -> Res<i64> {
    tauri::async_runtime::spawn_blocking(move || {
        let r = resolve(&app, game_id)?;
        if !r.adapter.id().starts_with("android.") {
            return Err("cet émulateur reçoit ses réglages directement : utilisez « Appliquer »".into());
        }
        let accepted = super::validation::validate(&profile.settings, r.adapter.specs(), &hardware_of(&app)).accepted;
        if accepted.is_empty() {
            return Err("aucun réglage à reporter dans cette configuration".into());
        }
        let lines: Vec<SheetLine> = super::android::sheet_lines(&accepted, &profile.labels).into_iter().map(|c| SheetLine { key: c.key, label: c.label, before: c.before, after: c.after, done: false }).collect();
        let applied = Profile { settings: accepted, ..profile.clone() };
        let profile_json = serde_json::to_string(&applied).map_err(|e| e.to_string())?;
        let changes_json = serde_json::to_string(&lines).map_err(|e| e.to_string())?;
        let mode_s = mode.map(|m| serde_json::to_value(m).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default());
        let target = super::android::sheet_target(r.adapter.id(), game_id);
        let e = backup::NewEntry {
            game_id,
            adapter: r.adapter.id(),
            emulator_version: r.install.version.as_deref(),
            source: profile.source.as_str(),
            source_ref: &profile.source_ref,
            mode: mode_s.as_deref(),
            profile_json: &profile_json,
            changes_json: &changes_json,
        };
        app.state::<LibraryState>().with(|c| backup::record_manual(c, &target, &e).map_err(err))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Coche les réglages faits d'une fiche (`done` : clés), décoche les autres.
#[tauri::command]
pub fn smartconfig_sheet_check(app: AppHandle, application_id: i64, done: Vec<String>) -> Res<()> {
    let lib = app.state::<LibraryState>();
    let entry = lib.with(|c| backup::entry(c, application_id).map_err(err))?.ok_or("fiche introuvable")?;
    let mut lines: Vec<SheetLine> = serde_json::from_str(&entry.changes).map_err(|e| e.to_string())?;
    for l in &mut lines {
        l.done = done.contains(&l.key);
    }
    let json = serde_json::to_string(&lines).map_err(|e| e.to_string())?;
    lib.with(|c| backup::update_manual(c, application_id, &json).map_err(err))
}

/// Retire une fiche (retour arrière) : l'interface rappelle les réglages à remettre à la main.
#[tauri::command]
pub fn smartconfig_sheet_withdraw(app: AppHandle, application_id: i64) -> Res<()> {
    app.state::<LibraryState>().with(|c| backup::withdraw_manual(c, application_id).map_err(err))
}
