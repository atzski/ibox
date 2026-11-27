//! État de la console (Kotlin : `DeviceState.kt`) : chaleur, batterie, écran, mémoire, pour les
//! paliers de performance d'iBox (docs/ANDROID.md §9). Les changements arrivent aussi par
//! l'événement `device` du plugin (`addPluginListener("ibox-android", "device", …)`).

use serde::{Deserialize, Serialize};
use tauri::Runtime;

use crate::{IboxAndroid, Result};

/// Instantané de `DeviceState.snapshot()`. Champs absents : valeur par défaut (Android ancien).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DeviceState {
    /// `PowerManager.THERMAL_STATUS_*` : 0 aucun, 1 léger, 2 modéré, 3 sévère, 4 critique…
    pub thermal: u8,
    /// Marge thermique prévue à 10 s (Android 11+) : 1,0 = début du bridage.
    pub headroom: Option<f32>,
    /// Charge en %, -1 inconnue.
    pub battery: i32,
    pub charging: bool,
    /// Économiseur d'énergie d'Android.
    pub saver: bool,
    /// Définition de l'écran en pixels (paysage).
    pub width: u32,
    pub height: u32,
    /// Fréquence d'affichage actuelle et fréquences possibles à cette définition (Hz).
    pub refresh: f32,
    pub refresh_rates: Vec<u32>,
    pub memory_mb: u64,
    pub low_ram: bool,
}

#[derive(Serialize)]
struct FrameRate {
    hz: u32,
}

#[derive(Deserialize)]
struct Refresh {
    refresh: u32,
}

impl<R: Runtime> IboxAndroid<R> {
    pub fn device_state(&self) -> Result<DeviceState> {
        self.call("deviceState", ())
    }

    /// Fréquence d'affichage voulue (0 : choix du système) ; renvoie celle obtenue.
    pub fn set_frame_rate(&self, hz: u32) -> Result<u32> {
        self.call::<Refresh>("setFrameRate", FrameRate { hz }).map(|r| r.refresh)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn etat_au_format_du_kotlin() {
        let s: DeviceState = serde_json::from_str(r#"{"thermal":2,"headroom":0.8,"battery":54,"charging":false,"saver":true,"width":1920,"height":1080,"refresh":120.0,"refreshRates":[60,120],"memoryMb":11634,"lowRam":false,"reason":"thermal"}"#).unwrap();
        assert_eq!((s.thermal, s.battery, s.refresh_rates.clone(), s.memory_mb), (2, 54, vec![60, 120], 11634));
        // Android 9 : ni chaleur ni marge
        let old: DeviceState = serde_json::from_str(r#"{"battery":80,"charging":true}"#).unwrap();
        assert_eq!((old.thermal, old.headroom), (0, None));
    }
}
