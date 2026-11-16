//! Épinglage des clés des pairs au premier contact (TOFU).
//!
//! La clé d'un appareil d'ami (compte + identifiant d'appareil) est retenue la première fois.
//! Ensuite, une clé différente pour le même appareil bloque la session : seul un serveur
//! compromis (ou une réinstallation) peut produire ce cas, et l'utilisateur doit comparer le
//! code de sécurité avant d'accepter explicitement la nouvelle clé (`Pins::replace`). Un nouvel
//! appareil d'un ami déjà connu est signalé comme tel.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::identity;
use super::{Result, SignalError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    pub public_key: String,
    pub first_seen: u64,
    /// L'utilisateur a comparé le code de sécurité de vive voix.
    #[serde(default)]
    pub verified: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trust {
    /// Clé déjà épinglée pour cet appareil.
    Known { verified: bool },
    /// Premier contact avec ce compte : clé épinglée.
    FirstContact,
    /// Compte connu, nouvel appareil : clé épinglée, à signaler à l'utilisateur.
    NewDevice,
}

#[derive(Default, Serialize, Deserialize)]
struct File {
    /// compte → appareil → clé
    peers: BTreeMap<String, BTreeMap<String, Pin>>,
}

pub struct Pins {
    path: Option<PathBuf>,
    data: File,
}

impl Pins {
    /// Fichier `remote-play-peers.json` des données de l'application (créé au besoin).
    pub fn open(path: &Path) -> Result<Self> {
        let data = match std::fs::read_to_string(path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| SignalError::Store(e.to_string()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => File::default(),
            Err(e) => return Err(SignalError::Store(e.to_string())),
        };
        Ok(Pins { path: Some(path.to_path_buf()), data })
    }

    pub fn in_memory() -> Self {
        Pins { path: None, data: File::default() }
    }

    fn save(&self) -> Result<()> {
        let Some(path) = &self.path else { return Ok(()) };
        let text = serde_json::to_string_pretty(&self.data).map_err(|e| SignalError::Store(e.to_string()))?;
        // écriture atomique : un fichier à moitié écrit ne doit pas « oublier » les épinglages
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| SignalError::Store(e.to_string()))?;
        std::fs::rename(&tmp, path).map_err(|e| SignalError::Store(e.to_string()))
    }

    /// Vérifie (et épingle au premier contact) la clé annoncée pour un appareil d'un ami.
    pub fn check(&mut self, account: &str, device: &str, public_key: &str, now_ms: u64) -> Result<Trust> {
        identity::parse_public(public_key)?;
        let devices = self.data.peers.entry(account.to_string()).or_default();
        if let Some(pin) = devices.get(device) {
            return if pin.public_key == public_key { Ok(Trust::Known { verified: pin.verified }) } else { Err(SignalError::KeyChanged) };
        }
        // une même clé ne peut pas « déménager » d'un appareil à un autre
        if devices.values().any(|p| p.public_key == public_key) {
            return Err(SignalError::KeyChanged);
        }
        let trust = if devices.is_empty() { Trust::FirstContact } else { Trust::NewDevice };
        devices.insert(device.to_string(), Pin { public_key: public_key.to_string(), first_seen: now_ms, verified: false });
        self.save()?;
        Ok(trust)
    }

    /// Code de sécurité comparé : l'appareil est marqué vérifié.
    pub fn mark_verified(&mut self, account: &str, device: &str) -> Result<()> {
        let pin = self.data.peers.get_mut(account).and_then(|d| d.get_mut(device)).ok_or(SignalError::BadKey)?;
        pin.verified = true;
        self.save()
    }

    /// Acceptation explicite d'une nouvelle clé (après comparaison du code de sécurité).
    pub fn replace(&mut self, account: &str, device: &str, public_key: &str, now_ms: u64) -> Result<()> {
        identity::parse_public(public_key)?;
        self.data.peers.entry(account.to_string()).or_default()
            .insert(device.to_string(), Pin { public_key: public_key.to_string(), first_seen: now_ms, verified: true });
        self.save()
    }

    pub fn forget(&mut self, account: &str) -> Result<()> {
        self.data.peers.remove(account);
        self.save()
    }

    pub fn get(&self, account: &str, device: &str) -> Option<&Pin> {
        self.data.peers.get(account)?.get(device)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_play::signaling::identity::DeviceKey;

    fn key(n: u8) -> String {
        DeviceKey::from_seed(&[n; 32]).public_b64()
    }

    #[test]
    fn premier_contact_puis_changement_refuse() {
        let mut pins = Pins::in_memory();
        assert_eq!(pins.check("bob", "pc", &key(1), 1), Ok(Trust::FirstContact));
        assert_eq!(pins.check("bob", "pc", &key(1), 2), Ok(Trust::Known { verified: false }));
        // serveur compromis qui substitue la clé : refus, et la clé épinglée ne bouge pas
        assert_eq!(pins.check("bob", "pc", &key(2), 3), Err(SignalError::KeyChanged));
        assert_eq!(pins.get("bob", "pc").unwrap().public_key, key(1));
        // nouvel appareil d'un ami connu : signalé
        assert_eq!(pins.check("bob", "portable", &key(3), 4), Ok(Trust::NewDevice));
        // la clé d'un appareil ne peut pas être réannoncée sous un autre identifiant
        assert_eq!(pins.check("bob", "autre", &key(1), 5), Err(SignalError::KeyChanged));
        // clé invalide
        assert_eq!(pins.check("carol", "pc", "xyz", 6), Err(SignalError::BadKey));
        assert!(pins.get("carol", "pc").is_none());
    }

    #[test]
    fn verification_et_remplacement_explicite() {
        let mut pins = Pins::in_memory();
        pins.check("bob", "pc", &key(1), 1).unwrap();
        pins.mark_verified("bob", "pc").unwrap();
        assert_eq!(pins.check("bob", "pc", &key(1), 2), Ok(Trust::Known { verified: true }));
        pins.replace("bob", "pc", &key(2), 3).unwrap();
        assert_eq!(pins.check("bob", "pc", &key(2), 4), Ok(Trust::Known { verified: true }));
        assert_eq!(pins.check("bob", "pc", &key(1), 5), Err(SignalError::KeyChanged));
        pins.forget("bob").unwrap();
        assert_eq!(pins.check("bob", "pc", &key(1), 6), Ok(Trust::FirstContact));
    }

    #[test]
    fn epinglage_persistant() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("remote-play-peers.json");
        {
            let mut pins = Pins::open(&path).unwrap();
            pins.check("bob", "pc", &key(1), 1).unwrap();
        }
        let mut pins = Pins::open(&path).unwrap();
        assert_eq!(pins.check("bob", "pc", &key(2), 2), Err(SignalError::KeyChanged));
        std::fs::write(&path, "{abîmé").unwrap();
        assert!(matches!(Pins::open(&path), Err(SignalError::Store(_))));
    }
}
