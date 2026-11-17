//! Connecteur Steam : lecture des fichiers locaux de Steam, en lecture seule.
//!
//! - `steamapps/libraryfolders.vdf` : les bibliothèques (un dossier par disque) ;
//! - `steamapps/appmanifest_<id>.acf` : un manifeste par application installée
//!   (identifiant, nom, dossier, état, dernière partie) ;
//! - `userdata/<compte>/config/localconfig.vdf` : temps de jeu enregistré par Steam.
//!
//! Lancement : `steam.exe -applaunch <id>` (option documentée de Steam) ; Steam
//! gère l'authentification et les protections, iBox ne les contourne pas.
//! Les jeux possédés mais non installés ne sont pas connus localement : ils sont
//! lus, si l'utilisateur fournit sa clé, par l'API Web officielle de Steam.
//! Installation : `steam.exe steam://install/<id>` ouvre la fenêtre d'installation de Steam.

use super::vdf::{self, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Outils de Steam qui ne sont pas des jeux (composants, environnements, VR).
const NOT_GAMES: [&str; 11] = [
    "228980",  // Steamworks Common Redistributables
    "250820",  // SteamVR
    "1070560", // Steam Linux Runtime 1.0
    "1391110", // Steam Linux Runtime 2.0
    "1628350", // Steam Linux Runtime 3.0
    "1493710", // Proton Experimental
    "1580130", // Proton 6.3
    "1887720", // Proton 7.0
    "2348590", // Proton 8.0
    "2805730", // Proton 9.0
    "3658110", // Proton 10.0
];

/// Nom de la clé API Web Steam dans le coffre Windows.
pub const KEY: &str = "steam-webapi";

/// Écart entre un identifiant Steam 64 bits et l'identifiant de compte (dossier userdata).
const STEAMID64_BASE: u64 = 76_561_197_960_265_728;

#[derive(Debug, Clone, PartialEq)]
pub struct SteamApp {
    pub appid: String,
    pub name: String,
    pub install_dir: PathBuf,
    pub installed: bool,
    /// Secondes Unix.
    pub last_played: Option<i64>,
    pub owner: Option<String>,
}

/// Dossier d'installation de Steam (celui qui contient steam.exe).
pub fn root() -> Option<PathBuf> {
    if let Some(path) = MANUAL_ROOT.lock().ok().and_then(|root| root.clone()).filter(|p| valid_root(p)) {
        return Some(path);
    }
    #[cfg(windows)]
    if let Some(root) = registered_roots().find(|p| p.join("steam.exe").is_file()) {
        return Some(root);
    }
    ["ProgramFiles(x86)", "ProgramFiles"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(|base| PathBuf::from(base).join("Steam"))
        .find(|p| p.join("steam.exe").is_file())
}

static MANUAL_ROOT: std::sync::Mutex<Option<PathBuf>> = std::sync::Mutex::new(None);

fn valid_root(path: &Path) -> bool {
    path.is_absolute() && path.join("steam.exe").is_file()
}

pub fn load_manual_root(file: &Path) {
    if let Ok(path) = std::fs::read_to_string(file) {
        if let Ok(mut root) = MANUAL_ROOT.lock() {
            *root = Some(PathBuf::from(path));
        }
    }
}

pub fn set_manual_root(file: &Path, path: PathBuf) -> Result<(), String> {
    if !valid_root(&path) {
        return Err("Choisissez le dossier qui contient steam.exe.".into());
    }
    let path_text = path.to_str().ok_or("Ce chemin Steam est illisible.")?;
    let mut root = MANUAL_ROOT.lock().map_err(|e| e.to_string())?;
    let temporary = file.with_extension("tmp");
    std::fs::write(&temporary, path_text).map_err(|e| format!("Impossible d’enregistrer le dossier Steam : {e}"))?;
    std::fs::rename(&temporary, file).map_err(|e| format!("Impossible d’enregistrer le dossier Steam : {e}"))?;
    *root = Some(path);
    Ok(())
}

#[cfg(windows)]
fn registered_roots() -> impl Iterator<Item = PathBuf> {
    use winreg::{enums::*, RegKey};

    [
        (HKEY_CURRENT_USER, KEY_READ, "SteamPath"),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY, "InstallPath"),
        (HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY, "InstallPath"),
    ]
    .into_iter()
    .filter_map(|(hive, access, value)| {
        let key = RegKey::predef(hive).open_subkey_with_flags(r"Software\Valve\Steam", access).ok()?;
        let path: String = key.get_value(value).ok()?;
        let path = path.trim().trim_matches('"');
        (!path.is_empty()).then(|| PathBuf::from(path)).filter(|p| p.is_absolute())
    })
}

/// Bibliothèques Steam (dossier principal compris).
pub fn libraries(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.to_path_buf()];
    for file in [root.join("steamapps").join("libraryfolders.vdf"), root.join("config").join("libraryfolders.vdf")] {
        let Ok(text) = std::fs::read_to_string(&file) else { continue };
        let doc = vdf::parse(&text);
        let Some(folders) = doc.get("libraryfolders") else { continue };
        for (_, f) in folders.entries() {
            // format récent : bloc avec « path » ; ancien format : chemin direct
            let path = f.get("path").and_then(Value::str).or_else(|| f.str());
            if let Some(p) = path {
                let p = PathBuf::from(p);
                if !out.iter().any(|o| same_dir(o, &p)) {
                    out.push(p);
                }
            }
        }
        break;
    }
    out
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    norm(a) == norm(b)
}

