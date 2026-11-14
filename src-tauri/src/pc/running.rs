//! Jeu PC en cours, même lancé par une boutique (Epic, Steam…) : un processus
//! dont l'exécutable se trouve dans le dossier d'installation d'un jeu connu.
use rusqlite::Connection;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

static SYS: Mutex<Option<System>> = Mutex::new(None);
static LAST: Mutex<Option<(Instant, Option<(i64, String)>)>> = Mutex::new(None);

fn norm(p: &str) -> String {
    let mut s = p.replace('/', "\\").to_lowercase();
    if !s.ends_with('\\') { s.push('\\'); }
    s
}

/// (identifiant du jeu, titre) du jeu PC en cours, s'il y en a un.
pub fn detect(conn: &Connection) -> Option<(i64, String)> {
    // résultat gardé quelques secondes : plusieurs appels rapprochés ne rescannent pas
    if let Ok(last) = LAST.lock() {
        if let Some((at, v)) = last.as_ref() { if at.elapsed() < Duration::from_secs(8) { return v.clone(); } }
    }
    let dirs: Vec<(i64, String, String)> = conn
        .prepare("SELECT i.game_id, g.title, i.install_dir FROM pc_installs i JOIN games g ON g.id = i.game_id WHERE i.installed AND i.install_dir IS NOT NULL")
        .and_then(|mut st| st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?)))?.collect())
        .unwrap_or_default();
    // dossiers trop courts (racine d'un disque) ignorés
    let dirs: Vec<(i64, String, String)> = dirs.into_iter().map(|(id, t, d)| (id, t, norm(&d))).filter(|(_, _, d)| d.matches('\\').count() >= 2).collect();
    let found = (|| {
        if dirs.is_empty() { return None; }
        let mut guard = SYS.lock().ok()?;
        let sys = guard.get_or_insert_with(System::new);
        sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
        for p in sys.processes().values() {
            let Some(exe) = p.exe().and_then(|e| e.to_str()) else { continue };
            let exe = exe.to_lowercase();
            // le plus long dossier qui contient l'exécutable (jeux imbriqués)
            if let Some((id, title, _)) = dirs.iter().filter(|(_, _, d)| exe.starts_with(d.as_str())).max_by_key(|(_, _, d)| d.len()) {
                return Some((*id, title.clone()));
            }
        }
        None
    })();
    if let Ok(mut last) = LAST.lock() { *last = Some((Instant::now(), found.clone())); }
    found
}

#[cfg(test)]
mod tests {
    #[test]
    fn top_level_game_folders_count() {
        assert!(super::norm("G:/Fortnite").matches('\\').count() >= 2);
        assert!(super::norm("G:/").matches('\\').count() < 2);
    }
    #[test]
    fn normalizes_dirs() {
        assert_eq!(super::norm("C:/Program Files/Epic Games/Fortnite"), "c:\\program files\\epic games\\fortnite\\");
    }
}
