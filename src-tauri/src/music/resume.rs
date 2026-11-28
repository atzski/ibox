//! Reprise de la lecture : au lancement suivant, Music in the Box retrouve le même titre, à la
//! même position, au même volume, **en pause** (rien ne se met à jouer tout seul).
//!
//! Pendant la lecture, l'état est noté dans `music-resume.json` (dossier de données local) :
//! à chaque changement de titre ou de volume, et dès que la position a bougé de deux secondes
//! (relève toutes les trois secondes, même panneau fermé ou iBox masqué derrière un jeu). Il
//! n'y a donc rien à faire à la fermeture : le fichier a au plus trois secondes de retard.
//!
//! Au lancement, si un état a été noté, la page YouTube Music est chargée (cachée) quelques
//! secondes après le démarrage, puis pilotée avec les commandes que le pont a déjà (`volume`,
//! `playItem`, `pause`, `seek`) : aucun changement du pont, donc du plugin. Le titre démarre
//! volume à zéro, est mis en pause, placé, puis le volume est rendu : on n'entend rien.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::ytm;

const FILE: &str = "music-resume.json";
/// Relève de l'état quand personne d'autre ne le lit.
const SAVE_EVERY: Duration = Duration::from_secs(3);
/// Écart de position à partir duquel l'état est réécrit.
const POSITION_STEP_MS: u64 = 2000;
/// Délai avant de charger YouTube Music au lancement (iBox démarre d'abord).
const STARTUP_DELAY: Duration = Duration::from_secs(5);
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const LOAD_TIMEOUT: Duration = Duration::from_secs(20);

/// Ce qu'il faut pour reprendre.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub video_id: String,
    /// Playlist, album ou radio d'où vient le titre : la file d'attente revient avec lui.
    pub playlist_id: Option<String>,
    pub position_ms: u64,
    /// 0–100 ; absent si le lecteur ne l'a pas donné.
    pub volume: Option<u8>,
}

/// Reprise en cours : l'état (titre muet en train de se placer) n'est ni noté ni montré.
static RESTORING: AtomicBool = AtomicBool::new(false);
/// Dernier état écrit (ou relu) : on ne réécrit que ce qui a changé.
static WRITTEN: Mutex<Option<Saved>> = Mutex::new(None);

pub fn restoring() -> bool {
    RESTORING.load(Ordering::Relaxed)
}

/// État du pont (`state`) → ce qu'il faut noter. Rien tant qu'aucun titre n'est chargé
/// (-1 non démarré, 0 fini, 5 en file : la position n'y veut rien dire).
pub fn snapshot(v: &Value) -> Option<Saved> {
    let video_id = v.get("videoId").and_then(Value::as_str).filter(|s| !s.is_empty())?.to_string();
    if !matches!(v.get("playerState").and_then(Value::as_i64), Some(1..=3)) {
        return None;
    }
    let position = v.get("position").and_then(Value::as_f64).unwrap_or(0.0).max(0.0);
    Some(Saved {
        video_id,
        playlist_id: v.get("playlistId").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_string),
        position_ms: (position * 1000.0) as u64,
        volume: v.get("volume").and_then(Value::as_u64).map(|x| x.min(100) as u8),
    })
}

/// Faut-il réécrire le fichier ? Oui pour un autre titre, une autre liste, un autre volume,
/// ou une position qui a bougé d'au moins deux secondes (lecture, déplacement).
pub fn changed(last: Option<&Saved>, new: &Saved) -> bool {
    match last {
        None => true,
        Some(l) => l.video_id != new.video_id || l.playlist_id != new.playlist_id || l.volume != new.volume || l.position_ms.abs_diff(new.position_ms) >= POSITION_STEP_MS,
    }
}

/// Lit un état noté ; un fichier abîmé ou d'un autre format ne reprend rien.
pub fn parse(text: &str) -> Option<Saved> {
    serde_json::from_str::<Saved>(text).ok().filter(|s| !s.video_id.is_empty())
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    Some(app.path().app_local_data_dir().ok()?.join(FILE))
}

fn load(app: &AppHandle) -> Option<Saved> {
    parse(&std::fs::read_to_string(path(app)?).ok()?)
}

