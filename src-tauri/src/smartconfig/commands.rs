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
use serde::Serialize;
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
    cached.get_or_insert_with(hardware::detect).clone()
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
    let Some(install) = install else {
        st.state = "noEmulator";
        return Ok(st);
    };
    let Some(adapter) = adapters::by_id(&install.profile_id).filter(|a| a.platforms().contains(&game.platform.as_str())) else { return Ok(st) };
    st.adapter = Some(adapter.id().into());
    st.emulator_version = install.version.clone();
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
        let install = install.ok_or("aucun émulateur associé à ce jeu")?;
        let adapter = adapters::by_id(&install.profile_id).ok_or("émulateur non pris en charge par SmartConfig")?;
        let hw = hardware_of(&app);
        let state = app.state::<SmartConfigState>();
        let mut profiles: Vec<Profile> = Vec::new();
        let (mut matched, mut stale, mut errors) = (false, false, Vec::new());
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
    let install = install.ok_or("aucun émulateur associé à ce jeu")?;
    let adapter = adapters::by_id(&install.profile_id).ok_or("émulateur non pris en charge par SmartConfig")?;
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
        if install.exe.parent().is_some_and(crate::emulators::install::running_inside) {
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
            if install.exe.parent().is_some_and(crate::emulators::install::running_inside) {
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
