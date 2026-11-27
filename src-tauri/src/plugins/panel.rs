//! Panneau en jeu d'un plugin (`overlay.entry` du manifeste, iClips 0.2) : la page du paquet
//! dans une fenêtre `plugin-<id>` transparente qui couvre l'écran principal, par-dessus le jeu.
//!
//! - ouverture : raccourci du manifeste (permission `hotkey`, `shortcut.rs`, emplacement
//!   `Plugin`) ou combo manette maintenu (permission `gamepad`, XInput natif) ;
//! - le jeu au premier plan est retenu à l'ouverture et retrouve le focus à la fermeture ;
//! - la fenêtre est exclue des captures : elle n'apparaît ni dans les clips ni dans les images ;
//! - pendant l'ouverture, la manette est transmise à la page (`ibox:host`, événement `pad`) ;
//! - événements `panel://open` et `panel://close-request` (l'interface anime puis appelle
//!   `overlay.close`).
//!
//! Un seul panneau de plugin à la fois : le premier plugin activé qui en déclare un.
//! Music in the Box (`overlay.builtin`) garde son propre socle (`music/overlay.rs`).

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use super::{protocol, Active};

static VISIBLE: AtomicBool = AtomicBool::new(false);
/// Fenêtre au premier plan avant l'ouverture (le jeu), pour lui rendre le focus.
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);
const COMBO_HOLD: Duration = Duration::from_millis(400);

/// Plugin activé qui sert un panneau de sa propre page.
pub fn plugin(app: &AppHandle) -> Option<Arc<Active>> {
    super::all_active(app).into_iter().find(|a| a.allows("overlay") && a.manifest.overlay.as_ref().is_some_and(|o| o.entry.is_some()))
}

/// Le panneau remplace l'overlay de capture d'iBox (iClips : `clips-capture`).
pub fn takes_capture(app: &AppHandle) -> bool {
    plugin(app).is_some_and(|a| a.allows("clips-capture"))
}

/// Raccourci du panneau (permission `hotkey`).
pub fn hotkey(app: &AppHandle) -> Option<crate::shortcut::Shortcut> {
    let a = plugin(app).filter(|a| a.allows("hotkey"))?;
    a.manifest.overlay.as_ref()?.hotkey.as_deref()?.parse().ok()
}

/// Combo manette du panneau (permission `gamepad`), masque XInput.
fn combo(app: &AppHandle) -> Option<u16> {
    let a = plugin(app).filter(|a| a.allows("gamepad"))?;
    super::manifest::parse_combo(a.manifest.overlay.as_ref()?.pad_combo.as_deref()?)
}

pub fn visible() -> bool {
    VISIBLE.load(Ordering::Relaxed)
}

/// Envoie un événement à la page du panneau.
fn emit(app: &AppHandle, id: &str, event: &str, payload: serde_json::Value) {
    if let Some(w) = app.get_webview_window(&protocol::window_label(id)) {
        let detail = serde_json::json!({ "event": event, "payload": payload }).to_string();
        let _ = w.eval(format!("window.dispatchEvent(new CustomEvent(\"ibox:host\", {{ detail: {detail} }}))"));
    }
}

/// Raccourci ou combo : ouvre, ou demande à la page de fermer (elle anime la sortie puis
/// appelle `overlay.close`). Sans réponse, le panneau est caché quand même.
pub fn toggle(app: &AppHandle) {
    let Some(a) = plugin(app) else { return };
    if !visible() {
        show(app, &a);
        return;
    }
    emit(app, &a.id, "panel://close-request", serde_json::Value::Null);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(700));
        if visible() {
            hide(&app);
        }
    });
}

/// Ouvre le panneau sur tout l'écran principal. La fenêtre se crée par la boucle
/// d'événements depuis un autre fil (jamais dans une commande).
#[cfg(mobile)]
fn show(_: &AppHandle, _: &Active) {}

#[cfg(desktop)]
fn show(app: &AppHandle, a: &Active) {
    let Some(entry) = a.manifest.overlay.as_ref().and_then(|o| o.entry.clone()) else { return };
    // l'image du jeu est figée avant que le panneau ne la couvre (capture d'écran à garder)
    if a.allows("clips-capture") {
        crate::capture::freeze(app);
    }
    remember_foreground();
    VISIBLE.store(true, Ordering::Relaxed);
    let id = a.id.clone();
    let side = a.manifest.overlay.as_ref().map(|o| o.side.clone()).unwrap_or_else(|| "right".into());
    let width = a.manifest.overlay.as_ref().map(|o| o.width).unwrap_or(460);
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            let label = protocol::window_label(&id);
            let w = match app.get_webview_window(&label) {
                Some(w) => w,
                None => {
                    let (lang, dark) = super::look();
                    let url = format!("{}?lang={lang}&scheme={}&side={side}&width={width}", protocol::url(&id, &entry), if dark { "dark" } else { "light" });
                    let Ok(url) = url.parse() else { return };
                    let home = protocol::url(&id, "");
                    match tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::CustomProtocol(url))
                        .title("iBox")
                        .decorations(false)
                        .transparent(true)
                        .shadow(false)
                        .resizable(false)
                        .always_on_top(true)
                        .skip_taskbar(true)
                        .visible(false)
                        .on_navigation(move |u| u.as_str().starts_with(&home))
                        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                        .build()
                    {
                        Ok(w) => {
                            // ni dans les clips, ni dans les captures
                            crate::music::backdrop::exclude_from_capture(&w);
                            w
                        }
                        Err(e) => {
                            eprintln!("iBox : panneau du plugin indisponible : {e}");
                            VISIBLE.store(false, Ordering::Relaxed);
                            return;
                        }
                    }
                }
            };
            if let Ok(Some(m)) = w.primary_monitor() {
                let _ = w.set_position(*m.position());
                let _ = w.set_size(*m.size());
            }
            let _ = w.show();
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
            #[cfg(windows)]
            if let Ok(h) = w.hwnd() {
                crate::music::overlay::force_foreground(h.0 as isize);
            }
            emit(&app, &id, "panel://open", serde_json::Value::Null);
        });
    });
}

