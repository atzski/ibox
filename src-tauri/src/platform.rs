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
/// Aperçu Steam Deck (`IBOX_SIMULATE_DECK=1`) : sous Linux (WSL, `scripts/deck-preview.ps1`) la
/// vraie version Linux ; sous Windows (`deck-preview.ps1 -Windows`) l'interface du Deck en Mode Jeu
/// sur le cœur Windows, pour essayer l'interface avec le GPU du PC.
pub fn preview() -> bool {
    std::env::var_os("IBOX_SIMULATE_DECK").is_some_and(|v| v == "1")
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
    preview().then_some("Steam Deck (aperçu)")
}

/// Mode Jeu de SteamOS (lu une fois) : pas de zone de notification, et iBox ne doit jamais se
/// masquer (il deviendrait invisible tout en restant « en cours » pour Steam).
pub fn game_mode() -> bool {
    static MODE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *MODE.get_or_init(|| current().game_mode)
}

pub fn current() -> PlatformInfo {
    PlatformInfo {
        // aperçu sous Windows : l'interface se comporte comme sur le Deck, en Mode Jeu
        os: if cfg!(windows) && !preview() { "windows" } else { "linux" },
        steam_deck: steam_deck(),
        game_mode: (cfg!(windows) && preview()) || (cfg!(target_os = "linux") && game_mode_from(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))),
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
    {
        // appelé au tout début de `run`, avant tout autre fil : aucune lecture concurrente
        if game_mode_from(|k| std::env::var(k).ok().filter(|v| !v.is_empty())) && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        for (k, v) in video_decoding_env(|k| std::env::var(k).ok(), &VaProbe::system()) {
            std::env::set_var(k, v);
        }
    }
}

/// Ce que le système offre pour le décodage matériel VA-API.
pub struct VaProbe {
    /// Nœud de rendu du GPU (`/dev/dri/renderD128`…).
    pub render_node: bool,
    /// Dossier contenant un pilote VA (`*_drv_video.so`, `radeonsi_drv_video.so` sur le Deck).
    pub drivers_dir: Option<String>,
}

impl VaProbe {
    /// Dossiers usuels des pilotes VA : SteamOS / Arch (`/usr/lib/dri`), Debian / Ubuntu, Fedora.
    pub const DRIVER_DIRS: [&'static str; 4] = ["/usr/lib/dri", "/usr/lib/x86_64-linux-gnu/dri", "/usr/lib64/dri", "/usr/local/lib/dri"];

    pub fn system() -> Self {
        let render_node = std::fs::read_dir("/dev/dri").is_ok_and(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD")));
        let has_driver = |dir: &str| std::fs::read_dir(dir).is_ok_and(|d| d.flatten().any(|e| e.file_name().to_string_lossy().ends_with("_drv_video.so")));
        let drivers_dir = Self::DRIVER_DIRS.iter().find(|d| has_driver(d)).map(|d| d.to_string());
        VaProbe { render_node, drivers_dir }
    }
}

/// Variables d'environnement du décodage vidéo (WebCodecs par GStreamer, Remote Play invité) :
/// décodeur matériel VA-API en priorité quand le GPU et son pilote sont là, sinon rien (le décodeur
/// logiciel de FFmpeg, LGPL, sert de repli). Ce que l'utilisateur a réglé lui-même est gardé.
pub fn video_decoding_env(var: impl Fn(&str) -> Option<String>, va: &VaProbe) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    let Some(dir) = va.drivers_dir.as_ref().filter(|_| va.render_node) else { return out };
    // GStreamer 1.20 : `vah264dec` a un rang nul, il n'est jamais choisi d'office
    if var("GST_PLUGIN_FEATURE_RANK").is_none() {
        out.push(("GST_PLUGIN_FEATURE_RANK", "vah264dec:MAX".to_string()));
    }
    // la libva de l'AppImage (Ubuntu) cherche ses pilotes ailleurs que SteamOS
    if var("LIBVA_DRIVERS_PATH").is_none() {
        out.push(("LIBVA_DRIVERS_PATH", dir.clone()));
    }
    out
}

#[tauri::command]
pub fn platform_info() -> PlatformInfo {
    current()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn va_api_en_priorite_seulement_si_disponible() {
        let none = |_: &str| None::<String>;
        let deck = VaProbe { render_node: true, drivers_dir: Some("/usr/lib/dri".into()) };
        assert_eq!(video_decoding_env(none, &deck), vec![("GST_PLUGIN_FEATURE_RANK", "vah264dec:MAX".to_string()), ("LIBVA_DRIVERS_PATH", "/usr/lib/dri".to_string())]);
        // pas de pilote VA, ou pas de GPU : décodeur logiciel, rien n'est changé
        assert!(video_decoding_env(none, &VaProbe { render_node: true, drivers_dir: None }).is_empty());
        assert!(video_decoding_env(none, &VaProbe { render_node: false, drivers_dir: Some("/usr/lib/dri".into()) }).is_empty());
        // réglages de l'utilisateur gardés
        let user = |k: &str| (k == "GST_PLUGIN_FEATURE_RANK").then(|| "x:1".to_string());
        assert_eq!(video_decoding_env(user, &deck), vec![("LIBVA_DRIVERS_PATH", "/usr/lib/dri".to_string())]);
    }

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
        assert_eq!(p.os, if cfg!(windows) && !preview() { "windows" } else { "linux" });
        if cfg!(windows) && !preview() {
            assert!(p.steam_deck.is_none() && !p.game_mode);
        }
    }
}
