//! Ce que l'hôte peut partager : écrans et fenêtres visibles, avec le jeu lancé depuis iBox
//! proposé en premier (Game Share). Aucune capture ici : seulement la liste, lue à la demande.

use serde::{Deserialize, Serialize};

use super::capture::Target;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Source {
    /// Écran entier (`HMONITOR`).
    Monitor { id: i64, name: String, width: i32, height: i32, primary: bool },
    /// Fenêtre (`HWND`) et le processus qui la possède.
    Window { id: i64, title: String, pid: u32, width: i32, height: i32 },
}

impl Source {
    pub fn target(&self) -> Target {
        match self {
            Source::Monitor { id, .. } => Target::Monitor(*id as isize),
            Source::Window { id, .. } => Target::Window(*id as isize),
        }
    }
}

/// Choix de l'hôte transmis par l'interface (identifiant seulement, revalidé ici).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Choice {
    Primary,
    Monitor { id: i64 },
    Window { id: i64 },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sources {
    pub items: Vec<Source>,
    /// Fenêtre du jeu lancé depuis iBox, si on la trouve : choisie par défaut.
    pub game: Option<i64>,
    pub game_title: Option<String>,
}

/// La plus grande fenêtre visible du processus `pid`.
pub fn window_of(items: &[Source], pid: u32) -> Option<i64> {
    items
        .iter()
        .filter_map(|s| match s {
            Source::Window { id, pid: p, width, height, .. } if *p == pid => Some((*id, *width as i64 * *height as i64)),
            _ => None,
        })
        .max_by_key(|(_, area)| *area)
        .map(|(id, _)| id)
}

/// Revalide le choix (la fenêtre peut avoir été fermée entre-temps) ; jamais de repli silencieux
/// sur un autre contenu que celui choisi.
pub fn resolve(choice: Choice) -> Result<Target, String> {
    match choice {
        Choice::Primary => Ok(Target::PrimaryMonitor),
        Choice::Monitor { id } => list().into_iter().find(|s| matches!(s, Source::Monitor { id: i, .. } if *i == id)).map(|s| s.target()).ok_or_else(|| "Cet écran n'est plus disponible.".into()),
        Choice::Window { id } => list().into_iter().find(|s| matches!(s, Source::Window { id: i, .. } if *i == id)).map(|s| s.target()).ok_or_else(|| "Cette fenêtre est fermée.".into()),
    }
}

#[cfg(windows)]
pub fn list() -> Vec<Source> {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT, TRUE};
    use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_TOOLWINDOW,
    };

    let mut out: Vec<Source> = Vec::new();

    unsafe extern "system" fn monitor(h: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> i32 {
        let out = unsafe { &mut *(data as *mut Vec<Source>) };
        let mut info: MONITORINFOEXW = unsafe { std::mem::zeroed() };
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if unsafe { GetMonitorInfoW(h, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO) } != 0 {
            let r = info.monitorInfo.rcMonitor;
            let n = out.iter().filter(|s| matches!(s, Source::Monitor { .. })).count() + 1;
            out.push(Source::Monitor {
                id: h as i64,
                name: format!("Écran {n}"),
                width: r.right - r.left,
                height: r.bottom - r.top,
                primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        TRUE
    }

    unsafe extern "system" fn window(h: HWND, data: LPARAM) -> i32 {
        let out = unsafe { &mut *(data as *mut Vec<Source>) };
        unsafe {
            if IsWindowVisible(h) == 0 || IsIconic(h) != 0 || !GetWindow(h, GW_OWNER).is_null() {
                return TRUE;
            }
            if GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW != 0 {
                return TRUE;
            }
            let len = GetWindowTextLengthW(h);
            if len <= 0 {
                return TRUE;
            }
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(h, buf.as_mut_ptr(), buf.len() as i32);
            let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
            let mut r: RECT = std::mem::zeroed();
            GetWindowRect(h, &mut r);
            let (w, hgt) = (r.right - r.left, r.bottom - r.top);
            if w < 120 || hgt < 90 {
                return TRUE;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            // iBox lui-même n'est jamais proposé (on partagerait ses propres fenêtres)
            if pid == std::process::id() {
                return TRUE;
            }
            out.push(Source::Window { id: h as i64, title: title.chars().take(120).collect(), pid, width: w, height: hgt });
        }
        TRUE
    }

    unsafe {
        EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(monitor), &mut out as *mut Vec<Source> as LPARAM);
        EnumWindows(Some(window), &mut out as *mut Vec<Source> as *mut c_void as LPARAM);
    }
    out
}

#[cfg(not(windows))]
pub fn list() -> Vec<Source> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fenetre_principale_du_jeu() {
        let items = vec![
            Source::Monitor { id: 1, name: "Écran 1".into(), width: 1920, height: 1080, primary: true },
            Source::Window { id: 10, title: "Lanceur".into(), pid: 42, width: 400, height: 300 },
            Source::Window { id: 11, title: "Jeu".into(), pid: 42, width: 1920, height: 1080 },
            Source::Window { id: 12, title: "Autre".into(), pid: 7, width: 2560, height: 1440 },
        ];
        assert_eq!(window_of(&items, 42), Some(11));
        assert_eq!(window_of(&items, 99), None);
        assert_eq!(items[2].target(), Target::Window(11));
    }

    #[test]
    #[cfg(windows)]
    fn liste_reelle_sans_erreur() {
        // au moins un écran sur une session Windows ouverte ; les fenêtres dépendent du bureau
        let items = list();
        assert!(items.iter().any(|s| matches!(s, Source::Monitor { .. })));
        assert!(matches!(resolve(Choice::Window { id: -1 }), Err(_)));
    }
}
