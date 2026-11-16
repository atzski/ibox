//! iBox dans Windows : icône de la zone de notification, fonctionnement en
//! arrière-plan et fenêtre masquée pendant une partie.
//!
//! - Fermer la fenêtre la masque (iBox reste dans la zone de notification),
//!   sauf si l'utilisateur a désactivé ce comportement ; « Quitter » ferme vraiment.
//! - Au lancement d'un jeu, la fenêtre se masque ; elle revient à la fin de la partie.
//! - Clic droit sur l'icône : Ouvrir iBox, Jeux, Social, Quitter.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};

/// Comportements choisis dans Paramètres › Système (transmis au démarrage).
pub struct Behavior {
    pub keep_in_tray: AtomicBool,
    pub hide_on_launch: AtomicBool,
    /// La fenêtre a été masquée par un lancement de jeu (à réafficher à la fin).
    hidden_for_game: AtomicBool,
}

impl Default for Behavior {
    fn default() -> Self {
        Self { keep_in_tray: AtomicBool::new(true), hide_on_launch: AtomicBool::new(true), hidden_for_game: AtomicBool::new(false) }
    }
}

/// Réaffiche la fenêtre principale au premier plan.
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn show_and_go(app: &AppHandle, place: &str) {
    show_main(app);
    let _ = app.emit("tray://navigate", place);
}

/// Icône de la zone de notification et son menu.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Ouvrir iBox", true, None::<&str>)?;
    let games = MenuItem::with_id(app, "games", "Jeux", true, None::<&str>)?;
    let social = MenuItem::with_id(app, "social", "Social", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter iBox", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &games, &social, &sep, &quit])?;

    let mut tray = TrayIconBuilder::with_id("ibox")
        .tooltip("iBox")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "games" => show_and_go(app, "games"),
            "social" => show_and_go(app, "social"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    // fermer la fenêtre = la masquer (iBox reste disponible dans la zone de notification)
    if let Some(w) = app.get_webview_window("main") {
        let handle = app.clone();
        w.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if handle.state::<Behavior>().keep_in_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }
        });
    }
    Ok(())
}

/// Un jeu démarre : la fenêtre s'efface pour laisser toute la place au jeu.
pub fn game_started(app: &AppHandle) {
    let b = app.state::<Behavior>();
    if !b.hide_on_launch.load(Ordering::Relaxed) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        if w.hide().is_ok() {
            b.hidden_for_game.store(true, Ordering::Relaxed);
        }
    }
}

/// La partie est finie : iBox revient au premier plan s'il s'était effacé.
pub fn game_ended(app: &AppHandle) {
    let b = app.state::<Behavior>();
    if b.hidden_for_game.swap(false, Ordering::Relaxed) {
        show_main(app);
    }
}

/// Réglages venant de l'interface.
#[tauri::command]
pub fn shell_behavior_set(app: AppHandle, keep_in_tray: bool, hide_on_launch: bool) {
    let b = app.state::<Behavior>();
    b.keep_in_tray.store(keep_in_tray, Ordering::Relaxed);
    b.hide_on_launch.store(hide_on_launch, Ordering::Relaxed);
}

/// Masque iBox (il reste dans la zone de notification).
#[tauri::command]
pub fn shell_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// Pages d'aide ouvertes dans le navigateur par l'assistant de configuration.
/// Liste fermée : aucune adresse venant d'ailleurs n'est ouverte.
const HELP_PAGES: [&str; 6] = [
    "https://retroachievements.org/settings",
    "https://iidb.iisu.network/",
    "https://buymeacoffee.com/atzski",
    "https://steamcommunity.com/dev/apikey",
    "https://www.steamgriddb.com/profile/preferences/api",
    "https://store.steampowered.com/account/",
];

