//! Fenêtre `music` : le panneau Music in the Box, par-dessus le jeu. La fenêtre couvre tout
//! l'écran d'iBox ou du jeu (`screen::pick`), transparente ; la carte s'y place selon le réglage de position.
//! Ouverte par son raccourci (Alt+C par défaut, `shortcut.rs`) ou en maintenant Vue + Y sur une
//! manette (XInput, lu en natif : la Gamepad API de Chromium ne voit rien quand la fenêtre est
//! cachée ou sans focus).
//!
//! À l'ouverture, la fenêtre du jeu est retenue puis le panneau prend le focus (le jeu ne
//! reçoit plus les entrées) ; à la fermeture, le focus est rendu au jeu. Pendant que le
//! panneau est ouvert, la manette lui est transmise (`music://pad`) et l'état est relu
//! deux fois par seconde (`music://state`).

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
#[cfg(mobile)]
use crate::mobile::DesktopWindow;

pub const LABEL: &str = "music";
/// Durée de maintien du combo manette.
const COMBO_HOLD: Duration = Duration::from_millis(400);

static VISIBLE: AtomicBool = AtomicBool::new(false);
/// Fenêtre au premier plan avant l'ouverture (le jeu), pour lui rendre le focus.
static PREVIOUS: AtomicIsize = AtomicIsize::new(0);
/// Fenêtre du panneau (pour savoir s'il a le focus).
static OWN: AtomicIsize = AtomicIsize::new(0);
/// Réglage « Rester affiché pendant le jeu » : le lecteur reste à l'écran, le jeu garde la
/// main ; les clics à côté de la carte passent au jeu.
static STAY_OPEN: AtomicBool = AtomicBool::new(false);
/// Rectangle de la carte dans la fenêtre (px CSS) et échelle d'affichage, envoyés par l'interface.
static CARD: Mutex<Option<[f64; 5]>> = Mutex::new(None);

/// Ce que le plugin Music in the Box activé a ouvert (`plugins::host::apply`). `None` : socle
/// endormi, ni raccourci, ni manette, ni fenêtre (docs/PLUGINS.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Config {
    /// Raccourci clavier (permission `hotkey`) ; la combinaison vient des réglages.
    pub hotkey: bool,
    /// Combo manette (permission `gamepad`), masque XInput.
    pub combo: Option<u16>,
    /// WebView YouTube Music (permission `webview:https://music.youtube.com`).
    pub webview: bool,
    /// Fond « verre » capturé sous le panneau (permission `backdrop`).
    pub backdrop: bool,
}

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);

pub fn config() -> Option<Config> {
    CONFIG.lock().ok().and_then(|c| *c)
}

pub fn enabled() -> bool {
    config().is_some()
}

/// Réveille (ou endort) le panneau. Endormi : il est caché puis sa fenêtre est détruite.
pub fn configure(app: &AppHandle, config: Option<Config>) {
    if let Ok(mut c) = CONFIG.lock() {
        *c = config;
    }
    if config.is_none() {
        VISIBLE.store(false, Ordering::Relaxed);
        let app = app.clone();
        std::thread::spawn(move || {
            let main = app.clone();
            let _ = main.run_on_main_thread(move || {
                if let Some(w) = app.get_webview_window(LABEL) {
                    let _ = w.destroy();
                    OWN.store(0, Ordering::Relaxed);
                    restore_foreground();
                }
            });
        });
    }
}

pub fn visible() -> bool {
    VISIBLE.load(Ordering::Relaxed)
}

fn stay_open() -> bool {
    STAY_OPEN.load(Ordering::Relaxed)
}

pub fn start(app: AppHandle) {
    pad_thread(app.clone());
    cursor_thread(app.clone());
    state_thread(app);
}

/// Mode d'affichage et position de la carte (px CSS + `devicePixelRatio`), envoyés par
/// l'interface à chaque changement.
#[tauri::command]
pub async fn music_layout(stay_open: bool, card: Option<[f64; 4]>, scale: Option<f64>) {
    STAY_OPEN.store(stay_open, Ordering::Relaxed);
    if let Ok(mut c) = CARD.lock() {
        *c = card.map(|[x, y, w, h]| [x, y, w, h, scale.unwrap_or(1.0)]);
    }
}

