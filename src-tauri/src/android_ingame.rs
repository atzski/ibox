//! Pendant une partie sur Android (docs/ANDROID.md §17) : l'émulateur occupe l'écran, iBox est
//! derrière et son interface dort. Ce module fait le travail à sa place :
//!
//! - **session** : écoute `launch://started` / `launch://ended` (émis par `launcher/android.rs` et
//!   `android_apps`) et démarre / arrête le service « Partie en cours » du plugin `ibox-ingame` ;
//! - **succès** : veille RetroAchievements native (comme `startRaWatch` de `services/retro.ts`,
//!   qui s'efface sur Android), notification Android et événement `ra-live` pour l'interface ;
//! - **amis** : chaque nouvelle de `toast::push` (fil d'iNetbox) devient une notification Android
//!   quand iBox n'est pas devant ([`on_toast`]).
//!
//! Réglages et textes (langue d'iBox) envoyés par l'interface (`android_notify_configure`, depuis
//! `services/androidNotify.ts`). Hors d'Android, les commandes répondent sans rien faire ; la
//! logique (choix du canal, textes, nouveautés) est testée sous Windows.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        atomic::{AtomicBool, AtomicI32, Ordering},
        Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_ibox_android::ingame::{Channel, IboxIngameExt, NotifyStatus, Post};

/// Réglages de l'interface (Paramètres › Système › Pendant les parties).
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Prefs {
    /// « Notifications » d'iBox, hors « Ne pas déranger ».
    pub enabled: bool,
    pub achievements: bool,
    pub messages: bool,
    /// Activité des amis, demandes, invitations, mentions.
    pub friends: bool,
    /// Notification « Partie en cours » (et le service qui garde iBox éveillé).
    pub session: bool,
    /// Compte RetroAchievements (la clé reste dans le coffre, `metadata::keys`).
    pub ra_user: Option<String>,
    /// Textes dans la langue d'iBox ; absents : français ([`text`]).
    pub texts: HashMap<String, String>,
}

impl Default for Prefs {
    fn default() -> Self {
        Self { enabled: true, achievements: true, messages: true, friends: true, session: true, ra_user: None, texts: HashMap::new() }
    }
}

static PREFS: Mutex<Option<Prefs>> = Mutex::new(None);
static STARTED: AtomicBool = AtomicBool::new(false);
static NEXT_ID: AtomicI32 = AtomicI32::new(100);

fn prefs() -> Prefs {
    PREFS.lock().ok().and_then(|p| p.clone()).unwrap_or_default()
}

/// Textes par défaut (français) ; l'interface envoie leur traduction.
fn default_text(key: &str) -> &'static str {
    match key {
        "achievement.title" => "Succès débloqué : {0}",
        "achievement.points" => "{0} · {1} points",
        "achievement.point" => "{0} · 1 point",
        "achievement.hardcore" => "{0} · Hardcore",
        "friend.game" => "{0} lance « {1} »",
        "friend.request" => "{0} vous a ajouté en ami",
        "friend.invite" => "{0} vous invite à « {1} »",
        "friend.message" => "{0} vous a écrit",
        _ => "",
    }
}

/// Texte de la langue d'iBox, ses `{0}`, `{1}`… remplacés.
fn text(p: &Prefs, key: &str, values: &[&str]) -> String {
    let template = p.texts.get(key).map(String::as_str).filter(|t| !t.is_empty()).unwrap_or_else(|| default_text(key));
    values.iter().enumerate().fold(template.to_string(), |acc, (i, v)| acc.replace(&format!("{{{i}}}"), v))
}

// ——— Nouvelles des amis ———

/// Canal d'une nouvelle de `toast::push` ; `None` : pas de notification Android.
fn toast_channel(payload: &Value) -> Option<Channel> {
    match payload["kind"].as_str()? {
        "message" => Some(Channel::Messages),
        "game" => Some(Channel::Friends),
        "request" | "invite" => Some(Channel::Requests),
        "notice" => Some(match payload["link"]["kind"].as_str() {
            Some("achievements") => Channel::Achievements,
            Some("community") | Some("friends") => Channel::Requests,
            _ => Channel::Notices,
        }),
        // mises à jour (Paramètres › Système) et clips (pas sur Android) : rien
        _ => None,
    }
}