/// Cache le panneau et rend le focus au jeu.
pub fn hide(app: &AppHandle) {
    VISIBLE.store(false, Ordering::Relaxed);
    let Some(a) = plugin(app) else { return };
    let label = protocol::window_label(&a.id);
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.hide();
            }
            restore_foreground();
        });
    });
}

/// Ferme pour de bon la fenêtre du panneau d'un plugin (désactivation, mise à jour).
pub fn close(app: &AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window(&protocol::window_label(id)) {
        if visible() {
            VISIBLE.store(false, Ordering::Relaxed);
            restore_foreground();
        }
        let _ = w.destroy();
    }
}

#[cfg(windows)]
fn remember_foreground() {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let fg = unsafe { GetForegroundWindow() } as isize;
    if fg != 0 && !visible() {
        PREVIOUS.store(fg, Ordering::Relaxed);
    }
}
#[cfg(not(windows))]
fn remember_foreground() {}

#[cfg(windows)]
fn restore_foreground() {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;
    let prev = PREVIOUS.swap(0, Ordering::Relaxed);
    if prev != 0 && unsafe { IsWindow(prev as _) } != 0 {
        crate::music::overlay::force_foreground(prev);
    }
}
#[cfg(not(windows))]
fn restore_foreground() {}

/// Manette : le combo maintenu ouvre ou ferme ; panneau ouvert, les boutons vont à la page.
/// Le même fil garde un clip quand Vue + A sont maintenus (clips automatiques, `clips_auto.rs`).
/// Sans plugin qui l'a demandé, XInput n'est pas lu.
#[cfg(windows)]
pub fn start(app: AppHandle) {
    use crate::music::overlay::pad;
    std::thread::spawn(move || {
        let mut before = 0u16;
        let mut combo_since: Option<Instant> = None;
        let mut fired = false;
        let mut repeat_at: Option<Instant> = None;
        let mut clip_since: Option<Instant> = None;
        let mut clip_fired = false;
        loop {
            let mask = combo(&app);
            let clip = crate::clips_auto::pad_armed();
            if mask.is_none() && !clip {
                before = 0;
                std::thread::sleep(Duration::from_millis(500));
                continue;
            }
            let Some(now) = crate::music::overlay::xinput_buttons() else {
                before = 0;
                std::thread::sleep(Duration::from_millis(1000));
                continue;
            };
            if mask.is_some_and(|m| now & m == m) {
                let since = *combo_since.get_or_insert_with(Instant::now);
                if !fired && since.elapsed() >= COMBO_HOLD {
                    fired = true;
                    toggle(&app);
                }
            } else {
                combo_since = None;
                fired = false;
            }
            // clip automatique : Vue + A maintenus en partie, panneau fermé
            let auto = crate::clips_auto::PAD_COMBO;
            if clip && !visible() && now & auto == auto {
                let since = *clip_since.get_or_insert_with(Instant::now);
                if !clip_fired && since.elapsed() >= COMBO_HOLD {
                    clip_fired = true;
                    crate::clips_auto::trigger(&app, "pad");
                }
            } else {
                clip_since = None;
                clip_fired = false;
            }
            if visible() {
                if let Some(a) = plugin(&app) {
                    for action in pad::pressed(now, before) {
                        emit(&app, &a.id, "pad", action.into());
                    }
                    if now & pad::REPEAT != 0 && now & pad::REPEAT == before & pad::REPEAT {
                        let at = *repeat_at.get_or_insert_with(|| Instant::now() + Duration::from_millis(400));
                        if Instant::now() >= at {
                            for action in pad::repeated(now) {
                                emit(&app, &a.id, "pad", action.into());
                            }
                            repeat_at = Some(Instant::now() + Duration::from_millis(120));
                        }
                    } else {
                        repeat_at = None;
                    }
                }
            }
            before = now;
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}
#[cfg(not(windows))]
pub fn start(_app: AppHandle) {}
