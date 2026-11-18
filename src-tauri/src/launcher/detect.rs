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
    if let Some(home) = crate::paths::home() {
        for sub in ["Desktop", "Downloads", "Documents", "Emulation", "Emulators", "Applications"] {
            roots.push((home.join(sub), 3));
        }
        // Linux : lanceurs des Flatpak installés pour l'utilisateur (Discover, EmuDeck)
        roots.push((home.join(".local/share/flatpak/exports/bin"), 1));
    }
    // Linux : lanceurs des Flatpak installés pour tout le système (Steam Deck : Discover)
    if !cfg!(windows) {
        roots.push((PathBuf::from("/var/lib/flatpak/exports/bin"), 1));
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
            // lanceurs Flatpak : liens symboliques vers le programme exporté
            if !entry.file_type().is_file() && !(entry.path_is_symlink() && entry.path().is_file()) {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(key_name) = program_name(entry.path(), &name) else {
                continue;
            };
            let profile: &'static Profile = profiles::detect_profile(key_name);
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

/// Nom qui sert à reconnaître l'émulateur, ou `None` si le fichier n'est pas un programme :
/// - Windows : `*.exe` ;
/// - Linux : `*.AppImage` (« PCSX2-v2.2.AppImage »), ou lanceur Flatpak de `exports/bin`,
///   reconnu par le dernier segment de son identifiant (« org.DolphinEmu.dolphin-emu » → « dolphin-emu »).
fn program_name<'a>(path: &Path, name: &'a str) -> Option<&'a str> {
    let lower = name.to_lowercase();
    if lower.ends_with(".exe") {
        return Some(name);
    }
    if cfg!(windows) {
        return None;
    }
    if lower.ends_with(".appimage") {
        return Some(name);
    }
    let flatpak = path.parent().is_some_and(|d| d.ends_with("exports/bin"));
    (flatpak && name.matches('.').count() >= 2).then(|| name.rsplit('.').next().unwrap_or(name))
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

    #[test]
    fn noms_de_programme_selon_le_systeme() {
        let bin = Path::new("/var/lib/flatpak/exports/bin");
        assert_eq!(program_name(&bin.join("x.exe"), "Dolphin.exe"), Some("Dolphin.exe"));
        if cfg!(windows) {
            assert_eq!(program_name(&bin.join("PCSX2.AppImage"), "PCSX2.AppImage"), None);
        } else {
            assert_eq!(program_name(Path::new("/home/deck/Applications/PCSX2-v2.2.AppImage"), "PCSX2-v2.2.AppImage"), Some("PCSX2-v2.2.AppImage"));
            assert_eq!(program_name(&bin.join("org.DolphinEmu.dolphin-emu"), "org.DolphinEmu.dolphin-emu"), Some("dolphin-emu"));
            assert_eq!(program_name(&bin.join("net.pcsx2.PCSX2"), "net.pcsx2.PCSX2"), Some("PCSX2"));
            // hors exports/bin, un fichier sans extension n'est pas un émulateur
            assert_eq!(program_name(Path::new("/home/deck/Games/net.pcsx2.PCSX2"), "net.pcsx2.PCSX2"), None);
            assert_eq!(program_name(&bin.join("steam"), "steam"), None);
        }
    }

    #[test]
    #[cfg(unix)]
    fn trouve_appimage_et_flatpak_sous_linux() {
        let tmp = tempfile::tempdir().unwrap();
        let r = tmp.path();
        let apps = r.join("Applications");
        let bin = r.join("flatpak/exports/bin");
        let target = r.join("flatpak/app/net.pcsx2.PCSX2/bin/pcsx2");
        for d in [&apps, &bin, &target.parent().unwrap().to_path_buf()] {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(apps.join("DuckStation-x64.AppImage"), b"\x7fELF").unwrap();
        fs::write(&target, b"#!/bin/sh").unwrap();
        std::os::unix::fs::symlink(&target, bin.join("net.pcsx2.PCSX2")).unwrap();
        let found = scan(&[(apps, 3), (bin, 1)], &[]);
        let ids: Vec<&str> = found.iter().map(|s| s.profile_id).collect();
        assert!(ids.contains(&"duckstation") && ids.contains(&"pcsx2"), "{found:?}");
    }
}
