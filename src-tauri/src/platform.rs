//! Plateforme d'exécution, transmise à l'interface : Windows ou Linux, Steam Deck, Mode Jeu.
//!
//! L'interface s'en sert pour masquer ce qui n'existe pas sur la plateforme (capture au raccourci,
//! hôte Remote Play, zone de notification…). Voir `docs/STEAMDECK.md`.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// `windows` ou `linux`.
    pub os: &'static str,
    /// Modèle de Steam Deck reconnu (`Steam Deck (LCD)`, `Steam Deck OLED`), sinon `None`.
    pub steam_deck: Option<&'static str>,
    /// Console portable de jeu : Steam Deck reconnu, ou machine que Steam présente comme telle
    /// (`SteamDeck=1`, posé par Steam sur SteamOS et ses dérivés). L'interface y active d'office
    /// son mode performance.
    pub handheld: bool,
    /// Lancé sous gamescope (Mode Jeu de SteamOS) : une seule fenêtre visible, pas de raccourcis globaux.
    pub game_mode: bool,
    /// Aperçu Steam Deck sur PC (`scripts/deck-preview.ps1`) : fenêtre de 1280×800, jamais plein écran.
    pub preview: bool,
    /// Banc d'essai Remote Play de l'aperçu (`deck-preview.ps1 -RemotePlay`) : l'interface ne
    /// monte que le banc, pour que la scène 3D ne fausse pas les mesures de décodage.
    pub bench: bool,
    /// Version Android (docs/ANDROID.md). `os` y vaut `linux` : l'interface prend le chemin
    /// « une seule fenêtre, pas de raccourcis globaux » du Steam Deck.
    pub android: bool,
    /// Console portable PC reconnue (Steam Deck, ROG Ally, Legion Go, MSI Claw…) : écran et
    /// puissance graphique, d'où l'interface tire son palier de performance et la taille du texte.
    pub device: Option<HandheldDevice>,
}

/// Puissance graphique d'une console portable, pour le palier de performance de l'interface.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GpuClass {
    /// Consoles Android d'entrée de gamme (Unisoc T618, Helio G85…) : vue en jaquettes d'office.
    Minimal,
    /// Consoles Android modestes (Snapdragon 720G, Dimensity 900, Unisoc T820) : 3D allégée.
    Weak,
    /// Steam Deck (~1,6 TFLOPS), Ryzen Z1, Z2 A, Z2 Go, Snapdragon 865 : interface allégée.
    Low,
    /// Ryzen Z1 / Z2 Extreme, Z2, Intel Arc (MSI Claw), Snapdragon 8 Gen 1 et suivants :
    /// interface complète, 3D bridée.
    Mid,
}

/// Écran intégré d'une console portable (définition native, diagonale).
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandheldScreen {
    pub width: u32,
    pub height: u32,
    pub inches: f32,
}

/// Console portable PC reconnue par son micrologiciel (SMBIOS / DMI).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HandheldDevice {
    /// Identifiant stable (`steam-deck-oled`, `rog-ally-x`, `legion-go`…) ; `handheld` pour une
    /// console reconnue à son fabricant mais sans fiche détaillée.
    pub id: &'static str,
    /// Nom affiché (Paramètres, diagnostic).
    pub name: String,
    /// Écran intégré, s'il est connu.
    pub screen: Option<HandheldScreen>,
    pub gpu: GpuClass,
    /// Console Android : puce reconnue (`android_chip.rs`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chip: Option<crate::android_chip::Chip>,
}

/// Ce que le micrologiciel dit de la machine (Windows : registre `HARDWARE\DESCRIPTION\System\BIOS` ;
/// Linux : `/sys/class/dmi/id`), plus le nom du processeur. Jamais de numéro de série.
#[derive(Debug, Clone, Default)]
pub struct Firmware {
    pub vendor: String,
    pub product: String,
    /// `SystemFamily` / `product_family` (Lenovo y met « Legion Go 8APU1 », le produit étant « 83E1 »).
    pub family: String,
    pub version: String,
    pub cpu: String,
}

