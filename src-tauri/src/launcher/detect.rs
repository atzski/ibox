//! Recherche des émulateurs déjà installés (aucun téléchargement) : dossiers
//! d'installation habituels et voisins des dossiers de jeux, profondeur limitée.

use super::profiles::{self, Profile};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub exe_path: String,
    pub profile_id: &'static str,
    pub name: &'static str,
    pub platforms: &'static [&'static str],
}

const SKIP: [&str; 9] = ["windows", "$recycle.bin", "system volume information", "node_modules", "steamapps", "cache", "logs", "shaders", "temp"];
const BUDGET: Duration = Duration::from_secs(6);

/// Dossiers parcourus : programmes, profil utilisateur, et parents des dossiers de jeux.
pub fn default_roots(game_folders: &[String]) -> Vec<(PathBuf, usize)> {
    let mut roots: Vec<(PathBuf, usize)> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Ok(p) = std::env::var(var) {
            roots.push((PathBuf::from(p), 3));
        }
    }
    if let Ok(p) = std::env::var("LOCALAPPDATA") {
        roots.push((PathBuf::from(&p).join("Programs"), 3));
    }
    if let Ok(p) = std::env::var("APPDATA") {
        roots.push((PathBuf::from(p), 2));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        for sub in ["Desktop", "Downloads", "Documents", "Emulation", "Emulators"] {
            roots.push((PathBuf::from(&home).join(sub), 3));
        }
    }
    for f in game_folders {
        let p = Path::new(f);
        roots.push((p.to_path_buf(), 3));
        if let Some(parent) = p.parent() {
            roots.push((parent.to_path_buf(), 3));
        }
    }
    roots.retain(|(p, _)| p.is_dir());
    roots.sort();
    roots.dedup_by(|a, b| a.0 == b.0);
    roots
}

pub fn scan(roots: &[(PathBuf, usize)], known: &[String]) -> Vec<Suggestion> {
    let started = Instant::now();
    let mut found: BTreeMap<String, Suggestion> = BTreeMap::new();
    // comparaison insensible à la casse et au séparateur (« / » ou « \ »)
    let norm = |p: &str| p.replace('/', "\\").to_lowercase();
    let known: Vec<String> = known.iter().map(|k| norm(k)).collect();
    for (root, depth) in roots {
        let walker = WalkDir::new(root).max_depth(*depth).follow_links(false).into_iter().filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            e.depth() == 0 || !(name.starts_with('.') || (e.file_type().is_dir() && SKIP.contains(&name.as_str())))
        });
        for entry in walker.flatten() {
            if started.elapsed() > BUDGET {
                return found.into_values().collect();
            }
            if !entry.file_type().is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().ends_with(".exe") {
                continue;
            }
            let profile: &'static Profile = profiles::detect_profile(&name);
            if profile.id == "custom" || is_helper(&name) {
                continue;
            }
            let path = entry.path().to_string_lossy().to_string();
            let key = norm(&path);
            if known.contains(&key) {
                continue;
            }
            found.entry(key).or_insert(Suggestion { exe_path: path, profile_id: profile.id, name: profile.name, platforms: profile.platforms });
        }
    }
    found.into_values().collect()
}

/// Exécutables annexes qui ne sont pas l'émulateur lui-même.
fn is_helper(name: &str) -> bool {
    let n = name.to_lowercase();
    ["updater", "uninstall", "unins", "crash", "tool", "setup", "cli.exe", "nogui", "debug", "room"].iter().any(|w| n.contains(w))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn trouve_les_emulateurs_et_ignore_le_reste() {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path();
        for f in ["Dolphin-x64/Dolphin.exe", "Dolphin-x64/Updater.exe", "PCSX2/pcsx2-qt.exe", "Divers/notepad.exe", "PPSSPP/PPSSPPWindows64.exe"] {
            let p = r.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, b"MZ").unwrap();
        }
        let known = vec![r.join("PCSX2/pcsx2-qt.exe").to_string_lossy().to_string()];
        let found = scan(&[(r.to_path_buf(), 3)], &known);
        let ids: Vec<&str> = found.iter().map(|s| s.profile_id).collect();
        assert_eq!(ids.len(), 2, "{found:?}");
        assert!(ids.contains(&"dolphin") && ids.contains(&"ppsspp"));
    }
}