/// Note l'état lu sur le pont, s'il a changé. Appelé à chaque lecture de l'état (`current`).
pub fn remember(app: &AppHandle, state: &Value) {
    if restoring() {
        return;
    }
    let Some(new) = snapshot(state) else { return };
    let Ok(mut last) = WRITTEN.lock() else { return };
    if !changed(last.as_ref(), &new) {
        return;
    }
    let Some(file) = path(app) else { return };
    // écrit à côté puis renommé : jamais de fichier à moitié écrit si iBox se ferme à cet instant
    let tmp = file.with_extension("json.tmp");
    let Ok(text) = serde_json::to_string(&new) else { return };
    if std::fs::write(&tmp, text).and_then(|_| std::fs::rename(&tmp, &file)).is_ok() {
        *last = Some(new);
    }
}

/// Veille : charge YouTube Music au lancement s'il y a quelque chose à reprendre, reprend à
/// chaque création de sa fenêtre, puis note l'état toutes les trois secondes.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut had_window = false;
        let mut awake_since: Option<Instant> = None;
        let mut opened = false;
        loop {
            std::thread::sleep(if had_window { SAVE_EVERY } else { Duration::from_secs(1) });
            // plugin désactivé ou sans WebView : rien n'est lu, rien n'est ouvert
            if !super::overlay::config().is_some_and(|c| c.webview) {
                had_window = false;
                awake_since = None;
                continue;
            }
            let since = *awake_since.get_or_insert_with(Instant::now);
            if ytm::window(&app).is_none() {
                had_window = false;
                // une seule fois par lancement, et seulement s'il y a un titre à retrouver
                if !opened && since.elapsed() >= STARTUP_DELAY {
                    opened = true;
                    if ytm::known(&app) && load(&app).is_some() {
                        ytm::open(&app, false);
                    }
                }
                continue;
            }
            if !had_window {
                had_window = true;
                opened = true;
                if let Some(saved) = load(&app) {
                    RESTORING.store(true, Ordering::Relaxed);
                    let outcome = restore(&app, &saved);
                    RESTORING.store(false, Ordering::Relaxed);
                    super::diag::log(&app, &format!("reprise de la lecture : {outcome}"));
                    if let Ok(mut w) = WRITTEN.lock() {
                        *w = Some(saved);
                    }
                    super::emit_state(&app);
                }
                continue;
            }
            // lit l'état, ce qui le note (`current` appelle `remember`)
            let _ = super::current(&app);
        }
    });
}

/// État du pont ; ses lignes de journal vont dans `music.log` comme pour les autres lectures.
fn state(app: &AppHandle) -> Option<Value> {
    let v = ytm::call(app, "state", Value::Null).ok()?;
    super::diag::music(app, &ytm::log_lines(&v));
    Some(v)
}

fn player_state(v: &Value) -> i64 {
    v.get("playerState").and_then(Value::as_i64).unwrap_or(-1)
}

fn video(v: &Value) -> Option<&str> {
    v.get("videoId").and_then(Value::as_str)
}

