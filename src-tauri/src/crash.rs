//! Journal des plantages : toute panique Rust (fil principal ou fil de fond) est
//! écrite dans `logs/crash.log` avant que le fil ne s'arrête. Sans lui, une
//! application fenêtrée disparaît sans laisser de trace (`eprintln!` ne va nulle part).
//!
//! Le journal reste sur ce PC ; le rapport de problème (Paramètres › Système)
//! en reprend la fin. Le dossier de l'utilisateur Windows est masqué.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static LOG: OnceLock<PathBuf> = OnceLock::new();

/// Au-delà, le journal repart de zéro (il ne sert qu'aux derniers incidents).
const MAX_LEN: u64 = 128 * 1024;
/// Part du journal reprise dans le rapport de problème.
const TAIL: usize = 8 * 1024;

/// Installe le relevé des paniques. Le comportement par défaut (message sur la
/// console en développement) est conservé.
pub fn install(log_dir: &Path) {
    let _ = std::fs::create_dir_all(log_dir);
    let _ = LOG.set(log_dir.join("crash.log"));
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "(panique sans message)".into());
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        record(&format!("panique fil « {} » {place} : {message}", thread.name().unwrap_or("?")));
        previous(info);
    }));
}

/// Ajoute une ligne au journal (horodatée, version, chemins masqués).
pub fn record(line: &str) {
    let Some(path) = LOG.get() else { return };
    if std::fs::metadata(path).map(|m| m.len() > MAX_LEN).unwrap_or(false) {
        let _ = std::fs::remove_file(path);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "{} v{} {}", crate::library::time::now_iso(), env!("CARGO_PKG_VERSION"), mask(line));
    }
}

fn mask(text: &str) -> String {
    match crate::paths::home() {
        Some(home) => text.replace(&*home.to_string_lossy(), if cfg!(windows) { "%USERPROFILE%" } else { "~" }),
        None => text.to_string(),
    }
}

/// Fin du journal des plantages, pour le rapport de problème (vide s'il n'y en a aucun).
#[tauri::command]
pub fn crash_log_tail() -> String {
    let Some(text) = LOG.get().and_then(|p| std::fs::read_to_string(p).ok()) else { return String::new() };
    let start = text.len().saturating_sub(TAIL);
    // coupe sur une limite de caractère puis sur un début de ligne
    let start = (start..text.len()).find(|&i| text.is_char_boundary(i)).unwrap_or(text.len());
    let tail = &text[start..];
    let tail = if start > 0 { tail.split_once('\n').map(|(_, rest)| rest).unwrap_or(tail) } else { tail };
    tail.to_string()
}

/// Erreurs de l'interface (exceptions non rattrapées, écrans tombés) : même journal.
#[tauri::command]
pub fn crash_log_ui(message: String) {
    let message: String = message.chars().take(2000).collect();
    record(&format!("interface : {}", message.replace(['\r', '\n'], " ⏎ ")));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masque_le_dossier_utilisateur() {
        if let Some(home) = crate::paths::home() {
            let home = home.to_string_lossy().to_string();
            assert!(!mask(&format!("{home}/jeux/x.iso")).contains(&home));
        }
    }
}
