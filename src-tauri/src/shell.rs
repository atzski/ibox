//! iBox dans Windows : icône de la zone de notification, fonctionnement en
//! arrière-plan et fenêtre masquée pendant une partie.
//!
//! - Fermer la fenêtre la masque (iBox reste dans la zone de notification),
//!   sauf si l'utilisateur a désactivé ce comportement ; « Quitter » ferme vraiment.
//! - Au lancement d'un jeu, la fenêtre se masque ; elle revient à la fin de la partie.
//! - Clic droit sur l'icône : Ouvrir iBox, Jeux, Social, Quitter.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
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
        let _ = app.emit("shell://visibility", true);
    }
}

/// Masque la fenêtre principale (iBox continue dans la zone de notification).
pub fn hide_main(app: &AppHandle) -> bool {
    // Mode Jeu : la fenêtre n'est jamais masquée (gamescope met le jeu au premier plan),
    // mais l'interface se met au repos comme si elle l'était
    if crate::platform::game_mode() {
        let _ = app.emit("shell://visibility", false);
        return true;
    }
    match app.get_webview_window("main") {
        Some(w) if w.hide().is_ok() => {
            // l'interface se met au repos (musique coupée) tant qu'elle est invisible
            let _ = app.emit("shell://visibility", false);
            true
        }
        _ => false,
    }
}

fn show_and_go(app: &AppHandle, place: &str) {
    show_main(app);
    let _ = app.emit("tray://navigate", place);
}

/// Icône de la zone de notification et son menu.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    // Mode Jeu (gamescope) : ni zone de notification, ni fermeture qui masque la fenêtre
    if crate::platform::game_mode() {
        return Ok(());
    }
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
                    hide_main(&handle);
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
    if hide_main(app) {
        b.hidden_for_game.store(true, Ordering::Relaxed);
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
    hide_main(&app);
}

/// Pages d'aide ouvertes dans le navigateur par l'assistant de configuration.
/// Liste fermée : aucune adresse venant d'ailleurs n'est ouverte.
const HELP_PAGES: [&str; 8] = [
    "https://github.com/atzski/ibox/releases/latest",
    "https://discord.gg/xg6uQbYGZK",
    "https://retroachievements.org/settings",
    "https://iidb.iisu.network/",
    "https://buymeacoffee.com/atzski",
    "https://steamcommunity.com/dev/apikey",
    "https://www.steamgriddb.com/profile/preferences/api",
    "https://store.steampowered.com/account/",
];

/// Outil de Windows désigné par son chemin complet (`%SystemRoot%\…`) : jamais un
/// homonyme trouvé ailleurs (dossier d'iBox, PATH modifié).
pub fn windows_tool(rel: &str) -> std::path::PathBuf {
    let root = std::env::var_os("SystemRoot").map(std::path::PathBuf::from).unwrap_or_else(|| r"C:\Windows".into());
    root.join(rel)
}

/// Ouvre une adresse ou un dossier avec l'application par défaut du système
/// (Explorateur sous Windows, `xdg-open` sous Linux). La cible est passée comme un seul
/// argument : aucun interpréteur de commandes.
pub fn open_target(target: impl AsRef<std::ffi::OsStr>) -> Result<(), String> {
    #[cfg(windows)]
    let mut cmd = std::process::Command::new(windows_tool("explorer.exe"));
    #[cfg(not(windows))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(target).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Montre un fichier dans le gestionnaire de fichiers (sélectionné sous Windows ;
/// sous Linux, son dossier est ouvert, faute de sélection standard).
pub fn reveal(path: &std::path::Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new(windows_tool("explorer.exe")).arg(format!("/select,{}", path.display())).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        open_target(path.parent().unwrap_or(path))
    }
}

/// Ouvre une page d'aide dans le navigateur par défaut.
#[tauri::command]
pub fn open_help_page(url: String) -> Result<(), String> {
    if !HELP_PAGES.contains(&url.as_str()) {
        return Err("Adresse non autorisée.".into());
    }
    open_target(&url)
}

// ——— Démarrage avec Windows ———

/// Argument passé par le démarrage automatique : iBox reste dans la zone de notification.
pub const HIDDEN_ARG: &str = "--hidden";

