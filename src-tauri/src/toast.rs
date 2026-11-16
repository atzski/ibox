//! Notifications iBox en bas à droite de l'écran (ami qui lance un jeu,
//! demande d'ami, message). Une petite fenêtre transparente, au premier plan,
//! qui ne prend pas le focus : elle s'affiche même quand iBox est réduit.
use serde_json::Value;
use std::{collections::VecDeque, sync::{atomic::{AtomicBool, Ordering}, Mutex}};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

static QUEUE: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());
static ENABLED: AtomicBool = AtomicBool::new(true);
static FRIENDS: AtomicBool = AtomicBool::new(true);
const LABEL: &str = "toast";
/// Taille de la fenêtre (en points) : une carte et son ombre.
const WIDTH: f64 = 400.0;
const HEIGHT: f64 = 132.0;

fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) { return Some(w); }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("iBox")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| eprintln!("iBox : fenêtre de notification indisponible : {e}"))
        .ok()
}

/// Coin bas-droit de la zone de travail de l'écran principal (au-dessus de la barre des tâches).
fn place(w: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = w.primary_monitor() else { return };
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let (ww, wh) = ((WIDTH * scale) as i32, (HEIGHT * scale) as i32);
    let margin = (8.0 * scale) as i32;
    let x = area.position.x + area.size.width as i32 - ww - margin;
    let y = area.position.y + area.size.height as i32 - wh - margin;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

/// Ajoute une notification (ignorée si l'utilisateur les a coupées).
pub fn push(app: &AppHandle, payload: Value) {
    if !ENABLED.load(Ordering::Relaxed) || (payload["kind"] != "update" && !FRIENDS.load(Ordering::Relaxed)) { return; }
    if let Ok(mut q) = QUEUE.lock() {
        if q.len() >= 6 { q.pop_front(); }
        q.push_back(payload);
    }
    let app = app.clone();
    let main = app.clone();
    let _ = main.run_on_main_thread(move || {
        let Some(w) = window(&app) else { return };
        place(&w);
        let _ = w.show();
        let _ = w.set_always_on_top(true);
        let _ = app.emit_to(LABEL, "toast-push", ());
    });
}

#[tauri::command]
pub fn toast_update(app: AppHandle, version: String) {
    push(&app, serde_json::json!({"kind":"update","friendId":"","name":format!("iBox {version}"),"body":"Cliquez pour installer la mise à jour."}));
}

/// La fenêtre de notification récupère les notifications en attente.
#[tauri::command]
pub fn toast_pull() -> Vec<Value> {
    QUEUE.lock().map(|mut q| q.drain(..).collect()).unwrap_or_default()
}

/// Plus rien à montrer : la fenêtre se cache.
#[tauri::command]
pub fn toast_done(app: AppHandle) {
    let empty = QUEUE.lock().map(|q| q.is_empty()).unwrap_or(true);
    if let (true, Some(w)) = (empty, app.get_webview_window(LABEL)) { let _ = w.hide(); }
}

/// Clic sur une notification : iBox revient au premier plan et ouvre ce qu'il faut.
#[tauri::command]
pub fn toast_click(app: AppHandle, payload: Value) {
    crate::shell::show_main(&app);
    let _ = app.emit_to("main", "toast-click", payload);
}

/// Réglage « Notifications » d'iBox (repris par la fenêtre principale).
#[tauri::command]
pub fn toast_enabled(enabled: bool, friends: Option<bool>) {
    FRIENDS.store(friends.unwrap_or(true), Ordering::Relaxed);
    ENABLED.store(enabled, Ordering::Relaxed);
}