fn channel_allowed(p: &Prefs, c: Channel) -> bool {
    p.enabled
        && match c {
            Channel::Achievements => p.achievements,
            Channel::Messages => p.messages,
            Channel::Friends | Channel::Requests => p.friends,
            Channel::Notices => true,
        }
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

/// Titre et texte d'une nouvelle des amis.
fn toast_text(p: &Prefs, payload: &Value) -> (String, Option<String>) {
    let s = |k: &str| payload[k].as_str().unwrap_or_default().to_string();
    let name = clip(&s("name"), 60);
    let body = Some(clip(&s("body"), 300)).filter(|b| !b.is_empty());
    match s("kind").as_str() {
        "message" => (text(p, "friend.message", &[&name]), body),
        "game" => (text(p, "friend.game", &[&name, &clip(&s("gameTitle"), 80)]), None),
        "request" => (text(p, "friend.request", &[&name]), None),
        "invite" => (text(p, "friend.invite", &[&name, &clip(&s("gameTitle"), 80)]), None),
        _ => (name, body),
    }
}

/// Identifiant Android : les messages d'un même ami se remplacent, le reste s'empile.
fn toast_id(payload: &Value) -> i32 {
    if payload["kind"] == "message" {
        let friend = payload["friendId"].as_str().unwrap_or_default();
        let h = friend.bytes().fold(5381u32, |h, b| h.wrapping_mul(33) ^ b as u32);
        return 10_000 + (h % 1_000_000) as i32;
    }
    next_id()
}

fn next_id() -> i32 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    if id > 9_000 { NEXT_ID.store(100, Ordering::Relaxed); }
    id
}

/// Appelé par `toast::push` (après ses propres filtres) : notification Android si iBox est derrière.
pub fn on_toast(app: &AppHandle, payload: &Value) {
    if !cfg!(target_os = "android") { return; }
    let p = prefs();
    let Some(channel) = toast_channel(payload).filter(|&c| channel_allowed(&p, c)) else { return };
    let (title, body) = toast_text(&p, payload);
    let post = Post {
        id: toast_id(payload),
        channel,
        title,
        body,
        image: None,
        tap: Some(json!({ "toast": payload }).to_string()),
        only_in_background: true,
    };
    let app = app.clone();
    std::thread::spawn(move || { let _ = app.ibox_ingame().post(&post); });
}

// ——— Session ———

struct Watch {
    playing: bool,
    /// Fin de la dernière partie : la veille continue 5 min après.
    last_play: Option<Instant>,
    /// Les succès déjà obtenus ne sont pas annoncés : première lecture d'une session = amorce.
    primed: bool,
    seen: BTreeSet<u64>,
    /// Réveil demandé (début de partie).
    wake: bool,
}

static WATCH: Mutex<Watch> = Mutex::new(Watch { playing: false, last_play: None, primed: false, seen: BTreeSet::new(), wake: false });
static WAKE: Condvar = Condvar::new();

const AFTER_PLAY: Duration = Duration::from_secs(5 * 60);

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn on_started(app: &AppHandle, payload: &str) {
    let v: Value = serde_json::from_str(payload).unwrap_or(Value::Null);
    if let Ok(mut w) = WATCH.lock() {
        w.playing = true;
        w.primed = false;
        w.wake = true;
    }
    WAKE.notify_all();
    if !prefs().session { return; }
    let title = v["title"].as_str().unwrap_or_default().to_string();
    let emulator = v["emulatorName"].as_str().or(v["emulator_name"].as_str()).unwrap_or_default().to_string();
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = app.ibox_ingame().session_start(&title, &emulator, now_ms()) {
            eprintln!("iBox : notification de la partie indisponible : {e}");
        }
    });
}