/// Écran où la carte a été glissée depuis le lancement d'iBox (nom Windows, ex.
/// « \\.\DISPLAY2 »). Absent : le lecteur s'ouvre là où l'on regarde (`screen::pick`). Il
/// n'est plus relu des réglages : l'écran gardé d'un lancement à l'autre se perdait entre
/// les fenêtres, et le lecteur s'ouvrait ailleurs que sur l'écran d'iBox (28/11/2026).
static MONITOR: Mutex<Option<String>> = Mutex::new(None);

pub mod screen {
    //! Choix de l'écran du lecteur (sans dépendance Windows : testable).

    /// Écran du bureau, en pixels physiques.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Rect {
        pub x: i32,
        pub y: i32,
        pub w: u32,
        pub h: u32,
    }

    fn at(screens: &[Rect], (px, py): (i32, i32)) -> Option<usize> {
        screens.iter().position(|s| px >= s.x && py >= s.y && (px as i64) < s.x as i64 + s.w as i64 && (py as i64) < s.y as i64 + s.h as i64)
    }

    /// Dans l'ordre : l'écran où la carte a été glissée depuis le lancement (`pinned`), celui
    /// de la fenêtre qui avait la main à l'ouverture (le jeu, ou iBox : centre `foreground`),
    /// celui de la fenêtre d'iBox (centre `ibox`), puis l'écran principal.
    pub fn pick(screens: &[Rect], pinned: Option<usize>, foreground: Option<(i32, i32)>, ibox: Option<(i32, i32)>, primary: Option<usize>) -> Option<usize> {
        pinned
            .filter(|i| *i < screens.len())
            .or_else(|| foreground.and_then(|p| at(screens, p)))
            .or_else(|| ibox.and_then(|p| at(screens, p)))
            .or(primary.filter(|i| *i < screens.len()))
            .or((!screens.is_empty()).then_some(0))
    }
}

fn chosen_monitor(app: &AppHandle, w: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    let monitors = w.available_monitors().ok()?;
    let screens: Vec<screen::Rect> = monitors.iter().map(|m| screen::Rect { x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height }).collect();
    let wanted = MONITOR.lock().ok().and_then(|m| m.clone());
    let pinned = wanted.and_then(|name| monitors.iter().position(|m| m.name() == Some(&name)));
    let primary = w.primary_monitor().ok().flatten().and_then(|p| monitors.iter().position(|m| m.position() == p.position()));
    // fenêtre d'iBox réduite : sa position ne dit plus rien (-32000), on passe à la suite
    let ibox = app.get_webview_window("main").filter(|m| !m.is_minimized().unwrap_or(true)).and_then(|m| {
        let (p, s) = (m.outer_position().ok()?, m.outer_size().ok()?);
        Some((p.x + s.width as i32 / 2, p.y + s.height as i32 / 2))
    });
    let i = screen::pick(&screens, pinned, foreground_center(), ibox, primary)?;
    monitors.into_iter().nth(i)
}

/// Centre de la fenêtre qui avait la main à l'ouverture (retenue par `remember_foreground`).
/// Rien pour le bureau ou la barre des tâches (leur fenêtre s'étend sur tous les écrans) ni
/// pour une fenêtre réduite.
#[cfg(windows)]
fn foreground_center() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowRect, IsIconic, IsWindow, IsWindowVisible};
    let hwnd = PREVIOUS.load(Ordering::Relaxed);
    if hwnd == 0 || hwnd == OWN.load(Ordering::Relaxed) {
        return None;
    }
    unsafe {
        let h = hwnd as _;
        if IsWindow(h) == 0 || IsWindowVisible(h) == 0 || IsIconic(h) != 0 {
            return None;
        }
        let mut class = [0u16; 64];
        let n = GetClassNameW(h, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
        let class = String::from_utf16_lossy(&class[..n]);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd") {
            return None;
        }
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        (GetWindowRect(h, &mut r) != 0).then_some((r.left + (r.right - r.left) / 2, r.top + (r.bottom - r.top) / 2))
    }
}
#[cfg(not(windows))]
fn foreground_center() -> Option<(i32, i32)> {
    None
}

/// Position d'abord : en changeant d'écran, Windows redimensionne la fenêtre quand l'échelle
/// d'affichage diffère ; la taille posée ensuite est la bonne, puis la position est confirmée.
fn cover(w: &tauri::WebviewWindow, m: &tauri::Monitor) {
    let at = PhysicalPosition::new(m.position().x, m.position().y);
    let _ = w.set_position(at);
    let _ = w.set_size(PhysicalSize::new(m.size().width, m.size().height));
    let _ = w.set_position(at);
}

