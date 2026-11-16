//! Notifications iBox en bas à droite de l'écran (ami qui lance un jeu,
//! demande d'ami, message). Une petite fenêtre transparente, au premier plan,
//! qui ne prend pas le focus : elle s'affiche même quand iBox est réduit.
use serde_json::Value;
use std::{collections::VecDeque, sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::Duration};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

static QUEUE: Mutex<VecDeque<Value>> = Mutex::new(VecDeque::new());
static ENABLED: AtomicBool = AtomicBool::new(true);
static FRIENDS: AtomicBool = AtomicBool::new(true);
/// Une veille garde la fenêtre au-dessus des jeux tant qu'elle est affichée.
static KEEPER: AtomicBool = AtomicBool::new(false);
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

/// Les notifications d'amis suivent le réglage « Amis » ; les mises à jour passent toujours
/// (même en « Ne pas déranger ») ; les autres suivent le réglage général.
fn allowed(kind: &str, enabled: bool, friends: bool) -> bool {
    match kind {
        "update" => true,
        "notice" => enabled,
        _ => enabled && friends,
    }
}

/// Repasse la fenêtre au sommet des fenêtres « toujours au premier plan » : un jeu en plein
/// écran fenêtré (le cas de la plupart des jeux récents) l'est aussi, et passerait devant.
/// La fenêtre ne prend jamais le focus : le jeu n'est pas interrompu.
fn raise(w: &tauri::WebviewWindow) {
    let _ = w.set_always_on_top(false);
    let _ = w.set_always_on_top(true);
}

/// Tant que la notification est visible, elle est replacée au premier plan régulièrement.
fn keep_on_top(app: &AppHandle) {
    if KEEPER.swap(true, Ordering::SeqCst) { return; }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let Some(w) = app.get_webview_window(LABEL) else { break };
            if !w.is_visible().unwrap_or(false) { break; }
            let target = w.clone();
            let _ = app.run_on_main_thread(move || raise(&target));
        }
        KEEPER.store(false, Ordering::SeqCst);
    });
}

/// Ajoute une notification (ignorée si l'utilisateur les a coupées).
pub fn push(app: &AppHandle, payload: Value) {
    let kind = payload["kind"].as_str().unwrap_or_default();
    if !allowed(kind, ENABLED.load(Ordering::Relaxed), FRIENDS.load(Ordering::Relaxed)) { return; }
    if let Ok(mut q) = QUEUE.lock() {
        if q.len() >= 6 { q.pop_front(); }
        q.push_back(payload);
    }
    let app = app.clone();
    // La fenêtre est créée par la boucle d'événements, jamais pendant une commande en cours sur le
    // fil principal : appelé depuis ce fil, run_on_main_thread exécute la tâche sur-le-champ, et
    // créer une WebView2 à cet endroit bloque définitivement Windows (fil principal figé, plus
    // aucune commande ne répond). Le passage par un autre fil met la tâche dans la file d'attente.
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            let Some(w) = window(&app) else { return };
            place(&w);
            let _ = w.show();
            raise(&w);
            let _ = app.emit_to(LABEL, "toast-push", ());
            keep_on_top(&app);
        });
    });
}

#[tauri::command]
pub async fn toast_update(app: AppHandle, version: String) {
    push(&app, serde_json::json!({"kind":"update","friendId":"","name":format!("iBox {version}"),"body":"Cliquez pour installer la mise à jour."}));
}

/// Notification d'iBox (bibliothèque, succès, mise à jour…) montrée en bas à droite de l'écran,
/// quand iBox n'est pas au premier plan. `link` dit où mène le clic.
#[tauri::command]
pub async fn toast_notice(app: AppHandle, title: String, body: Option<String>, icon: Option<String>, tone: Option<String>, link: Option<Value>, image: Option<String>) {
    // seules les images des succès RetroAchievements sont affichées
    let image = image.filter(|u| u.starts_with("https://media.retroachievements.org/") && u.len() < 200);
    let clip = |s: String, n: usize| s.chars().take(n).collect::<String>();
    push(&app, serde_json::json!({
        "kind": "notice",
        "friendId": "",
        "name": clip(title, 90),
        "body": body.map(|b| clip(b, 180)),
        "icon": icon.map(|i| clip(i, 24)),
        "tone": tone.map(|t| clip(t, 8)),
        "link": link,
        "image": image,
    }));
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

#[cfg(test)]
mod tests {
    use super::allowed;

    #[test]
    fn mises_a_jour_toujours_annoncees() {
        assert!(allowed("update", false, false));
        assert!(allowed("notice", true, false));
        assert!(!allowed("notice", false, true));
        assert!(allowed("game", true, true));
        assert!(!allowed("game", true, false));
        assert!(!allowed("request", false, true));
    }
}
