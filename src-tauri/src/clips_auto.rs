//! Clips automatiques (iClips 0.4, permission `clips-auto`) : un clip est gardé sans passer par
//! iBox quand on dit « Clip ça ! » (`voice.rs`), quand on maintient Vue + A sur la manette, ou à
//! la fin d'une partie. Chaque déclencheur s'active dans iClips ; rien ne tourne sans un plugin
//! activé qui a reçu `clips-auto`, ni hors d'une partie avec la mémoire des clips.
//!
//! Le micro n'est ouvert que pendant l'écoute ; une notification le dit à chaque début d'écoute
//! en partie (même en « Ne pas déranger ») et Windows montre son propre témoin.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::voice;

/// Déclencheurs choisis dans iClips. Au départ, « Clip ça ! » est activé (demande de Gébril,
/// 25/11/2026) : le micro n'écoute que pendant une partie, une notification le dit à chaque
/// début d'écoute, et l'option se coupe dans Automatique. Vue + A et fin de partie sont coupés.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Auto {
    #[serde(default = "yes")]
    pub voice: bool,
    #[serde(default)]
    pub pad: bool,
    #[serde(default)]
    pub end: bool,
}

fn yes() -> bool {
    true
}

impl Default for Auto {
    fn default() -> Self {
        Auto { voice: true, pad: false, end: false }
    }
}

/// Rien ne tourne : aucun plugin activé n'a reçu `clips-auto`.
const OFF: Auto = Auto { voice: false, pad: false, end: false };

impl Auto {
    /// Change seulement les champs donnés (`{voice?, pad?, end?}`).
    pub fn patched(mut self, v: &Value) -> Self {
        if let Some(b) = v["voice"].as_bool() { self.voice = b; }
        if let Some(b) = v["pad"].as_bool() { self.pad = b; }
        if let Some(b) = v["end"].as_bool() { self.end = b; }
        self
    }
}

/// Vue + A maintenus (masque XInput).
pub const PAD_COMBO: u16 = 0x0020 | 0x1000;
/// Deux clips automatiques à moins de 5 s d'écart : le second est ignoré (phrase répétée).
const COOLDOWN_MS: u64 = 5_000;
/// Essai de la voix depuis le Studio.
const TEST_MS: u64 = 8_000;
/// Après un échec de l'écoute, nouvel essai dans 30 s.
const RETRY_MS: u64 = 30_000;

static SETTINGS: Mutex<Option<Auto>> = Mutex::new(None);
/// Mémoire des clips tenue en ce moment : partie en cours, ou partout si demandé (`capture.rs`).
static PLAYING: AtomicBool = AtomicBool::new(false);
/// Combo manette armé : lu par le fil XInput du panneau (`plugins/panel.rs`).
static PAD: AtomicBool = AtomicBool::new(false);
static LISTENING: AtomicBool = AtomicBool::new(false);
static TEST_UNTIL: AtomicU64 = AtomicU64::new(0);
static RETRY_AT: AtomicU64 = AtomicU64::new(0);
static LAST: AtomicU64 = AtomicU64::new(0);
static VOICE_THREAD: AtomicBool = AtomicBool::new(false);
/// Dernière erreur de l'écoute et langue utilisée, pour iClips.
static VOICE: Mutex<(Option<String>, Option<String>)> = Mutex::new((None, None));
/// Micro écouté par « Clip ça ! » : celui choisi dans iClips, `None` : celui par défaut de Windows.
static VOICE_MIC: Mutex<Option<String>> = Mutex::new(None);

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

fn file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("clips-auto.json"))
}

pub fn settings(app: &AppHandle) -> Auto {
    if let Some(s) = SETTINGS.lock().ok().and_then(|g| *g) {
        return s;
    }
    let s = file(app).and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if let Ok(mut g) = SETTINGS.lock() { *g = Some(s); }
    s
}