/// Applications installées (ou en cours d'installation) dans toutes les bibliothèques.
pub fn scan(root: &Path) -> Vec<SteamApp> {
    let mut out: Vec<SteamApp> = Vec::new();
    for lib in libraries(root) {
        let steamapps = lib.join("steamapps");
        let Ok(dir) = std::fs::read_dir(&steamapps) else { continue };
        for entry in dir.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
            if let Some(app) = parse_manifest(&text, &steamapps) {
                if !out.iter().any(|a| a.appid == app.appid) {
                    out.push(app);
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

pub fn parse_manifest(text: &str, steamapps: &Path) -> Option<SteamApp> {
    let doc = vdf::parse(text);
    let app = doc.get("AppState")?;
    let field = |k: &str| app.get(k).and_then(Value::str).map(str::to_string);
    let appid = field("appid")?;
    if appid.is_empty() || !appid.chars().all(|c| c.is_ascii_digit()) || NOT_GAMES.contains(&appid.as_str()) {
        return None;
    }
    let name = field("name").filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("Jeu Steam {appid}"));
    let flags: u32 = field("StateFlags").and_then(|f| f.parse().ok()).unwrap_or(0);
    let installdir = field("installdir").unwrap_or_default();
    Some(SteamApp {
        install_dir: steamapps.join("common").join(&installdir),
        // bit 4 : « entièrement installé » (les mises à jour en cours le gardent)
        installed: flags & 4 != 0,
        last_played: field("LastPlayed").and_then(|t| t.parse().ok()).filter(|t: &i64| *t > 0),
        owner: field("LastOwner"),
        appid,
        name,
    })
}

/// Temps de jeu (minutes) enregistré par Steam pour un compte.
pub fn playtimes(root: &Path, owner_steamid64: &str) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    let Some(account) = owner_steamid64.parse::<u64>().ok().and_then(|id| id.checked_sub(STEAMID64_BASE)) else {
        return out;
    };
    let file = root.join("userdata").join(account.to_string()).join("config").join("localconfig.vdf");
    let Ok(text) = std::fs::read_to_string(file) else { return out };
    let doc = vdf::parse(&text);
    let Some(apps) = doc.path(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"]) else {
        return out;
    };
    for (appid, data) in apps.entries() {
        if let Some(min) = data.get("Playtime").and_then(Value::str).and_then(|m| m.parse::<i64>().ok()) {
            if min > 0 {
                out.insert(appid.clone(), min);
            }
        }
    }
    out
}

/// Compte Steam de cet ordinateur (identifiant 64 bits) : le dernier connecté
/// d'après `config/loginusers.vdf`, sinon le propriétaire le plus fréquent des jeux installés.
pub fn account(root: &Path, apps: &[SteamApp]) -> Option<String> {
    if let Ok(text) = std::fs::read_to_string(root.join("config").join("loginusers.vdf")) {
        let doc = vdf::parse(&text);
        if let Some(users) = doc.get("users") {
            let mut best: Option<(bool, i64, String)> = None;
            for (id, u) in users.entries() {
                if id.parse::<u64>().map_or(true, |n| n < STEAMID64_BASE) {
                    continue;
                }
                let recent = u.get("MostRecent").or(u.get("mostrecent")).and_then(Value::str) == Some("1");
                let ts = u.get("Timestamp").and_then(Value::str).and_then(|t| t.parse().ok()).unwrap_or(0);
                if best.as_ref().map_or(true, |(r, t, _)| (recent, ts) > (*r, *t)) {
                    best = Some((recent, ts, id.clone()));
                }
            }
            if let Some((_, _, id)) = best {
                return Some(id);
            }
        }
    }
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for o in apps.iter().filter_map(|a| a.owner.as_deref()) {
        *counts.entry(o).or_default() += 1;
    }
    counts.into_iter().max_by_key(|(_, n)| *n).map(|(o, _)| o.to_string())
}

/// Membres de la Famille Steam de l'utilisateur (identifiants 64 bits, lui exclu),
/// d'après le bloc `FamilyGroup` de son `localconfig.vdf`.
pub fn family_members(root: &Path, steamid: &str) -> Vec<String> {
    let Some(account) = steamid.parse::<u64>().ok().and_then(|id| id.checked_sub(STEAMID64_BASE)) else {
        return Vec::new();
    };
    let file = root.join("userdata").join(account.to_string()).join("config").join("localconfig.vdf");
    let Ok(text) = std::fs::read_to_string(file) else { return Vec::new() };
    family_members_in(&vdf::parse(&text), account)
}

fn family_members_in(doc: &Value, me: u64) -> Vec<String> {
    let Some(members) = doc.path(&["UserLocalConfigStore", "FamilyGroup", "members"]) else {
        return Vec::new();
    };
    let mut out: Vec<String> = members
        .entries()
        .iter()
        .filter_map(|(_, m)| m.get("accountid").and_then(Value::str)?.parse::<u64>().ok())
        .filter(|&a| a != me && a > 0 && a < (1 << 32))
        .map(|a| (a + STEAMID64_BASE).to_string())
        .collect();
    out.dedup();
    out
}

/// Jeu possédé, d'après l'API Web officielle de Steam.
#[derive(Debug, Clone, PartialEq)]
pub struct OwnedGame {
    pub appid: String,
    pub name: String,
    pub playtime_minutes: i64,
    pub last_played: Option<i64>,
}

/// Clé API Web Steam : 32 caractères hexadécimaux.
pub fn valid_key(key: &str) -> bool {
    key.len() == 32 && key.chars().all(|c| c.is_ascii_hexdigit())
}

/// Jeux possédés par un compte : `IPlayerService/GetOwnedGames` (API Web officielle,
/// clé personnelle de l'utilisateur, conservée dans le coffre Windows).
/// `free` : inclure les jeux gratuits auxquels le compte a joué.
pub fn owned_games(key: &str, steamid: &str, free: bool) -> Result<Vec<OwnedGame>, String> {
    if !valid_key(key) {
        return Err("Clé API Web Steam invalide (32 caractères attendus).".into());
    }
    if !steamid.chars().all(|c| c.is_ascii_digit()) {
        return Err("Compte Steam introuvable sur cet ordinateur.".into());
    }
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    // Les serveurs de Steam renvoient parfois 500/502/503/504 (passerelle surchargée, maintenance
    // du mardi) : trois essais espacés, puis une requête plus légère (sans les jeux gratuits).
    let attempts: &[(bool, u64)] = if free { &[(true, 0), (true, 1500), (true, 4000), (false, 2000)] } else { &[(false, 0), (false, 1500), (false, 4000)] };
    let mut last = String::new();
    for &(with_free, wait_ms) in attempts {
        if wait_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(wait_ms));
        }
        match owned_once(&client, key, steamid, with_free) {
            Ok(games) => return Ok(games),
            Err(Attempt::Retry(msg)) => last = msg,
            Err(Attempt::Fatal(msg)) => return Err(msg),
        }
    }
    Err(last)
}

