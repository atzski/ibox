//! Plugins installés et activés : `<données>/plugins/plugins.json`, écrit de façon atomique.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub version: String,
    pub enabled: bool,
    /// Permissions acceptées à l'installation (celles du manifeste, affichées avant).
    #[serde(default)]
    pub granted: Vec<String>,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub installed_at: u64,
}

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default)]
    pub plugins: BTreeMap<String, Installed>,
}

const FILE: &str = "plugins.json";

impl Registry {
    pub fn load(root: &Path) -> Self {
        fs::read(root.join(FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, root: &Path) -> Result<(), String> {
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let tmp = root.join(format!("{FILE}.tmp"));
        fs::write(&tmp, serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(&tmp, root.join(FILE)).map_err(|e| e.to_string())
    }

    pub fn enabled(&self) -> impl Iterator<Item = (&String, &Installed)> {
        self.plugins.iter().filter(|(_, p)| p.enabled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_and_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Registry::load(dir.path()), Registry::default());
        let mut r = Registry::default();
        r.plugins.insert("demo".into(), Installed { version: "1.0.0".into(), enabled: true, granted: vec!["overlay".into()], publisher: "atzski".into(), installed_at: 1 });
        r.save(dir.path()).unwrap();
        assert_eq!(Registry::load(dir.path()), r);
        assert_eq!(r.enabled().count(), 1);
    }
}
