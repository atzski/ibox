//! iBox Remote Play — moteur natif (hôte). Étude et feuille de route : `docs/REMOTE-PLAY.md`.
//!
//! Phase 1a : interrupteur général (désactivé par défaut), réglages bornés, permissions,
//! protocole des DataChannels et diagnostic réel. Aucun service de capture, de réseau ou
//! d'injection d'entrées n'existe encore : rien ne démarre, même activé.

pub mod config;
pub mod diagnostics;
pub mod permissions;
pub mod protocol;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State};

use config::Config;

pub struct RemotePlay {
    path: Option<PathBuf>,
    config: Mutex<Config>,
}

impl RemotePlay {
    pub fn open(app: &AppHandle) -> Self {
        let path = app.path().app_data_dir().ok().map(|d| d.join("remote-play.json"));
        let config = path.as_deref().map(Config::load).unwrap_or_default();
        RemotePlay { path, config: Mutex::new(config) }
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
pub fn remote_play_set_config(state: State<'_, RemotePlay>, config: Config) -> Result<Config, String> {
    let config = config.sanitized();
    if let Some(path) = &state.path {
        config.save(path)?;
    }
    *state.config.lock().map_err(|_| "réglages indisponibles")? = config.clone();
    Ok(config)
}

#[tauri::command]
pub async fn remote_play_diagnose() -> Result<diagnostics::Report, String> {
    tauri::async_runtime::spawn_blocking(diagnostics::probe).await.map_err(|e| e.to_string())
}
