//! Alimentation et mise en veille (Steam Deck surtout, docs/STEAMDECK.md §7 et §12 D5).
//!
//! - Sur batterie, les veilles de fond (pouls iNetbox) s'espacent et l'interface allège la 3D.
//! - Sortie de veille : `Instant` (horloge monotone) ne compte pas le temps passé en veille sous
//!   Linux, contrairement à `SystemTime` ; un écart entre les deux révèle une mise en veille. iBox
//!   reprend alors tout de suite (pouls iNetbox) et prévient l'interface (`system-resumed`).

use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerStatus {
    /// Sur batterie (secteur débranché).
    pub on_battery: bool,
    /// Charge de la batterie en %, si l'appareil en a une.
    pub percent: Option<u8>,
}

/// Lecture de `/sys/class/power_supply` (Linux) : batterie (`type` = Battery, `status`,
/// `capacity`) et secteur (`type` = Mains, `online`).
pub fn read_sysfs(root: &Path) -> PowerStatus {
    let mut out = PowerStatus::default();
    let Ok(entries) = std::fs::read_dir(root) else { return out };
    let mut mains_online: Option<bool> = None;
    let mut discharging = false;
    for e in entries.flatten() {
        let p = e.path();
        let read = |f: &str| std::fs::read_to_string(p.join(f)).map(|s| s.trim().to_string()).unwrap_or_default();
        match read("type").as_str() {
            "Battery" => {
                if let Ok(c) = read("capacity").parse::<u8>() {
                    out.percent = Some(c.min(100));
                }
                discharging |= read("status") == "Discharging";
            }
            "Mains" | "USB" => mains_online = Some(mains_online.unwrap_or(false) || read("online") == "1"),
            _ => {}
        }
    }
    out.on_battery = out.percent.is_some() && match mains_online {
        Some(online) => !online,
        None => discharging,
    };
    out
}

/// Android : la batterie vient du plugin (`DeviceState.kt`), relayée par l'interface
/// (`power_report`). `/sys/class/power_supply` y est fermé par SELinux : le lire toutes les 10 s
/// (pouls iNetbox) remplissait `logcat` de refus (D13, docs/ANDROID-RECETTE.md).
#[cfg(target_os = "android")]
static REPORTED: std::sync::Mutex<PowerStatus> = std::sync::Mutex::new(PowerStatus { on_battery: false, percent: None });

pub fn status() -> PowerStatus {
    #[cfg(target_os = "android")]
    {
        REPORTED.lock().map(|s| *s).unwrap_or_default()
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut s: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
        if unsafe { GetSystemPowerStatus(&mut s) } == 0 {
            return PowerStatus::default();
        }
        let has_battery = s.BatteryFlag != 255 && s.BatteryFlag & 128 == 0;
        PowerStatus { on_battery: has_battery && s.ACLineStatus == 0, percent: (has_battery && s.BatteryLifePercent <= 100).then_some(s.BatteryLifePercent) }
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        read_sysfs(Path::new("/sys/class/power_supply"))
    }
}

#[tauri::command]
pub fn power_status() -> PowerStatus {
    status()
}

/// Android : l'interface transmet l'état de la batterie reçu du plugin (sans effet ailleurs).
#[tauri::command]
pub fn power_report(on_battery: bool, percent: Option<u8>) {
    #[cfg(target_os = "android")]
    if let Ok(mut s) = REPORTED.lock() {
        *s = PowerStatus { on_battery, percent };
    }
    #[cfg(not(target_os = "android"))]
    let _ = (on_battery, percent);
}

/// Intervalle du pouls iNetbox : 10 s sur secteur, 30 s sur batterie, 45 s pendant une partie
/// sur batterie (consoles portables, docs/HANDHELD.md). Le serveur efface une présence restée
/// 90 s sans pouls : 45 s en laisse passer deux par fenêtre, un pouls perdu ne fait pas
/// paraître le joueur hors ligne. Lancement et fin de partie envoient leur pouls tout de suite
/// (interface, `inetbox.ts`) : les amis voient le jeu sans attendre.
pub fn pulse_interval(on_battery: bool, playing: bool) -> Duration {
    Duration::from_secs(match (on_battery, playing) {
        (false, _) => 10,
        (true, false) => 30,
        (true, true) => 45,
    })
}