fn on_ended(app: &AppHandle) {
    if let Ok(mut w) = WATCH.lock() {
        w.playing = false;
        w.last_play = Some(Instant::now());
    }
    let app = app.clone();
    std::thread::spawn(move || { let _ = app.ibox_ingame().session_stop(); });
}

// ——— Succès ———

/// Un succès de `API_GetUserRecentAchievements` (champs utiles seulement).
#[derive(Debug, Clone, PartialEq)]
struct Unlock {
    id: u64,
    title: String,
    points: u64,
    hardcore: bool,
    badge: Option<String>,
    game_id: u64,
    game_title: String,
}

fn num(v: &Value) -> u64 {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0)
}

fn parse_unlock(v: &Value) -> Option<Unlock> {
    let id = num(&v["AchievementID"]);
    (id > 0).then(|| Unlock {
        id,
        title: v["Title"].as_str().unwrap_or_default().to_string(),
        points: num(&v["Points"]),
        hardcore: num(&v["HardcoreMode"]) == 1,
        badge: v["BadgeName"].as_str().filter(|b| !b.is_empty() && b.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')).map(str::to_string),
        game_id: num(&v["GameID"]),
        game_title: v["GameTitle"].as_str().unwrap_or_default().to_string(),
    })
}

/// Succès jamais vus, du plus ancien au plus récent (5 au plus) ; rien à l'amorce.
fn fresh(seen: &mut BTreeSet<u64>, primed: &mut bool, rows: &[Value]) -> Vec<(Unlock, Value)> {
    let list: Vec<(Unlock, Value)> = rows.iter().filter_map(|r| parse_unlock(r).map(|u| (u, r.clone()))).collect();
    let new: Vec<(Unlock, Value)> = list.iter().filter(|(u, _)| !seen.contains(&u.id)).cloned().collect();
    seen.extend(list.iter().map(|(u, _)| u.id));
    if !*primed {
        *primed = true;
        return vec![];
    }
    new.into_iter().take(5).rev().collect()
}

fn unlock_body(p: &Prefs, u: &Unlock) -> String {
    let points = u.points.to_string();
    let body = if u.points == 1 { text(p, "achievement.point", &[&u.game_title]) } else { text(p, "achievement.points", &[&u.game_title, &points]) };
    if u.hardcore { text(p, "achievement.hardcore", &[&body]) } else { body }
}

/// Badge du succès (PNG), pour la grande icône de la notification. Attendu 3 s au plus : la
/// résolution du nom n'obéit pas au délai de reqwest (60 s vus dans l'AVD), et une notification
/// en retard ne sert plus à rien ; sans badge, elle part sans grande icône.
fn badge(name: &str) -> Option<String> {
    use base64::Engine;
    let url = format!("https://media.retroachievements.org/Badge/{name}.png");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let fetch = || -> Option<Vec<u8>> {
            let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(8)).build().ok()?;
            let bytes = client.get(url).send().ok()?.error_for_status().ok()?.bytes().ok()?;
            (bytes.len() < 256 * 1024).then(|| bytes.to_vec())
        };
        let _ = tx.send(fetch());
    });
    let bytes = rx.recv_timeout(Duration::from_secs(3)).ok().flatten()?;
    Some(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Essais dans l'émulateur du PC (versions de débogage seulement) : `ra-simulate.json` dans les
/// données d'iBox remplace la réponse de RetroAchievements (docs/ANDROID.md §17.6).
fn simulated(app: &AppHandle) -> Option<Vec<Value>> {
    if !cfg!(debug_assertions) { return None; }
    let path = app.path().app_data_dir().ok()?.join("ra-simulate.json");
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<Vec<Value>>(&raw).ok()
}

fn recent(app: &AppHandle, user: Option<&str>) -> Option<Vec<Value>> {
    if let Some(rows) = simulated(app) { return Some(rows); }
    let user = user.filter(|u| !u.is_empty())?;
    let mut params = serde_json::Map::new();
    params.insert("u".into(), json!(user));
    params.insert("m".into(), json!(30));
    let v = tauri::async_runtime::block_on(crate::achievements::ra_api("API_GetUserRecentAchievements".into(), params)).ok()?;
    v.as_array().cloned()
}

fn announce(app: &AppHandle, p: &Prefs, u: &Unlock, raw: &Value) {
    // l'interface (endormie ou non) tient à jour `useRaLive`, le centre de notifications et
    // l'écran du bas de la Thor
    let _ = app.emit_to("main", "ra-live", raw);
    if !channel_allowed(p, Channel::Achievements) { return; }
    let post = Post {
        id: 20_000_000 + (u.id % 10_000_000) as i32,
        channel: Channel::Achievements,
        title: text(p, "achievement.title", &[&u.title]),
        body: Some(unlock_body(p, u)),
        image: u.badge.as_deref().and_then(badge),
        tap: Some(json!({ "link": { "kind": "achievements", "gameId": format!("ra-{}", u.game_id) } }).to_string()),
        only_in_background: true,
    };
    let _ = app.ibox_ingame().post(&post);
}

fn interval() -> Duration {
    if crate::power::status().on_battery { Duration::from_secs(90) } else { Duration::from_secs(45) }
}

/// Fil de veille : lit les succès récents pendant la partie et 5 min après.
fn watch_loop(app: AppHandle) {
    loop {
        {
            let Ok(guard) = WATCH.lock() else { return };
            let (mut w, _) = WAKE.wait_timeout_while(guard, interval(), |w| !w.wake).unwrap_or_else(|e| e.into_inner());
            w.wake = false;
            let active = w.playing || w.last_play.is_some_and(|t| t.elapsed() < AFTER_PLAY);
            if !active { continue; }
        }
        let p = prefs();
        let Some(rows) = recent(&app, p.ra_user.as_deref()) else { continue };
        let news = {
            let Ok(mut w) = WATCH.lock() else { return };
            let Watch { seen, primed, .. } = &mut *w;
            fresh(seen, primed, &rows)
        };
        for (u, raw) in &news { announce(&app, &p, u, raw); }
    }
}

/// Premier réglage reçu : écoute des parties et fil de veille (une fois).
fn start(app: &AppHandle) {
    if !cfg!(target_os = "android") || STARTED.swap(true, Ordering::SeqCst) { return; }
    let a = app.clone();
    app.listen("launch://started", move |e| on_started(&a, e.payload()));
    let a = app.clone();
    app.listen("launch://ended", move |_| on_ended(&a));
    let a = app.clone();
    std::thread::spawn(move || watch_loop(a));
}

// ——— Commandes ———

async fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&AppHandle) -> tauri_plugin_ibox_android::Result<T> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app).map_err(|e| e.to_string())).await.map_err(|e| e.to_string())?
}

