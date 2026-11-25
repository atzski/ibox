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

/// Lanceurs et clients des boutiques : ouverts, ils ne veulent pas dire qu'un jeu tourne
/// (plusieurs jeux Riot pointent vers le client Riot, par exemple). Aussi les logiciels de la
/// bibliothèque Steam qui tournent en permanence (fonds d'écran animés) : ce ne sont pas des parties.
const LAUNCHERS: &[&str] = &[
    "riotclientservices.exe", "riot client.exe", "riotclientux.exe", "riotclientuxrender.exe", "riotclientcrashhandler.exe",
    "leagueclient.exe", "leagueclientux.exe", "leagueclientuxrender.exe", "leaguecrashhandler.exe",
    "steam.exe", "steamwebhelper.exe", "steamservice.exe", "epicgameslauncher.exe", "epicwebhelper.exe",
    "galaxyclient.exe", "galaxyclient helper.exe", "eadesktop.exe", "eabackgroundservice.exe", "ealauncher.exe",
    "ubisoftconnect.exe", "upc.exe", "uplaywebcore.exe", "rsi launcher.exe", "battle.net.exe", "agent.exe",
    "wallpaper32.exe", "wallpaper64.exe", "webwallpaper32.exe", "wallpaperservice32.exe", "wallpaperservice32_c.exe",
];

/// Jeu correspondant à un exécutable en cours, parmi les dossiers d'installation connus.
fn pick(exe: &str, dirs: &[(i64, String, String)]) -> Option<(i64, String)> {
    let exe = exe.to_lowercase();
    let file = exe.rsplit(['\\', '/']).next().unwrap_or(&exe);
    if LAUNCHERS.contains(&file) {
        return None;
    }
    // League of Legends et Teamfight Tactics partagent le même jeu : c'est League of Legends
    if file == "league of legends.exe" {
        if let Some((id, title, _)) = dirs.iter().find(|(_, t, _)| t.eq_ignore_ascii_case("League of Legends")) {
            return Some((*id, title.clone()));
        }
    }
    // le plus long dossier qui contient l'exécutable (jeux imbriqués)
    dirs.iter()
        .filter(|(_, _, d)| exe.starts_with(d.as_str()))
        .max_by_key(|(_, _, d)| d.len())
        .map(|(id, title, _)| (*id, title.clone()))
}

/// Dossiers d'installation connus : (jeu, titre, dossier normalisé).
fn install_dirs(conn: &Connection) -> Vec<(i64, String, String)> {
    let dirs: Vec<(i64, String, String)> = conn
        .prepare("SELECT i.game_id, g.title, i.install_dir FROM pc_installs i JOIN games g ON g.id = i.game_id WHERE i.installed AND i.install_dir IS NOT NULL")
        .and_then(|mut st| st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?)))?.collect())
        .unwrap_or_default();
    // dossiers trop courts (racine d'un disque) ignorés
    dirs.into_iter().map(|(id, t, d)| (id, t, norm(&d))).filter(|(_, _, d)| d.matches('\\').count() >= 2).collect()
}

/// (jeu, titre, processus) du jeu PC en cours, sans cache.
pub fn find_process(conn: &Connection) -> Option<(i64, String, u32)> {
    let dirs = install_dirs(conn);
    if dirs.is_empty() { return None; }
    let mut guard = SYS.lock().ok()?;
    let sys = guard.get_or_insert_with(System::new);
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet));
    sys.processes().iter().find_map(|(pid, p)| pick(p.exe()?.to_str()?, &dirs).map(|(id, t)| (id, t, pid.as_u32())))
}

/// Le processus tourne-t-il encore ?
pub fn alive(pid: u32) -> bool {
    let Ok(mut guard) = SYS.lock() else { return false };
    let sys = guard.get_or_insert_with(System::new);
    let pid = sysinfo::Pid::from_u32(pid);
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
    sys.process(pid).is_some()
}

/// Oublie le résultat gardé (un jeu vient d'être ajouté).
pub fn forget() {
    if let Ok(mut last) = LAST.lock() { *last = None; }
}

/// (identifiant du jeu, titre) du jeu PC en cours, s'il y en a un.
pub fn detect(conn: &Connection) -> Option<(i64, String)> {
    // résultat gardé quelques secondes : plusieurs appels rapprochés ne rescannent pas
    if let Ok(last) = LAST.lock() {
        if let Some((at, v)) = last.as_ref() { if at.elapsed() < Duration::from_secs(8) { return v.clone(); } }
    }
    let found = find_process(conn).map(|(id, t, _)| (id, t));
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
    fn client_riot_ouvert_ne_lance_aucun_jeu() {
        let client = super::norm(r"C:\Riot Games\Riot Client");
        let dirs = vec![(1, "Teamfight Tactics".to_string(), client.clone()), (2, "League of Legends".to_string(), client)];
        assert_eq!(super::pick(r"C:\Riot Games\Riot Client\RiotClientServices.exe", &dirs), None);
        assert_eq!(super::pick(r"C:\Riot Games\League of Legends\LeagueClientUx.exe", &dirs), None);
        assert_eq!(super::pick(r"C:\Riot Games\League of Legends\Game\League of Legends.exe", &dirs), Some((2, "League of Legends".into())));
        let fortnite = vec![(3, "Fortnite".to_string(), super::norm("G:/Fortnite"))];
        assert_eq!(super::pick(r"G:\Fortnite\FortniteGame\Binaries\Win64\FortniteClient-Win64-Shipping.exe", &fortnite), Some((3, "Fortnite".into())));
        assert_eq!(super::pick(r"C:\Program Files (x86)\Epic Games\Launcher\EpicGamesLauncher.exe", &fortnite), None);
        // Wallpaper Engine tourne en permanence : ce n'est pas une partie
        let wallpaper = vec![(4, "Wallpaper Engine".to_string(), super::norm(r"C:\Steam\steamapps\common\wallpaper_engine"))];
        assert_eq!(super::pick(r"C:\Steam\steamapps\common\wallpaper_engine\wallpaper64.exe", &wallpaper), None);
        assert_eq!(super::pick(r"C:\Steam\steamapps\common\wallpaper_engine\bin\webwallpaper32.exe", &wallpaper), None);
    }

    #[test]
    fn normalizes_dirs() {
        assert_eq!(super::norm("C:/Program Files/Epic Games/Fortnite"), "c:\\program files\\epic games\\fortnite\\");
    }
}
