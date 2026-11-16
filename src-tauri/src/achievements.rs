use crate::{metadata::keys, pc::steam};
use serde_json::{json, Value};

fn fetch(url: &str, params: &[(&str, &str)]) -> Result<Value, String> {
    let url = reqwest::Url::parse_with_params(url, params).map_err(|_| "Adresse invalide.")?;
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Connexion indisponible.")?
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|_| {
            "Succès indisponibles. Vérifiez le compte, la clé et la visibilité du profil.".into()
        })
}

#[tauri::command]
pub async fn achievements_ra_key(key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 128 || !key.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err("Clé RetroAchievements invalide.".into());
    }
    keys::set("retroachievements", key).map_err(|_| "Coffre Windows indisponible.".into())
}

#[tauri::command]
pub async fn achievements_read(
    source: String,
    game: u32,
    username: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = game.to_string();
        if source == "steam" {
            let key = keys::get(steam::KEY).ok().flatten().ok_or("Ajoutez votre clé Steam dans les paramètres.")?;
            let root = steam::root().ok_or("Installez Steam et connectez votre compte.")?;
            let user = steam::account(&root, &steam::scan(&root)).ok_or("Compte Steam introuvable.")?;
            let data = fetch("https://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v0001/", &[("key",&key),("steamid",&user),("appid",&id),("l","french")])?;
            let stats = data["playerstats"]["achievements"].as_array().ok_or("Aucun succès Steam accessible pour ce jeu.")?;
            let schema = fetch("https://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/", &[("key",&key),("appid",&id),("l","french")]).unwrap_or_default();
            let details = schema["game"]["availableGameStats"]["achievements"].as_array();
            return Ok(json!(stats.iter().map(|a| {
                let detail = details.and_then(|rows| rows.iter().find(|row| row["name"] == a["apiname"]));
                json!({"title": a["name"].as_str().or(a["apiname"].as_str()), "description":a["description"], "earned":a["achieved"] == 1, "unlockedAt":a["unlocktime"], "image":detail.and_then(|row| row[if a["achieved"] == 1 {"icon"} else {"icongray"}].as_str().or(row["icon"].as_str())).map(|url| url.replacen("http://", "https://", 1))})
            }).collect::<Vec<_>>()));
        }
        if source != "ra" { return Err("Source inconnue.".into()); }
        let user = username.filter(|s| !s.is_empty() && s.len() <= 32).ok_or("Indiquez votre pseudo RetroAchievements.")?;
        let key = keys::get("retroachievements").ok().flatten().ok_or("Ajoutez votre clé RetroAchievements dans les paramètres.")?;
        let data = fetch("https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php", &[("y",&key),("u",&user),("g",&id)])?;
        if data["NumAchievements"].as_u64() == Some(0) { return Ok(json!([])); }
        let achievements = data["Achievements"].as_object().ok_or("Aucun succès RetroAchievements accessible pour ce jeu.")?;
        Ok(json!(achievements.values().map(|a| {
            let badge = a["BadgeName"].as_str().filter(|name| name.bytes().all(|c| c.is_ascii_digit()));
            json!({"title":a["Title"],"description":a["Description"],"unlockedAt":a["DateEarnedHardcore"].as_str().or(a["DateEarned"].as_str()), "earned":a["DateEarned"].is_string() || a["DateEarnedHardcore"].is_string(),"image":badge.map(|name| format!("https://media.retroachievements.org/Badge/{name}.png"))})
        }).collect::<Vec<_>>()))
    }).await.map_err(|_| "Lecture des succès interrompue.".to_string())?
}
fn title_words(title: &str) -> Vec<String> {
    let normalized = title.to_lowercase().replace(['’', '\''], "");
    normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty() && !matches!(*word, "the" | "legend" | "of" | "a" | "an"))
        .map(str::to_owned)
        .collect()
}

#[tauri::command]
pub async fn achievements_ra_search(platform: String, title: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let system = match platform.as_str() {
            "snes" => "3",
            "n64" => "2",
            "gb" => "4",
            "gba" => "5",
            "gbc" => "6",
            "ds" => "18",
            "3ds" => "62",
            "gamecube" => "16",
            "wii" => "19",
            "ps1" => "12",
            "ps2" => "21",
            "psp" => "41",
            _ => return Ok(json!([])),
        };
        let key = keys::get("retroachievements")
            .ok()
            .flatten()
            .ok_or("Ajoutez votre clé RetroAchievements dans les paramètres.")?;
        let catalog = fetch(
            "https://retroachievements.org/API/API_GetGameList.php",
            &[("y", &key), ("i", system), ("f", "0")],
        )?;
        let query = title_words(&title);
        let rows = catalog
            .as_array()
            .ok_or("Catalogue RetroAchievements indisponible.")?;
        let mut matches = rows
            .iter()
            .filter_map(|item| {
                let name = item["Title"].as_str()?;
                let words = title_words(name);
                let common = query.iter().filter(|word| words.contains(word)).count();
                if query.is_empty() || common == 0 || common * 2 < query.len().max(words.len()) {
                    return None;
                }
                let count = item["NumAchievements"].as_u64();
                let distance = query.len() + words.len() - 2 * common;
                Some((
                    (words != query, distance, count == Some(0), name),
                    json!({"title":name,"id":item["ID"],"count":count}),
                ))
            })
            .collect::<Vec<_>>();
        matches.sort_by_key(|(rank, _)| *rank);
        Ok(json!(matches
            .into_iter()
            .take(12)
            .map(|(_, item)| item)
            .collect::<Vec<_>>()))
    })
    .await
    .map_err(|_| "Recherche interrompue.".to_string())?
}
#[tauri::command]
pub async fn achievements_ra_progress(username: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = keys::get("retroachievements").ok().flatten().ok_or("Ajoutez votre clé RetroAchievements.")?;
        if username.trim().is_empty() || username.len() > 32 { return Err("Pseudo invalide.".into()); }
        let mut games = Vec::new();
        loop {
            let offset = games.len().to_string();
            let page = fetch("https://retroachievements.org/API/API_GetUserCompletionProgress.php",
                &[("y",&key),("u",&username),("c","500"),("o",&offset)])?;
            let rows = page["Results"].as_array().ok_or("Progression RetroAchievements indisponible.")?;
            games.extend(rows.iter().map(|r| json!({"title":r["Title"],"system":r["ConsoleID"],"id":r["GameID"],"earned":r["NumAwarded"],"total":r["MaxPossible"]})));
            if rows.is_empty() || games.len() as u64 >= page["Total"].as_u64().unwrap_or(0) { break; }
        }
        Ok(json!(games))
    }).await.map_err(|_| "Synchronisation interrompue.".to_string())?
}
#[tauri::command]
pub fn achievements_ra_connected() -> Result<bool, String> {
    keys::get("retroachievements")
        .map(|key| key.is_some())
        .map_err(|_| "Coffre Windows indisponible.".into())
}

#[tauri::command]
pub fn achievements_ra_disconnect() -> Result<(), String> {
    keys::delete("retroachievements").map_err(|_| "Coffre Windows indisponible.".into())
}
