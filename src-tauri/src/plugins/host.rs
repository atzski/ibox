//! Socle natif des plugins : ce que la fenêtre d'un plugin peut demander, permission par
//! permission. La fenêtre n'a aucune capability Tauri ; ses appels arrivent par le protocole
//! (`POST /<id>/__host/<appel>`) et passent tous par [`call`].
//!
//! | Appel | Permission |
//! |---|---|
//! | `overlay.close` | `overlay` |
//! | `media.state`, `media.control` | `media-session` |
//! | `webview.call`, `webview.open`, `webview.status` | `webview:<origine>` |
//! | `clips.list`, `clips.update` (`{name, title?, favorite?}`), `clips.delete` (`{name}`), `clips.thumb` (`{name, jpeg, duration?}`) | `clips` |
//! | `clips.status`, `clips.save` | `clips-capture` |
//! | `edit.render` (`{kind: "mp4", segments: [{name, start, end}], title?}` ou `{kind: "gif", name, start, end}`) | `clips-edit` |
//! | `screen.open`, `screen.close` | un `screen` dans le manifeste |
//!
//! Les fichiers des clips se lisent par `GET /<id>/__clips/<nom>` (permission `clips`,
//! `protocol.rs`). Événement `clips://changed` à chaque nouveau clip ([`notify`]).
//!
//! Le socle (fenêtre overlay, raccourci, manette, WebView isolée) reste endormi tant
//! qu'aucun plugin activé ne le demande (`apply`).

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::Active;

/// Permission requise par un appel ; `None` : appel inconnu.
pub fn permission_for(call: &str) -> Option<&'static str> {
    Some(match call {
        "overlay.close" => "overlay",
        "media.state" | "media.control" => "media-session",
        "webview.call" | "webview.open" | "webview.status" => "webview",
        "clips.list" | "clips.update" | "clips.delete" | "clips.thumb" => "clips",
        "clips.status" | "clips.save" => "clips-capture",
        "edit.render" => "clips-edit",
        "auto.get" | "auto.set" | "auto.test" => "clips-auto",
        "shot.save" | "community.open" => "clips-capture",
        "capture.get" | "capture.set" | "capture.folder" => "clips-settings",
        "share.copy" | "share.drag" | "share.reveal" | "share.save" | "share.link" | "share.copyLink" | "share.friends" | "share.send" => "clips-share",
        "screen.open" | "screen.close" => "screen",
        _ => return None,
    })
}

/// Le plugin a-t-il le droit de faire cet appel ?
pub fn allowed(active: &Active, call: &str) -> bool {
    match permission_for(call) {
        Some("webview") => active.manifest.webview.is_some() && active.manifest.webview_origin().is_some_and(|o| active.allows(&format!("webview:{o}"))),
        Some("screen") => active.manifest.screen.is_some(),
        Some(p) => active.allows(p),
        None => false,
    }
}