enum Attempt {
    /// Erreur passagère des serveurs de Steam : on peut réessayer.
    Retry(String),
    Fatal(String),
}

fn owned_once(client: &reqwest::blocking::Client, key: &str, steamid: &str, free: bool) -> Result<Vec<OwnedGame>, Attempt> {
    let url = reqwest::Url::parse_with_params(
        "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
        &[("key", key), ("steamid", steamid), ("include_appinfo", "1"), ("include_played_free_games", if free { "1" } else { "0" }), ("format", "json")],
    )
    .map_err(|e| Attempt::Fatal(e.to_string()))?;
    let res = client
        .get(url)
        .send()
        .map_err(|_| Attempt::Retry("Steam ne répond pas : vérifiez la connexion Internet.".to_string()))?;
    match res.status().as_u16() {
        200 => {}
        401 | 403 => return Err(Attempt::Fatal("Steam refuse cette clé API Web : vérifiez-la sur steamcommunity.com/dev/apikey.".into())),
        429 => return Err(Attempt::Fatal("Steam limite les requêtes : réessayez dans quelques minutes.".into())),
        s @ 500..=599 => {
            return Err(Attempt::Retry(format!(
                "Les serveurs de Steam sont momentanément indisponibles (erreur {s}, de leur côté) : vos jeux installés sont à jour, les jeux possédés non installés seront lus à la prochaine actualisation."
            )))
        }
        s => return Err(Attempt::Fatal(format!("Steam a répondu une erreur ({s})."))),
    }
    let body: serde_json::Value = res.json().map_err(|_| Attempt::Retry("Réponse de Steam illisible.".to_string()))?;
    parse_owned(&body).map_err(Attempt::Fatal)
}

