//! Commandes Tauri des manuels. Réseau et disque dans des fils dédiés.

use super::{archive, game_info, lookup, screenscraper, set_lookup, steam, Found, ManualInfo, ManualOptions, ManualStore};
use crate::db;
use crate::library::commands::LibraryState;
use crate::library::time::iso_from_unix;
use crate::metadata::commands::MetadataState;
use crate::metadata::http::Http;
use crate::metadata::{keys, MetaError};
use base64::Engine;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

type Res<T> = Result<T, String>;

pub struct ManualState {
    store: Arc<ManualStore>,
    /// Propositions de la dernière recherche : l'interface ne voit qu'un jeton.
    candidates: Mutex<HashMap<String, (i64, Found)>>,
    /// Jeux en cours de recherche automatique (une seule à la fois par jeu).
    busy: Mutex<HashSet<i64>>,
}

impl ManualState {
    pub fn open(app: &AppHandle) -> Result<Self, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("manuals");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Self { store: Arc::new(ManualStore::new(dir)), candidates: Mutex::new(HashMap::new()), busy: Mutex::new(HashSet::new()) })
    }
}

/// Travail bloquant avec sa propre connexion à la base.
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&rusqlite::Connection, &ManualState, &Http) -> Result<T, MetaError> + Send + 'static,
) -> Res<T> {
    let db_path = app.state::<LibraryState>().db_path().to_path_buf();
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db::open(&db_path).map_err(|e| e.to_string())?;
        let state = app2.state::<ManualState>();
        let http = app2.state::<MetadataState>().http.clone();
        f(&conn, &state, &http).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Opération interrompue : {e}"))?
}

fn changed(app: &AppHandle, game_id: i64) {
    let _ = app.emit("manual://changed", game_id);
}

#[tauri::command]
pub async fn manual_list(app: AppHandle) -> Res<Vec<ManualInfo>> {
    blocking(&app, |c, st, _| st.store.list(c)).await
}

#[tauri::command]
pub async fn manual_read(app: AppHandle, game_id: i64) -> Res<tauri::ipc::Response> {
    blocking(&app, move |c, st, _| st.store.read(c, game_id)).await.map(tauri::ipc::Response::new)
}

/// Couverture déjà rendue (JPEG) ; vide si le lecteur ne l'a pas encore produite.
#[tauri::command]
pub async fn manual_cover(app: AppHandle, game_id: i64) -> Res<tauri::ipc::Response> {
    blocking(&app, move |c, st, _| st.store.read_cover(c, game_id)).await.map(|b| tauri::ipc::Response::new(b.unwrap_or_default()))
}

/// Couverture rendue par le lecteur (JPEG en base64) et nombre de pages.
#[tauri::command]
pub async fn manual_cover_save(app: AppHandle, game_id: i64, jpeg: String, pages: Option<i64>) -> Res<()> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(jpeg.as_bytes()).map_err(|e| e.to_string())?;
    blocking(&app, move |c, st, _| st.store.save_cover(c, game_id, &bytes, pages)).await
}

#[tauri::command]
pub async fn manual_import(app: AppHandle, game_id: i64, path: String) -> Res<ManualInfo> {
    let info = blocking(&app, move |c, st, _| st.store.import(c, game_id, std::path::Path::new(&path))).await?;
    changed(&app, game_id);
    Ok(info)
}

