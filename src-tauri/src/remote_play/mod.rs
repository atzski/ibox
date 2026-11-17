//! iBox Remote Play — moteur natif (hôte). Étude et feuille de route : `docs/REMOTE-PLAY.md`.
//!
//! Phase 1a : interrupteur général (désactivé par défaut), réglages bornés, permissions,
//! protocole des DataChannels et diagnostic réel.
//! Phase 1b : capture WGC (`capture/`) et encodage H.264 Media Foundation (`encode/`).
//! Phase 3 (natif) : `input` exécute les entrées autorisées.
//! Phases 1c/2 : `transport` (str0m) relie l'hôte à un invité WebView2 ; signalisation manuelle
//! (boucle locale, LAN) tant qu'iNetbox n'est pas déployé. Rien ne démarre si Remote Play est
//! désactivé (défaut).

pub mod audio;
pub mod capture;
pub mod config;
pub mod diagnostics;
pub mod encode;
pub mod input;
#[cfg(windows)]
pub mod online;
pub mod pad_driver;
pub mod permissions;
pub mod protocol;
pub mod signaling;
pub mod sources;
#[cfg(windows)]
pub mod transport;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use config::Config;

pub struct RemotePlay {
    path: Option<PathBuf>,
    config: Mutex<Config>,
    #[cfg(windows)]
    host: Mutex<Option<std::sync::Arc<transport::host::Host>>>,
    #[cfg(windows)]
    online: Mutex<online::OnlineState>,
}

impl RemotePlay {
    pub fn open(app: &AppHandle) -> Self {
        let path = app.path().app_data_dir().ok().map(|d| d.join("remote-play.json"));
        let config = path.as_deref().map(Config::load).unwrap_or_default();
        RemotePlay {
            path,
            config: Mutex::new(config),
            #[cfg(windows)]
            host: Mutex::new(None),
            #[cfg(windows)]
            online: Mutex::new(online::OnlineState::default()),
        }
    }

    /// Enregistre et applique des réglages (bornés).
    pub fn save(&self, config: Config) -> Result<Config, String> {
        let config = config.sanitized();
        if let Some(path) = &self.path {
            config.save(path)?;
        }
        *self.config.lock().map_err(|_| "réglages indisponibles")? = config.clone();
        Ok(config)
    }

    pub fn enabled(&self) -> bool {
        self.config.lock().map(|c| c.enabled).unwrap_or(false)
    }
}

