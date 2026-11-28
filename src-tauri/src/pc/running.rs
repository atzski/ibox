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

/// Identifiant Steam d'un lancement `steam -applaunch <id>`.
pub fn applaunch_id(args: &[String]) -> Option<u32> {
    let at = args.iter().position(|a| a == "-applaunch")?;
    args.get(at + 1)?.parse().ok().filter(|id| *id != 0)
}

/// Jeu Steam tenu par un processus `reaper` (Linux) : Steam lance chaque jeu sous
/// `reaper SteamLaunch AppId=<id> -- …`, qui vit jusqu'à la fin du dernier processus du jeu.
/// Même lecture que gamescope (`GetAppIdFromReaper`, src/Utils/Process.cpp) : c'est aussi ce
/// processus qui fait dire à Steam que le jeu est « en cours ».
pub fn reaper_app_id(name: &str, cmd: &[&str]) -> Option<u32> {
    if name != "reaper" { return None; }
    let mut steam_launch = false;
    for arg in cmd.iter().skip(1) {
        match *arg {
            "--" => break,
            "SteamLaunch" => steam_launch = true,
            a if steam_launch => {
                if let Some(id) = a.strip_prefix("AppId=").and_then(|v| v.parse::<u32>().ok()).filter(|id| *id != 0) {
                    return Some(id);
                }
            }
            _ => {}
        }
    }
    None
}

/// Processus `reaper` de ce jeu Steam, s'il tourne (Linux ; ailleurs, jamais).
pub fn steam_reaper(app_id: u32) -> Option<u32> {
    let mut guard = SYS.lock().ok()?;
    let sys = guard.get_or_insert_with(System::new);
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cmd(UpdateKind::OnlyIfNotSet));
    sys.processes().iter().find_map(|(pid, p)| {
        let cmd: Vec<&str> = p.cmd().iter().filter_map(|a| a.to_str()).collect();
        (reaper_app_id(p.name().to_str()?, &cmd) == Some(app_id)).then(|| pid.as_u32())
    })
}

/// Oublie le résultat gardé (un jeu vient d'être ajouté, une partie vient de finir).
pub fn forget() {
    if let Ok(mut last) = LAST.lock() { *last = None; }
}

/// Durée de vie du résultat gardé : assez pour que deux appels rapprochés (carte « En jeu »,
/// présence iNetbox) ne rescannent pas, assez peu pour ne pas annoncer longtemps un jeu fermé.
const DETECT_TTL: Duration = Duration::from_secs(3);

/// (identifiant du jeu, titre) du jeu PC en cours, s'il y en a un.
pub fn detect(conn: &Connection) -> Option<(i64, String)> {
    // résultat gardé quelques secondes : plusieurs appels rapprochés ne rescannent pas
    if let Ok(last) = LAST.lock() {
        if let Some((at, v)) = last.as_ref() { if at.elapsed() < DETECT_TTL { return v.clone(); } }
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
    fn jeu_steam_lu_sur_son_reaper() {
        let reaper = "/home/deck/.local/share/Steam/ubuntu12_32/reaper";
        let cmd = [reaper, "SteamLaunch", "AppId=1145360", "--", "/home/deck/.local/share/Steam/ubuntu12_32/steam-launch-wrapper", "--", "proton", "waitforexitandrun", "Hades.exe"];
        assert_eq!(super::reaper_app_id("reaper", &cmd), Some(1145360));
        // un autre programme avec les mêmes arguments, ou un reaper sans jeu : rien
        assert_eq!(super::reaper_app_id("bash", &cmd), None);
        assert_eq!(super::reaper_app_id("reaper", &[reaper, "SteamLaunch", "AppId=0", "--", "jeu"]), None);
        assert_eq!(super::reaper_app_id("reaper", &[reaper, "AppId=570", "--", "jeu"]), None, "AppId sans SteamLaunch avant lui");
        // les arguments du jeu, après « -- », ne comptent pas
        assert_eq!(super::reaper_app_id("reaper", &[reaper, "SteamLaunch", "--", "jeu", "AppId=570"]), None);
        // raccourci non-Steam (iBox lui-même) : identifiant sur 32 bits
        assert_eq!(super::reaper_app_id("reaper", &[reaper, "SteamLaunch", "AppId=3221225472", "--", "iBox.AppImage"]), Some(3221225472));
    }

    #[test]
    fn identifiant_du_lancement_steam() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(super::applaunch_id(&args(&["-applaunch", "1966720"])), Some(1966720));
        assert_eq!(super::applaunch_id(&args(&["run", "com.valvesoftware.Steam", "-applaunch", "570"])), Some(570));
        assert_eq!(super::applaunch_id(&args(&["steam://install/570"])), None);
        assert_eq!(super::applaunch_id(&args(&["-applaunch"])), None);
        assert_eq!(super::applaunch_id(&args(&["-applaunch", "abc"])), None);
    }

    #[test]
    fn normalizes_dirs() {
        assert_eq!(super::norm("C:/Program Files/Epic Games/Fortnite"), "c:\\program files\\epic games\\fortnite\\");
    }
}
