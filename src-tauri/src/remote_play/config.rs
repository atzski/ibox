//! Réglages Remote Play, gardés côté natif (`remote-play.json`) et toujours bornés.
//! Remote Play est **désactivé par défaut** ; tant qu'il l'est, aucun service de capture ou de
//! contrôle distant ne démarre.

use serde::{Deserialize, Serialize};

use super::input::hotkey::{Hotkey, DEFAULT_HOTKEY};
use super::permissions::Profile;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    Latency,
    Performance,
    Balanced,
    Quality,
    Maximum,
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Codec {
    Auto,
    H264,
    Hevc,
    Av1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AudioSource {
    System,
    GameOnly,
    None,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub enabled: bool,
    pub computer_name: String,
    /// Hauteur cible en pixels ; 0 = native, `None` = automatique selon la connexion.
    pub height: Option<u32>,
    pub fps: u32,
    /// Débit en kbit/s ; `None` = automatique.
    pub bitrate_kbps: Option<u32>,
    pub quality: Quality,
    pub codec: Codec,
    pub audio: AudioSource,
    pub keep_host_audio: bool,
    /// « Masquer l'écho Discord » : retire le son de Discord de ce qui est envoyé à l'invité.
    pub hide_discord_echo: bool,
    pub max_guests: u32,
    /// Limite de débit montant total de l'hôte, en kbit/s.
    pub upload_limit_kbps: Option<u32>,
    pub default_profile: Profile,
    pub confirm_connections: bool,
    pub invite_ttl_secs: u32,
    pub idle_timeout_mins: u32,
    pub lan_discovery: bool,
    pub stun_servers: Vec<String>,
    pub show_stats: bool,
    pub blocked_accounts: Vec<String>,
    /// Raccourci global d'arrêt d'urgence (« Ctrl+Alt+Shift+F12 »).
    pub stop_hotkey: String,
    /// « Accepter les demandes Remote Play de mes amis » (`accounts.rp_accept_requests` sur
    /// iNetbox) : désactivé par défaut.
    pub accept_requests: bool,
    /// Avertissement « vos participants voient votre adresse IP » lu avant la première session P2P.
    pub ip_warning_seen: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            enabled: false,
            computer_name: String::new(),
            height: None,
            fps: 60,
            bitrate_kbps: None,
            quality: Quality::Auto,
            codec: Codec::Auto,
            audio: AudioSource::System,
            keep_host_audio: true,
            hide_discord_echo: true,
            max_guests: 5,
            upload_limit_kbps: None,
            default_profile: Profile::Spectator,
            confirm_connections: true,
            invite_ttl_secs: 120,
            idle_timeout_mins: 30,
            lan_discovery: false,
            stun_servers: vec!["stun:stun.cloudflare.com:3478".into(), "stun:stun.l.google.com:19302".into()],
            show_stats: false,
            blocked_accounts: Vec::new(),
            stop_hotkey: DEFAULT_HOTKEY.into(),
            accept_requests: false,
            ip_warning_seen: false,
        }
    }
}

pub const FPS_RANGE: (u32, u32) = (15, 240);
pub const BITRATE_RANGE_KBPS: (u32, u32) = (500, 150_000);
pub const HEIGHT_RANGE: (u32, u32) = (360, 4320);
pub const MAX_GUESTS: u32 = 8;

impl Config {
    /// Ramène chaque valeur dans un domaine raisonnable ; ne fait jamais échouer le chargement.
    pub fn sanitized(mut self) -> Self {
        let clamp = |v: u32, (lo, hi): (u32, u32)| v.clamp(lo, hi);
        self.fps = clamp(self.fps, FPS_RANGE);
        self.bitrate_kbps = self.bitrate_kbps.map(|b| clamp(b, BITRATE_RANGE_KBPS));
        self.upload_limit_kbps = self.upload_limit_kbps.map(|b| clamp(b, BITRATE_RANGE_KBPS));
        self.height = self.height.map(|h| if h == 0 { 0 } else { clamp(h, HEIGHT_RANGE) });
        self.max_guests = self.max_guests.clamp(1, MAX_GUESTS);
        self.invite_ttl_secs = self.invite_ttl_secs.clamp(30, 900);
        self.idle_timeout_mins = self.idle_timeout_mins.clamp(1, 24 * 60);
        self.computer_name = self.computer_name.chars().filter(|c| !c.is_control()).take(40).collect::<String>().trim().to_owned();
        // le profil par défaut ne peut jamais être Contrôle complet : il exige une confirmation à chaque fois
        if self.default_profile == Profile::FullControl {
            self.default_profile = Profile::Spectator;
        }
        self.stun_servers.retain(|s| (s.starts_with("stun:") || s.starts_with("stuns:")) && s.len() <= 200);
        self.stun_servers.truncate(4);
        self.blocked_accounts.truncate(1000);
        // un raccourci illisible ne doit jamais laisser l'hôte sans arrêt d'urgence
        self.stop_hotkey = self.stop_hotkey.parse::<Hotkey>().unwrap_or_default().to_string();
        self
    }

    pub fn load(path: &std::path::Path) -> Self {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Config>(&bytes).ok())
            .unwrap_or_default()
            .sanitized()
    }

    pub fn save(&self, path: &std::path::Path) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_by_default_and_spectator() {
        let c = Config::default();
        assert!(!c.enabled);
        assert_eq!(c.default_profile, Profile::Spectator);
        assert!(c.confirm_connections);
    }

    #[test]
    fn values_are_clamped() {
        let c = Config {
            fps: 10_000,
            bitrate_kbps: Some(1),
            height: Some(100_000),
            max_guests: 0,
            default_profile: Profile::FullControl,
            computer_name: "  PC\u{7}  de salon  ".into(),
            stun_servers: vec!["http://evil".into(), "stun:ok:3478".into()],
            ..Config::default()
        }
        .sanitized();
        assert_eq!(c.fps, FPS_RANGE.1);
        assert_eq!(c.bitrate_kbps, Some(BITRATE_RANGE_KBPS.0));
        assert_eq!(c.height, Some(HEIGHT_RANGE.1));
        assert_eq!(c.max_guests, 1);
        assert_eq!(c.default_profile, Profile::Spectator);
        assert_eq!(c.computer_name, "PC  de salon");
        assert_eq!(c.stun_servers, vec!["stun:ok:3478".to_string()]);
        assert_eq!(Config { height: Some(0), ..Config::default() }.sanitized().height, Some(0));
        assert_eq!(Config { stop_hotkey: "F12".into(), ..Config::default() }.sanitized().stop_hotkey, DEFAULT_HOTKEY);
        assert_eq!(Config { stop_hotkey: "maj+ctrl+pause".into(), ..Config::default() }.sanitized().stop_hotkey, "Ctrl+Shift+Pause");
    }

    #[test]
    fn corrupt_or_partial_files_fall_back_safely() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-play.json");
        std::fs::write(&path, b"{ pas du json").unwrap();
        assert_eq!(Config::load(&path), Config::default());
        std::fs::write(&path, br#"{"enabled":true,"fps":144}"#).unwrap();
        let c = Config::load(&path);
        assert!(c.enabled);
        assert_eq!(c.fps, 144);
        assert_eq!(c.max_guests, 5);
        c.save(&path).unwrap();
        assert_eq!(Config::load(&path), c);
    }
}