pub fn call(app: &AppHandle, active: &Active, name: &str, arg: Value) -> Result<Value, String> {
    if !allowed(active, name) {
        return Err(format!("Appel refusé : {name}"));
    }
    match name {
        "overlay.close" => {
            if active.manifest.overlay.as_ref().is_some_and(|o| o.entry.is_some()) {
                super::panel::hide(app);
            } else {
                crate::music::overlay::hide(app);
            }
            Ok(Value::Null)
        }
        "media.state" => serde_json::to_value(crate::music::current(app)).map_err(|e| e.to_string()),
        "media.control" => {
            let action = arg.get("action").and_then(Value::as_str).ok_or("action manquante")?.to_string();
            let value = arg.get("value").and_then(Value::as_f64);
            let state = tauri::async_runtime::block_on(crate::music::music_control(app.clone(), action, value))?;
            serde_json::to_value(state).map_err(|e| e.to_string())
        }
        "webview.status" => Ok(json!({ "known": crate::music::ytm::known(app), "open": crate::music::ytm::window(app).is_some() })),
        "webview.open" => {
            let visible = arg.get("visible").and_then(Value::as_bool).unwrap_or(false);
            if crate::music::ytm::open(app, visible) { Ok(Value::Null) } else { Err("WebView indisponible.".into()) }
        }
        "webview.call" => {
            let cmd = arg.get("cmd").and_then(Value::as_str).ok_or("cmd manquante")?;
            crate::music::ytm::call(app, cmd, arg.get("arg").cloned().unwrap_or(Value::Null))
        }
        "clips.list" => crate::capture::clip_list(app).map(Value::from),
        "clips.update" => {
            let name = arg.get("name").and_then(Value::as_str).ok_or("name manquant")?;
            crate::capture::clip_update(app, name, arg.get("title").and_then(Value::as_str), arg.get("favorite").and_then(Value::as_bool))?;
            Ok(Value::Null)
        }
        "clips.delete" => {
            let name = arg.get("name").and_then(Value::as_str).ok_or("name manquant")?;
            crate::capture::clip_delete(app, name)?;
            Ok(Value::Null)
        }
        "clips.thumb" => {
            let name = arg.get("name").and_then(Value::as_str).ok_or("name manquant")?;
            let jpeg = arg.get("jpeg").and_then(Value::as_str).ok_or("jpeg manquant")?;
            let bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, jpeg).map_err(|_| "Image illisible.")?;
            crate::capture::clip_thumb(app, name, &bytes, arg.get("duration").and_then(Value::as_f64))?;
            Ok(Value::Null)
        }
        "clips.status" => Ok(crate::capture::clip_status()),
        "clips.save" => {
            let c = tauri::async_runtime::block_on(crate::capture::save_clip(app.clone()))?;
            Ok(json!({ "name": c.name, "game": c.game, "src": format!("__clips/{}", c.name) }))
        }
        "edit.render" => {
            let job = crate::clip_edit::start(app, crate::clip_edit::Request::parse(&arg)?)?;
            Ok(json!({ "job": job }))
        }
        "auto.get" => Ok(crate::clips_auto::status(app)),
        "auto.set" => crate::clips_auto::set(app, &arg),
        "auto.test" => Ok(crate::clips_auto::test(app)),
        "share.friends" => crate::share::friends(app),
        "shot.save" => crate::capture::save_frozen(app),
        "community.open" => {
            super::panel::hide(app);
            crate::capture::open_community(app);
            Ok(Value::Null)
        }
        "capture.get" => Ok(crate::capture::capture_state(app)),
        "capture.set" => crate::capture::capture_apply(app, &arg),
        "capture.folder" => crate::capture::open_folder(app),
        n if n.starts_with("share.") => {
            let name = arg.get("name").and_then(Value::as_str).ok_or("name manquant")?;
            match n {
                "share.copy" => crate::share::copy(app, name),
                "share.drag" => crate::share::drag(app, &active.id, name),
                "share.reveal" => crate::share::reveal(app, name),
                "share.save" => crate::share::save(app, name),
                "share.link" => crate::share::link(app, name),
                "share.copyLink" => crate::share::copy_link(app, name),
                "share.send" => crate::share::send(app, name, arg.get("friendId").and_then(Value::as_str).ok_or("friendId manquant")?),
                _ => Err(format!("Appel inconnu : {n}")),
            }
        }
        "screen.open" => {
            super::panel::hide(app);
            let (lang, dark) = super::look();
            tauri::async_runtime::block_on(super::plugins_open_screen(app.clone(), active.id.clone(), Some(lang.into()), Some(dark)))?;
            Ok(Value::Null)
        }
        "screen.close" => {
            close_screen(app, &active.id);
            Ok(Value::Null)
        }
        _ => Err(format!("Appel inconnu : {name}")),
    }
}

/// Origine que l'interface intégrée « music » sait piloter.
const MUSIC_ORIGIN: &str = "https://music.youtube.com";

/// Plugin activé qui sert l'interface intégrée `music` (Music in the Box).
fn music_plugin(app: &AppHandle) -> Option<std::sync::Arc<Active>> {
    super::all_active(app).into_iter().find(|a| a.manifest.overlay.as_ref().and_then(|o| o.builtin.as_deref()) == Some("music") && a.allows("overlay"))
}

/// Ce que le socle ouvre pour ce plugin, permission par permission.
pub fn music_config(a: &Active) -> crate::music::overlay::Config {
    let webview = a.manifest.webview.is_some() && a.manifest.webview_origin() == Some(MUSIC_ORIGIN) && a.allows(&format!("webview:{MUSIC_ORIGIN}"));
    crate::music::overlay::Config {
        hotkey: a.allows("hotkey"),
        combo: if a.allows("gamepad") { a.manifest.overlay.as_ref().and_then(|o| o.pad_combo.as_deref()).and_then(super::manifest::parse_combo) } else { None },
        webview,
        backdrop: a.allows("backdrop"),
    }
}

/// Pont du plugin : ses scripts dans l'ordre du manifeste (vérifiés à l'installation).
fn scripts(a: &Active) -> Option<String> {
    let w = a.manifest.webview.as_ref()?;
    let mut out = String::new();
    for s in &w.scripts {
        out.push_str(&std::fs::read_to_string(a.dir.join(s)).ok()?);
        out.push('\n');
    }
    (!out.is_empty()).then_some(out)
}

/// Réveille ou endort le socle selon les plugins activés. Sans plugin, rien n'est réservé :
/// ni raccourci, ni manette, ni fenêtre. `IBOX_MUSIC_DEV=1` réveille le socle sans plugin
/// (développement, avec le pont intégré).
pub fn apply(app: &AppHandle) {
    let (config, bridge) = match music_plugin(app) {
        Some(a) => (Some(music_config(&a)), scripts(&a)),
        None if std::env::var("IBOX_MUSIC_DEV").as_deref() == Ok("1") => (Some(crate::music::overlay::Config { hotkey: true, combo: Some(crate::music::overlay::pad::COMBO), webview: true, backdrop: true }), None),
        None => (None, None),
    };
    crate::music::ytm::set_scripts(bridge);
    if config.is_none() {
        crate::music::ytm::close(app);
    }
    crate::music::overlay::configure(app, config);
}