/// iBox a été lancé par Windows à l'ouverture de session.
pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == HIDDEN_ARG)
}

/// Premier affichage : la fenêtre est créée invisible (aucun éclair plein écran
/// au démarrage avec Windows), puis montrée seulement si l'utilisateur a ouvert iBox.
/// Une version publiée réécrit aussi l'entrée de démarrage : chemin de
/// l'exécutable à jour (dossier déplacé, mise à jour) et argument `--hidden` présent.
pub fn startup(app: &AppHandle) {
    if !started_hidden() {
        show_main(app);
    }
    #[cfg(not(debug_assertions))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let l = app.autolaunch();
        if l.is_enabled().unwrap_or(false) {
            if let Err(e) = l.enable() {
                eprintln!("iBox : entrée de démarrage avec Windows non rafraîchie : {e}");
            }
        }
    }
}

/// La fenêtre principale est-elle visible ? (l'interface se met au repos sinon)
#[tauri::command]
pub fn shell_visible(app: AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(true)
}

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
    let _ = reveal(&path);
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

/// Délai maximal de la recherche d'une mise à jour (requête du manifeste).
const CHECK_TIMEOUT: Duration = Duration::from_secs(25);
/// Délai maximal du téléchargement de l'installeur.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Délai maximal de toute l'opération, quoi qu'il arrive.
const INSTALL_DEADLINE: Duration = Duration::from_secs(15 * 60);
/// Événement de progression d'une installation (écouté par l'interface).
pub const UPDATE_EVENT: &str = "update://progress";

fn updater(app: &AppHandle) -> Result<Option<tauri_plugin_updater::Updater>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let Some(url) = UPDATE_URL else { return Ok(None) };
    let url = url.parse().map_err(|e| format!("adresse de mise à jour invalide ({e})"))?;
    app.updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .timeout(CHECK_TIMEOUT)
        .build()
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Journal des mises à jour (dossier des journaux d'iBox) : étapes et erreurs, sans chemin
/// ni information personnelle. Sert à comprendre un échec chez un utilisateur.
fn update_log(app: &AppHandle, line: &str) {
    use std::io::Write;
    let Ok(dir) = app.path().app_log_dir() else { return };
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("updates.log");
    // journal court : repart de zéro au-delà de 64 Kio
    if std::fs::metadata(&path).map(|m| m.len() > 64 * 1024).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{} v{} {line}", crate::library::time::now_iso(), app.package_info().version);
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let Some(u) = updater(&app)? else {
        return Ok(UpdateInfo { configured: false, current, available: None, notes: None });
    };
    let found = u.check().await.map_err(|e| check_error(&app, e))?;
    Ok(UpdateInfo { configured: true, current, available: found.as_ref().map(|f| f.version.clone()), notes: found.and_then(|f| f.body) })
}

/// Échec de la vérification : message clair (le détail technique va dans le journal).
fn check_error(app: &AppHandle, e: tauri_plugin_updater::Error) -> String {
    update_log(app, &format!("recherche impossible : {e}"));
    "Impossible de joindre le serveur de mises à jour. Vérifiez votre connexion, puis réessayez.".into()
}

/// Étapes d'une mise à jour, envoyées à l'interface pendant l'installation.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub enum UpdateProgress {
    Checking,
    Downloading { received: u64, total: Option<u64> },
    Verifying,
    Installing,
    /// Échec : iBox reste ouvert, l'interface propose de réessayer ou de télécharger l'installeur.
    Failed { message: String },
    UpToDate,
}

static INSTALLING: AtomicBool = AtomicBool::new(false);

