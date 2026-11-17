//! Remote Play entre amis iNetbox, par Internet (Phase 4). L'hôte invite un ami, l'ami accepte,
//! l'offre et la réponse SDP signées passent par la boîte aux lettres d'iNetbox, puis la session
//! est directe (P2P, UDP) : iNetbox ne voit ni le média ni les entrées, et il n'y a jamais de
//! relais. Rien ne tourne tant que Remote Play est désactivé (défaut).
//!
//! - [`api`] : routes Remote Play d'iNetbox (inchangées) ;
//! - [`sides`] : vérifications sans E/S (signature, épinglage TOFU, jeton, empreinte DTLS) ;
//! - ici : fils de signalisation, état affiché, fenêtre d'indicateur, commandes Tauri.

pub mod api;
pub mod sides;
#[cfg(test)]
mod e2e_tests;

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use self::api::{Api, ApiError, Incoming};
use self::sides::{Event, GuestSide, HostSide, TrustView};
use super::permissions::{Mode, Profile};
use super::signaling::identity::DeviceKey;
use super::signaling::pinning::Pins;
use super::signaling::SignalError;
use super::sources::{self, Choice};
use super::transport::host::{Host, HostOptions, Network};
use super::RemotePlay;

/// Évènement envoyé à toutes les fenêtres à chaque changement d'état.
pub const STATUS_EVENT: &str = "remote-play-online";
pub const INVITES_EVENT: &str = "remote-play-invites";
/// Fenêtre d'indicateur côté hôte (toujours visible pendant un partage).
pub const INDICATOR: &str = "remote-play-indicator";
/// Délai maximal d'attente de l'offre de l'hôte après avoir accepté.
const OFFER_WAIT: Duration = Duration::from_secs(45);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

/// État d'une session en ligne, tel qu'affiché (jamais d'adresse IP, jamais de jeton).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `host` ou `guest`.
    pub role: String,
    /// `inviting` (en attente de l'ami), `connecting`, `live`, `ended`, `failed`.
    pub stage: String,
    pub peer_id: String,
    pub peer_name: String,
    /// `watch` (spectateur) ou `play`.
    pub mode: String,
    pub profile: Option<Profile>,
    pub source: Option<String>,
    pub safety_code: Option<String>,
    pub trust: Option<TrustView>,
    pub error: Option<String>,
    /// Messages de signalisation refusés (signature, rejeu…) pendant la session.
    pub rejected: u32,
    pub session_id: Option<String>,
    pub expires_at: Option<u64>,
}

/// Invitation reçue, telle que montrée à l'interface (sans le jeton, qui reste natif).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteView {
    pub id: String,
    pub from_id: String,
    pub from_name: String,
    pub mode: String,
    pub expires_at: u64,
}

impl From<&Incoming> for InviteView {
    fn from(i: &Incoming) -> Self {
        InviteView { id: i.id.clone(), from_id: i.from_id.clone(), from_name: i.from_name.clone(), mode: i.mode.clone(), expires_at: i.expires_at }
    }
}

struct GuestCtx {
    side: GuestSide,
    session: String,
    host: String,
}

#[derive(Default)]
pub struct OnlineState {
    /// (compte, identifiant d'appareil iNetbox) déjà déclaré.
    device: Option<(String, String)>,
    invites: Vec<Incoming>,
    seen: HashSet<String>,
    status: Option<Status>,
    /// Arrêt demandé au fil de signalisation en cours (hôte ou invité).
    cancel: Option<Arc<AtomicBool>>,
    guest: Option<GuestCtx>,
}

/// Ce qu'il faut pour parler à iNetbox au nom de cet appareil.
struct Ctx {
    api: Api,
    me: String,
    key: DeviceKey,
    device: String,
    pins: PathBuf,
}

fn rp(app: &AppHandle) -> tauri::State<'_, RemotePlay> {
    app.state::<RemotePlay>()
}

fn api_of(app: &AppHandle) -> Result<(Api, String), String> {
    let _ = app;
    let (base, token, me) = crate::inetbox::rp_context().map_err(|e| e.message().to_string())?;
    Ok((Api::new(&base, token).map_err(|e| e.message)?, me))
}