/// Retire le manuel ; il ne sera plus cherché automatiquement pour ce jeu.
#[tauri::command]
pub async fn manual_remove(app: AppHandle, game_id: i64) -> Res<()> {
    blocking(&app, move |c, st, _| st.store.remove(c, game_id, true)).await?;
    changed(&app, game_id);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateOut {
    token: String,
    title: String,
    region: Option<String>,
    size: Option<u64>,
    /// Confiance de la correspondance (0..1).
    score: f32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOut {
    candidates: Vec<CandidateOut>,
    /// Sources injoignables (messages lisibles).
    errors: Vec<String>,
}

/// Interroge toutes les sources activées, dans l'ordre de fiabilité.
fn search_all(http: &Http, game: &super::GameInfo, opts: &ManualOptions, stop_at_exact: bool) -> (Vec<Found>, Vec<String>) {
    let mut found = Vec::new();
    let mut errors = Vec::new();
    let mut run = |name: &str, r: Result<Vec<Found>, MetaError>, found: &mut Vec<Found>| match r {
        Ok(list) => found.extend(list),
        Err(MetaError::MissingKey(_)) => {}
        Err(e) => errors.push(format!("{name} : {e}")),
    };
    if opts.uses(steam::PROVIDER) {
        run("Steam", steam::find(http, game), &mut found);
    }
    if stop_at_exact && found.iter().any(|f| f.score >= 1.0) {
        return (found, errors);
    }
    if opts.uses(screenscraper::PROVIDER) && screenscraper::available() {
        run("ScreenScraper", screenscraper::find(http, game, opts), &mut found);
    }
    if stop_at_exact && found.iter().any(|f| f.score >= archive::AUTO_SCORE) {
        return (found, errors);
    }
    if opts.uses(archive::PROVIDER) {
        run("Internet Archive", archive::find(http, game, opts), &mut found);
    }
    (found, errors)
}

#[tauri::command]
pub async fn manual_search(app: AppHandle, game_id: i64, options: ManualOptions) -> Res<SearchOut> {
    blocking(&app, move |c, st, http| {
        let game = game_info(c, game_id)?;
        let (mut found, errors) = search_all(http, &game, &options, false);
        // meilleure confiance d'abord, puis région préférée
        found.sort_by(|a, b| b.score.total_cmp(&a.score).then(options.region_rank(a.region.as_deref()).cmp(&options.region_rank(b.region.as_deref()))));
        let mut map = st.candidates.lock().unwrap_or_else(|e| e.into_inner());
        map.retain(|_, (g, _)| *g != game_id);
        let candidates = found
            .into_iter()
            .take(12)
            .enumerate()
            .map(|(i, f)| {
                let token = format!("{game_id}-{i}-{}", f.reference.len());
                let out = CandidateOut { token: token.clone(), title: f.title.clone(), region: f.region.clone(), size: f.size, score: f.score };
                map.insert(token, (game_id, f));
                out
            })
            .collect();
        Ok(SearchOut { candidates, errors })
    })
    .await
}

#[tauri::command]
pub async fn manual_apply(app: AppHandle, game_id: i64, token: String) -> Res<ManualInfo> {
    let info = blocking(&app, move |c, st, http| {
        let found = st
            .candidates
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&token)
            .filter(|(g, _)| *g == game_id)
            .map(|(_, f)| f.clone())
            .ok_or(MetaError::NotFound)?;
        st.store.download(c, http, game_id, &found)
    })
    .await?;
    changed(&app, game_id);
    Ok(info)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoOut {
    /// found | none | skipped | error
    status: &'static str,
    manual: Option<ManualInfo>,
    error: Option<String>,
}

/// Délai avant de réinterroger les sources pour un jeu sans manuel.
fn retry_after(outcome: &str) -> Option<i64> {
    match outcome {
        "none" => Some(14 * 86_400),
        "error" => Some(6 * 3600),
        "found" => Some(0),
        _ => None, // dismissed : plus jamais tout seul
    }
}

/// Recherche automatique (ouverture d'une fiche, ou toute la collection) :
/// n'applique que ce qui est sûr, ne réinterroge pas trop souvent.
#[tauri::command]
pub async fn manual_auto(app: AppHandle, game_id: i64, options: ManualOptions, force: bool) -> Res<AutoOut> {
    {
        let st = app.state::<ManualState>();
        if !st.busy.lock().unwrap_or_else(|e| e.into_inner()).insert(game_id) {
            return Ok(AutoOut { status: "skipped", manual: None, error: None });
        }
    }
    let result = blocking(&app, move |c, st, http| {
        if let Some(m) = st.store.info(c, game_id)? {
            return Ok(AutoOut { status: "found", manual: Some(m), error: None });
        }
        if !force {
            if let Some((outcome, at)) = lookup(c, game_id)? {
                let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
                match retry_after(&outcome) {
                    None => return Ok(AutoOut { status: "skipped", manual: None, error: None }),
                    Some(gap) if at > iso_from_unix(now - gap) => return Ok(AutoOut { status: "skipped", manual: None, error: None }),
                    _ => {}
                }
            }
        }
        let game = game_info(c, game_id)?;
        let (mut found, errors) = search_all(http, &game, &options, true);
        // seul, iBox n'ajoute qu'un manuel sûr, dans la langue de l'utilisateur ou en anglais
        found.retain(|f| f.score >= archive::AUTO_SCORE && archive::language_bonus(f.region.as_deref(), &options) >= 0.0);
        found.sort_by(|a, b| b.score.total_cmp(&a.score).then(options.region_rank(a.region.as_deref()).cmp(&options.region_rank(b.region.as_deref()))));
        let mut last_error = errors.first().cloned();
        for f in &found {
            match st.store.download(c, http, game_id, f) {
                Ok(m) => return Ok(AutoOut { status: "found", manual: Some(m), error: None }),
                Err(e) => last_error = Some(e.to_string()),
            }
        }
        let status = if last_error.is_some() { "error" } else { "none" };
        set_lookup(c, game_id, status)?;
        Ok(AutoOut { status, manual: None, error: last_error })
    })
    .await;
    app.state::<ManualState>().busy.lock().unwrap_or_else(|e| e.into_inner()).remove(&game_id);
    if let Ok(AutoOut { status: "found", manual: Some(_), .. }) = &result {
        changed(&app, game_id);
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualStatus {
    /// Cette version d'iBox a-t-elle ses identifiants développeur ScreenScraper ?
    screenscraper_available: bool,
    /// Compte ScreenScraper relié (identifiant seulement).
    screenscraper_login: Option<String>,
    count: usize,
    cache_bytes: u64,
}

#[tauri::command]
pub async fn manual_status(app: AppHandle) -> Res<ManualStatus> {
    blocking(&app, |c, st, _| {
        Ok(ManualStatus {
            screenscraper_available: screenscraper::available(),
            screenscraper_login: screenscraper::account().map(|a| a.login),
            count: st.store.list(c)?.len(),
            cache_bytes: st.store.size_bytes(),
        })
    })
    .await
}

/// Supprime tous les manuels téléchargés (les PDF importés à la main sont gardés).
#[tauri::command]
pub async fn manual_clear_downloaded(app: AppHandle) -> Res<usize> {
    let n = blocking(&app, |c, st, _| {
        let ids: Vec<i64> = {
            let mut q = c.prepare("SELECT game_id FROM game_manuals WHERE source <> 'user'")?;
            let rows = q.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        for id in &ids {
            st.store.remove(c, *id, false)?;
        }
        c.execute("DELETE FROM manual_lookups WHERE outcome <> 'dismissed'", [])?;
        st.store.collect_garbage(c)?;
        Ok(ids.len())
    })
    .await?;
    let _ = app.emit("manual://changed", -1);
    Ok(n)
}

/// Relie le compte ScreenScraper du joueur (vérifié avant d'être enregistré).
#[tauri::command]
pub async fn screenscraper_account_set(app: AppHandle, login: String, password: String) -> Res<screenscraper::UserInfo> {
    let login = login.trim().to_string();
    if login.is_empty() || password.is_empty() {
        return Err("Identifiant et mot de passe requis.".into());
    }
    blocking(&app, move |_, _, http| {
        let acc = screenscraper::Account { login, password };
        let info = screenscraper::user_info(http, &acc)?;
        keys::set(screenscraper::ACCOUNT_KEY, &serde_json::to_string(&acc).map_err(|e| MetaError::Invalid(e.to_string()))?)?;
        Ok(info)
    })
    .await
}

/// Quota du compte relié (interroge ScreenScraper).
#[tauri::command]
pub async fn screenscraper_account_info(app: AppHandle) -> Res<Option<screenscraper::UserInfo>> {
    blocking(&app, |_, _, http| match screenscraper::account() {
        Some(acc) => screenscraper::user_info(http, &acc).map(Some),
        None => Ok(None),
    })
    .await
}

#[tauri::command]
pub fn screenscraper_account_delete(_state: State<ManualState>) -> Res<()> {
    keys::delete(screenscraper::ACCOUNT_KEY).map_err(|e| e.to_string())
}
