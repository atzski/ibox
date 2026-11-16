//! Conversion des coordonnées souris normalisées (protocole) en coordonnées `SendInput`.
//!
//! L'invité envoie une position 0–65535 **sur la zone partagée** (un écran ou le rectangle client
//! d'une fenêtre). L'hôte la ramène à un pixel physique du bureau virtuel, puis à la coordonnée
//! absolue 0–65535 **sur le bureau virtuel entier** attendue par
//! `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` (multi-écrans, origines négatives comprises).
//! Tous les rectangles sont en pixels physiques : le fil qui les lit et celui qui appelle
//! `SendInput` sont « Per-Monitor V2 » (voir `win.rs`).

use serde::{Deserialize, Serialize};

/// Rectangle en pixels physiques, coordonnées du bureau virtuel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub const fn new(left: i32, top: i32, width: i32, height: i32) -> Self {
        Rect { left, top, width, height }
    }
    pub fn is_empty(&self) -> bool {
        self.width <= 0 || self.height <= 0
    }
}

/// Valeur normalisée (0 = premier pixel, 65535 = dernier) → pixel de la zone, arrondi au plus proche.
pub fn area_pixel(n: u16, start: i32, len: i32) -> i32 {
    if len <= 1 {
        return start;
    }
    start + ((n as i64 * (len as i64 - 1) + 32767) / 65535) as i32
}

/// Pixel → coordonnée absolue `VIRTUALDESK`. On vise le centre du pixel : Windows retrouve le
/// pixel par `start + abs * len / 65536` (troncature), ce qui retombe exactement sur `px` tant que
/// le bureau virtuel mesure moins de 32 768 pixels. Un pixel hors du bureau est ramené au bord.
pub fn desk_abs(px: i32, start: i32, len: i32) -> u16 {
    if len <= 0 {
        return 0;
    }
    let offset = (px as i64 - start as i64).clamp(0, len as i64 - 1);
    ((offset * 65536 + 32768) / len as i64).min(65535) as u16
}

/// Pixel qu'obtient Windows pour une coordonnée absolue (utilisé par les tests et le diagnostic).
pub fn desk_pixel(abs: u16, start: i32, len: i32) -> i32 {
    start + ((abs as i64 * len.max(0) as i64) / 65536) as i32
}

/// Position normalisée sur `area` → coordonnées absolues sur le bureau virtuel `desk`.
pub fn to_desktop(x: u16, y: u16, area: Rect, desk: Rect) -> (u16, u16) {
    let px = area_pixel(x, area.left, area.width);
    let py = area_pixel(y, area.top, area.height);
    (desk_abs(px, desk.left, desk.width), desk_abs(py, desk.top, desk.height))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corners_map_to_first_and_last_pixel() {
        let area = Rect::new(0, 0, 1920, 1080);
        assert_eq!(area_pixel(0, area.left, area.width), 0);
        assert_eq!(area_pixel(65535, area.left, area.width), 1919);
        assert_eq!(area_pixel(32768, area.left, area.width), 960);
        assert_eq!(area_pixel(65535, 100, 1), 100);
        assert_eq!(area_pixel(12345, 100, 0), 100);
    }

    #[test]
    fn every_pixel_survives_the_round_trip() {
        // largeurs courantes, impaires, et bureaux multi-écrans à origine négative
        for (start, len) in [(0, 1920), (0, 1366), (-2560, 6400), (-1080, 3000), (0, 7680), (-3840, 11520), (0, 1)] {
            for px in start..start + len {
                let abs = desk_abs(px, start, len);
                assert_eq!(desk_pixel(abs, start, len), px, "start={start} len={len} px={px}");
            }
        }
    }

    #[test]
    fn secondary_monitor_left_of_primary() {
        // écran secondaire 2560×1440 à gauche du principal 1920×1080 : bureau virtuel (-2560, -360) 4480×1440
        let desk = Rect::new(-2560, -360, 4480, 1440);
        let left_screen = Rect::new(-2560, -360, 2560, 1440);
        let primary = Rect::new(0, 0, 1920, 1080);
        let (ax, ay) = to_desktop(0, 0, left_screen, desk);
        assert_eq!((desk_pixel(ax, desk.left, desk.width), desk_pixel(ay, desk.top, desk.height)), (-2560, -360));
        let (ax, ay) = to_desktop(65535, 65535, primary, desk);
        assert_eq!((desk_pixel(ax, desk.left, desk.width), desk_pixel(ay, desk.top, desk.height)), (1919, 1079));
        let (ax, ay) = to_desktop(32768, 32768, primary, desk);
        assert_eq!((desk_pixel(ax, desk.left, desk.width), desk_pixel(ay, desk.top, desk.height)), (960, 540));
    }

    #[test]
    fn window_partly_off_screen_is_clamped_to_the_desktop() {
        let desk = Rect::new(0, 0, 1920, 1080);
        let window = Rect::new(1700, 900, 800, 600);
        let (ax, ay) = to_desktop(65535, 65535, window, desk);
        assert_eq!((ax, ay), (desk_abs(1919, 0, 1920), desk_abs(1079, 0, 1080)));
        let (ax, _) = to_desktop(0, 0, Rect::new(-500, 0, 800, 600), desk);
        assert_eq!(desk_pixel(ax, 0, 1920), 0);
    }
}
