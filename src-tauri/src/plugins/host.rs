//! Socle natif des plugins : ce que la fenêtre d'un plugin peut demander, permission par
//! permission. La fenêtre n'a aucune capability Tauri ; ses appels arrivent par le protocole
//! (`POST /<id>/__host/<appel>`) et passent tous par [`call`].
//!
//! | Appel | Permission |
//! |---|---|
//! | `overlay.close` | `overlay` |
//! | `media.state`, `media.control` | `media-session` |
//! | `webview.call`, `webview.open`, `webview.status` | `webview:<origine>` |
//!
//! Le socle (fenêtre overlay, raccourci, manette, WebView isolée) reste endormi tant
//! qu'aucun plugin activé ne le demande (`apply`).

use serde_json::{json, Value};
use tauri::AppHandle;

use super::Active;

/// Permission requise par un appel ; `None` : appel inconnu.
pub fn permission_for(call: &str) -> Option<&'static str> {
    Some(match call {
        "overlay.close" => "overlay",
        "media.state" | "media.control" => "media-session",
        "webview.call" | "webview.open" | "webview.status" => "webview",
        _ => return None,
    })
}

/// Le plugin a-t-il le droit de faire cet appel ?
pub fn allowed(active: &Active, call: &str) -> bool {
    match permission_for(call) {
        Some("webview") => active.manifest.webview.is_some() && active.manifest.webview_origin().is_some_and(|o| active.allows(&format!("webview:{o}"))),
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
            crate::music::overlay::hide(app);
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

/// Arrête ce qu'un plugin a ouvert (avant désactivation, mise à jour ou désinstallation).
pub fn stop(app: &AppHandle, id: &str) {
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