/// `auto.set` : enregistre les déclencheurs et rend l'état.
pub fn set(app: &AppHandle, patch: &Value) -> Result<Value, String> {
    let s = settings(app).patched(patch);
    let f = file(app).ok_or("Dossier d'iBox introuvable.")?;
    if let Some(d) = f.parent() { let _ = std::fs::create_dir_all(d); }
    std::fs::write(&f, serde_json::to_vec(&s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if let Ok(mut g) = SETTINGS.lock() { *g = Some(s); }
    if !s.voice {
        // nouvel essai tout de suite à la prochaine activation
        RETRY_AT.store(0, Ordering::Relaxed);
    }
    tick(app, PLAYING.load(Ordering::Relaxed));
    Ok(status(app))
}

/// Un plugin activé a-t-il reçu `clips-auto` ?
fn allowed(app: &AppHandle) -> bool {
    crate::plugins::all_active(app).iter().any(|a| a.allows("clips-auto"))
}

fn armed(app: &AppHandle) -> Auto {
    if allowed(app) { settings(app) } else { OFF }
}

pub fn listening() -> bool {
    LISTENING.load(Ordering::Relaxed)
}

pub fn pad_armed() -> bool {
    PAD.load(Ordering::Relaxed)
}

/// `auto.get` : réglages, écoute en cours, langue et dernière erreur de la voix.
pub fn status(app: &AppHandle) -> Value {
    let s = settings(app);
    let (error, language) = VOICE.lock().map(|v| v.clone()).unwrap_or_default();
    let language = language.or_else(|| voice::pick(crate::plugins::look().0, &voice::languages()));
    json!({
        "voice": s.voice, "pad": s.pad, "end": s.end,
        "listening": listening(), "language": language, "error": error,
        "phrase": language.as_deref().map(|l| voice::phrases(l)[0]),
        "mic": VOICE_MIC.lock().ok().and_then(|m| m.clone()),
    })
}

/// Veille de `capture.rs`, toutes les 2 s : partie en cours (avec la mémoire des clips) ou non.
pub fn tick(app: &AppHandle, playing: bool) {
    PLAYING.store(playing, Ordering::Relaxed);
    let a = armed(app);
    PAD.store(playing && a.pad, Ordering::Relaxed);
    if a.voice || TEST_UNTIL.load(Ordering::Relaxed) > now() {
        voice_thread(app);
    }
}

/// `auto.test` : écoute 8 s, même hors partie ; `voice://heard` si la phrase est reconnue.
pub fn test(app: &AppHandle) -> Value {
    TEST_UNTIL.store(now() + TEST_MS, Ordering::Relaxed);
    RETRY_AT.store(0, Ordering::Relaxed);
    voice_thread(app);
    json!({ "ms": TEST_MS })
}

/// Un clip automatique peut-il partir maintenant ? (pas deux à moins de 5 s)
fn take_turn(last: &AtomicU64, at: u64) -> bool {
    let prev = last.load(Ordering::Relaxed);
    if prev != 0 && at.saturating_sub(prev) < COOLDOWN_MS {
        return false;
    }
    last.compare_exchange(prev, at, Ordering::Relaxed, Ordering::Relaxed).is_ok()
}

fn body(how: &str) -> &'static str {
    match how {
        "voice" => "Clip gardé : « Clip ça ! »",
        "pad" => "Clip gardé : Vue + A",
        _ => "Clip gardé : fin de partie",
    }
}

fn toast(app: &AppHandle, title: &str, body: &str, icon: &str, tone: &str) {
    crate::toast::push(app, json!({ "kind": "notice", "always": true, "friendId": "", "name": title, "body": body, "icon": icon, "tone": tone }));
}

fn save(app: &AppHandle, how: &'static str) {
    match tauri::async_runtime::block_on(crate::capture::save_clip_as(app.clone(), Some(how))) {
        // notification d'iClips : jaquette du jeu, son de déclencheur d'appareil photo
        Ok(c) => crate::toast::push(app, json!({
            "kind": "clip", "friendId": "", "name": c.game.clone().unwrap_or_else(|| "Bureau".into()),
            "gameTitle": c.game, "platformId": c.platform_id, "body": body(how), "clip": c.name,
        })),
        Err(e) => toast(app, "Clip impossible", &e, "play", "warn"),
    }
}

/// Voix ou manette : garde le clip sur un autre fil (la phrase ou le combo n'attendent pas).
pub fn trigger(app: &AppHandle, how: &'static str) {
    if !PLAYING.load(Ordering::Relaxed) || !take_turn(&LAST, now()) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || save(&app, how));
}

/// Fin de partie (veille de `capture.rs`, avant que la mémoire ne se vide).
pub fn on_game_end(app: &AppHandle) {
    if armed(app).end {
        save(app, "end");
    }
}

fn want_voice(app: &AppHandle) -> bool {
    TEST_UNTIL.load(Ordering::Relaxed) > now() || (PLAYING.load(Ordering::Relaxed) && armed(app).voice)
}

fn set_listening(app: &AppHandle, on: bool) {
    if LISTENING.swap(on, Ordering::Relaxed) != on {
        crate::plugins::host::notify(app, "voice://state", json!({ "listening": on }));
    }
}