/// Clé d'appareil (coffre Windows) déclarée à iNetbox pour le compte connecté.
fn context(app: &AppHandle) -> Result<Ctx, String> {
    let (api, me) = api_of(app)?;
    let key = DeviceKey::load_or_create().map_err(|e| e.to_string())?;
    let state = rp(app);
    let cached = state.online.lock().map_err(|_| "état indisponible")?.device.clone();
    let device = match cached {
        Some((account, id)) if account == me => id,
        _ => {
            let name = state.config.lock().map(|c| c.computer_name.clone()).unwrap_or_default();
            let name = if name.is_empty() { std::env::var("COMPUTERNAME").unwrap_or_else(|_| "iBox".into()) } else { name };
            let id = api.register_device(&key, &me, &name).map_err(|e| e.message)?;
            state.online.lock().map_err(|_| "état indisponible")?.device = Some((me.clone(), id.clone()));
            id
        }
    };
    let pins = app.path().app_data_dir().map_err(|e| e.to_string())?.join("remote-play-peers.json");
    Ok(Ctx { api, me, key, device, pins })
}

fn set_status(app: &AppHandle, status: Status) {
    if let Ok(mut s) = rp(app).online.lock() {
        s.status = Some(status.clone());
    }
    let _ = app.emit(STATUS_EVENT, &status);
}

fn update_status(app: &AppHandle, f: impl FnOnce(&mut Status)) {
    let current = rp(app).online.lock().ok().and_then(|s| s.status.clone());
    if let Some(mut s) = current {
        f(&mut s);
        set_status(app, s);
    }
}

/// Message affiché pour une erreur de signalisation.
fn signal_message(e: &SignalError, peer: &str) -> String {
    match e {
        SignalError::KeyChanged => format!("La clé de l'appareil de {peer} a changé : session bloquée. Si votre ami a réinstallé iBox, comparez le code de sécurité de vive voix avant de recommencer."),
        other => other.to_string(),
    }
}

// ——— Indicateur côté hôte ———

fn show_indicator(app: &AppHandle) {
    let app = app.clone();
    // jamais de fenêtre créée pendant une commande synchrone (blocage de WebView2) : un autre fil
    // met la création dans la file de la boucle d'évènements (même procédé que `toast.rs`)
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(INDICATOR) {
                let _ = w.show();
                return;
            }
            let built = tauri::WebviewWindowBuilder::new(&app, INDICATOR, tauri::WebviewUrl::App("index.html".into()))
                .title("iBox Remote Play")
                .inner_size(580.0, 64.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .focused(false)
                .visible(false)
                .build();
            if let Ok(w) = built {
                place_indicator(&w, false);
                let _ = w.show();
            }
        });
    });
}

/// Bandeau entier centré en haut, ou pastille discrète dans le coin supérieur droit.
fn place_indicator(w: &tauri::WebviewWindow, compact: bool) {
    let (width, height) = if compact { (44.0, 44.0) } else { (580.0, 64.0) };
    let _ = w.set_size(tauri::LogicalSize::new(width, height));
    if let Ok(Some(m)) = w.primary_monitor() {
        let area = m.work_area();
        let scale = m.scale_factor();
        let w_px = (width * scale) as i32;
        let x = if compact {
            area.position.x + area.size.width as i32 - w_px - (8.0 * scale) as i32
        } else {
            area.position.x + (area.size.width as i32 - w_px) / 2
        };
        let _ = w.set_position(tauri::PhysicalPosition::new(x, area.position.y + (8.0 * scale) as i32));
    }
}

/// Réduit le bandeau de l'hôte en pastille (ou le rétablit). Il ne disparaît jamais tout à fait :
/// une session partagée doit rester visible.
pub fn set_indicator_compact(app: &AppHandle, compact: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(INDICATOR) {
                place_indicator(&w, compact);
            }
        });
    });
}

fn hide_indicator(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(INDICATOR) {
                let _ = w.close();
            }
        });
    });
}

// ——— Hôte ———

/// Arrête la session d'hôte en cours (relâchements compris), si c'est bien celle-ci.
fn stop_host(app: &AppHandle, host: &Arc<Host>) {
    let state = rp(app);
    let mine = state.host.lock().ok().and_then(|mut h| if h.as_ref().is_some_and(|x| Arc::ptr_eq(x, host)) { h.take() } else { None });
    if let Some(h) = mine {
        h.stop();
    }
}

struct HostPlan {
    friend: String,
    friend_name: String,
    mode: String,
    profile: Profile,
    opts: HostOptions,
    source: String,
}

