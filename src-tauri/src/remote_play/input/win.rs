//! Partie Windows réelle : `SendInput`, géométrie des écrans, fil de garde (raccourci d'arrêt
//! d'urgence, verrouillage / changement de session, crochets de priorité locale).
//!
//! Sécurité : rien ici ne demande d'élévation ni ne contourne l'UIPI ou le bureau sécurisé ;
//! `SendInput` vers une fenêtre administrateur, l'UAC ou l'écran de verrouillage échoue, et
//! l'échec est remonté tel quel ([`InjectError::Refused`]).

use std::cell::RefCell;
use std::mem::{size_of, zeroed};
use std::ptr::{null, null_mut};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::Instant;

use windows_sys::Win32::Foundation::{GetLastError, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{ClientToScreen, GetMonitorInfoW, MONITORINFO};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::System::Threading::GetCurrentThreadId;
use windows_sys::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows_sys::Win32::UI::Input::KeyboardAndMouse as km;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    GetLastInputInfo, RegisterHotKey, SendInput, UnregisterHotKey, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT,
    LASTINPUTINFO, MOD_NOREPEAT, MOUSEINPUT,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetMessageW,
    GetSystemMetrics, IsIconic, IsWindow, PostThreadMessageW, RegisterClassW, SetWindowsHookExW, TranslateMessage,
    UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, LLKHF_INJECTED, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, SM_CXVIRTUALSCREEN,
    SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_HOTKEY, WM_QUIT,
    WM_WTSSESSION_CHANGE, WNDCLASSW, WS_EX_TOOLWINDOW, WS_POPUP,
};

use super::geometry::Rect;
use super::hotkey::{stop_for_session_event, Hotkey, StopReason};
use super::inject::{self, raw, Area, InjectError, OsInput, Screen, Sink};
use super::local::{foreign_input, LocalActivity};

// Les constantes recopiées dans `inject.rs` doivent rester celles de Windows.
const _: () = {
    assert!(inject::KEYEVENTF_EXTENDEDKEY == km::KEYEVENTF_EXTENDEDKEY);
    assert!(inject::KEYEVENTF_KEYUP == km::KEYEVENTF_KEYUP);
    assert!(inject::KEYEVENTF_SCANCODE == km::KEYEVENTF_SCANCODE);
    assert!(inject::MOUSEEVENTF_MOVE == km::MOUSEEVENTF_MOVE);
    assert!(inject::MOUSEEVENTF_LEFTDOWN == km::MOUSEEVENTF_LEFTDOWN);
    assert!(inject::MOUSEEVENTF_LEFTUP == km::MOUSEEVENTF_LEFTUP);
    assert!(inject::MOUSEEVENTF_RIGHTDOWN == km::MOUSEEVENTF_RIGHTDOWN);
    assert!(inject::MOUSEEVENTF_RIGHTUP == km::MOUSEEVENTF_RIGHTUP);
    assert!(inject::MOUSEEVENTF_MIDDLEDOWN == km::MOUSEEVENTF_MIDDLEDOWN);
    assert!(inject::MOUSEEVENTF_MIDDLEUP == km::MOUSEEVENTF_MIDDLEUP);
    assert!(inject::MOUSEEVENTF_XDOWN == km::MOUSEEVENTF_XDOWN);
    assert!(inject::MOUSEEVENTF_XUP == km::MOUSEEVENTF_XUP);
    assert!(inject::MOUSEEVENTF_WHEEL == km::MOUSEEVENTF_WHEEL);
    assert!(inject::MOUSEEVENTF_HWHEEL == km::MOUSEEVENTF_HWHEEL);
    assert!(inject::MOUSEEVENTF_VIRTUALDESK == km::MOUSEEVENTF_VIRTUALDESK);
    assert!(inject::MOUSEEVENTF_ABSOLUTE == km::MOUSEEVENTF_ABSOLUTE);
    assert!(inject::XBUTTON1 as u16 == windows_sys::Win32::UI::WindowsAndMessaging::XBUTTON1);
    assert!(inject::XBUTTON2 as u16 == windows_sys::Win32::UI::WindowsAndMessaging::XBUTTON2);
};

/// Marque nos injections (`dwExtraInfo`) pour les reconnaître dans un journal ou un crochet.
pub const IBOX_INPUT_TAG: usize = 0x1B0C_5EED;

/// Le fil courant passe en « Per-Monitor V2 » le temps de la portée : rectangles et coordonnées
/// absolues en pixels physiques, quel que soit le DPI de chaque écran.
struct PhysicalPixels(DPI_AWARENESS_CONTEXT);

impl PhysicalPixels {
    fn enter() -> Self {
        PhysicalPixels(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) })
    }
}

impl Drop for PhysicalPixels {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }
}

fn to_input(input: &OsInput) -> INPUT {
    let r = raw(input);
    if r.mouse {
        INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: r.dx,
                    dy: r.dy,
                    mouseData: r.data as u32,
                    dwFlags: r.flags,
                    time: 0,
                    dwExtraInfo: IBOX_INPUT_TAG,
                },
            },
        }
    } else {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT { wVk: 0, wScan: r.data as u16, dwFlags: r.flags, time: 0, dwExtraInfo: IBOX_INPUT_TAG },
            },
        }
    }
}