/// Remet le titre noté en place, en pause. Bloquant (jusqu'à une minute si la page tarde).
fn restore(app: &AppHandle, saved: &Saved) -> &'static str {
    // 1. la page et son lecteur sont prêts
    let deadline = Instant::now() + READY_TIMEOUT;
    let first = loop {
        if ytm::window(app).is_none() {
            return "fenêtre fermée";
        }
        if let Some(v) = state(app).filter(|v| v.get("ready").and_then(Value::as_bool) == Some(true)) {
            break v;
        }
        if Instant::now() > deadline {
            return "lecteur pas prêt";
        }
        std::thread::sleep(Duration::from_millis(400));
    };
    // l'utilisateur a déjà lancé quelque chose : on ne touche à rien
    if video(&first).is_some() && matches!(player_state(&first), 1..=3) {
        return "un titre est déjà chargé";
    }
    // 2. volume à zéro le temps du chargement (le titre démarre toujours en lecture)
    let volume = saved.volume.or_else(|| first.get("volume").and_then(Value::as_u64).map(|x| x.min(100) as u8));
    if volume.is_some() {
        let _ = ytm::call(app, "volume", json!({ "value": 0 }));
    }
    let give_back = |app: &AppHandle| {
        if let Some(v) = volume {
            let _ = ytm::call(app, "volume", json!({ "value": v }));
        }
    };
    // 3. le titre, dans sa liste
    let mut item = json!({ "videoId": saved.video_id });
    if let Some(list) = &saved.playlist_id {
        item["playlistId"] = json!(list);
    }
    if ytm::call(app, "playItem", item).is_err() {
        give_back(app);
        return "titre refusé";
    }
    // 4. il est chargé et joue (muet)
    let deadline = Instant::now() + LOAD_TIMEOUT;
    loop {
        std::thread::sleep(Duration::from_millis(250));
        // un rechargement complet de la page (repli de `playItem`) fait échouer quelques lectures
        let loaded = state(app).is_some_and(|v| video(&v) == Some(saved.video_id.as_str()) && matches!(player_state(&v), 1 | 2));
        if loaded {
            break;
        }
        if Instant::now() > deadline {
            let _ = ytm::call(app, "pause", Value::Null);
            give_back(app);
            return "titre pas chargé à temps";
        }
    }
    // 5. pause, puis la position ; revérifié trois fois (une publicité ou la page peuvent relancer)
    let seconds = saved.position_ms as f64 / 1000.0;
    let _ = ytm::call(app, "pause", Value::Null);
    std::thread::sleep(Duration::from_millis(150));
    let _ = ytm::call(app, "seek", json!({ "seconds": seconds }));
    for _ in 0..3 {
        std::thread::sleep(Duration::from_millis(300));
        let Some(v) = state(app) else { continue };
        if video(&v) != Some(saved.video_id.as_str()) {
            break;
        }
        let playing = player_state(&v) == 1;
        let off = (v.get("position").and_then(Value::as_f64).unwrap_or(0.0) - seconds).abs() > 3.0;
        if !playing && !off {
            break;
        }
        if playing {
            let _ = ytm::call(app, "pause", Value::Null);
        }
        if off {
            let _ = ytm::call(app, "seek", json!({ "seconds": seconds }));
        }
    }
    // 6. le volume d'avant
    give_back(app);
    "titre remis en pause à sa position"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(id: &str, position_ms: u64, volume: Option<u8>) -> Saved {
        Saved { video_id: id.into(), playlist_id: None, position_ms, volume }
    }

    #[test]
    fn a_loaded_track_is_noted_with_its_position_volume_and_list() {
        let v = json!({ "videoId": "abc", "playerState": 2, "playlistId": "RDAMVMabc", "position": 83.4, "duration": 200.0, "volume": 35 });
        assert_eq!(snapshot(&v), Some(Saved { video_id: "abc".into(), playlist_id: Some("RDAMVMabc".into()), position_ms: 83_400, volume: Some(35) }));
        // en lecture, sans liste ni volume connus
        let v = json!({ "videoId": "abc", "playerState": 1, "playlistId": null, "position": 1.0 });
        assert_eq!(snapshot(&v), Some(saved("abc", 1000, None)));
    }

    #[test]
    fn nothing_is_noted_while_no_track_is_loaded() {
        assert_eq!(snapshot(&json!({ "playerState": 1, "position": 3.0 })), None);
        assert_eq!(snapshot(&json!({ "videoId": null, "playerState": 1 })), None);
        // non démarré, fini, en file : la position ne veut rien dire
        for state in [-1, 0, 5] {
            assert_eq!(snapshot(&json!({ "videoId": "abc", "playerState": state, "position": 0.0 })), None);
        }
        assert_eq!(snapshot(&json!({ "videoId": "abc", "playerState": null })), None);
    }

    #[test]
    fn the_file_is_rewritten_only_when_something_moved() {
        let last = saved("abc", 10_000, Some(40));
        assert!(changed(None, &last));
        assert!(!changed(Some(&last), &last));
        // en pause, ou une demi-seconde plus loin : rien à écrire
        assert!(!changed(Some(&last), &saved("abc", 10_500, Some(40))));
        assert!(changed(Some(&last), &saved("abc", 12_000, Some(40))));
        // retour en arrière, autre volume, autre titre, autre liste
        assert!(changed(Some(&last), &saved("abc", 2_000, Some(40))));
        assert!(changed(Some(&last), &saved("abc", 10_000, Some(41))));
        assert!(changed(Some(&last), &saved("xyz", 10_000, Some(40))));
        assert!(changed(Some(&last), &Saved { playlist_id: Some("PL1".into()), ..last.clone() }));
    }

    #[test]
    fn a_noted_state_is_read_back_and_a_damaged_file_resumes_nothing() {
        let s = Saved { video_id: "abc".into(), playlist_id: Some("PL1".into()), position_ms: 83_400, volume: Some(35) };
        assert_eq!(parse(&serde_json::to_string(&s).unwrap()), Some(s));
        assert_eq!(parse(r#"{"videoId":"abc","positionMs":5}"#), Some(saved("abc", 5, None)));
        assert_eq!(parse(""), None);
        assert_eq!(parse(r#"{"videoId":"abc","positi"#), None);
        assert_eq!(parse(r#"{"videoId":"","positionMs":5}"#), None);
        assert_eq!(parse(r#"{"positionMs":5}"#), None);
    }
}