/// Puissance graphique d'après le processeur (APU des consoles portables).
pub fn gpu_class_from_cpu(cpu: &str) -> GpuClass {
    let c = cpu.to_lowercase();
    let weak = c.contains("custom apu 0405") // Steam Deck LCD
        || c.contains("custom apu 0932") // Steam Deck OLED
        || c.contains("z2 a")
        || c.contains("z2 go")
        || (c.contains("z1") && !c.contains("extreme"))
        || [" n100", " n200", " n300", "7520u", "athlon"].iter().any(|k| c.contains(k));
    if weak { GpuClass::Low } else { GpuClass::Mid }
}

const fn screen(width: u32, height: u32, inches: f32) -> Option<HandheldScreen> {
    Some(HandheldScreen { width, height, inches })
}

/// Reconnaît une console portable PC. Pur et testable : les fiches viennent des fabricants
/// (définition et diagonale de l'écran intégré, APU). Les plus précises d'abord.
pub fn identify(fw: &Firmware) -> Option<HandheldDevice> {
    let vendor = fw.vendor.trim().to_lowercase();
    let product = fw.product.trim().to_lowercase();
    let all = format!("{product} {} {}", fw.family.trim().to_lowercase(), fw.version.trim().to_lowercase());
    let has = |keys: &[&str]| keys.iter().any(|k| all.contains(k));
    let by_cpu = || gpu_class_from_cpu(&fw.cpu);
    let make = |id: &'static str, name: &str, screen: Option<HandheldScreen>, gpu: GpuClass| Some(HandheldDevice { id, name: name.to_string(), screen, gpu, chip: None });
    if vendor.contains("valve") {
        return match product.as_str() {
            "jupiter" => make("steam-deck-lcd", "Steam Deck (LCD)", screen(1280, 800, 7.0), GpuClass::Low),
            "galileo" => make("steam-deck-oled", "Steam Deck OLED", screen(1280, 800, 7.4), GpuClass::Low),
            _ => None,
        };
    }
    if vendor.contains("asus") {
        return if has(&["rc73x", "xbox ally x"]) {
            make("rog-xbox-ally-x", "ROG Xbox Ally X", screen(1920, 1080, 7.0), GpuClass::Mid)
        } else if has(&["rc73y", "xbox ally"]) {
            make("rog-xbox-ally", "ROG Xbox Ally", screen(1920, 1080, 7.0), GpuClass::Low)
        } else if has(&["rc72l", "ally x"]) {
            make("rog-ally-x", "ROG Ally X", screen(1920, 1080, 7.0), GpuClass::Mid)
        } else if has(&["rc71l", "rog ally"]) {
            make("rog-ally", "ROG Ally", screen(1920, 1080, 7.0), by_cpu())
        } else {
            None
        };
    }
    if vendor.contains("lenovo") {
        return if has(&["legion go s", "83l3", "83n6", "83q2", "83q3"]) {
            make("legion-go-s", "Legion Go S", screen(1920, 1200, 8.0), by_cpu())
        } else if has(&["legion go 2", "83n0", "83n1"]) {
            make("legion-go-2", "Legion Go 2", screen(1920, 1200, 8.8), by_cpu())
        } else if has(&["legion go", "83e1"]) {
            make("legion-go", "Legion Go", screen(2560, 1600, 8.8), GpuClass::Mid)
        } else {
            None
        };
    }
    if vendor.contains("micro-star") || vendor == "msi" {
        return if has(&["claw 8"]) {
            make("msi-claw-8", "MSI Claw 8 AI+", screen(1920, 1200, 8.0), GpuClass::Mid)
        } else if has(&["claw 7"]) {
            make("msi-claw-7", "MSI Claw 7 AI+", screen(1920, 1200, 7.0), GpuClass::Mid)
        } else if has(&["claw"]) {
            make("msi-claw", "MSI Claw", screen(1920, 1080, 7.0), GpuClass::Mid)
        } else {
            None
        };
    }
    // autres fabricants de consoles portables : reconnues, sans fiche d'écran
    let generic = ["ayaneo", "gpd win", "onexplayer", "onexfly", "zotac zone", "zotac gaming zone"];
    if generic.iter().any(|k| vendor.contains(k) || all.contains(k)) || (vendor.contains("gpd") && all.contains("win")) {
        let name: String = fw.product.trim().chars().take(60).collect();
        return make("handheld", if name.is_empty() { "Console portable" } else { &name }, None, by_cpu());
    }
    None
}