/// Pendant un glissement de la carte : si la souris est passée sur un autre écran, la
/// fenêtre du lecteur s'y déplace. Rend le nom du nouvel écran (à garder dans les réglages),
/// ou rien si l'écran n'a pas changé.
#[tauri::command]
pub async fn music_follow_cursor(app: AppHandle) -> Option<String> {
    let w = app.get_webview_window(LABEL)?;
    let (x, y) = cursor()?;
    let target = w.monitor_from_point(x as f64, y as f64).ok().flatten()?;
    let current = w.current_monitor().ok().flatten();
    if current.as_ref().and_then(|m| m.name()) == target.name() {
        return None;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let main = app.clone();
    let t = target.clone();
    let _ = main.run_on_main_thread(move || {
        cover(&w, &t);
        let _ = tx.send(());
    });
    let _ = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(2))).await;
    let name = target.name().cloned();
    if let Ok(mut m) = MONITOR.lock() {
        *m = name.clone();
    }
    name
}

#[cfg(windows)]
fn cursor() -> Option<(i32, i32)> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut p = POINT { x: 0, y: 0 };
    (unsafe { GetCursorPos(&mut p) } != 0).then_some((p.x, p.y))
}
#[cfg(not(windows))]
fn cursor() -> Option<(i32, i32)> {
    None
}

/// « Rester affiché » : rend le clavier et la manette au jeu sans cacher le lecteur.
#[tauri::command]
pub async fn music_release(app: AppHandle) {
    let main = app.clone();
    let _ = main.run_on_main_thread(move || {
        let _ = &app;
        give_back_focus();
    });
}

/// Pendant « Rester affiché » : la fenêtre (tout l'écran) laisse passer les clics partout
/// sauf sur la carte. On suit la souris, et l'on bascule « transparente aux clics » quand
/// elle sort de la carte.
fn cursor_thread(app: AppHandle) {
    std::thread::spawn(move || {
        let mut ignoring = false;
        loop {
            let want = visible() && stay_open() && !over_card(&app);
            if want != ignoring {
                if let Some(w) = app.get_webview_window(LABEL) {
                    if w.set_ignore_cursor_events(want).is_ok() {
                        ignoring = want;
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(if visible() && stay_open() { 25 } else { 200 }));
        }
    });
}

#[cfg(windows)]
fn over_card(app: &AppHandle) -> bool {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let Some([x, y, w, h, scale]) = CARD.lock().ok().and_then(|c| *c) else { return true };
    let Some(win) = app.get_webview_window(LABEL) else { return true };
    let Ok(origin) = win.inner_position() else { return true };
    let mut p = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut p) } == 0 {
        return true;
    }
    let cx = (p.x - origin.x) as f64 / scale;
    let cy = (p.y - origin.y) as f64 / scale;
    cx >= x && cx <= x + w && cy >= y && cy <= y + h
}
#[cfg(not(windows))]
fn over_card(_: &AppHandle) -> bool {
    true
}

/// Le panneau a-t-il le clavier et la manette ?
#[cfg(windows)]
fn has_focus() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let own = OWN.load(Ordering::Relaxed);
    own != 0 && unsafe { GetForegroundWindow() } as isize == own
}
#[cfg(not(windows))]
fn has_focus() -> bool {
    true
}

/// Android : pas de panneau musique flottant (une seule fenêtre).
#[cfg(mobile)]
fn window(_: &AppHandle) -> Option<tauri::WebviewWindow> {
    None
}

#[cfg(desktop)]
fn window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Some(w);
    }
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("iBox Musique")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
        .map_err(|e| eprintln!("iBox : panneau musique indisponible : {e}"))
        .ok()
        .inspect(super::backdrop::exclude_from_capture)
}