/// Ouvre une page d'aide dans le navigateur par défaut.
#[tauri::command]
pub fn open_help_page(url: String) -> Result<(), String> {
    if !HELP_PAGES.contains(&url.as_str()) {
        return Err("Adresse non autorisée.".into());
    }
    // explorer.exe reçoit l'adresse comme un seul argument (aucun interpréteur de commandes)
    std::process::Command::new("explorer.exe").arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ——— Démarrage avec Windows ———

/// Argument passé par le démarrage automatique : iBox reste dans la zone de notification.
pub const HIDDEN_ARG: &str = "--hidden";

#[tauri::command]
pub fn autostart_get(app: AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let l = app.autolaunch();
    if enabled { l.enable() } else { l.disable() }.map_err(|e| e.to_string())?;
    l.is_enabled().map_err(|e| e.to_string())
}

// ——— Rapport de problème ———

/// Enregistre le rapport de diagnostic préparé par l'interface dans le
/// dossier de données d'iBox, puis le montre dans l'Explorateur. Rien n'est envoyé.
#[tauri::command]
pub fn diagnostic_save(app: AppHandle, text: String) -> Result<String, String> {
    if text.len() > 2 * 1024 * 1024 {
        return Err("Rapport trop volumineux.".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("diagnostics");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = crate::library::now_iso().replace([':', '-'], "").replace('T', "-").chars().take(15).collect::<String>();
    let path = dir.join(format!("ibox-diagnostic-{stamp}.txt"));
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    // chemin construit par iBox (jamais un nom venant de l'extérieur), passé comme un seul argument
    let _ = std::process::Command::new("explorer.exe").arg(format!("/select,{}", path.display())).spawn();
    Ok(path.display().to_string())
}

// ——— Mises à jour ———

/// Adresse du fichier de publication (latest.json), fixée à la compilation
/// d'une version publiée. Sans elle, iBox n'annonce aucune mise à jour.
const UPDATE_URL: Option<&str> = option_env!("IBOX_UPDATE_URL");

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub configured: bool,
    pub current: String,
    pub available: Option<String>,
    pub notes: Option<String>,
}

fn updater(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Updater>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(url) = UPDATE_URL else { return Ok(None) };
    let url = url.parse().map_err(|e| format!("adresse de mise à jour invalide ({e})"))?;
    app.updater_builder().endpoints(vec![url]).map_err(|e| e.to_string())?.build().map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let Some(u) = updater(&app)? else {
        return Ok(UpdateInfo { configured: false, current, available: None, notes: None });
    };
    let found = u.check().await.map_err(check_error)?;
    Ok(UpdateInfo { configured: true, current, available: found.as_ref().map(|f| f.version.clone()), notes: found.and_then(|f| f.body) })
}

/// Échec de la vérification : message clair (le détail technique va dans le journal).
fn check_error(e: tauri_plugin_updater::Error) -> String {
    eprintln!("iBox : vérification des mises à jour impossible : {e}");
    "Impossible de joindre le serveur de mises à jour. Vérifiez votre connexion, puis réessayez.".into()
}

/// Étapes d'une mise à jour, envoyées à l'interface pendant l'installation.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum UpdateProgress {
    Checking,
    Downloading { received: u64, total: Option<u64> },
    Verifying,
    Installing,
}

/// Télécharge la mise à jour (signature vérifiée), l'installe et redémarre iBox.
#[tauri::command]
pub async fn update_install(app: AppHandle, progress: tauri::ipc::Channel<UpdateProgress>) -> Result<(), String> {
    static INSTALLING: AtomicBool = AtomicBool::new(false);
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("Une mise à jour est déjà en cours.".into());
    }
    struct ResetInstall;
    impl Drop for ResetInstall {
        fn drop(&mut self) {
            INSTALLING.store(false, Ordering::Release);
        }
    }
    let _guard = ResetInstall;
    let _ = progress.send(UpdateProgress::Checking);
    let Some(u) = updater(&app)? else { return Err("Mises à jour non configurées.".into()) };
    let Some(update) = u.check().await.map_err(check_error)? else { return Err("iBox est déjà à jour.".into()) };
    let _ = progress.send(UpdateProgress::Downloading { received: 0, total: None });
    let mut received = 0;
    let mut last_reported = 0;
    let mut verifying = false;
    let bytes = update.download(
        |size, total| {
            received += size as u64;
            if last_reported == 0 || received - last_reported >= 128 * 1024 || total == Some(received) {
                last_reported = received;
                let _ = progress.send(UpdateProgress::Downloading { received, total });
            }
        },
        || {
            verifying = true;
            let _ = progress.send(UpdateProgress::Verifying);
        },
    ).await.map_err(|e| {
        if verifying { format!("Signature de la mise à jour invalide : {e}") }
        else { format!("Téléchargement impossible : {e}") }
    })?;
    let _ = progress.send(UpdateProgress::Installing);
    update.install(bytes).map_err(|e| format!("Installation impossible : {e}"))?;
    app.restart();
}

/// Réduit iBox dans la barre des tâches (bouton de la barre du haut).
#[tauri::command]
pub fn shell_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}