/// Micrologiciel de cette machine (lu une fois).
fn firmware() -> Firmware {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
        let bios = hklm.open_subkey(r"HARDWARE\DESCRIPTION\System\BIOS").ok();
        let get = |name: &str| bios.as_ref().and_then(|k| k.get_value::<String, _>(name).ok()).unwrap_or_default();
        let cpu = hklm.open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0").ok().and_then(|k| k.get_value::<String, _>("ProcessorNameString").ok()).unwrap_or_default();
        Firmware { vendor: get("SystemManufacturer"), product: get("SystemProductName"), family: get("SystemFamily"), version: get("SystemVersion"), cpu }
    }
    #[cfg(target_os = "linux")]
    {
        let read = |f: &str| std::fs::read_to_string(format!("/sys/class/dmi/id/{f}")).unwrap_or_default();
        let cpu = std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|t| t.lines().find(|l| l.starts_with("model name")).and_then(|l| l.split_once(':')).map(|(_, v)| v.trim().to_string())).unwrap_or_default();
        Firmware { vendor: read("sys_vendor"), product: read("product_name"), family: read("product_family"), version: read("product_version"), cpu }
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        Firmware::default()
    }
}

/// Console portable de cette machine (lue une fois) ; l'aperçu Steam Deck se présente en Deck OLED.
pub fn device() -> Option<HandheldDevice> {
    static DEVICE: std::sync::OnceLock<Option<HandheldDevice>> = std::sync::OnceLock::new();
    DEVICE
        .get_or_init(|| {
            if preview() {
                return identify(&Firmware { vendor: "Valve".into(), product: "Galileo".into(), ..Default::default() });
            }
            // console Android : la puce donne le palier (docs/ANDROID.md §9)
            #[cfg(target_os = "android")]
            return Some(crate::android_chip::identify(&crate::android_chip::props()));
            #[cfg(not(target_os = "android"))]
            {
                let fw = firmware();
                // modèle absent de la table : forme de la machine (Windows)
                identify(&fw).or_else(|| generic_handheld(&fw, &form_factor()))
            }
        })
        .clone()
}

/// Forme de la machine, pour une console portable absente de la table (`generic_handheld`).
#[derive(Debug, Clone, Default)]
pub struct FormFactor {
    /// Windows la classe en tablette (`PowerDeterminePlatformRoleEx` = `PlatformRoleSlate`) :
    /// boîtier « Tablet » ou « Detachable » du SMBIOS, comme les consoles portables.
    pub slate: bool,
    /// Une batterie est présente.
    pub battery: bool,
    /// Écran principal, taille physique en millimètres (EDID).
    pub screen_mm: Option<(u32, u32)>,
    /// Écran principal, définition en pixels.
    pub screen_px: Option<(u32, u32)>,
}