/// Repère une mise en veille entre deux passages : le temps réel a avancé bien plus que
/// l'horloge monotone (qui s'arrête pendant la veille sous Linux).
pub struct SleepWatch {
    mono: Instant,
    wall: SystemTime,
}

impl Default for SleepWatch {
    fn default() -> Self {
        SleepWatch { mono: Instant::now(), wall: SystemTime::now() }
    }
}

impl SleepWatch {
    /// `true` si une veille d'au moins `threshold` a eu lieu depuis le dernier appel.
    pub fn check(&mut self, threshold: Duration) -> bool {
        self.check_at(Instant::now(), SystemTime::now(), threshold)
    }

    pub fn check_at(&mut self, mono: Instant, wall: SystemTime, threshold: Duration) -> bool {
        let elapsed_mono = mono.saturating_duration_since(self.mono);
        let elapsed_wall = wall.duration_since(self.wall).unwrap_or_default();
        self.mono = mono;
        self.wall = wall;
        elapsed_wall.saturating_sub(elapsed_mono) >= threshold
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn supply(root: &Path, name: &str, files: &[(&str, &str)]) {
        let d = root.join(name);
        std::fs::create_dir_all(&d).unwrap();
        for (f, v) in files {
            std::fs::write(d.join(f), format!("{v}\n")).unwrap();
        }
    }

    #[test]
    fn batterie_du_steam_deck() {
        let t = tempfile::tempdir().unwrap();
        // Steam Deck : BAT1 et ACAD (secteur)
        supply(t.path(), "BAT1", &[("type", "Battery"), ("status", "Discharging"), ("capacity", "63")]);
        supply(t.path(), "ACAD", &[("type", "Mains"), ("online", "0")]);
        assert_eq!(read_sysfs(t.path()), PowerStatus { on_battery: true, percent: Some(63) });
        supply(t.path(), "ACAD", &[("type", "Mains"), ("online", "1")]);
        assert!(!read_sysfs(t.path()).on_battery, "branché");
        // sans batterie (PC de bureau) : jamais « sur batterie »
        let d = tempfile::tempdir().unwrap();
        supply(d.path(), "AC", &[("type", "Mains"), ("online", "1")]);
        assert_eq!(read_sysfs(d.path()), PowerStatus::default());
        assert_eq!(read_sysfs(Path::new("/nonexistent")), PowerStatus::default());
        assert_eq!(pulse_interval(false, true), Duration::from_secs(10));
        assert_eq!(pulse_interval(true, false), Duration::from_secs(30));
        // en partie sur batterie : espacé, mais toujours deux pouls avant l'effacement (90 s)
        assert_eq!(pulse_interval(true, true), Duration::from_secs(45));
        assert!(pulse_interval(true, true) * 2 <= Duration::from_secs(90));
    }

    #[test]
    fn sortie_de_veille_reperee() {
        let t0 = Instant::now();
        let w0 = SystemTime::now();
        let mut w = SleepWatch { mono: t0, wall: w0 };
        // 10 s écoulées des deux côtés : pas de veille
        assert!(!w.check_at(t0 + Duration::from_secs(10), w0 + Duration::from_secs(10), Duration::from_secs(20)));
        // 10 s monotones mais 5 min réelles : le Deck a dormi
        assert!(w.check_at(t0 + Duration::from_secs(20), w0 + Duration::from_secs(310), Duration::from_secs(20)));
        // horloge réelle reculée (réglage de l'heure) : pas de faux réveil
        assert!(!w.check_at(t0 + Duration::from_secs(30), w0, Duration::from_secs(20)));
    }
}