/// Injection réelle par `SendInput`.
#[derive(Debug, Default)]
pub struct WinSink {
    last_injected: Option<u32>,
}

impl Sink for WinSink {
    fn send(&mut self, inputs: &[OsInput]) -> Result<(), InjectError> {
        if inputs.is_empty() {
            return Ok(());
        }
        let raw: Vec<INPUT> = inputs.iter().map(to_input).collect();
        let _dpi = PhysicalPixels::enter();
        let sent = unsafe { SendInput(raw.len() as u32, raw.as_ptr(), size_of::<INPUT>() as i32) };
        self.last_injected = Some(unsafe { GetTickCount() });
        if sent as usize != raw.len() {
            return Err(InjectError::Refused(unsafe { GetLastError() }));
        }
        Ok(())
    }

    fn foreign_input_since_last(&mut self) -> bool {
        let Some(last) = self.last_injected else { return false };
        let mut info = LASTINPUTINFO { cbSize: size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
        let ok = unsafe { GetLastInputInfo(&mut info) != 0 };
        ok && foreign_input(info.dwTime, last)
    }
}

/// Géométrie réelle (pixels physiques).
#[derive(Debug, Default)]
pub struct WinScreen;

fn rect(r: RECT) -> Rect {
    Rect::new(r.left, r.top, r.right - r.left, r.bottom - r.top)
}

impl Screen for WinScreen {
    fn desktop(&self) -> Rect {
        let _dpi = PhysicalPixels::enter();
        unsafe {
            Rect::new(
                GetSystemMetrics(SM_XVIRTUALSCREEN),
                GetSystemMetrics(SM_YVIRTUALSCREEN),
                GetSystemMetrics(SM_CXVIRTUALSCREEN),
                GetSystemMetrics(SM_CYVIRTUALSCREEN),
            )
        }
    }