fn host_thread(app: AppHandle, ctx: Ctx, invite: api::Invite, plan: HostPlan, cancel: Arc<AtomicBool>) {
    let fail = |app: &AppHandle, msg: String| update_status(app, |s| {
        s.stage = "failed".into();
        s.error = Some(msg);
    });
    let session = invite.id.clone();

    // 1. attendre que l'ami accepte (long-poll : l'invitation devient une session ouverte)
    let deadline = Instant::now() + Duration::from_millis(invite.expires_at.saturating_sub(now_ms())) + Duration::from_secs(5);
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = ctx.api.delete_invite(&session);
            update_status(&app, |s| s.stage = "ended".into());
            return;
        }
        match ctx.api.poll(&session, api::MAX_WAIT_SECS) {
            Ok(p) if p.state == "open" => break,
            Ok(_) if Instant::now() > deadline => {
                let _ = ctx.api.delete_invite(&session);
                return fail(&app, format!("{} n'a pas répondu à temps (2 minutes).", plan.friend_name));
            }
            Ok(_) => {}
            Err(e) if matches!(e.code.as_str(), "NOT_FOUND" | "SESSION_ENDED") => {
                if cancel.load(Ordering::Relaxed) {
                    update_status(&app, |s| s.stage = "ended".into());
                    return;
                }
                return fail(&app, format!("{} a refusé l'invitation, ou elle a expiré.", plan.friend_name));
            }
            Err(e) => {
                if Instant::now() > deadline {
                    return fail(&app, e.message);
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }
    update_status(&app, |s| s.stage = "connecting".into());

    // 2. hôte : sockets, STUN, offre ; garde d'arrêt d'urgence et de verrouillage
    let host = match Host::start(plan.opts.clone()) {
        Ok(h) => Arc::new(h),
        Err(e) => {
            let _ = ctx.api.end(&session);
            return fail(&app, e);
        }
    };
    let previous = rp(&app).host.lock().ok().and_then(|mut h| h.replace(host.clone()));
    if let Some(p) = previous {
        p.stop();
    }
    show_indicator(&app);
    let mut side = HostSide::new(&session, &ctx.me, &plan.friend, &invite.token, invite.expires_at + 60_000);
    let sent = side.offer(&ctx.key, host.offer(), now_ms()).map_err(|e| e.to_string()).and_then(|s| ctx.api.send(&session, &plan.friend, &ctx.device, &s).map_err(|e| e.message));
    if let Err(e) = sent {
        stop_host(&app, &host);
        hide_indicator(&app);
        let _ = ctx.api.end(&session);
        return fail(&app, e);
    }

    // 3. réponse, candidats tardifs, départ
    let mut pins = Pins::open(&ctx.pins).unwrap_or_else(|_| Pins::in_memory());
    let mut devices: Option<Vec<api::Device>> = None;
    let mut errors = 0u32;
    let mut outcome: Option<Result<String, String>> = None;
    while outcome.is_none() {
        if cancel.load(Ordering::Relaxed) {
            outcome = Some(Ok("Session terminée.".into()));
            break;
        }
        let stats = host.stats();
        if matches!(stats.state.as_str(), "closed" | "failed") || stats.error.is_some() {
            outcome = Some(match stats.error {
                Some(e) => Err(e),
                None => Ok("Session terminée.".into()),
            });
            break;
        }
        if stats.connected {
            update_status(&app, |s| if s.stage == "connecting" { s.stage = "live".into() });
        }
        // attente courte : l'arrêt local (verrouillage, raccourci) est vu en quelques secondes
        match ctx.api.poll(&session, 5) {
            Ok(p) => {
                errors = 0;
                for mail in p.items {
                    if devices.is_none() {
                        devices = ctx.api.friend_devices(&plan.friend).ok();
                    }
                    let list = devices.as_deref().unwrap_or(&[]);
                    match side.on_mail(&ctx.key, list, &mut pins, &mail, now_ms()) {
                        Ok(Event::Description(answer)) => match host.accept_answer(&answer) {
                            Ok(_) => {
                                let peer = side.peer.clone();
                                update_status(&app, |s| {
                                    s.safety_code = peer.as_ref().map(|p| p.safety_code.clone());
                                    s.trust = peer.as_ref().map(|p| p.trust);
                                });
                            }
                            Err(e) => outcome = Some(Err(e)),
                        },
                        Ok(Event::Candidates(list)) => list.into_iter().take(64).for_each(|c| host.add_remote_candidate(c)),
                        Ok(Event::Bye) => outcome = Some(Ok(format!("{} a quitté la session.", plan.friend_name))),
                        Err(SignalError::KeyChanged) => outcome = Some(Err(signal_message(&SignalError::KeyChanged, &plan.friend_name))),
                        Err(_) => update_status(&app, |s| s.rejected += 1),
                    }
                    if outcome.is_some() {
                        break;
                    }
                }
            }
            Err(e) if matches!(e.code.as_str(), "NOT_FOUND" | "SESSION_ENDED") => {
                // la session de signalisation peut expirer pendant une partie : le P2P continue seul
                if host.stats().connected {
                    while !cancel.load(Ordering::Relaxed) && host.stats().connected {
                        std::thread::sleep(Duration::from_millis(500));
                    }
                }
                outcome = Some(Ok("Session terminée.".into()));
            }
            Err(e) => {
                errors += 1;
                if errors > 12 && !host.stats().connected {
                    outcome = Some(Err(e.message));
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        }
    }

    // 4. fin : au revoir signé (si possible), fermeture de la session iNetbox, arrêt de l'hôte
    if let Ok(bye) = side.bye(&ctx.key, now_ms()) {
        let _ = ctx.api.send(&session, &plan.friend, &ctx.device, &bye);
    }
    let _ = ctx.api.end(&session);
    stop_host(&app, &host);
    hide_indicator(&app);
    match outcome.unwrap_or(Ok(String::new())) {
        Ok(msg) => update_status(&app, |s| {
            s.stage = "ended".into();
            s.error = (!msg.is_empty()).then_some(msg);
        }),
        Err(e) => fail(&app, e),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteArgs {
    pub friend_id: String,
    pub friend_name: String,
    pub profile: Profile,
    pub source: Choice,
    /// Le Collaborateur a été confirmé explicitement par l'hôte.
    #[serde(default)]
    pub confirmed: bool,
}

/// Profil → mode d'invitation iNetbox (affiché à l'ami avant d'accepter).
pub fn invite_mode(profile: Profile) -> &'static str {
    if profile == Profile::Spectator { "watch" } else { "play" }
}

/// Contrôle les choix de l'hôte avant tout envoi.
pub fn check_profile(profile: Profile, confirmed: bool) -> Result<(), String> {
    match profile {
        Profile::FullControl => Err("Le Contrôle complet n'est pas disponible par Internet.".into()),
        Profile::Collaborator if !confirmed => Err("Le profil Collaborateur demande votre confirmation.".into()),
        _ => Ok(()),
    }
}

fn busy(state: &RemotePlay) -> bool {
    state.online.lock().map(|s| s.cancel.is_some() && s.status.as_ref().is_some_and(|st| !matches!(st.stage.as_str(), "ended" | "failed"))).unwrap_or(false)
}

/// Invite un ami à regarder ou à jouer sur ce PC.
#[tauri::command]
pub async fn remote_play_invite(app: AppHandle, args: InviteArgs) -> Result<Status, String> {
    let state = rp(&app);
    if !state.enabled() {
        return Err("Remote Play est désactivé dans les paramètres".into());
    }
    check_profile(args.profile, args.confirmed)?;
    if !api::is_uuid(&args.friend_id) {
        return Err("Ami invalide.".into());
    }
    if busy(&state) {
        return Err("Une session Remote Play est déjà en cours.".into());
    }
    let cfg = state.config.lock().map_err(|_| "réglages indisponibles")?.clone();
    if !cfg.ip_warning_seen {
        return Err("Lisez d'abord l'avertissement sur l'adresse IP.".into());
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = context(&app2)?;
        let target = sources::resolve(args.source)?;
        let source = match args.source {
            Choice::Window { id } => sources::list().into_iter().find_map(|s| match s {
                sources::Source::Window { id: i, title, .. } if i == id => Some(title),
                _ => None,
            }),
            _ => None,
        }
        .unwrap_or_else(|| "Écran".into());
        // une fenêtre = Game Share : manettes seulement, jamais le clavier ni la souris du PC
        let mode = if matches!(args.source, Choice::Window { .. }) { Mode::GameShare } else { Mode::DesktopShare };
        let max_kbps = match (cfg.bitrate_kbps, cfg.upload_limit_kbps) {
            (Some(b), Some(u)) => b.min(u),
            (Some(b), None) => b,
            (None, Some(u)) => u,
            (None, None) => 20_000,
        };
        let opts = HostOptions {
            network: Network::Internet { stun: cfg.stun_servers.clone() },
            port: 0,
            target,
            fps: cfg.fps,
            max_height: cfg.height.or(Some(1080)),
            initial_kbps: max_kbps.min(6_000),
            max_kbps,
            profile: args.profile,
            mode,
            hotkey: cfg.stop_hotkey.parse().unwrap_or_default(),
            blocked: cfg.blocked_accounts.clone(),
            guest_account: args.friend_id.clone(),
            frame_log: None,
            audio: cfg.audio != crate::remote_play::config::AudioSource::None,
        };
        let invite = ctx.api.create_invite(&args.friend_id, invite_mode(args.profile)).map_err(|e| e.message)?;
        let cancel = Arc::new(AtomicBool::new(false));
        let status = Status {
            role: "host".into(),
            stage: "inviting".into(),
            peer_id: args.friend_id.clone(),
            peer_name: args.friend_name.chars().take(60).collect(),
            mode: invite_mode(args.profile).into(),
            profile: Some(args.profile),
            source: Some(source.clone()),
            session_id: Some(invite.id.clone()),
            expires_at: Some(invite.expires_at),
            ..Default::default()
        };
        {
            let state = rp(&app2);
            let mut s = state.online.lock().map_err(|_| "état indisponible")?;
            s.cancel = Some(cancel.clone());
            s.guest = None;
        }
        set_status(&app2, status.clone());
        let plan = HostPlan { friend: args.friend_id, friend_name: status.peer_name.clone(), mode: status.mode.clone(), profile: args.profile, opts, source };
        let _ = (&plan.mode, plan.profile, &plan.source);
        let thread_app = app2.clone();
        std::thread::Builder::new()
            .name("remote-play-signal".into())
            .spawn(move || host_thread(thread_app, ctx, invite, plan, cancel))
            .map_err(|e| e.to_string())?;
        Ok(status)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Fin de session demandée par l'utilisateur (hôte ou invité), ou annulation d'une invitation.
#[tauri::command]
pub async fn remote_play_online_stop(app: AppHandle) -> Result<(), String> {
    let (cancel, guest) = {
        let state = rp(&app);
        let mut s = state.online.lock().map_err(|_| "état indisponible")?;
        (s.cancel.take(), s.guest.take())
    };
    if let Some(c) = cancel {
        c.store(true, Ordering::Relaxed);
    }
    let hosting = rp(&app).online.lock().ok().and_then(|s| s.status.clone()).filter(|s| s.role == "host").and_then(|s| s.session_id);
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // le fil de l'hôte attend peut-être dans un long-poll : supprimer l'invitation ou la session le réveille
        if let Some(session) = hosting {
            if let Ok((api, _)) = api_of(&app2) {
                let _ = api.delete_invite(&session);
                let _ = api.end(&session);
            }
        }
        // côté hôte : l'arrêt est immédiat (le fil de signalisation fait le reste)
        let host = rp(&app2).host.lock().ok().and_then(|mut h| h.take());
        if let Some(h) = host {
            h.stop();
            hide_indicator(&app2);
        }
        if let Some(mut g) = guest {
            if let Ok(ctx) = context(&app2) {
                if let Ok(bye) = g.side.bye(&ctx.key, now_ms()) {
                    let _ = ctx.api.send(&g.session, &g.host, &ctx.device, &bye);
                }
                let _ = ctx.api.end(&g.session);
            }
            update_status(&app2, |s| s.stage = "ended".into());
        }
    })
    .await
    .map_err(|e| e.to_string())
}

/// Arrêt d'urgence depuis l'indicateur : capture et entrées coupées sur-le-champ.
#[tauri::command]
pub async fn remote_play_emergency_stop(app: AppHandle) -> Result<(), String> {
    let cancel = rp(&app).online.lock().ok().and_then(|s| s.cancel.clone());
    if let Some(c) = cancel {
        c.store(true, Ordering::Relaxed);
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let host = rp(&app2).host.lock().ok().and_then(|mut h| h.take());
        if let Some(h) = host {
            h.stop();
        }
        hide_indicator(&app2);
        update_status(&app2, |s| {
            s.stage = "failed".into();
            s.error = Some("Arrêt d'urgence : partage coupé.".into());
        });
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remote_play_online_status(state: State<'_, RemotePlay>) -> Option<Status> {
    state.online.lock().ok().and_then(|s| s.status.clone())
}

#[tauri::command]
pub fn remote_play_sources(app: AppHandle) -> sources::Sources {
    let items = sources::list();
    // jeu lancé depuis iBox (émulateur ou jeu PC) : sa plus grande fenêtre est proposée d'abord
    let running = crate::launcher::commands::launch_status(app.state());
    let (game, game_title) = match running {
        Some(r) => (sources::window_of(&items, r.pid), Some(r.title)),
        None => {
            let lib = app.state::<crate::library::commands::LibraryState>();
            match lib.with(|c| Ok(crate::pc::running::find_process(c))).ok().flatten() {
                Some((_, title, pid)) => (sources::window_of(&items, pid), Some(title)),
                None => (None, None),
            }
        }
    };
    sources::Sources { items, game, game_title }
}

// ——— Invité ———

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuestJoin {
    pub session_id: String,
    pub offer: String,
    pub host_name: String,
    pub mode: String,
    pub safety_code: String,
    pub trust: TrustView,
    /// Serveurs STUN pour le WebView (`stun:` seulement).
    pub stun_servers: Vec<String>,
}

/// Accepte une invitation reçue : consomme le jeton, attend l'offre signée de l'hôte et la
/// vérifie (signature, clé épinglée, jeton, empreinte DTLS). Le WebView répond ensuite.
#[tauri::command]
pub async fn remote_play_accept(app: AppHandle, invite_id: String) -> Result<GuestJoin, String> {
    let state = rp(&app);
    if !state.enabled() {
        return Err("Remote Play est désactivé dans les paramètres".into());
    }
    if busy(&state) {
        return Err("Une session Remote Play est déjà en cours.".into());
    }
    let cfg = state.config.lock().map_err(|_| "réglages indisponibles")?.clone();
    if !cfg.ip_warning_seen {
        return Err("Lisez d'abord l'avertissement sur l'adresse IP.".into());
    }
    let invite = state.online.lock().map_err(|_| "état indisponible")?.invites.iter().find(|i| i.id == invite_id).cloned().ok_or("Invitation expirée ou déjà utilisée.")?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = context(&app2)?;
        let cancel = Arc::new(AtomicBool::new(false));
        {
            let state = rp(&app2);
            let mut s = state.online.lock().map_err(|_| "état indisponible")?;
            s.invites.retain(|i| i.id != invite.id);
            s.cancel = Some(cancel.clone());
        }
        set_status(&app2, Status {
            role: "guest".into(),
            stage: "connecting".into(),
            peer_id: invite.from_id.clone(),
            peer_name: invite.from_name.clone(),
            mode: invite.mode.clone(),
            session_id: Some(invite.id.clone()),
            ..Default::default()
        });
        let result = (|| -> Result<GuestJoin, String> {
            let r = ctx.api.redeem(&invite.token).map_err(|e| e.message)?;
            if r.host_id != invite.from_id || r.guest_id != ctx.me {
                return Err("Invitation incohérente : session refusée.".into());
            }
            let mut side = GuestSide::new(&r.session_id, &ctx.me, &r.host_id, &r.token);
            let mut pins = Pins::open(&ctx.pins).map_err(|e| e.to_string())?;
            let devices = ctx.api.friend_devices(&r.host_id).map_err(|e| e.message)?;
            let deadline = Instant::now() + OFFER_WAIT;
            let mut rejected = 0u32;
            while Instant::now() < deadline && !cancel.load(Ordering::Relaxed) {
                let p = ctx.api.poll(&r.session_id, 10).map_err(|e| e.message)?;
                for mail in p.items {
                    match side.on_mail(&ctx.key, &devices, &mut pins, &mail, now_ms()) {
                        Ok(Event::Description(offer)) => {
                            let peer = side.peer.clone().ok_or("appareil de l'hôte inconnu")?;
                            let join = GuestJoin {
                                session_id: r.session_id.clone(),
                                offer,
                                host_name: invite.from_name.clone(),
                                mode: r.mode.clone(),
                                safety_code: peer.safety_code.clone(),
                                trust: peer.trust,
                                stun_servers: cfg.stun_servers.iter().filter(|s| s.starts_with("stun:")).cloned().collect(),
                            };
                            let state = rp(&app2);
                            state.online.lock().map_err(|_| "état indisponible")?.guest = Some(GuestCtx { side, session: r.session_id.clone(), host: r.host_id.clone() });
                            update_status(&app2, |s| {
                                s.session_id = Some(r.session_id.clone());
                                s.safety_code = Some(peer.safety_code.clone());
                                s.trust = Some(peer.trust);
                                s.rejected = rejected;
                            });
                            return Ok(join);
                        }
                        Ok(Event::Bye) => return Err(format!("{} a annulé la session.", invite.from_name)),
                        Err(SignalError::KeyChanged) => return Err(signal_message(&SignalError::KeyChanged, &invite.from_name)),
                        _ => rejected += 1,
                    }
                }
            }
            let _ = ctx.api.end(&r.session_id);
            Err(format!("{} n'a pas envoyé de proposition de connexion à temps.", invite.from_name))
        })();
        if let Err(e) = &result {
            let msg = e.clone();
            update_status(&app2, |s| {
                s.stage = "failed".into();
                s.error = Some(msg);
            });
            if let Ok(mut s) = rp(&app2).online.lock() {
                s.cancel = None;
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Réponse SDP du WebView : signée puis déposée pour l'hôte. Un fil relève ensuite la boîte aux
/// lettres pour voir le départ de l'hôte.
#[tauri::command]
pub async fn remote_play_answer(app: AppHandle, sdp: String) -> Result<(), String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = context(&app2)?;
        let (sealed, session, host, cancel) = {
            let state = rp(&app2);
            let mut s = state.online.lock().map_err(|_| "état indisponible")?;
            let cancel = s.cancel.clone().unwrap_or_default();
            let g = s.guest.as_mut().ok_or("aucune session à rejoindre")?;
            (g.side.answer(&ctx.key, &sdp, now_ms()).map_err(|e| e.to_string())?, g.session.clone(), g.host.clone(), cancel)
        };
        ctx.api.send(&session, &host, &ctx.device, &sealed).map_err(|e| e.message)?;
        let watch_app = app2.clone();
        std::thread::Builder::new()
            .name("remote-play-signal".into())
            .spawn(move || guest_watch(watch_app, ctx, session, cancel))
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Candidats ICE trouvés par le WebView après sa réponse (trickle par la boîte aux lettres).
#[tauri::command]
pub async fn remote_play_candidates(app: AppHandle, candidates: Vec<String>) -> Result<(), String> {
    // les candidats mDNS (`.local`) ne servent à rien à l'hôte ; les lignes sont bornées
    let list: Vec<String> = candidates
        .into_iter()
        .map(|c| c.trim().trim_start_matches("a=").to_string())
        .filter(|c| c.starts_with("candidate:") && c.len() <= 512 && !c.contains(['\r', '\n']) && !c.split_whitespace().nth(4).is_some_and(|a| a.ends_with(".local")))
        .take(16)
        .collect();
    if list.is_empty() {
        return Ok(());
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ctx = context(&app2)?;
        let (sealed, session, host) = {
            let state = rp(&app2);
            let mut s = state.online.lock().map_err(|_| "état indisponible")?;
            let g = s.guest.as_mut().ok_or("aucune session")?;
            (g.side.candidates(&ctx.key, list, now_ms()).map_err(|e| e.to_string())?, g.session.clone(), g.host.clone())
        };
        ctx.api.send(&session, &host, &ctx.device, &sealed).map_err(|e| e.message)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Le WebView signale la connexion (ou sa perte) : affichage seulement.
#[tauri::command]
pub fn remote_play_guest_state(app: AppHandle, connected: bool) {
    update_status(&app, |s| {
        if s.role == "guest" && !matches!(s.stage.as_str(), "ended" | "failed") {
            s.stage = if connected { "live".into() } else { "connecting".into() };
        }
    });
}

fn guest_watch(app: AppHandle, ctx: Ctx, session: String, cancel: Arc<AtomicBool>) {
    let mut errors = 0;
    while !cancel.load(Ordering::Relaxed) {
        match ctx.api.poll(&session, api::MAX_WAIT_SECS) {
            Ok(p) => {
                errors = 0;
                let mut bye = false;
                if !p.items.is_empty() {
                    let state = rp(&app);
                    let host = match state.online.lock().ok().and_then(|s| s.guest.as_ref().map(|g| g.host.clone())) {
                        Some(h) => h,
                        None => return,
                    };
                    // appel réseau hors du verrou : les commandes de l'interface ne doivent pas attendre
                    let devices = ctx.api.friend_devices(&host).unwrap_or_default();
                    let mut pins = Pins::open(&ctx.pins).unwrap_or_else(|_| Pins::in_memory());
                    let Ok(mut s) = state.online.lock() else { return };
                    if let Some(g) = s.guest.as_mut() {
                        for mail in &p.items {
                            if let Ok(Event::Bye) = g.side.on_mail(&ctx.key, &devices, &mut pins, mail, now_ms()) {
                                bye = true;
                            }
                        }
                    }
                }
                if bye {
                    update_status(&app, |s| {
                        s.stage = "ended".into();
                        s.error = Some(format!("{} a terminé la session.", s.peer_name));
                    });
                    let _ = app.emit("remote-play-guest-ended", ());
                    return;
                }
            }
            // la boîte aux lettres expire après 15 min sans message : la session P2P continue
            Err(e) if matches!(e.code.as_str(), "NOT_FOUND" | "SESSION_ENDED") => return,
            Err(_) => {
                errors += 1;
                if errors > 30 {
                    return;
                }
                std::thread::sleep(Duration::from_secs(5));
            }
        }
    }
}

/// Refuse une invitation reçue.
#[tauri::command]
pub async fn remote_play_decline(app: AppHandle, invite_id: String) -> Result<(), String> {
    if let Ok(mut s) = rp(&app).online.lock() {
        s.invites.retain(|i| i.id != invite_id);
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (api, _) = api_of(&app2)?;
        api.delete_invite(&invite_id).map_err(|e| e.message)?;
        emit_invites(&app2);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remote_play_invites(state: State<'_, RemotePlay>) -> Vec<InviteView> {
    let now = now_ms();
    state.online.lock().map(|s| s.invites.iter().filter(|i| i.expires_at > now).map(InviteView::from).collect()).unwrap_or_default()
}

fn emit_invites(app: &AppHandle) {
    let now = now_ms();
    let list: Vec<InviteView> = rp(app).online.lock().map(|s| s.invites.iter().filter(|i| i.expires_at > now).map(InviteView::from).collect()).unwrap_or_default();
    let _ = app.emit_to("main", INVITES_EVENT, &list);
}

/// Appelé par l'actualisation iNetbox (toutes les 10 s) : invitations reçues, seulement si Remote
/// Play est activé **et** que l'utilisateur accepte les demandes de ses amis.
pub fn pulse(app: &AppHandle) {
    let state = rp(app);
    let (enabled, accept) = state.config.lock().map(|c| (c.enabled, c.accept_requests)).unwrap_or((false, false));
    if !enabled || !accept {
        return;
    }
    let Ok((api, _)) = api_of(app) else { return };
    let Ok(list) = api.incoming() else { return };
    // seules les invitations à rejoindre un hôte (kind « invite ») sont gérées
    let list: Vec<Incoming> = list.into_iter().filter(|i| i.kind == "invite" && api::is_uuid(&i.id) && api::is_uuid(&i.from_id)).collect();
    let fresh: Vec<Incoming> = {
        let Ok(mut s) = state.online.lock() else { return };
        let fresh = list.iter().filter(|i| !s.seen.contains(&i.id)).cloned().collect();
        for i in &list {
            s.seen.insert(i.id.clone());
        }
        if s.seen.len() > 500 {
            s.seen.clear();
        }
        s.invites = list;
        fresh
    };
    for i in &fresh {
        crate::toast::push(app, json!({
            "kind": "invite",
            "remotePlay": true,
            "inviteId": i.id,
            "friendId": i.from_id,
            "name": i.from_name,
            "mode": i.mode,
            "gameTitle": "",
        }));
    }
    emit_invites(app);
}

/// Remote Play activé : déclare la clé de l'appareil et aligne le réglage du serveur.
/// Désactivé : arrête toute session, refuse les demandes côté serveur, oublie les invitations.
pub fn on_enabled_changed(app: &AppHandle, enabled: bool, accept: bool) {
    let app = app.clone();
    std::thread::spawn(move || {
        if enabled {
            if context(&app).is_ok() {
                if let Ok((api, _)) = api_of(&app) {
                    let _ = api.set_accept_requests(accept);
                }
            }
            return;
        }
        let (cancel, guest) = match rp(&app).online.lock() {
            Ok(mut s) => {
                s.invites.clear();
                (s.cancel.take(), s.guest.take())
            }
            Err(_) => (None, None),
        };
        if let Some(c) = cancel {
            c.store(true, Ordering::Relaxed);
        }
        drop(guest);
        let host = rp(&app).host.lock().ok().and_then(|mut h| h.take());
        if let Some(h) = host {
            h.stop();
        }
        hide_indicator(&app);
        if let Ok((api, _)) = api_of(&app) {
            let _ = api.set_accept_requests(false);
        }
        emit_invites(&app);
    });
}

/// « Accepter les demandes Remote Play de mes amis » : enregistré sur iNetbox puis localement.
#[tauri::command]
pub async fn remote_play_set_accept(app: AppHandle, accept: bool) -> Result<bool, String> {
    let state = rp(&app);
    if accept && !state.enabled() {
        return Err("Remote Play est désactivé dans les paramètres".into());
    }
    let app2 = app.clone();
    let accepted = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        if accept {
            context(&app2)?; // clé d'appareil déclarée avant d'accepter quoi que ce soit
        }
        let (api, _) = api_of(&app2)?;
        api.set_accept_requests(accept).map_err(|e: ApiError| e.message)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut cfg = state.config.lock().map_err(|_| "réglages indisponibles")?.clone();
    cfg.accept_requests = accepted;
    state.save(cfg)?;
    if !accepted {
        if let Ok(mut s) = state.online.lock() {
            s.invites.clear();
        }
        emit_invites(&app);
    }
    Ok(accepted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choix_de_l_hote() {
        assert_eq!(invite_mode(Profile::Spectator), "watch");
        assert_eq!(invite_mode(Profile::Player), "play");
        assert_eq!(invite_mode(Profile::Collaborator), "play");
        assert!(check_profile(Profile::Spectator, false).is_ok());
        assert!(check_profile(Profile::Player, false).is_ok());
        assert!(check_profile(Profile::Collaborator, false).is_err());
        assert!(check_profile(Profile::Collaborator, true).is_ok());
        assert!(check_profile(Profile::FullControl, true).is_err());
    }
}