/// Lance l'installation de la mise à jour dans un fil dédié, avec son propre moteur réseau :
/// rien d'autre dans iBox ne peut la ralentir ni la bloquer, et chaque étape a un délai maximal.
/// La progression arrive par l'événement `update://progress` ; la commande répond aussitôt.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    if UPDATE_URL.is_none() {
        return Err("Mises à jour non configurées.".into());
    }
    if INSTALLING.swap(true, Ordering::AcqRel) {
        return Err("Une mise à jour est déjà en cours.".into());
    }
    let worker = app.clone();
    let spawned = std::thread::Builder::new().name("ibox-update".into()).spawn(move || {
        let app = worker;
        let emit = |p: UpdateProgress| { let _ = app.emit(UPDATE_EVENT, p); };
        let result = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| format!("Moteur de mise à jour indisponible : {e}"))
            .and_then(|rt| rt.block_on(async {
                match tokio::time::timeout(INSTALL_DEADLINE, run_update(&app, &emit)).await {
                    Ok(r) => r,
                    Err(_) => Err("La mise à jour a pris trop de temps.".into()),
                }
            }));
        INSTALLING.store(false, Ordering::Release);
        match result {
            Ok(()) => {}
            Err(message) if message == UP_TO_DATE => emit(UpdateProgress::UpToDate),
            Err(message) => {
                update_log(&app, &format!("échec : {message}"));
                emit(UpdateProgress::Failed { message });
            }
        }
    });
    if let Err(e) = spawned {
        INSTALLING.store(false, Ordering::Release);
        return Err(format!("Mise à jour impossible : {e}"));
    }
    Ok(())
}

const UP_TO_DATE: &str = "iBox est déjà à jour.";

async fn run_update(app: &AppHandle, emit: &impl Fn(UpdateProgress)) -> Result<(), String> {
    emit(UpdateProgress::Checking);
    update_log(app, "recherche");
    let u = updater(app)?.ok_or("Mises à jour non configurées.")?;
    let mut update = u.check().await.map_err(|e| check_error(app, e))?.ok_or(UP_TO_DATE)?;
    update_log(app, &format!("trouvée : {}", update.version));
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    emit(UpdateProgress::Downloading { received: 0, total: None });
    let mut received = 0u64;
    let mut last_reported = 0u64;
    let mut verifying = false;
    let bytes = update
        .download(
            |size, total| {
                received += size as u64;
                if received - last_reported >= 256 * 1024 || total == Some(received) {
                    last_reported = received;
                    emit(UpdateProgress::Downloading { received, total });
                }
            },
            || {
                verifying = true;
                emit(UpdateProgress::Verifying);
            },
        )
        .await
        .map_err(|e| {
            if verifying { format!("Signature de la mise à jour invalide : {e}") } else { format!("Téléchargement impossible : {e}") }
        })?;
    update_log(app, &format!("téléchargée ({} octets), installation", bytes.len()));
    emit(UpdateProgress::Installing);
    // l'installeur prend le relais (mode discret), puis relance iBox ; ce processus se ferme
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

#[cfg(test)]
mod update_live {
    //! Test réseau réel du canal de mise à jour publié (ignoré par défaut) :
    //!   cargo test --lib update_live -- --ignored --nocapture
    //! Lit le manifeste comme le fait iBox, télécharge l'installeur annoncé et vérifie sa
    //! signature avec la clé publique intégrée à iBox (le même contrôle que l'installation).
    use base64::Engine;

    #[test]
    #[ignore]
    fn manifeste_installeur_et_signature() {
        let b64 = base64::engine::general_purpose::STANDARD;
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let pubkey = String::from_utf8(b64.decode(conf["plugins"]["updater"]["pubkey"].as_str().unwrap()).unwrap()).unwrap();
        let pk = minisign_verify::PublicKey::decode(&pubkey).unwrap();
        let http = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(120)).build().unwrap();
        for manifest in [
            "https://github.com/atzski/ibox/releases/latest/download/latest.json",
            "https://github.com/atzski/inbox-releases/releases/latest/download/latest.json",
        ] {
            let m: serde_json::Value = http.get(manifest).send().unwrap().error_for_status().unwrap().json().unwrap();
            let win = &m["platforms"]["windows-x86_64"];
            let url = win["url"].as_str().unwrap();
            assert!(url.starts_with("https://github.com/atzski/ibox/releases/download/"), "{url}");
            let bytes = http.get(url).send().unwrap().error_for_status().unwrap().bytes().unwrap();
            let sig = String::from_utf8(b64.decode(win["signature"].as_str().unwrap()).unwrap()).unwrap();
            let sig = minisign_verify::Signature::decode(&sig).unwrap();
            pk.verify(&bytes, &sig, true).expect("signature valide");
            println!("{manifest} -> {} : {} octets, signature valide", m["version"], bytes.len());
        }
    }
}