#[tauri::command]
pub fn remote_play_config(state: State<'_, RemotePlay>) -> Config {
    state.config.lock().map(|c| c.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn remote_play_set_config(app: AppHandle, state: State<'_, RemotePlay>, mut config: Config) -> Result<Config, String> {
    let before = state.config.lock().map_err(|_| "réglages indisponibles")?.clone();
    // « accepter les demandes » ne change que par `remote_play_set_accept` (aligné sur iNetbox) ;
    // Remote Play désactivé = demandes refusées
    config.accept_requests = before.accept_requests && config.enabled;
    // l'avertissement sur l'adresse IP, une fois lu, le reste
    config.ip_warning_seen |= before.ip_warning_seen;
    let saved = state.save(config)?;
    #[cfg(windows)]
    if saved.enabled != before.enabled {
        online::on_enabled_changed(&app, saved.enabled, saved.accept_requests);
    }
    let _ = &app;
    Ok(saved)
}

#[tauri::command]
pub async fn remote_play_diagnose() -> Result<diagnostics::Report, String> {
    tauri::async_runtime::spawn_blocking(diagnostics::probe).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remote_play_pad_driver() -> pad_driver::PadDriver {
    pad_driver::status()
}

/// Installe ViGEmBus (invite Windows = accord de l'utilisateur) pour les manettes des invités.
#[tauri::command]
pub async fn remote_play_install_pad_driver() -> Result<pad_driver::PadDriver, String> {
    tauri::async_runtime::spawn_blocking(pad_driver::install).await.map_err(|e| e.to_string())?
}

/// Bandeau de l'hôte réduit en pastille (`true`) ou affiché en entier.
#[tauri::command]
pub async fn remote_play_indicator_compact(app: AppHandle, compact: bool) -> Result<(), String> {
    #[cfg(windows)]
    online::set_indicator_compact(&app, compact);
    let _ = (&app, compact);
    Ok(())
}

/// Session d'hôte demandée par l'interface (échange manuel des SDP).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostStartArgs {
    /// `false` : boucle locale sur ce PC (127.0.0.1) ; `true` : réseau local.
    pub lan: bool,
    /// Profil de l'invité (LAN seulement ; la boucle locale est toujours en spectateur).
    pub profile: Option<permissions::Profile>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostOffer {
    pub sdp: String,
    pub lan: bool,
}

#[cfg(windows)]
fn current_host(state: &RemotePlay) -> Option<std::sync::Arc<transport::host::Host>> {
    state.host.lock().ok().and_then(|h| h.clone())
}

#[cfg(windows)]
#[tauri::command]
pub async fn remote_play_host_start(state: State<'_, RemotePlay>, args: HostStartArgs) -> Result<HostOffer, String> {
    use transport::host::{Host, HostOptions, Network};
    if !state.enabled() {
        return Err("Remote Play est désactivé dans les paramètres".into());
    }
    let cfg = state.config.lock().map_err(|_| "réglages indisponibles")?.clone();
    // en boucle locale, les entrées de l'invité reviendraient sur ce même PC : spectateur imposé
    let profile = if args.lan { args.profile.unwrap_or(cfg.default_profile) } else { permissions::Profile::Spectator };
    let max_kbps = match (cfg.bitrate_kbps, cfg.upload_limit_kbps) {
        (Some(b), Some(u)) => b.min(u),
        (Some(b), None) => b,
        (None, Some(u)) => u,
        (None, None) => 50_000,
    };
    let opts = HostOptions {
        network: if args.lan { Network::Lan } else { Network::Loopback },
        port: 0,
        target: capture::Target::PrimaryMonitor,
        fps: cfg.fps,
        max_height: cfg.height,
        initial_kbps: max_kbps.min(10_000),
        max_kbps,
        profile,
        mode: permissions::Mode::DesktopShare,
        hotkey: cfg.stop_hotkey.parse().unwrap_or_default(),
        blocked: cfg.blocked_accounts.clone(),
        guest_account: if args.lan { "lan".into() } else { "boucle-locale".into() },
        frame_log: None,
        audio: args.lan && cfg.audio != config::AudioSource::None,
    };
    let previous = state.host.lock().map_err(|_| "session indisponible")?.take();
    let host = tauri::async_runtime::spawn_blocking(move || {
        drop(previous); // une seule session à la fois : l'ancienne est arrêtée (relâchements compris)
        Host::start(opts)
    })
    .await
    .map_err(|e| e.to_string())??;
    let offer = HostOffer { sdp: host.offer().to_string(), lan: args.lan };
    *state.host.lock().map_err(|_| "session indisponible")? = Some(std::sync::Arc::new(host));
    Ok(offer)
}

/// Réponse SDP de l'invité ; renvoie le code de vérification à comparer avec lui.
#[cfg(windows)]
#[tauri::command]
pub async fn remote_play_host_answer(state: State<'_, RemotePlay>, sdp: String) -> Result<String, String> {
    let host = current_host(&state).ok_or("aucune session d'hôte")?;
    tauri::async_runtime::spawn_blocking(move || host.accept_answer(&sdp)).await.map_err(|e| e.to_string())?
}

#[cfg(windows)]
#[tauri::command]
pub fn remote_play_host_stats(state: State<'_, RemotePlay>) -> Option<transport::stats::TransportStats> {
    current_host(&state).map(|h| h.stats())
}

#[cfg(windows)]
#[tauri::command]
pub async fn remote_play_host_stop(state: State<'_, RemotePlay>) -> Result<Option<transport::stats::TransportStats>, String> {
    let host = state.host.lock().map_err(|_| "session indisponible")?.take();
    match host {
        Some(h) => tauri::async_runtime::spawn_blocking(move || Some(h.stop())).await.map_err(|e| e.to_string()),
        None => Ok(None),
    }
}