fn heard(app: &AppHandle) {
    if TEST_UNTIL.swap(0, Ordering::Relaxed) > now() {
        crate::plugins::host::notify(app, "voice://heard", Value::Null);
        return;
    }
    if armed(app).voice {
        trigger(app, "voice");
    }
}

/// Fil de l'écoute : ouvre le micro quand il le faut, le ferme dès que ce n'est plus le cas.
fn voice_thread(app: &AppHandle) {
    if VOICE_THREAD.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut listener: Option<(voice::Listener, &'static str, Option<String>)> = None;
        loop {
            let want = want_voice(&app);
            let ui = crate::plugins::look().0;
            // micro choisi dans iClips (identifiant de Windows) : l'écoute le suit
            let mic = crate::clips::devices().1;
            if listener.as_ref().is_some_and(|(l, lang, m)| !want || !l.alive() || *lang != ui || *m != mic) {
                listener = None;
                set_listening(&app, false);
            }
            if want && listener.is_none() && now() >= RETRY_AT.load(Ordering::Relaxed) {
                match start(&app, ui, mic.as_deref()) {
                    Ok(l) => {
                        if let Ok(mut v) = VOICE.lock() { *v = (None, Some(l.tag().to_string())); }
                        let heard_on = if l.on_chosen() { mic.as_deref().and_then(|id| crate::remote_play::audio::endpoints(true).into_iter().find(|e| e.id == id).map(|e| e.name)) } else { None };
                        if let Ok(mut m) = VOICE_MIC.lock() { *m = heard_on; }
                        listener = Some((l, ui, mic));
                        set_listening(&app, true);
                        if PLAYING.load(Ordering::Relaxed) && TEST_UNTIL.load(Ordering::Relaxed) <= now() {
                            toast(&app, "« Clip ça ! » vous écoute", "Le micro écoute pour « Clip ça ! », sur ce PC seulement.", "sound", "info");
                        }
                    }
                    Err(e) => {
                        eprintln!("iBox : écoute de « Clip ça ! » impossible : {e}");
                        if let Ok(mut v) = VOICE.lock() { v.0 = Some(e.clone()); }
                        RETRY_AT.store(now() + RETRY_MS, Ordering::Relaxed);
                        crate::plugins::host::notify(&app, "voice://state", json!({ "listening": false, "error": e }));
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(400));
        }
    });
}

fn start(app: &AppHandle, ui: &str, mic: Option<&str>) -> Result<voice::Listener, String> {
    let tag = voice::pick(ui, &voice::languages())
        .ok_or("Windows ne sait reconnaître ni le français ni l'anglais sur ce PC (Paramètres Windows › Heure et langue › Langue : reconnaissance vocale).")?;
    // nom Windows du micro choisi (le moteur classique l'ouvre par son nom)
    let name = mic.and_then(|id| crate::remote_play::audio::endpoints(true).into_iter().find(|e| e.id == id).map(|e| e.name));
    let app = app.clone();
    voice::Listener::start(&tag, name.as_deref(), move || heard(&app))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_reglages_changent_champ_par_champ() {
        // au départ : « Clip ça ! » seul
        assert_eq!(Auto::default(), Auto { voice: true, pad: false, end: false });
        let a = OFF.patched(&json!({ "voice": true }));
        assert_eq!(a, Auto { voice: true, pad: false, end: false });
        let b = a.patched(&json!({ "pad": true, "end": "oui" }));
        assert_eq!(b, Auto { voice: true, pad: true, end: false });
        let read: Auto = serde_json::from_str(r#"{"pad":true}"#).unwrap();
        assert_eq!(read, Auto { voice: true, pad: true, end: false });
        // un « non » déjà donné reste un « non »
        let kept: Auto = serde_json::from_str(r#"{"voice":false}"#).unwrap();
        assert!(!kept.voice);
    }

    #[test]
    fn pas_deux_clips_automatiques_a_la_suite() {
        let last = AtomicU64::new(0);
        assert!(take_turn(&last, 10_000));
        assert!(!take_turn(&last, 12_000));
        assert!(!take_turn(&last, 14_999));
        assert!(take_turn(&last, 15_000));
    }

    #[test]
    fn le_combo_est_vue_et_a() {
        let names = ["back".to_string(), "a".to_string()];
        assert_eq!(crate::plugins::manifest::parse_combo(&names), Some(PAD_COMBO));
    }
}