/// Console portable que la table ne connaît pas (nouveau modèle, fabricant rare) : une tablette
/// sur batterie dont l'écran fait de 4 à 9,5 pouces. Les tablettes Windows (Surface et autres) ont
/// 10 pouces et plus ; une diagonale invraisemblable (EDID absent ou faux) ne conclut rien.
pub fn generic_handheld(fw: &Firmware, f: &FormFactor) -> Option<HandheldDevice> {
    if !f.slate || !f.battery {
        return None;
    }
    let (w, h) = f.screen_mm?;
    let inches = ((w as f32).hypot(h as f32) / 25.4 * 10.0).round() / 10.0;
    if !(4.0..=9.5).contains(&inches) {
        return None;
    }
    let screen = f.screen_px.filter(|&(pw, ph)| pw > 0 && ph > 0).map(|(pw, ph)| HandheldScreen { width: pw.max(ph), height: pw.min(ph), inches });
    let product: String = fw.product.trim().chars().take(60).collect();
    let generic = ["", "System Product Name", "To be filled by O.E.M.", "Default string"];
    let name = if generic.contains(&product.as_str()) { "Console portable".to_string() } else { product };
    Some(HandheldDevice { id: "handheld", name, screen, gpu: gpu_class_from_cpu(&fw.cpu), chip: None })
}

/// Forme de cette machine (Windows ; ailleurs, rien : SteamOS annonce ses consoles par `SteamDeck=1`).
fn form_factor() -> FormFactor {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{GetDC, GetDeviceCaps, ReleaseDC, DESKTOPHORZRES, DESKTOPVERTRES, HORZSIZE, VERTSIZE};
        use windows_sys::Win32::System::Power::{PowerDeterminePlatformRoleEx, PlatformRoleSlate, POWER_PLATFORM_ROLE_V2};
        let slate = unsafe { PowerDeterminePlatformRoleEx(POWER_PLATFORM_ROLE_V2) } == PlatformRoleSlate;
        let battery = crate::power::status().percent.is_some();
        let (mut mm, mut px) = (None, None);
        unsafe {
            let dc = GetDC(std::ptr::null_mut());
            if !dc.is_null() {
                let (w, h) = (GetDeviceCaps(dc, HORZSIZE as i32), GetDeviceCaps(dc, VERTSIZE as i32));
                if w > 0 && h > 0 {
                    mm = Some((w as u32, h as u32));
                }
                let (pw, ph) = (GetDeviceCaps(dc, DESKTOPHORZRES as i32), GetDeviceCaps(dc, DESKTOPVERTRES as i32));
                if pw > 0 && ph > 0 {
                    px = Some((pw as u32, ph as u32));
                }
                ReleaseDC(std::ptr::null_mut(), dc);
            }
        }
        FormFactor { slate, battery, screen_mm: mm, screen_px: px }
    }
    #[cfg(not(windows))]
    {
        FormFactor::default()
    }
}

/// Petits écrans : la taille minimale de la fenêtre (1100×700) dépasse l'écran d'une console
/// portable réglée à 175 % ou 200 % (ROG Ally : 1097×617 ou 960×540 points). Le plein écran
/// déborderait alors de l'écran : la contrainte est levée quand l'écran est plus petit qu'elle.
pub fn fit_small_screen(app: &tauri::AppHandle) {
    use tauri::Manager;
    let Some(w) = app.get_webview_window("main") else { return };
    let Ok(Some(m)) = w.current_monitor() else { return };
    let logical = m.size().to_logical::<f64>(m.scale_factor());
    if logical.width < 1100.0 || logical.height < 700.0 {
        let _ = w.set_min_size(Some(tauri::LogicalSize::new(800.0, 480.0)));
    }
}

/// Réponse des commandes propres au bureau sur Android.
pub const UNAVAILABLE: &str = "Pas encore disponible sur Android.";

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
        #[cfg(mobile)]
        use crate::mobile::DesktopWindow;
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

/// Console portable d'après Steam : il pose `SteamDeck=1` pour ce qu'il lance sur un Steam Deck et
/// sur les autres machines sous SteamOS (Mode Jeu comme Mode Bureau). Le modèle DMI reste la
/// source sûre du Steam Deck : cette variable manque quand iBox est ouvert hors de Steam.
pub fn handheld_from(var: impl Fn(&str) -> Option<String>) -> bool {
    var("SteamDeck").is_some_and(|v| v.trim() == "1")
}

/// Mode Jeu de SteamOS (lu une fois) : pas de zone de notification, et iBox ne doit jamais se
/// masquer (il deviendrait invisible tout en restant « en cours » pour Steam).
pub fn game_mode() -> bool {
    static MODE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *MODE.get_or_init(|| current().game_mode)
}