/// Réglages et textes de l'interface ; démarre la veille au premier appel.
#[tauri::command]
pub async fn android_notify_configure(app: AppHandle, prefs: Prefs) -> Result<(), String> {
    let texts = prefs.texts.clone();
    if let Ok(mut p) = PREFS.lock() { *p = Some(prefs); }
    if !cfg!(target_os = "android") { return Ok(()); }
    start(&app);
    blocking(app, move |a| a.ibox_ingame().configure(&texts)).await
}

/// Autorisation des notifications, et toucher d'une notification à ouvrir (une fois).
#[tauri::command]
pub async fn android_notify_status(app: AppHandle) -> Result<NotifyStatus, String> {
    if !cfg!(target_os = "android") { return Ok(NotifyStatus::default()); }
    blocking(app, |a| a.ibox_ingame().status()).await
}

/// Dialogue d'Android, ou ses Paramètres si le dialogue n'est plus permis.
#[tauri::command]
pub async fn android_notify_request(app: AppHandle) -> Result<NotifyStatus, String> {
    if !cfg!(target_os = "android") { return Ok(NotifyStatus::default()); }
    blocking(app, |a| a.ibox_ingame().request()).await
}

/// Page des notifications d'iBox dans les Paramètres d'Android.
#[tauri::command]
pub async fn android_notify_settings(app: AppHandle) -> Result<(), String> {
    if !cfg!(target_os = "android") { return Ok(()); }
    blocking(app, |a| a.ibox_ingame().open_settings()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: u64, points: u64) -> Value {
        json!({ "AchievementID": id, "Title": format!("S{id}"), "Points": points, "HardcoreMode": 0, "BadgeName": "12345", "GameID": 7, "GameTitle": "Jeu" })
    }

    #[test]
    fn amorce_puis_nouveautes_du_plus_ancien_au_plus_recent() {
        let (mut seen, mut primed) = (BTreeSet::new(), false);
        assert!(fresh(&mut seen, &mut primed, &[row(1, 5)]).is_empty(), "amorce");
        // l'API rend les plus récents d'abord
        let news = fresh(&mut seen, &mut primed, &[row(3, 10), row(2, 5), row(1, 5)]);
        assert_eq!(news.iter().map(|(u, _)| u.id).collect::<Vec<_>>(), vec![2, 3]);
        assert!(fresh(&mut seen, &mut primed, &[row(3, 10), row(2, 5)]).is_empty());
    }

    #[test]
    fn textes_traduits_et_pluriel() {
        let mut p = Prefs::default();
        let u = parse_unlock(&row(1, 1)).unwrap();
        assert_eq!(unlock_body(&p, &u), "Jeu · 1 point");
        let mut hard = parse_unlock(&row(2, 10)).unwrap();
        hard.hardcore = true;
        assert_eq!(unlock_body(&p, &hard), "Jeu · 10 points · Hardcore");
        p.texts.insert("achievement.title".into(), "Achievement unlocked: {0}".into());
        assert_eq!(text(&p, "achievement.title", &["Boss"]), "Achievement unlocked: Boss");
        // badge douteux : pas d'adresse construite avec
        assert!(parse_unlock(&json!({ "AchievementID": 9, "BadgeName": "../x" })).unwrap().badge.is_none());
    }

    #[test]
    fn canaux_et_reglages() {
        let mut p = Prefs::default();
        assert_eq!(toast_channel(&json!({ "kind": "message" })), Some(Channel::Messages));
        assert_eq!(toast_channel(&json!({ "kind": "game" })), Some(Channel::Friends));
        assert_eq!(toast_channel(&json!({ "kind": "invite" })), Some(Channel::Requests));
        assert_eq!(toast_channel(&json!({ "kind": "notice", "link": { "kind": "community" } })), Some(Channel::Requests));
        assert_eq!(toast_channel(&json!({ "kind": "notice", "link": { "kind": "achievements" } })), Some(Channel::Achievements));
        assert_eq!(toast_channel(&json!({ "kind": "update" })), None);
        p.messages = false;
        assert!(!channel_allowed(&p, Channel::Messages) && channel_allowed(&p, Channel::Friends));
        p.enabled = false;
        assert!(!channel_allowed(&p, Channel::Notices));
    }

    #[test]
    fn nouvelles_des_amis() {
        let p = Prefs::default();
        let (t, b) = toast_text(&p, &json!({ "kind": "game", "name": "Alex", "gameTitle": "Zelda" }));
        assert_eq!((t.as_str(), b), ("Alex lance « Zelda »", None));
        let (t, b) = toast_text(&p, &json!({ "kind": "message", "name": "Alex", "body": "On joue ?" }));
        assert_eq!((t.as_str(), b.as_deref()), ("Alex vous a écrit", Some("On joue ?")));
        let m = json!({ "kind": "message", "friendId": "f1" });
        assert_eq!(toast_id(&m), toast_id(&m), "les messages d'un ami se remplacent");
    }

    #[test]
    fn reglages_partiels_de_l_interface() {
        let p: Prefs = serde_json::from_str(r#"{"messages":false,"raUser":"Joueur"}"#).unwrap();
        assert!(p.enabled && p.session && !p.messages);
        assert_eq!(p.ra_user.as_deref(), Some("Joueur"));
    }
}
