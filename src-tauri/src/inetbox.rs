//! Native iNetbox transport: no bearer tokens in React or localStorage.
use crate::metadata::keys;
use reqwest::{blocking::Client, Method, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, io::Read, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Mutex, OnceLock}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter, Manager};

static LOCK: Mutex<()> = Mutex::new(());
static CLIENT: OnceLock<Client> = OnceLock::new();
static SNAPSHOT: Mutex<Option<(Instant, Value)>> = Mutex::new(None);
static HEARTBEAT: Mutex<Option<(Instant, Value)>> = Mutex::new(None);
static USER: Mutex<Option<Value>> = Mutex::new(None);
static ACTIVE: AtomicBool = AtomicBool::new(false);
static RETRY_AT: AtomicU64 = AtomicU64::new(0);
/// Serveur iNetbox en ligne (Render + Neon). `IBOX_INETBOX_URL` le remplace à la
/// compilation, par exemple par le serveur local de développement (http://127.0.0.1:4318).
const SERVICE: &str = match option_env!("IBOX_INETBOX_URL") { Some(url) => url, None => "https://inetbox-server.onrender.com" };

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Error { code: String, message: String, retry_after_seconds: Option<u64> }
type Result<T> = std::result::Result<T, Error>;
impl Error { pub(crate) fn new(code: &str, message: &str) -> Self { err(code, message) } }
fn err(code: &str, message: &str) -> Error { Error { code: code.into(), message: message.into(), retry_after_seconds: None } }
fn vault_error() -> Error { err("VAULT_ERROR", "Le coffre Windows est indisponible.") }
fn base_url(raw: &str) -> Result<Url> {
    let u = Url::parse(raw).map_err(|_| err("CONFIG_ERROR", "Adresse iNetbox invalide."))?;
    let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(u.scheme() == "https" || (u.scheme() == "http" && local)) || !u.username().is_empty() || u.password().is_some() || u.query().is_some() || u.fragment().is_some() || u.path() != "/" {
        return Err(err("CONFIG_ERROR", "iNetbox exige HTTPS, sauf en local."));
    }
    Ok(u)
}
/// Session propre au profil local actif : chaque joueur du PC a son compte iNetbox.
fn credential() -> String { credential_with(&crate::profile::suffix()) }
fn credential_with(suffix: &str) -> String { format!("inetbox-session-{:016x}{}", xxhash_rust::xxh3::xxh3_64(SERVICE.as_bytes()), suffix) }
/// Profil local supprimé : efface sa session de ce PC (le compte reste sur iNetbox).
pub fn forget_stored_session(profile: &str) {
    let _ = keys::delete(&credential_with(&crate::profile::suffix_for(profile)));
}
/// Changement de profil : oublie l'état en mémoire (la session du profil reste dans le coffre).
pub fn forget_session() {
    if let Ok(mut g) = SNAPSHOT.lock() { *g = None; }
    if let Ok(mut g) = HEARTBEAT.lock() { *g = None; }
    if let Ok(mut g) = USER.lock() { *g = None; }
    if let Ok(mut g) = SEEN.lock() { *g = None; }
    ACTIVE.store(false, Ordering::Relaxed);
}
fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() }
fn http(client: &Client, method: Method, path: &str, token: Option<&str>, body: Option<&Value>) -> Result<Value> {
    let wait = RETRY_AT.load(Ordering::Relaxed).saturating_sub(now());
    if wait > 0 {
        return Err(Error { retry_after_seconds: Some(wait), ..err("RATE_LIMITED", "iNetbox reprendra après une courte pause.") });
    }
    let url = base_url(SERVICE)?.join(path).map_err(|_| err("CONFIG_ERROR", "Route invalide."))?;
    let mut request = client.request(method, url);
    if let Some(token) = token { request = request.bearer_auth(token); }
    if let Some(body) = body { request = request.json(body); }
    let response = request.send().map_err(|_| {
        RETRY_AT.store(now().saturating_add(25), Ordering::Relaxed);
        err("NETWORK_ERROR", "iNetbox est injoignable. Votre bibliothèque reste disponible hors ligne.")
    })?;
    let status = response.status();
    let retry: Option<u64> = response.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok());
    if status.as_u16() == 429 { RETRY_AT.store(now().saturating_add(retry.unwrap_or(60)), Ordering::Relaxed); }
    if status.is_server_error() { RETRY_AT.store(now().saturating_add(retry.unwrap_or(25)), Ordering::Relaxed); }
    let mut bytes = Vec::new();
    response.take(512 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| err("NETWORK_ERROR", "Réponse iNetbox interrompue."))?;
    if bytes.len() > 512 * 1024 { return Err(err("INVALID_RESPONSE", "Réponse iNetbox trop volumineuse.")); }
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if !status.is_success() {
        // codes connus du serveur (comptes par e-mail) : messages fixes, jamais le texte reçu
        let known = match value["error"]["code"].as_str().unwrap_or_default() {
            "INVALID_CODE" => Some(("INVALID_CODE", "Code incorrect ou expiré. Demandez-en un nouveau.")),
            "EMAIL_UNAVAILABLE" => Some(("EMAIL_UNAVAILABLE", "Cette adresse e-mail est déjà utilisée par un autre compte.")),
            "MAIL_UNAVAILABLE" => Some(("MAIL_UNAVAILABLE", "L’envoi d’e-mails n’est pas encore disponible sur iNetbox.")),
            "MAIL_FAILED" => Some(("MAIL_FAILED", "L’e-mail n’a pas pu partir. Réessayez dans un instant.")),
            _ => None,
        };
        if let Some((code, message)) = known {
            return Err(Error { code: code.into(), message: message.into(), retry_after_seconds: None });
        }
        let (code, message) = match status.as_u16() {
            401 => ("UNAUTHENTICATED", "Identifiants incorrects ou session expirée. Reconnectez-vous."),
            400 => ("INVALID_INPUT", "Vérifiez les champs envoyés."),
            404 => ("NOT_FOUND", "Compte ou invitation indisponible."),
            409 => ("CONFLICT", "Ce nom est indisponible, ou cette relation existe déjà."),
            429 => ("RATE_LIMITED", "Trop de demandes. Patientez avant de réessayer."),
            _ => ("SERVICE_ERROR", "iNetbox est momentanément indisponible."),
        };
        return Err(Error { code: code.into(), message: message.into(), retry_after_seconds: retry });
    }
    if status.as_u16() != 204 && value.is_null() { return Err(err("INVALID_RESPONSE", "Réponse iNetbox invalide.")); }
    Ok(value)
}
fn clear_session() -> Result<()> {
    *SNAPSHOT.lock().map_err(|_| vault_error())? = None;
    *HEARTBEAT.lock().map_err(|_| vault_error())? = None;
    ACTIVE.store(false, Ordering::Relaxed);
    *USER.lock().map_err(|_| vault_error())? = None;
    keys::delete(&credential()).map_err(|_| vault_error())
}
fn public_user(user: &Value) -> Result<Value> {
    if ["id", "username", "displayName", "friendCode"].iter().any(|k| !user[*k].is_string()) || !user["privacy"]["shareOnline"].is_boolean() || !user["privacy"]["shareGame"].is_boolean() {
        return Err(err("INVALID_RESPONSE", "Compte iNetbox invalide."));
    }
    let avatar = if user["avatar"].is_object() { user["avatar"].clone() } else { Value::Null };
    let mut safe = json!({ "id": user["id"], "username": user["username"], "displayName": user["displayName"], "friendCode": user["friendCode"], "avatar": avatar,
        "privacy": { "shareOnline": user["privacy"]["shareOnline"], "shareGame": user["privacy"]["shareGame"],
            "shareLibrary": user["privacy"]["shareLibrary"].as_bool().unwrap_or(false) } });
    if user["privacy"]["publicProfile"].is_boolean() { safe["privacy"]["publicProfile"] = user["privacy"]["publicProfile"].clone(); }
    if user["featuredGames"].is_array() { safe["featuredGames"] = user["featuredGames"].clone(); }
    safe["achievementHighlight"] = user["achievementHighlight"].clone();
    if user["email"].is_string() { safe["email"] = user["email"].clone(); }
    Ok(safe)
}
fn set_user(user: Value) -> Result<Value> {
    let user = public_user(&user)?;
    *USER.lock().map_err(|_| vault_error())? = Some(user.clone());
    ACTIVE.store(true, Ordering::Relaxed);
    Ok(user)
}
fn route(action: &str, id: Option<&str>) -> Result<(Method, String)> {
    let id = id.unwrap_or("");
    if matches!(action, "accept" | "remove" | "block" | "unblock" | "dismissInvite" | "favorite" | "unfavorite" | "friendProfile" | "commonGames" | "conversation" | "typing" | "deleteShare" | "react" | "unreact" | "comments" | "comment" | "deleteComment") && (id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')) {
        return Err(err("INVALID_INPUT", "Identifiant invalide."));
    }
    Ok(match action {
        "profile" => (Method::PATCH, "/v1/me".into()),
        "setEmail" => (Method::PUT, "/v1/me/email".into()),
        "invite" => (Method::POST, "/v1/friend-requests".into()),
        "accept" => (Method::POST, format!("/v1/friend-requests/{id}/accept")),
        "remove" => (Method::DELETE, format!("/v1/friends/{id}")),
        "block" => (Method::POST, format!("/v1/blocks/{id}")),
        "unblock" => (Method::DELETE, format!("/v1/blocks/{id}")),
        "deleteAccount" => (Method::DELETE, "/v1/me".into()),
        "gameInvite" => (Method::POST, "/v1/game-invites".into()),
        "dismissInvite" => (Method::DELETE, format!("/v1/game-invites/{id}")),
        "favorite" => (Method::PUT, format!("/v1/friends/{id}/favorite")),
        "unfavorite" => (Method::DELETE, format!("/v1/friends/{id}/favorite")),
        "friendProfile" => (Method::GET, format!("/v1/friends/{id}/profile")),
        "commonGames" => (Method::GET, format!("/v1/friends/{id}/common-games")),
        "conversation" => (Method::GET, format!("/v1/messages/{id}")),
        "sendMessage" => (Method::POST, "/v1/messages".into()),
        "typing" => (Method::POST, format!("/v1/messages/{id}/typing")),
        "activity" => (Method::GET, "/v1/activity".into()),
        "library" => (Method::PUT, "/v1/library".into()),
        "shares" => (Method::GET, "/v1/shares".into()),
        "deleteShare" => (Method::DELETE, format!("/v1/shares/{id}")),
        "react" => (Method::PUT, format!("/v1/shares/{id}/reaction")),
        "unreact" => (Method::DELETE, format!("/v1/shares/{id}/reaction")),
        "comments" => (Method::GET, format!("/v1/shares/{id}/comments")),
        "comment" => (Method::POST, format!("/v1/shares/{id}/comments")),
        "deleteComment" => (Method::DELETE, format!("/v1/comments/{id}")),
        _ => return Err(err("INVALID_ACTION", "Action iNetbox inconnue.")),
    })
}
pub(crate) fn activity(app: &AppHandle) -> Option<Value> {
    let lib = app.state::<crate::library::commands::LibraryState>();
    let launched = crate::launcher::commands::launch_status(app.state());
    lib.with(|conn| {
        if let Some(running) = launched {
            let (title, platform): (String, String) = conn.query_row("SELECT title,platform_id FROM games WHERE id=?1", [running.game_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
            let detached = platform == "pc" && crate::pc::launch_target(conn, running.game_id).map(|p| p.detached).unwrap_or(true);
            if !detached { return Ok(Some(json!({ "title": title.chars().take(160).collect::<String>(), "platformId": platform }))); }
        }
        // jeu PC lancé par sa boutique (Epic, Steam…) ou hors d'iBox
        Ok(crate::pc::running::detect(conn).map(|(_, title)| json!({ "title": title.chars().take(160).collect::<String>(), "platformId": "pc" })))
    }).ok().flatten()
}
/// Communauté : envoi d'une capture (octets bruts, jusqu'à 8 Mo) sans bloquer le reste d'iNetbox.
/// La miniature (JPEG, facultative) est ajoutée à la fin du corps et annoncée par `thumb`.
pub(crate) fn upload_share(meta: &[(&str, String)], mut bytes: Vec<u8>, thumb: Option<Vec<u8>>) -> Result<Value> {
    let token = keys::get(&credential()).map_err(|_| vault_error())?.ok_or_else(|| err("UNAUTHENTICATED", "Connectez-vous à iNetbox pour partager."))?;
    let client = Client::builder().timeout(Duration::from_secs(120)).connect_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|_| err("NETWORK_ERROR", "Connexion indisponible."))?;
    let mut url = base_url(SERVICE)?.join("/v1/shares").map_err(|_| err("CONFIG_ERROR", "Route invalide."))?;
    url.query_pairs_mut().extend_pairs(meta.iter().map(|(k, v)| (*k, v.as_str())));
    if let Some(t) = thumb {
        url.query_pairs_mut().append_pair("thumb", &t.len().to_string());
        bytes.extend_from_slice(&t);
    }
    let response = client.post(url).bearer_auth(token).header("content-type", "application/octet-stream").body(bytes).send()
        .map_err(|_| err("NETWORK_ERROR", "iNetbox est injoignable."))?;
    let status = response.status();
    let value: Value = response.json().unwrap_or(Value::Null);
    if status.is_success() { return Ok(value); }
    Err(match status.as_u16() {
        401 => err("UNAUTHENTICATED", "Connectez-vous à iNetbox pour partager."),
        413 => err("TOO_LARGE", "Capture trop lourde pour être partagée."),
        429 => err("RATE_LIMITED", "Vous avez beaucoup partagé : réessayez un peu plus tard."),
        _ => err("SERVICE_ERROR", "Le partage a échoué. Réessayez dans un instant."),
    })
}

/// Communauté : image ou clip d'un partage visible (PNG ou GIF, 8 Mo au plus), ou sa miniature JPEG.
pub(crate) fn share_media(id: &str, thumb: bool) -> Result<Vec<u8>> {
    if id.len() != 36 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') { return Err(err("INVALID_INPUT", "Identifiant invalide.")); }
    let token = keys::get(&credential()).map_err(|_| vault_error())?.ok_or_else(|| err("UNAUTHENTICATED", "Connectez-vous à iNetbox."))?;
    let client = Client::builder().timeout(Duration::from_secs(60)).redirect(reqwest::redirect::Policy::none()).build()
        .map_err(|_| err("NETWORK_ERROR", "Connexion indisponible."))?;
    let url = base_url(SERVICE)?.join(&format!("/v1/shares/{id}/{}", if thumb { "thumb" } else { "media" })).map_err(|_| err("CONFIG_ERROR", "Route invalide."))?;
    let response = client.get(url).bearer_auth(token).send().map_err(|_| err("NETWORK_ERROR", "iNetbox est injoignable."))?;
    if !response.status().is_success() { return Err(err("NOT_FOUND", "Capture indisponible.")); }
    let mut bytes = Vec::new();
    response.take(8 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| err("NETWORK_ERROR", "Téléchargement interrompu."))?;
    let image = bytes.starts_with(&[0x89, b'P', b'N', b'G']) || bytes.starts_with(b"GIF8") || (thumb && bytes.starts_with(&[0xff, 0xd8, 0xff]));
    if bytes.len() > 8 * 1024 * 1024 || !image { return Err(err("INVALID_RESPONSE", "Capture invalide.")); }
    Ok(bytes)
}

fn perform(app: &AppHandle, action: &str, body: Value, id: Option<String>) -> Result<Value> {
    let _guard = LOCK.lock().map_err(|_| vault_error())?;
    if CLIENT.get().is_none() {
        let client = Client::builder().timeout(Duration::from_secs(75)).connect_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none()).build().map_err(|_| err("NETWORK_ERROR", "Connexion indisponible."))?;
        let _ = CLIENT.set(client);
    }
    let client = CLIENT.get().unwrap();
    if action == "info" { return Ok(json!({ "url": SERVICE, "local": base_url(SERVICE)?.scheme() == "http" })); }
    // mot de passe oublié : demande du code par e-mail (aucune session en jeu)
    if action == "forgot" {
        http(client, Method::POST, "/v1/auth/forgot", None, Some(&body))?;
        return Ok(Value::Null);
    }
    if matches!(action, "login" | "register" | "reset") {
        if keys::get(&credential()).map_err(|_| vault_error())?.is_some() { return Err(err("SESSION_EXISTS", "Déconnectez le compte actuel avant de changer de compte.")); }
        let value = http(client, Method::POST, &format!("/v1/auth/{action}"), None, Some(&body))?;
        let token = value["token"].as_str().filter(|t| t.len() == 43).ok_or_else(|| err("INVALID_RESPONSE", "Session invalide."))?;
        public_user(&value["user"])?;
        if keys::set(&credential(), token).is_err() {
            let _ = http(client, Method::POST, "/v1/auth/logout", Some(token), None);
            return Err(vault_error());
        }
        return set_user(value["user"].clone());
    }
    let token = keys::get(&credential()).map_err(|_| vault_error())?;
    if action == "restore" && token.is_none() { return Ok(Value::Null); }
    let token = token.ok_or_else(|| err("UNAUTHENTICATED", "Connectez-vous à iNetbox."))?;
    if matches!(action, "logout" | "logoutAll") {
        let path = if action == "logoutAll" { "/v1/auth/logout-all" } else { "/v1/auth/logout" };
        let result = http(client, Method::POST, path, Some(&token), None);
        clear_session()?;
        return Ok(json!({ "revoked": result.is_ok() || result.as_ref().err().is_some_and(|e| e.code == "UNAUTHENTICATED") }));
    }
    let result = (|| {
        match action {
            "restore" => set_user(http(client, Method::GET, "/v1/me", Some(&token), None)?),
            "snapshot" => {
                if let Some((_, value)) = SNAPSHOT.lock().map_err(|_| vault_error())?.as_ref().filter(|(at, _)| at.elapsed() < Duration::from_secs(8)) {
                    return Ok(value.clone());
                }
                let user = set_user(http(client, Method::GET, "/v1/me", Some(&token), None)?)?;
                let friends = http(client, Method::GET, "/v1/friends", Some(&token), None)?;
                let invitations = http(client, Method::GET, "/v1/friend-requests", Some(&token), None)?;
                let blocks = http(client, Method::GET, "/v1/blocks", Some(&token), None)?;
                // invitations à jouer : absentes d'un serveur plus ancien (404) → liste vide
                let (games, supported) = match http(client, Method::GET, "/v1/game-invites", Some(&token), None) {
                    Ok(v) => (v["items"].clone(), true),
                    Err(e) if e.code == "NOT_FOUND" => (json!([]), false),
                    Err(e) => return Err(e),
                };
                // messages non lus : absents d'un serveur sans « social-v2 »
                let (unread, social) = match http(client, Method::GET, "/v1/messages", Some(&token), None) {
                    Ok(v) => (v["items"].clone(), true),
                    Err(e) if e.code == "NOT_FOUND" => (json!([]), false),
                    Err(e) => return Err(e),
                };
                let snapshot = json!({ "user": user, "friends": friends["items"], "invitations": invitations["items"], "blocks": blocks["items"],
                    "gameInvites": games, "gameInvitesSupported": supported, "unread": unread, "socialSupported": social });
                *SNAPSHOT.lock().map_err(|_| vault_error())? = Some((Instant::now(), snapshot.clone()));
                Ok(snapshot)
            }
            "heartbeat" => {
                let user = USER.lock().map_err(|_| vault_error())?.clone().unwrap_or(Value::Null);
                let online = user["privacy"]["shareOnline"].as_bool().unwrap_or(false);
                if !online { return Ok(Value::Null); }
                let game = if user["privacy"]["shareGame"].as_bool().unwrap_or(false) { activity(app) } else { None };
                let payload = json!({ "status": "online", "game": game });
                let mut last = HEARTBEAT.lock().map_err(|_| vault_error())?;
                if last.as_ref().is_some_and(|(at, old)| *old == payload && at.elapsed() < Duration::from_secs(20)) {
                    return Ok(Value::Null);
                }
                let result = http(client, Method::PUT, "/v1/presence", Some(&token), Some(&payload))?;
                *last = Some((Instant::now(), payload));
                Ok(result)
            }
            "owners" => {
                let key = body["key"].as_str().filter(|k| !k.is_empty() && k.len() <= 220).ok_or_else(|| err("INVALID_INPUT", "Jeu invalide."))?;
                http(client, Method::GET, &format!("/v1/library/owners?key={}", encode(key)), Some(&token), None)
            }
            _ => {
                let (method, mut path) = route(action, id.as_deref())?;
                let mut payload = if body.is_null() { None } else { Some(&body) };
                // conversation : seulement les messages récents (nombre entier, jamais de texte libre)
                if action == "conversation" {
                    if let Some(after) = body.get("after").and_then(Value::as_u64) { path.push_str(&format!("?after={after}")); }
                    payload = None;
                }
                let value = http(client, method, &path, Some(&token), payload)?;
                if action == "deleteAccount" { clear_session()?; }
                if matches!(action, "profile" | "setEmail") {
                    if body.get("shareOnline").is_some() || body.get("shareGame").is_some() {
                        *HEARTBEAT.lock().map_err(|_| vault_error())? = None;
                    }
                    let user = set_user(value)?;
                    if let Some((_, snapshot)) = SNAPSHOT.lock().map_err(|_| vault_error())?.as_mut() { snapshot["user"] = user.clone(); }
                    return Ok(user);
                }
                if matches!(action, "invite" | "accept" | "remove" | "block" | "unblock" | "favorite" | "unfavorite" | "dismissInvite") {
                    *SNAPSHOT.lock().map_err(|_| vault_error())? = None;
                }
                Ok(value)
            }
        }
    })();
    if result.as_ref().err().is_some_and(|e| e.code == "UNAUTHENTICATED") && action != "deleteAccount" { clear_session()?; }
    result
}
#[tauri::command]
pub async fn inetbox_call(app: AppHandle, action: String, body: Option<Value>, id: Option<String>) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || perform(&app, &action, body.unwrap_or(Value::Null), id))
        .await.map_err(|_| err("INTERNAL_ERROR", "iNetbox est indisponible."))?
}
/// Native timer keeps presence alive even when the WebView is minimized.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        // toutes les 10 s : messages et activité des amis arrivent vite (présence envoyée au plus toutes les 20 s)
        std::thread::sleep(Duration::from_secs(10));
        if ACTIVE.load(Ordering::Relaxed) && now() >= RETRY_AT.load(Ordering::Relaxed) {
            let _ = perform(&app, "heartbeat", Value::Null, None);
            pulse(&app);
        }
    });
}
/// Encodage d'un paramètre d'adresse (tout sauf lettres, chiffres et -_.~).
fn encode(raw: &str) -> String {
    raw.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// Ce qui a déjà été vu, pour n'annoncer que les nouveautés.
#[derive(Default)]
struct Seen { user: String, games: HashMap<String, String>, requests: HashSet<String>, unread: HashMap<String, u64>, invites: HashSet<String> }
static SEEN: Mutex<Option<Seen>> = Mutex::new(None);

/// Actualisation native (même iBox réduit) : l'interface reçoit l'état des amis,
/// et chaque nouveauté devient une notification en bas à droite.
fn pulse(app: &AppHandle) {
    let Ok(snap) = perform(app, "snapshot", Value::Null, None) else { return };
    let _ = app.emit_to("main", "inetbox-snapshot", &snap);
    for toast in news(&snap) { crate::toast::push(app, toast); }
}
fn news(snap: &Value) -> Vec<Value> {
    let Ok(mut guard) = SEEN.lock() else { return vec![] };
    let user = snap["user"]["id"].as_str().unwrap_or_default().to_string();
    let first = guard.as_ref().is_none_or(|s| s.user != user);
    let list = |k: &str| snap[k].as_array().cloned().unwrap_or_default();
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or_default().to_string();
    let mut next = Seen { user, ..Default::default() };
    let mut out = vec![];
    let friends = list("friends");
    for f in &friends {
        let game = s(f, "gameTitle");
        if let Some(before) = guard.as_ref().and_then(|g| g.games.get(&s(f, "id"))) {
            if !game.is_empty() && &game != before && !first {
                out.push(json!({ "kind": "game", "friendId": f["id"], "name": f["displayName"], "avatar": f["avatar"], "gameTitle": game, "platformId": f["platformId"] }));
            }
        }
        next.games.insert(s(f, "id"), game);
    }
    for i in list("invitations").iter().filter(|i| i["outgoing"] == false) {
        if !first && !guard.as_ref().is_some_and(|g| g.requests.contains(&s(i, "id"))) {
            out.push(json!({ "kind": "request", "friendId": i["id"], "name": i["displayName"], "avatar": i["avatar"] }));
        }
        next.requests.insert(s(i, "id"));
    }
    for m in list("unread") {
        let (id, at) = (s(&m, "friendId"), m["lastAt"].as_u64().unwrap_or(0));
        if !first && guard.as_ref().and_then(|g| g.unread.get(&id)).is_none_or(|&before| at > before) {
            let avatar = friends.iter().find(|f| f["id"] == m["friendId"]).map(|f| f["avatar"].clone()).unwrap_or(Value::Null);
            out.push(json!({ "kind": "message", "friendId": id, "name": m["displayName"], "avatar": avatar, "body": m["lastBody"] }));
        }
        next.unread.insert(id, at);
    }
    for i in list("gameInvites") {
        if !first && !guard.as_ref().is_some_and(|g| g.invites.contains(&s(&i, "id"))) {
            out.push(json!({ "kind": "invite", "friendId": i["fromId"], "name": i["fromName"], "gameTitle": i["gameTitle"], "platformId": i["platformId"] }));
        }
        next.invites.insert(s(&i, "id"));
    }
    *guard = Some(next);
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn secure_origin() {
        assert!(base_url("http://127.0.0.1:4318").is_ok());
        assert!(base_url("https://social.example.com").is_ok());
        for url in ["http://remote.example.com", "https://a:b@example.com", "https://example.com?key=x", "file:///tmp/x", "https://example.com/other"] { assert!(base_url(url).is_err()); }
    }
    #[test]
    fn known_routes_only() {
        assert!(route("https://evil.example", None).is_err());
        assert!(route("accept", Some("../me")).is_err());
        assert!(route("conversation", Some("../../v1/me")).is_err());
        assert!(route("typing", Some("x")).is_err());
        assert_eq!(route("typing", Some("123e4567-e89b-12d3-a456-426614174000")).unwrap().1, "/v1/messages/123e4567-e89b-12d3-a456-426614174000/typing");
        assert_eq!(encode("switch|zelda & co"), "switch%7Czelda%20%26%20co");
        assert_eq!(route("block", Some("550e8400-e29b-41d4-a716-446655440000")).unwrap().1, "/v1/blocks/550e8400-e29b-41d4-a716-446655440000");
        assert_eq!(route("dismissInvite", Some("550e8400-e29b-41d4-a716-446655440000")).unwrap().1, "/v1/game-invites/550e8400-e29b-41d4-a716-446655440000");
        assert!(route("dismissInvite", Some("../x")).is_err());
        assert!(route("comment", Some("../../v1/me")).is_err());
        assert_eq!(route("deleteComment", Some("550e8400-e29b-41d4-a716-446655440000")).unwrap().1, "/v1/comments/550e8400-e29b-41d4-a716-446655440000");
    }
    #[test]
    fn tokens_and_extra_fields_never_reach_the_webview() {
        let raw = json!({ "id": "id", "username": "test", "displayName": "Test", "friendCode": "code", "token": "secret", "password_hash": "secret", "privacy": { "shareOnline": false, "shareGame": false, "secret": "secret" } });
        let safe = public_user(&raw).unwrap();
        assert!(safe.get("token").is_none());
        assert!(!safe.to_string().contains("secret"));
        assert!(public_user(&json!({ "id": "broken" })).is_err());
    }
    /// Opt-in integration test using only its own temporary account and vault entry.
    #[test]
    #[ignore = "requires local iNetbox server and Windows credential vault"]
    fn local_http_and_windows_vault() {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos().to_string();
        let username = format!("qa_{}", &suffix[suffix.len()-15..]);
        let password = format!("temporary-qa-{suffix}-password");
        let key = format!("inetbox-test-{suffix}");
        let client = Client::builder().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let registered = http(&client, Method::POST, "/v1/auth/register", None, Some(&json!({ "username": username, "password": password, "displayName": "Native test (temporary)" }))).unwrap();
        let token = registered["token"].as_str().unwrap().to_string();
        let check = (|| -> Result<()> {
            let safe = public_user(&registered["user"])?;
            assert!(safe.get("token").is_none());
            keys::set(&key, &token).map_err(|_| vault_error())?;
            let restored = keys::get(&key).map_err(|_| vault_error())?.unwrap();
            assert!(restored == token, "vault token mismatch");
            let user = http(&client, Method::GET, "/v1/me", Some(&restored), None)?;
            assert_eq!(user["username"], username);
            http(&client, Method::POST, "/v1/auth/logout", Some(&restored), None)?;
            assert_eq!(http(&client, Method::GET, "/v1/me", Some(&restored), None).unwrap_err().code, "UNAUTHENTICATED");
            Ok(())
        })();
        // Cleanup is attempted even if the vault check failed.
        let _ = keys::delete(&key);
        let login = http(&client, Method::POST, "/v1/auth/login", None, Some(&json!({ "username": username, "password": password }))).unwrap();
        http(&client, Method::DELETE, "/v1/me", login["token"].as_str(), Some(&json!({ "password": password }))).unwrap();
        check.unwrap();
    }
}
