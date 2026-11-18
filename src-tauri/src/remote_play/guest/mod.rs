//! Invité Remote Play natif (Steam Deck, option A de docs/STEAMDECK.md §6.2 ; phase D3, prototype).
//!
//! WebKitGTK n'a pas de WebRTC : la réception passe donc par str0m en Rust (`peer.rs`, `run.rs`),
//! comme l'hôte. Les images H.264 sont envoyées au WebView par un `Channel` Tauri binaire, puis
//! décodées par WebCodecs (`src/services/nativeGuest.ts`). Compile sous Windows et Linux ; sous
//! Windows il sert d'essai face à l'hôte local, l'invité du WebView restant celui des sessions.
//!
//! Trame envoyée au WebView (petit-boutiste) : `[0] type` (1 image, 2 son, 3 control,
//! 4 connecté, 5 déconnecté) · `[1] drapeaux` (bit 0 : image clé) · `[2..4]` réservé ·
//! `[4..12] temps RTP` · `[12..16]` arrivée en µs depuis le début de la session · données.

pub mod peer;
pub mod run;

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::ipc::{Channel, InvokeResponseBody};

use peer::{GuestEvent, GuestStats};
use run::{NativeGuest, Options};

pub const HEADER: usize = 16;

/// Trame binaire d'un événement (voir l'en-tête du module).
pub fn frame(e: &GuestEvent, started: Instant) -> Vec<u8> {
    let (kind, flags, time, arrived, data): (u8, u8, u64, Option<Instant>, &[u8]) = match e {
        GuestEvent::Video { data, rtp_time, keyframe, arrived } => (1, *keyframe as u8, *rtp_time, Some(*arrived), data),
        GuestEvent::Audio { data, rtp_time } => (2, 0, *rtp_time, None, data),
        GuestEvent::Control(data) => (3, 0, 0, None, data),
        GuestEvent::Connected => (4, 0, 0, None, &[]),
        GuestEvent::Disconnected => (5, 0, 0, None, &[]),
    };
    let micros = arrived.map(|a| a.saturating_duration_since(started).as_micros() as u32).unwrap_or(0);
    let mut out = Vec::with_capacity(HEADER + data.len());
    out.extend_from_slice(&[kind, flags, 0, 0]);
    out.extend_from_slice(&time.to_le_bytes());
    out.extend_from_slice(&micros.to_le_bytes());
    out.extend_from_slice(data);
    out
}

fn slot() -> &'static Mutex<Option<NativeGuest>> {
    static SLOT: OnceLock<Mutex<Option<NativeGuest>>> = OnceLock::new();
    SLOT.get_or_init(Mutex::default)
}

fn with<T>(f: impl FnOnce(&NativeGuest) -> T) -> Option<T> {
    slot().lock().ok()?.as_ref().map(f)
}

/// Répond à l'offre de l'hôte et commence la réception. Renvoie la réponse SDP à transmettre.
#[tauri::command]
pub async fn remote_play_native_guest_start(offer: String, loopback: bool, stun_servers: Vec<String>, events: Channel<InvokeResponseBody>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(old) = slot().lock().map_err(|e| e.to_string())?.take() {
            old.stop();
        }
        let started = Instant::now();
        let guest = NativeGuest::start(&offer, Options { stun_servers, loopback }, move |e| {
            let _ = events.send(InvokeResponseBody::Raw(frame(&e, started)));
        })?;
        let answer = guest.answer().to_string();
        *slot().lock().map_err(|e| e.to_string())? = Some(guest);
        Ok(answer)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Message du protocole sur `input` (non fiable) ou `control` (fiable).
#[tauri::command]
pub fn remote_play_native_guest_send(channel: String, bytes: Vec<u8>) -> bool {
    let label = match channel.as_str() {
        peer::INPUT_LABEL => peer::INPUT_LABEL,
        peer::CONTROL_LABEL => peer::CONTROL_LABEL,
        _ => return false,
    };
    with(|g| g.send(label, bytes)).is_some()
}

/// Le décodeur a perdu le fil (erreur, image manquante) : nouvelle image clé.
#[tauri::command]
pub fn remote_play_native_guest_keyframe() {
    with(|g| g.request_keyframe());
}

#[tauri::command]
pub fn remote_play_native_guest_candidate(line: String) {
    with(|g| g.add_remote_candidate(line));
}

#[tauri::command]
pub fn remote_play_native_guest_stats() -> Option<GuestStats> {
    with(|g| g.stats())
}

#[tauri::command]
pub async fn remote_play_native_guest_stop() -> Option<GuestStats> {
    tauri::async_runtime::spawn_blocking(|| slot().lock().ok()?.take().map(|g| g.stop())).await.ok().flatten()
}

/// Résultat de la sonde WebCodecs du WebView (décodage H.264 pris en charge, matériel ou non),
/// écrit dans le journal : c'est la mesure 1 du prototype D3.
#[tauri::command]
pub fn remote_play_webcodecs_report(report: serde_json::Value) {
    eprintln!("[webcodecs] {report}");
}

/// Banc d'essai de l'aperçu Steam Deck (`scripts/deck-preview.ps1 -RemotePlay`) : offre d'un hôte
/// d'essai lue dans `IBOX_RP_OFFER_FILE`. Rien hors de ce banc : sans la variable, `None`.
#[tauri::command]
pub fn remote_play_native_guest_dev_offer() -> Option<String> {
    let path = std::env::var_os("IBOX_RP_OFFER_FILE")?;
    std::fs::read_to_string(path).ok().filter(|s| s.starts_with("v=0"))
}

/// Banc d'essai : extrait du vrai flux enregistré (`IBOX_RP_SAMPLE_FILE`, au plus 64 Mo), décodé
/// par WebCodecs au rythme réel pour mesurer le décodage dans ce moteur web.
#[tauri::command]
pub fn remote_play_native_guest_dev_sample() -> Result<tauri::ipc::Response, String> {
    let path = std::env::var_os("IBOX_RP_SAMPLE_FILE").ok_or("banc d'essai inactif")?;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 64 << 20 {
        return Err("extrait trop gros".into());
    }
    std::fs::read(path).map(tauri::ipc::Response::new).map_err(|e| e.to_string())
}

/// Banc d'essai : réponse écrite dans `IBOX_RP_ANSWER_FILE`, lue par l'hôte d'essai.
#[tauri::command]
pub fn remote_play_native_guest_dev_answer(sdp: String) -> Result<(), String> {
    let path = std::env::var_os("IBOX_RP_ANSWER_FILE").ok_or("banc d'essai inactif")?;
    std::fs::write(path, sdp).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests;
