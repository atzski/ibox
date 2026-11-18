//! Plateforme d'exécution, transmise à l'interface : Windows ou Linux, Steam Deck, Mode Jeu.
//!
//! L'interface s'en sert pour masquer ce qui n'existe pas sur la plateforme (capture Alt+E,
//! hôte Remote Play, zone de notification…). Voir `docs/STEAMDECK.md`.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// `windows` ou `linux`.
    pub os: &'static str,
    /// Modèle de Steam Deck reconnu (`Steam Deck (LCD)`, `Steam Deck OLED`), sinon `None`.
    pub steam_deck: Option<&'static str>,
    /// Lancé sous gamescope (Mode Jeu de SteamOS) : une seule fenêtre visible, pas de raccourcis globaux.
    pub game_mode: bool,
    /// Aperçu Steam Deck sur PC (`scripts/deck-preview.ps1`) : fenêtre de 1280×800, jamais plein écran.
    pub preview: bool,
    /// Banc d'essai Remote Play de l'aperçu (`deck-preview.ps1 -RemotePlay`) : l'interface ne
    /// monte que le banc, pour que la scène 3D ne fausse pas les mesures de décodage.
    pub bench: bool,
}

/// Aperçu Steam Deck sur PC (`IBOX_SIMULATE_DECK=1`, Linux seulement).
pub fn preview() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("IBOX_SIMULATE_DECK").is_some_and(|v| v == "1")
}

/// Aperçu : la fenêtre principale prend la taille de l'écran du Deck (1280×800) au lieu du plein
/// écran, que l'affichage de WSL dimensionne mal.
pub fn apply_preview(app: &tauri::AppHandle) {
    use tauri::Manager;
    if !preview() {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_fullscreen(false);
        let _ = w.set_min_size(None::<tauri::LogicalSize<f64>>);
        let _ = w.set_size(tauri::LogicalSize::new(1280.0, 800.0));
        let _ = w.set_title("Steam Deck - apercu iBox");
    }
}

/// Une seule fenêtre : sous Linux, notifications et bandeaux vivent dans la fenêtre principale
/// (gamescope n'affiche qu'une fenêtre à la fois ; même comportement en Mode Bureau).
pub const SINGLE_WINDOW: bool = !cfg!(windows);

/// Mode Jeu : gamescope définit ces variables pour les programmes qu'il affiche.
pub fn game_mode_from(var: impl Fn(&str) -> Option<String>) -> bool {
    var("XDG_CURRENT_DESKTOP").is_some_and(|d| d.eq_ignore_ascii_case("gamescope")) || var("GAMESCOPE_WAYLAND_DISPLAY").is_some()
}

/// Aperçu Steam Deck sur PC (`scripts/deck-preview.ps1`) : `IBOX_SIMULATE_DECK=1` fait passer
/// ce Linux pour un Steam Deck (le Mode Jeu, lui, vient de `XDG_CURRENT_DESKTOP=gamescope`).
#[cfg(target_os = "linux")]
fn steam_deck() -> Option<&'static str> {
    if preview() {
        return Some("Steam Deck (aperçu)");
    }
    let read = |f: &str| std::fs::read_to_string(format!("/sys/class/dmi/id/{f}")).unwrap_or_default();
    crate::smartconfig::hardware::linux::steam_deck_model(&read("sys_vendor"), &read("product_name"))
}

#[cfg(not(target_os = "linux"))]
fn steam_deck() -> Option<&'static str> {
    None
}

/// Mode Jeu de SteamOS (lu une fois) : pas de zone de notification, et iBox ne doit jamais se
/// masquer (il deviendrait invisible tout en restant « en cours » pour Steam).
pub fn game_mode() -> bool {
    static MODE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *MODE.get_or_init(|| current().game_mode)
}

pub fn current() -> PlatformInfo {
    PlatformInfo {
        os: if cfg!(windows) { "windows" } else { "linux" },
        steam_deck: steam_deck(),
        game_mode: cfg!(target_os = "linux") && game_mode_from(|k| std::env::var(k).ok().filter(|v| !v.is_empty())),
        preview: preview(),
        bench: preview() && (std::env::var_os("IBOX_RP_SAMPLE_FILE").is_some() || std::env::var_os("IBOX_RP_OFFER_FILE").is_some()),
    }
}

/// Réglages de WebKitGTK sous gamescope, appliqués avant la création de la fenêtre et seulement
/// si l'utilisateur ne les a pas déjà définis (options de lancement Steam).
/// `WEBKIT_DISABLE_DMABUF_RENDERER` évite l'écran noir connu de WebKitGTK sous gamescope.
/// `WEBKIT_DISABLE_COMPOSITING_MODE` n'est pas forcé : il coupe l'accélération (étagère 3D) et
/// reste un recours manuel (docs/STEAMDECK.md §5.3).
pub fn prepare_webview() {
    #[cfg(target_os = "linux")]
    if game_mode_from(|k| std::env::var(k).ok().filter(|v| !v.is_empty())) && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        // appelé au tout début de `run`, avant tout autre fil : aucune lecture concurrente
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_jeu_reconnu_par_gamescope() {
        assert!(game_mode_from(|k| (k == "XDG_CURRENT_DESKTOP").then(|| "gamescope".into())));
        assert!(game_mode_from(|k| (k == "GAMESCOPE_WAYLAND_DISPLAY").then(|| "gamescope-0".into())));
        assert!(!game_mode_from(|k| (k == "XDG_CURRENT_DESKTOP").then(|| "KDE".into())));
        assert!(!game_mode_from(|_| None));
    }

    #[test]
    fn systeme_courant() {
        let p = current();
        assert_eq!(p.os, if cfg!(windows) { "windows" } else { "linux" });
        if cfg!(windows) {
            assert!(p.steam_deck.is_none() && !p.game_mode);
        }
    }
}