pub fn current() -> PlatformInfo {
    let device = device();
    PlatformInfo {
        // aperçu sous Windows : l'interface se comporte comme sur le Deck, en Mode Jeu
        os: if cfg!(windows) && !preview() { "windows" } else { "linux" },
        steam_deck: steam_deck(),
        // console Android ou console portable PC reconnue : mode performance d'office
        handheld: steam_deck().is_some() || device.is_some() || cfg!(target_os = "android") || (cfg!(target_os = "linux") && handheld_from(|k| std::env::var(k).ok())),
        game_mode: (cfg!(windows) && preview()) || (cfg!(target_os = "linux") && game_mode_from(|k| std::env::var(k).ok().filter(|v| !v.is_empty()))),
        preview: preview(),
        bench: preview() && (std::env::var_os("IBOX_RP_SAMPLE_FILE").is_some() || std::env::var_os("IBOX_RP_OFFER_FILE").is_some()),
        android: cfg!(target_os = "android"),
        device,
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
    fn console_portable_annoncee_par_steam() {
        assert!(handheld_from(|k| (k == "SteamDeck").then(|| "1".into())));
        assert!(!handheld_from(|k| (k == "SteamDeck").then(|| "0".into())));
        assert!(!handheld_from(|_| None));
    }

    #[test]
    fn systeme_courant() {
        let p = current();
        assert_eq!(p.os, if cfg!(windows) && !preview() { "windows" } else { "linux" });
        if cfg!(windows) && !preview() {
            assert!(p.steam_deck.is_none() && !p.game_mode);
            // console portable seulement si le micrologiciel la nomme
            assert_eq!(p.handheld, p.device.is_some());
        }
    }

    fn fw(vendor: &str, product: &str, family: &str, cpu: &str) -> Firmware {
        Firmware { vendor: vendor.into(), product: product.into(), family: family.into(), version: String::new(), cpu: cpu.into() }
    }

    #[test]
    fn console_hors_table_reconnue_a_sa_forme() {
        let fw = fw("NEWCO", "Handy X1", "", "AMD Ryzen Z2 Extreme");
        // tablette sur batterie, écran de 7 pouces (155×87 mm) : console portable
        let small = FormFactor { slate: true, battery: true, screen_mm: Some((155, 87)), screen_px: Some((1920, 1080)) };
        let d = generic_handheld(&fw, &small).expect("console");
        assert_eq!((d.id, d.name.as_str(), d.gpu), ("handheld", "Handy X1", GpuClass::Mid));
        assert_eq!(d.screen, Some(HandheldScreen { width: 1920, height: 1080, inches: 7.0 }));
        // Surface et tablettes de 10 pouces et plus, ordinateurs portables, bureau : rien
        assert!(generic_handheld(&fw, &FormFactor { screen_mm: Some((260, 173)), ..small.clone() }).is_none());
        assert!(generic_handheld(&fw, &FormFactor { slate: false, ..small.clone() }).is_none());
        assert!(generic_handheld(&fw, &FormFactor { battery: false, ..small.clone() }).is_none());
        // taille d'écran absente ou invraisemblable : rien n'est conclu
        assert!(generic_handheld(&fw, &FormFactor { screen_mm: None, ..small.clone() }).is_none());
        assert!(generic_handheld(&fw, &FormFactor { screen_mm: Some((16, 9)), ..small.clone() }).is_none());
        // nom générique du micrologiciel
        let anon = Firmware { product: "To be filled by O.E.M.".into(), ..fw.clone() };
        assert_eq!(generic_handheld(&anon, &small).unwrap().name, "Console portable");
    }

    #[test]
    fn consoles_portables_reconnues() {
        let id = |f: Firmware| identify(&f).map(|d| (d.id, d.gpu));
        assert_eq!(id(fw("Valve", "Jupiter\n", "", "AMD Custom APU 0405")), Some(("steam-deck-lcd", GpuClass::Low)));
        assert_eq!(id(fw("Valve", "Galileo", "Sephiroth", "AMD Custom APU 0932")), Some(("steam-deck-oled", GpuClass::Low)));
        // ROG Ally : même modèle, deux APU
        assert_eq!(id(fw("ASUSTeK COMPUTER INC.", "ROG Ally RC71L_RC71L", "ROG Ally", "AMD Ryzen Z1 Extreme")), Some(("rog-ally", GpuClass::Mid)));
        assert_eq!(id(fw("ASUSTeK COMPUTER INC.", "ROG Ally RC71L", "ROG Ally", "AMD Ryzen Z1")), Some(("rog-ally", GpuClass::Low)));
        assert_eq!(id(fw("ASUSTeK COMPUTER INC.", "ROG Ally X RC72LA_RC72LA", "ROG Ally X", "AMD Ryzen Z1 Extreme")), Some(("rog-ally-x", GpuClass::Mid)));
        assert_eq!(id(fw("ASUSTeK COMPUTER INC.", "ROG Xbox Ally RC73YA", "", "AMD Ryzen Z2 A")), Some(("rog-xbox-ally", GpuClass::Low)));
        assert_eq!(id(fw("ASUSTeK COMPUTER INC.", "ROG Xbox Ally X RC73XA", "", "AMD Ryzen AI Z2 Extreme")), Some(("rog-xbox-ally-x", GpuClass::Mid)));
        // Lenovo : le produit est un numéro de type, le nom est dans la famille
        assert_eq!(id(fw("LENOVO", "83E1", "Legion Go 8APU1", "AMD Ryzen Z1 Extreme")), Some(("legion-go", GpuClass::Mid)));
        assert_eq!(id(fw("LENOVO", "83L3", "Legion Go S 8ARP1", "AMD Ryzen Z2 Go")), Some(("legion-go-s", GpuClass::Low)));
        assert_eq!(id(fw("LENOVO", "83Q2", "", "AMD Ryzen Z1 Extreme")), Some(("legion-go-s", GpuClass::Mid)));
        assert_eq!(id(fw("LENOVO", "83N0", "Legion Go 2 8AHP2", "AMD Ryzen Z2 Extreme")), Some(("legion-go-2", GpuClass::Mid)));
        assert_eq!(id(fw("Micro-Star International Co., Ltd.", "Claw A1M", "", "Intel(R) Core(TM) Ultra 7 155H")), Some(("msi-claw", GpuClass::Mid)));
        assert_eq!(id(fw("Micro-Star International Co., Ltd.", "Claw 8 AI+ A2VM", "", "Intel(R) Core(TM) Ultra 7 258V")), Some(("msi-claw-8", GpuClass::Mid)));
        assert_eq!(id(fw("AYANEO", "AYANEO 2S", "", "AMD Ryzen 7 7840U")).map(|d| d.0), Some("handheld"));
        assert_eq!(id(fw("GPD", "G1618-04", "WIN 4", "AMD Ryzen 7 6800U")).map(|d| d.0), Some("handheld"));
        // PC ordinaires : rien
        assert_eq!(id(fw("ASUSTeK COMPUTER INC.", "ROG STRIX B650E-F GAMING WIFI", "", "AMD Ryzen 7 7800X3D")), None);
        assert_eq!(id(fw("LENOVO", "82JW", "Legion 5 15ACH6H", "AMD Ryzen 7 5800H")), None);
        assert_eq!(id(fw("Micro-Star International Co., Ltd.", "MS-7D75", "", "AMD Ryzen 9 7950X")), None);
        assert_eq!(id(fw("Valve", "Steam Machine", "", "")), None);
        let ally = identify(&fw("ASUSTeK COMPUTER INC.", "RC71L", "", "AMD Ryzen Z1 Extreme")).unwrap();
        assert_eq!(ally.screen, Some(HandheldScreen { width: 1920, height: 1080, inches: 7.0 }));
    }
}