/// Ouvre le panneau. Comme pour l'overlay de capture, la fenêtre est créée par la boucle
/// d'événements depuis un autre fil (jamais dans une commande).
pub fn show(app: &AppHandle) {
    let Some(config) = config() else { return };
    remember_foreground();
    VISIBLE.store(true, Ordering::Relaxed);
    let app = app.clone();
    std::thread::spawn(move || {
        // YouTube Music déjà connecté sur ce PC : la page se charge (cachée) pour être pilotable
        if config.webview && super::ytm::known(&app) && super::ytm::window(&app).is_none() {
            let a = app.clone();
            std::thread::spawn(move || {
                super::ytm::open(&a, false);
            });
        }
        let main = app.clone();
        let ui = app.clone();
        let _ = main.run_on_main_thread(move || {
            let app = ui;
            let Some(w) = window(&app) else {
                VISIBLE.store(false, Ordering::Relaxed);
                return;
            };
            // tout l'écran choisi (celui d'iBox ou du jeu, voir `screen::pick`), transparent :
            // la carte s'y place où l'utilisateur l'a mise
            if let Some(m) = chosen_monitor(&app, &w) {
                cover(&w, &m);
            }
            let _ = w.show();
            let _ = w.set_always_on_top(true);
            let _ = w.set_focus();
            #[cfg(windows)]
            if let Ok(h) = w.hwnd() {
                OWN.store(h.0 as isize, Ordering::Relaxed);
                force_foreground(h.0 as isize);
            }
            let _ = app.emit_to(LABEL, "music://open", ());
            super::diag::after_show(&app, LABEL);
        });
        super::emit_state(&app);
    });
}

/// Cache le panneau et rend le focus au jeu.
pub fn hide(app: &AppHandle) {
    VISIBLE.store(false, Ordering::Relaxed);
    let app = app.clone();
    std::thread::spawn(move || {
        let main = app.clone();
        let _ = main.run_on_main_thread(move || {
            if let Some(w) = app.get_webview_window(LABEL) {
                let _ = w.hide();
            }
            restore_foreground();
        });
    });
}

/// Raccourci ou combo : ouvre, ou demande à l'interface de fermer (elle anime la sortie
/// puis appelle `music_close`). Sans réponse, le panneau est caché quand même.
pub fn toggle(app: &AppHandle) {
    if !visible() {
        show(app);
        return;
    }
    let _ = app.emit_to(LABEL, "music://close-request", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(700));
        if visible() {
            hide(&app);
        }
    });
}