fn close_screen(app: &AppHandle, id: &str) {
    if let Some(w) = app.get_webview_window(&super::protocol::screen_label(id)) {
        let _ = w.close();
    }
}

/// Envoie un événement du socle aux fenêtres des plugins qui ont la permission `clips`
/// (`ibox:host`, comme les autres événements).
pub fn notify(app: &AppHandle, event: &str, payload: Value) {
    let detail = json!({ "event": event, "payload": payload }).to_string();
    let script = format!("window.dispatchEvent(new CustomEvent(\"ibox:host\", {{ detail: {detail} }}))");
    for a in super::all_active(app).into_iter().filter(|a| a.allows("clips")) {
        for label in [super::protocol::window_label(&a.id), super::protocol::screen_label(&a.id)] {
            if let Some(w) = app.get_webview_window(&label) {
                let _ = w.eval(&script);
            }
        }
    }
}

/// Arrête ce qu'un plugin a ouvert (avant désactivation, mise à jour ou désinstallation).
pub fn stop(app: &AppHandle, id: &str) {
    close_screen(app, id);
    super::panel::close(app, id);
    if music_plugin(app).is_some_and(|a| a.id == id) {
        crate::music::ytm::close(app);
        crate::music::overlay::configure(app, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::manifest::Manifest;

    fn active(perms: &[&str], granted: &[&str]) -> Active {
        let mut v = crate::plugins::install::tests::manifest_json("demo", "1.0.0");
        v["permissions"] = json!(perms);
        v["webview"] = json!({ "url": "https://music.youtube.com/" });
        let manifest: Manifest = serde_json::from_value(v).unwrap();
        Active { id: "demo".into(), dir: Default::default(), manifest, granted: granted.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn calls_need_a_permission_declared_and_granted() {
        let all = ["overlay", "media-session", "webview:https://music.youtube.com"];
        let a = active(&all, &all);
        assert!(allowed(&a, "overlay.close") && allowed(&a, "media.control") && allowed(&a, "webview.call"));
        assert!(!allowed(&a, "fs.read"));
        // déclarée mais pas accordée
        let b = active(&all, &["overlay"]);
        assert!(allowed(&b, "overlay.close") && !allowed(&b, "media.state") && !allowed(&b, "webview.call"));
        // accordée mais absente du manifeste
        let c = active(&["overlay"], &all);
        assert!(!allowed(&c, "media.state") && !allowed(&c, "webview.call"));
    }

    #[test]
    fn clips_and_screen_calls_are_gated() {
        let mut a = active(&["overlay", "clips"], &["overlay", "clips"]);
        assert!(allowed(&a, "clips.list") && allowed(&a, "clips.delete"));
        assert!(!allowed(&a, "screen.close"));
        a.manifest.screen = Some(crate::plugins::manifest::Screen { entry: "ui/studio.html".into(), title: None });
        assert!(allowed(&a, "screen.close"));
        a.granted = vec!["overlay".into()];
        assert!(!allowed(&a, "clips.list") && !allowed(&a, "clips.update"));
    }

    #[test]
    fn keeping_a_clip_needs_its_own_permission() {
        let a = active(&["overlay", "clips"], &["overlay", "clips"]);
        assert!(allowed(&a, "clips.thumb"));
        assert!(!allowed(&a, "clips.save") && !allowed(&a, "clips.status"));
        let b = active(&["overlay", "clips", "clips-capture"], &["overlay", "clips", "clips-capture"]);
        assert!(allowed(&b, "clips.save") && allowed(&b, "clips.status"));
        assert!(!allowed(&b, "edit.render"));
        assert!(!allowed(&b, "auto.set"));
        assert!(!allowed(&b, "auto.test"));
        assert!(!allowed(&b, "share.link") && !allowed(&b, "share.drag"));
        assert!(allowed(&b, "shot.save") && !allowed(&b, "capture.set"));
        let g = active(&["clips-settings"], &["clips-settings"]);
        assert!(allowed(&g, "capture.get") && allowed(&g, "capture.set") && !allowed(&g, "shot.save"));
        let s = active(&["clips-share"], &["clips-share"]);
        assert!(allowed(&s, "share.link") && allowed(&s, "share.send") && allowed(&s, "share.drag") && !allowed(&s, "auto.get"));
        let c = active(&["clips-auto"], &["clips-auto"]);
        assert!(allowed(&c, "auto.get") && allowed(&c, "auto.set") && allowed(&c, "auto.test"));
    }

    #[test]
    fn the_music_host_opens_only_what_was_granted() {
        let all = ["overlay", "hotkey", "gamepad", "backdrop", "webview:https://music.youtube.com"];
        let mut a = active(&all, &all);
        a.manifest.overlay.as_mut().unwrap().pad_combo = Some(vec!["back".into(), "y".into()]);
        let c = music_config(&a);
        assert!(c.hotkey && c.webview && c.backdrop);
        assert_eq!(c.combo, Some(crate::music::overlay::pad::COMBO));
        a.granted = vec!["overlay".into()];
        let c = music_config(&a);
        assert!(!c.hotkey && !c.webview && !c.backdrop && c.combo.is_none());
    }
}