pub fn parse_owned(body: &serde_json::Value) -> Result<Vec<OwnedGame>, String> {
    let resp = body.get("response").ok_or("Réponse de Steam illisible.")?;
    let Some(games) = resp.get("games").and_then(|g| g.as_array()) else {
        // réponse vide : profil privé (détails des jeux) ou compte sans jeux
        return if resp.get("game_count").and_then(|c| c.as_i64()) == Some(0) {
            Ok(Vec::new())
        } else {
            Err("Steam ne communique pas la liste des jeux : dans Steam › Profil › Confidentialité, « Détails des jeux » doit être Public.".into())
        };
    };
    Ok(games
        .iter()
        .filter_map(|g| {
            let appid = g.get("appid")?.as_u64()?.to_string();
            if NOT_GAMES.contains(&appid.as_str()) {
                return None;
            }
            let name = g.get("name").and_then(|n| n.as_str()).map(str::trim).filter(|n| !n.is_empty())?.to_string();
            Some(OwnedGame {
                appid,
                name,
                playtime_minutes: g.get("playtime_forever").and_then(|p| p.as_i64()).unwrap_or(0),
                last_played: g.get("rtime_last_played").and_then(|t| t.as_i64()).filter(|t| *t > 0),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jeux_possedes_api_web() {
        let body = serde_json::json!({"response": {"game_count": 3, "games": [
            {"appid": 1966720, "name": "Lethal Company", "playtime_forever": 754, "rtime_last_played": 1791551557},
            {"appid": 228980, "name": "Steamworks Common Redistributables", "playtime_forever": 0},
            {"appid": 620, "name": "Portal 2", "playtime_forever": 0, "rtime_last_played": 0}
        ]}});
        let games = parse_owned(&body).unwrap();
        assert_eq!(games.len(), 2);
        assert_eq!(games[0], OwnedGame { appid: "1966720".into(), name: "Lethal Company".into(), playtime_minutes: 754, last_played: Some(1_791_551_557) });
        assert_eq!(games[1].last_played, None);
        // profil privé : une erreur claire, pas une bibliothèque vide inventée
        assert!(parse_owned(&serde_json::json!({"response": {}})).is_err());
        assert!(parse_owned(&serde_json::json!({"response": {"game_count": 0}})).unwrap().is_empty());
        assert!(valid_key("0123456789ABCDEF0123456789abcdef") && !valid_key("abc"));
    }

    #[test]
    fn membres_de_la_famille() {
        let doc = vdf::parse("\"UserLocalConfigStore\" { \"FamilyGroup\" { \"groupid\" \"1\" \"members\" { \"0\" { \"accountid\" \"1000\" } \"1\" { \"accountid\" \"2000\" } \"2\" { \"accountid\" \"x\" } } } }");
        assert_eq!(family_members_in(&doc, 1000), vec!["76561197960267728".to_string()]);
        assert!(family_members_in(&vdf::parse("\"UserLocalConfigStore\" { }"), 1).is_empty());
    }

    #[test]
    fn compte_steam_le_plus_recent() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("config")).unwrap();
        std::fs::write(
            tmp.path().join("config").join("loginusers.vdf"),
            "\"users\" { \"76561197983523621\" { \"MostRecent\" \"0\" \"Timestamp\" \"1700000000\" } \"76561198988343748\" { \"MostRecent\" \"1\" \"Timestamp\" \"1600000000\" } }",
        )
        .unwrap();
        assert_eq!(account(tmp.path(), &[]).as_deref(), Some("76561198988343748"));
    }

    #[test]
    fn manifeste_jeu_outil_et_etat() {
        let lib = Path::new("G:\\SteamLibrary\\steamapps");
        let game = parse_manifest(
            "\"AppState\" { \"appid\" \"1966720\" \"name\" \"Lethal Company\" \"StateFlags\" \"4\" \"installdir\" \"Lethal Company\" \"LastPlayed\" \"1791551557\" \"LastOwner\" \"76561198988343748\" }",
            lib,
        )
        .unwrap();
        assert_eq!(game.appid, "1966720");
        assert!(game.installed);
        assert_eq!(game.install_dir, lib.join("common").join("Lethal Company"));
        assert_eq!(game.last_played, Some(1_791_551_557));

        // mise à jour en cours (4 | 1024) : toujours installé ; téléchargement (1026 sans 4) : non
        let updating = parse_manifest("\"AppState\" { \"appid\" \"10\" \"name\" \"X\" \"StateFlags\" \"1028\" }", lib).unwrap();
        assert!(updating.installed);
        let downloading = parse_manifest("\"AppState\" { \"appid\" \"11\" \"name\" \"Y\" \"StateFlags\" \"1026\" }", lib).unwrap();
        assert!(!downloading.installed);

        // composants de Steam écartés
        assert!(parse_manifest("\"AppState\" { \"appid\" \"228980\" \"name\" \"Steamworks Common Redistributables\" \"StateFlags\" \"4\" }", lib).is_none());
    }

    #[test]
    fn bibliotheques_et_temps_de_jeu() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("steamapps")).unwrap();
        std::fs::write(
            root.join("steamapps").join("libraryfolders.vdf"),
            format!("\"libraryfolders\" {{ \"0\" {{ \"path\" \"{}\" }} \"1\" {{ \"path\" \"G:\\\\SteamLibrary\" }} }}", root.display().to_string().replace('\\', "\\\\")),
        )
        .unwrap();
        let libs = libraries(root);
        assert_eq!(libs.len(), 2, "{libs:?}");
        assert!(libs[1].ends_with("SteamLibrary"));

        let cfg = root.join("userdata").join("1028077920").join("config");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::write(
            cfg.join("localconfig.vdf"),
            "\"UserLocalConfigStore\" { \"Software\" { \"Valve\" { \"Steam\" { \"apps\" { \"1966720\" { \"Playtime\" \"754\" } \"10\" { \"Playtime\" \"0\" } } } } } }",
        )
        .unwrap();
        let times = playtimes(root, "76561198988343648");
        assert_eq!(times.get("1966720"), Some(&754));
        assert!(!times.contains_key("10"));
    }
}