    fn resolve(&self, area: &Area) -> Option<Rect> {
        let _dpi = PhysicalPixels::enter();
        unsafe {
            match *area {
                Area::Desktop => Some(self.desktop()),
                Area::Rect(r) => Some(r),
                Area::Monitor(h) => {
                    let mut info: MONITORINFO = zeroed();
                    info.cbSize = size_of::<MONITORINFO>() as u32;
                    (GetMonitorInfoW(h as _, &mut info) != 0).then(|| rect(info.rcMonitor))
                }
                Area::Window(h) => {
                    let hwnd = h as HWND;
                    if IsWindow(hwnd) == 0 || IsIconic(hwnd) != 0 {
                        return None;
                    }
                    let mut client: RECT = zeroed();
                    let mut origin = POINT { x: 0, y: 0 };
                    if GetClientRect(hwnd, &mut client) == 0 || ClientToScreen(hwnd, &mut origin) == 0 {
                        return None;
                    }
                    Some(Rect::new(origin.x, origin.y, client.right, client.bottom))
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Fil de garde
// ---------------------------------------------------------------------------------------------

const HOTKEY_ID: i32 = 0x1B0C;

struct GuardState {
    on_stop: Box<dyn Fn(StopReason) + Send>,
    local: Arc<LocalActivity>,
}

thread_local! {
    // les crochets bas niveau et la procédure de fenêtre s'exécutent sur le fil qui les a posés
    static GUARD: RefCell<Option<GuardState>> = const { RefCell::new(None) };
}

fn fire(reason: StopReason) {
    GUARD.with(|g| {
        if let Some(state) = g.borrow().as_ref() {
            (state.on_stop)(reason);
        }
    });
}

fn note_local() {
    GUARD.with(|g| {
        if let Some(state) = g.borrow().as_ref() {
            state.local.note(Instant::now());
        }
    });
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && lparam != 0 {
        let info = &*(lparam as *const MSLLHOOKSTRUCT);
        if info.flags & LLMHF_INJECTED == 0 {
            note_local();
        }
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && lparam != 0 {
        let info = &*(lparam as *const KBDLLHOOKSTRUCT);
        if info.flags & LLKHF_INJECTED == 0 {
            note_local();
        }
    }
    CallNextHookEx(null_mut(), code, wparam, lparam)
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_HOTKEY if wparam as i32 == HOTKEY_ID => {
            fire(StopReason::Hotkey);
            0
        }
        WM_WTSSESSION_CHANGE => {
            if let Some(reason) = stop_for_session_event(wparam as u32) {
                fire(reason);
            }
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// Fil dédié avec sa propre boucle de messages : raccourci global d'arrêt d'urgence
/// (`RegisterHotKey`), notification de verrouillage / changement de session
/// (`WTSRegisterSessionNotification`) et crochets bas niveau de priorité locale.
/// S'arrête (et libère tout) quand il est détruit.
pub struct Guard {
    thread: u32,
    join: Option<JoinHandle<()>>,
    hooked: bool,
}

impl Guard {
    /// `on_stop` est appelé sur le fil de garde : il doit rester court (suspendre la session,
    /// relâcher, prévenir l'interface).
    pub fn start(hotkey: Hotkey, local: Arc<LocalActivity>, on_stop: Box<dyn Fn(StopReason) + Send>) -> Result<Guard, String> {
        let (tx, rx) = mpsc::channel::<Result<(u32, bool), String>>();
        let join = std::thread::Builder::new()
            .name("remote-play-guard".into())
            .spawn(move || unsafe { guard_thread(hotkey, local, on_stop, tx) })
            .map_err(|e| e.to_string())?;
        match rx.recv() {
            Ok(Ok((thread, hooked))) => Ok(Guard { thread, join: Some(join), hooked }),
            Ok(Err(e)) => {
                let _ = join.join();
                Err(e)
            }
            Err(_) => {
                let _ = join.join();
                Err("le fil d'arrêt d'urgence s'est arrêté au démarrage".into())
            }
        }
    }

    /// Vrai si les crochets de priorité locale sont posés (sinon heuristique `GetLastInputInfo`).
    pub fn hooked(&self) -> bool {
        self.hooked
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        unsafe { PostThreadMessageW(self.thread, WM_QUIT, 0, 0) };
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

unsafe fn guard_thread(
    hotkey: Hotkey,
    local: Arc<LocalActivity>,
    on_stop: Box<dyn Fn(StopReason) + Send>,
    ready: mpsc::Sender<Result<(u32, bool), String>>,
) {
    let instance = GetModuleHandleW(null());
    let class = wide("iBoxRemotePlayGuard");
    let wc = WNDCLASSW { lpfnWndProc: Some(window_proc), hInstance: instance, lpszClassName: class.as_ptr(), ..zeroed() };
    // échoue sans conséquence si la classe existe déjà (garde précédente)
    RegisterClassW(&wc);
    // fenêtre jamais affichée : la notification de session exige une fenêtre
    let hwnd = CreateWindowExW(WS_EX_TOOLWINDOW, class.as_ptr(), class.as_ptr(), WS_POPUP, 0, 0, 0, 0, null_mut(), null_mut(), instance, null());
    if hwnd.is_null() {
        let _ = ready.send(Err(format!("fenêtre de garde impossible (code {})", GetLastError())));
        return;
    }
    if RegisterHotKey(hwnd, HOTKEY_ID, hotkey.modifiers | MOD_NOREPEAT, hotkey.vk) == 0 {
        let code = GetLastError();
        DestroyWindow(hwnd);
        let _ = ready.send(Err(format!("le raccourci {hotkey} est déjà utilisé par une autre application (code {code})")));
        return;
    }
    if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) == 0 {
        let code = GetLastError();
        UnregisterHotKey(hwnd, HOTKEY_ID);
        DestroyWindow(hwnd);
        let _ = ready.send(Err(format!("surveillance du verrouillage de Windows impossible (code {code})")));
        return;
    }
    GUARD.with(|g| *g.borrow_mut() = Some(GuardState { on_stop, local: local.clone() }));
    let mouse: HHOOK = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), instance, 0);
    let keyboard: HHOOK = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), instance, 0);
    let hooked = !mouse.is_null() && !keyboard.is_null();
    local.set_hooked(hooked);
    let _ = ready.send(Ok((GetCurrentThreadId(), hooked)));

    let mut msg: MSG = zeroed();
    while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    for hook in [mouse, keyboard] {
        if !hook.is_null() {
            UnhookWindowsHookEx(hook);
        }
    }
    local.set_hooked(false);
    WTSUnRegisterSessionNotification(hwnd);
    UnregisterHotKey(hwnd, HOTKEY_ID);
    DestroyWindow(hwnd);
    GUARD.with(|g| g.borrow_mut().take());
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Appelle le vrai `SendInput` (déplacement relatif nul) : jamais dans les tests automatiques.
    /// `cargo test --lib sendinput_real -- --ignored`
    #[test]
    #[ignore = "SendInput réel : manuel"]
    fn sendinput_real() {
        WinSink::default().send(&[OsInput::MoveRel { dx: 0, dy: 0 }]).unwrap();
    }

    /// Pose et retire réellement raccourci, notification de session et crochets bas niveau
    /// (sans rien injecter). `cargo test --lib guard_real -- --ignored`
    #[test]
    #[ignore = "raccourci global et crochets système réels : manuel"]
    fn guard_real() {
        let local = Arc::new(LocalActivity::new());
        let hotkey: Hotkey = "Ctrl+Alt+Shift+F23".parse().unwrap();
        let guard = Guard::start(hotkey, local.clone(), Box::new(|_| {})).unwrap();
        assert!(local.hooked() == guard.hooked());
        // un second enregistrement du même raccourci doit échouer proprement
        let second = Guard::start(hotkey, Arc::new(LocalActivity::new()), Box::new(|_| {}));
        assert!(second.is_err());
        drop(guard);
        assert!(!local.hooked());
        // libéré : réenregistrable
        drop(Guard::start(hotkey, local, Box::new(|_| {})).unwrap());
    }
}