#[tauri::command]
pub async fn music_close(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub async fn music_open(app: AppHandle) {
    show(&app);
}

/// Relit l'état deux fois par seconde tant que le panneau est ouvert.
fn state_thread(app: AppHandle) {
    std::thread::spawn(move || loop {
        if visible() {
            super::emit_state(&app);
            std::thread::sleep(Duration::from_millis(500));
        } else {
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

// ——— Focus ———

#[cfg(windows)]
fn remember_foreground() {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    let fg = unsafe { GetForegroundWindow() } as isize;
    // le panneau lui-même au premier plan (ouverture répétée) : on garde le jeu retenu
    if fg != 0 && !visible() {
        PREVIOUS.store(fg, Ordering::Relaxed);
    }
}
#[cfg(not(windows))]
fn remember_foreground() {}

/// Passe une fenêtre au premier plan, même quand iBox n'est pas l'application active
/// (combo manette) : on attache le fil au fil de la fenêtre active le temps du changement.
/// Pas de touche Alt simulée : elle ouvrirait la barre de menus de certains émulateurs.
#[cfg(windows)]
pub(crate) fn force_foreground(hwnd: isize) {
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow};
    unsafe {
        let target = hwnd as _;
        let fg = GetForegroundWindow();
        if fg == target {
            return;
        }
        let me = GetCurrentThreadId();
        let other = if fg.is_null() { 0 } else { GetWindowThreadProcessId(fg, std::ptr::null_mut()) };
        let attached = other != 0 && other != me && AttachThreadInput(me, other, 1) != 0;
        BringWindowToTop(target);
        SetForegroundWindow(target);
        if attached {
            AttachThreadInput(me, other, 0);
        }
    }
}

#[cfg(windows)]
fn restore_foreground() {
    give_back_focus();
    PREVIOUS.store(0, Ordering::Relaxed);
}
#[cfg(not(windows))]
fn restore_foreground() {}

/// Rend le focus au jeu retenu à l'ouverture (le lecteur peut rester affiché).
#[cfg(windows)]
fn give_back_focus() {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindow;
    let prev = PREVIOUS.load(Ordering::Relaxed);
    if prev != 0 && unsafe { IsWindow(prev as _) } != 0 {
        force_foreground(prev);
    }
}
#[cfg(not(windows))]
fn give_back_focus() {}


// ——— Manette : XInput ———

pub mod pad {
    //! Boutons XInput et traduction en actions du panneau (sans dépendance Windows : testable).
    pub const UP: u16 = 0x0001;
    pub const DOWN: u16 = 0x0002;
    pub const LEFT: u16 = 0x0004;
    pub const RIGHT: u16 = 0x0008;
    pub const START: u16 = 0x0010;
    pub const BACK: u16 = 0x0020;
    pub const LB: u16 = 0x0100;
    pub const RB: u16 = 0x0200;
    pub const A: u16 = 0x1000;
    pub const B: u16 = 0x2000;
    pub const X: u16 = 0x4000;
    pub const Y: u16 = 0x8000;
    /// Combo d'ouverture : Vue (Back) + Y maintenus.
    pub const COMBO: u16 = BACK | Y;

    const ACTIONS: [(u16, &str); 11] = [
        (A, "ok"), (B, "back"), (X, "x"), (Y, "y"), (LB, "lb"), (RB, "rb"), (START, "start"),
        (UP, "up"), (DOWN, "down"), (LEFT, "left"), (RIGHT, "right"),
    ];
    /// Boutons répétés tant qu'ils restent enfoncés (croix directionnelle).
    pub const REPEAT: u16 = UP | DOWN | LEFT | RIGHT;

    /// Actions des boutons qui viennent d'être enfoncés. Rien tant que Vue est tenu
    /// (le combo ne doit pas aussi agir dans le panneau).
    pub fn pressed(now: u16, before: u16) -> Vec<&'static str> {
        if now & BACK != 0 {
            return Vec::new();
        }
        let fresh = now & !before;
        ACTIONS.iter().filter(|(b, _)| fresh & b != 0).map(|(_, a)| *a).collect()
    }

    pub fn repeated(now: u16) -> Vec<&'static str> {
        if now & BACK != 0 {
            return Vec::new();
        }
        ACTIONS.iter().filter(|(b, _)| now & REPEAT & b != 0).map(|(_, a)| *a).collect()
    }
}

/// Boutons XInput de toutes les manettes réunies ; `None` : aucune manette (ou XInput absent).
/// Partagé avec le panneau des plugins (`plugins/panel.rs`).
#[cfg(windows)]
pub(crate) fn xinput_buttons() -> Option<u16> {
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Gamepad {
        buttons: u16,
        lt: u8,
        rt: u8,
        lx: i16,
        ly: i16,
        rx: i16,
        ry: i16,
    }
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct XState {
        packet: u32,
        pad: Gamepad,
    }
    type GetState = unsafe extern "system" fn(u32, *mut XState) -> u32;
    static GET: std::sync::OnceLock<Option<GetState>> = std::sync::OnceLock::new();
    let get = (*GET.get_or_init(|| unsafe {
        use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};
        let mut lib = LoadLibraryA(c"xinput1_4.dll".as_ptr() as _);
        if lib.is_null() {
            lib = LoadLibraryA(c"xinput9_1_0.dll".as_ptr() as _);
        }
        if lib.is_null() {
            return None;
        }
        GetProcAddress(lib, c"XInputGetState".as_ptr() as _).map(|f| std::mem::transmute::<unsafe extern "system" fn() -> isize, GetState>(f))
    }))?;
    let mut now = 0u16;
    let mut connected = false;
    for slot in 0..4 {
        let mut s = XState::default();
        if unsafe { get(slot, &mut s) } == 0 {
            connected = true;
            now |= s.pad.buttons;
        }
    }
    connected.then_some(now)
}

#[cfg(windows)]
fn pad_thread(app: AppHandle) {
    std::thread::spawn(move || {
        let mut before = 0u16;
        let mut combo_since: Option<Instant> = None;
        let mut combo_fired = false;
        let mut repeat_at: Option<Instant> = None;
        let mut idle_checks = 0u32;
        loop {
            // sans plugin qui l'a demandé, la manette n'est pas lue
            let Some(combo) = config().and_then(|c| c.combo) else {
                before = 0;
                combo_since = None;
                std::thread::sleep(Duration::from_millis(500));
                continue;
            };
            // toutes les manettes réunies : n'importe laquelle ouvre et pilote le panneau
            let Some(now) = xinput_buttons() else {
                // aucune manette : on vérifie une fois par seconde seulement
                idle_checks += 1;
                before = 0;
                std::thread::sleep(Duration::from_millis(if idle_checks > 3 { 1000 } else { 100 }));
                continue;
            };
            idle_checks = 0;

            if now & combo == combo {
                let since = *combo_since.get_or_insert_with(Instant::now);
                if !combo_fired && since.elapsed() >= COMBO_HOLD {
                    combo_fired = true;
                    super::diag::log(&app, "combo manette reçu");
                    toggle(&app);
                }
            } else {
                combo_since = None;
                combo_fired = false;
            }

            // « Rester affiché » : la manette va au jeu tant que le panneau n’a pas le focus
            if visible() && (!stay_open() || has_focus()) {
                for action in pad::pressed(now, before) {
                    let _ = app.emit_to(LABEL, "music://pad", action);
                }
                // répétition de la croix : 400 ms puis toutes les 120 ms
                if now & pad::REPEAT != 0 && now & pad::REPEAT == before & pad::REPEAT {
                    let at = *repeat_at.get_or_insert_with(|| Instant::now() + Duration::from_millis(400));
                    if Instant::now() >= at {
                        for action in pad::repeated(now) {
                            let _ = app.emit_to(LABEL, "music://pad", action);
                        }
                        repeat_at = Some(Instant::now() + Duration::from_millis(120));
                    }
                } else {
                    repeat_at = None;
                }
            }
            before = now;
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}
#[cfg(not(windows))]
fn pad_thread(_app: AppHandle) {}

#[cfg(test)]
mod tests {
    use super::pad::*;
    use super::screen::{pick, Rect};

    /// Deux écrans : le principal 4K à droite (indice 1), un plus petit à gauche (indice 0).
    const SCREENS: [Rect; 2] = [Rect { x: -1920, y: 0, w: 1920, h: 1080 }, Rect { x: 0, y: 0, w: 3840, h: 2160 }];

    #[test]
    fn the_player_opens_on_the_screen_of_ibox_not_the_primary_one() {
        // iBox au premier plan sur le petit écran : c'est lui, pas l'écran principal
        assert_eq!(pick(&SCREENS, None, Some((-960, 540)), Some((-960, 540)), Some(1)), Some(0));
        // aucune fenêtre retenue (bureau au premier plan) : l'écran de la fenêtre d'iBox
        assert_eq!(pick(&SCREENS, None, None, Some((-960, 540)), Some(1)), Some(0));
        // un jeu sur l'autre écran : le lecteur s'ouvre par-dessus le jeu
        assert_eq!(pick(&SCREENS, None, Some((1920, 1080)), Some((-960, 540)), Some(0)), Some(1));
    }

    #[test]
    fn a_card_dragged_to_another_screen_stays_there_until_ibox_restarts() {
        assert_eq!(pick(&SCREENS, Some(1), Some((-960, 540)), Some((-960, 540)), Some(0)), Some(1));
        // écran débranché depuis : on revient à celui d'iBox
        assert_eq!(pick(&SCREENS[..1], Some(1), None, Some((-960, 540)), Some(0)), Some(0));
    }

    #[test]
    fn without_any_window_the_primary_screen_is_used() {
        assert_eq!(pick(&SCREENS, None, None, None, Some(1)), Some(1));
        // fenêtre hors de tout écran (réduite, écran retiré)
        assert_eq!(pick(&SCREENS, None, Some((-32000, -32000)), None, Some(1)), Some(1));
        assert_eq!(pick(&SCREENS, None, None, None, None), Some(0));
        assert_eq!(pick(&[], None, None, None, Some(0)), None);
    }

    #[test]
    fn only_fresh_buttons_become_actions() {
        assert_eq!(pressed(A, 0), vec!["ok"]);
        assert!(pressed(A, A).is_empty());
        assert_eq!(pressed(A | RB, A), vec!["rb"]);
    }

    #[test]
    fn the_combo_never_acts_inside_the_panel() {
        assert!(pressed(BACK | Y, BACK).is_empty());
        assert!(pressed(BACK, 0).is_empty());
        assert!(repeated(BACK | UP).is_empty());
        assert_eq!(repeated(UP | A), vec!["up"]);
    }
}
