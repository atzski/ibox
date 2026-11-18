//! Internet Archive (archive.org) : collections de scans de manuels
//! (« Console Manuals » et ses sous-collections par console).
//!
//! Correspondance par titre : les résultats sont notés (titre, console citée,
//! sous-collection de la console) ; seule une correspondance très sûre est
//! appliquée sans demander.

use super::{platforms_in, Found, GameInfo, ManualOptions};
use crate::metadata::http::{encode_segment, Http};
use crate::metadata::matching::{name_key, name_key_raw, similarity};
use crate::metadata::Result;
use serde_json::Value;

pub const PROVIDER: &str = "archive";

/// Score minimal pour appliquer un manuel sans le faire choisir.
pub const AUTO_SCORE: f32 = 0.9;

/// Sous-collections de « consolemanuals » propres à une console.
fn collections(platform: &str) -> &'static [&'static str] {
    match platform {
        "megadrive" => &["segagenesismanuals"],
        "saturn" => &["segasaturnmanuals"],
        "dreamcast" => &["segadreamcastmanuals"],
        "mastersystem" => &["sega_master_system_manuals"],
        "ps1" => &["playstationmanuals", "playstation-archive"],
        "ps2" => &["sonyplaystation2manuals", "ps2-kirklands-manual-labor"],
        "snes" => &["manuals_snes", "snes-kirklands-manual-labor"],
        "nes" => &["famicommanuals", "nintendogamepacks"],
        "n64" => &["nintendo64manuals"],
        "gba" => &["gameboyadvancemanuals", "tabor62gbamanual"],
        "atari2600" => &["a2600-kirklands-manual-labor"],
        "xbox" => &["xboxmanuals"],
        "xbox360" => &["xbox360manuals"],
        _ => &[],
    }
}

/// Mots retirés d'un titre de document avant comparaison.
const NOISE: &[&str] = &[
    "manual", "manuals", "manuel", "manuale", "handbuch", "instruction", "instructions", "booklet", "notice", "mode", "d", "emploi",
    "usa", "europe", "japan", "france", "germany", "world", "pal", "ntsc", "en", "fr", "de", "es", "it", "eu", "us", "jp", "uk", "rev", "scan",
];

fn clean_doc_title(t: &str) -> String {
    // étiquettes entre parenthèses ou crochets : année, éditeur, région…
    let mut plain = String::with_capacity(t.len());
    let mut depth = 0i32;
    for ch in t.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = (depth - 1).max(0),
            _ if depth == 0 => plain.push(ch),
            _ => {}
        }
    }
    let raw = name_key_raw(&plain);
    let mut words: Vec<&str> = raw.split_whitespace().collect();
    // les noms de console aussi (« Super Metroid SNES Manual » → « super metroid »)
    let consoles = [
        "snes", "nes", "n64", "gba", "gbc", "gb", "nds", "ds", "3ds", "psx", "ps1", "ps2", "ps3", "psp", "wii", "gamecube", "ngc", "xbox", "360", "genesis",
        "megadrive", "saturn", "dreamcast", "super", "nintendo", "famicom", "sega", "sony", "playstation", "mega", "drive", "game", "boy", "advance", "color",
        "master", "system", "gear", "atari", "2600", "pc", "windows", "dos", "cube", "ps", "english", "quality", "better",
    ];
    // « super » et « game » font souvent partie du titre : on ne les retire qu'en fin de titre
    while let Some(last) = words.last() {
        if NOISE.contains(last) || consoles.contains(last) {
            words.pop();
        } else {
            break;
        }
    }
    words.retain(|w| !NOISE.contains(w));
    words.join(" ")
}

fn region_of(title: &str) -> Option<String> {
    let t = format!(" {} ", title.to_lowercase());
    let raw = format!(" {} ", name_key_raw(title));
    let pick = |needles: &[&str], words: &[&str], code: &str| {
        (needles.iter().any(|n| t.contains(n)) || words.iter().any(|w| raw.contains(&format!(" {w} ")))).then(|| code.to_string())
    };
    pick(&["(france)", "(fr)", "mode d'emploi", "-fra"], &["francais", "french", "fra"], "fr")
        .or_else(|| pick(&["(korea)", "(kr)", "_kor", "(kor)"], &["korean", "kor"], "kr"))
        .or_else(|| pick(&["(china)", "(cn)", "[shen"], &["chinese"], "cn"))
        .or_else(|| pick(&["(germany)", "(de)"], &["spielanleitung", "deutsch", "german", "anleitung"], "de"))
        .or_else(|| pick(&["(italy)", "(it)"], &["manuale", "italiano", "italian"], "it"))
        .or_else(|| pick(&["(spain)", "(es)"], &["espanol", "spanish", "instrucciones"], "es"))
        .or_else(|| pick(&["(brazil)", "(br)"], &["brasileiro", "portugues", "portuguese"], "br"))
        .or_else(|| pick(&["(japan)", "(jp)", "(ntsc-j)"], &["japanese"], "jp"))
        .or_else(|| pick(&["(europe)", "(eu)", "(pal)", "nintendo of europe"], &["pal"], "eu"))
        .or_else(|| pick(&["(usa)", "(us)", "(ntsc-u)", "(ntsc)"], &[], "us"))
        .or_else(|| pick(&["(world)"], &[], "wor"))
}

/// Numéros de suite (chiffres, chiffres romains) d'un titre.
fn sequel_marks(key: &str) -> Vec<&str> {
    key.split_whitespace()
        .filter(|w| w.chars().all(|c| c.is_ascii_digit()) && w.len() <= 2 || ["ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"].contains(w))
        .collect()
}

/// Ajustement selon la langue du document : celle de l'utilisateur d'abord,
/// l'anglais ensuite ; une autre langue n'est jamais appliquée sans demander.
pub fn language_bonus(region: Option<&str>, opts: &ManualOptions) -> f32 {
    match region {
        Some("fr") if opts.language == "fr" => 0.05,
        None | Some("us" | "eu" | "uk" | "wor" | "au" | "ca") => 0.0,
        Some("fr") => -0.15,
        Some(_) => -0.25,
    }
}

/// Note d'un document (0..1) pour un jeu donné.
pub fn score(game_title: &str, platform: &str, doc_title: &str, doc_collections: &[String]) -> f32 {
    let want = name_key(game_title);
    let got = clean_doc_title(doc_title);
    if want.is_empty() || got.is_empty() {
        return 0.0;
    }
    let mut s = similarity(&want, &got);
    // titre du jeu suivi d'autres mots (sous-titre, édition…) : proposé, jamais appliqué seul
    let extra = s < 1.0 && got.starts_with(&want);
    if extra {
        s = s.max(0.8);
    }
    // « Crash Bandicoot » n'est pas « Crash Bandicoot 2 »
    if sequel_marks(&want) != sequel_marks(&got) {
        s -= 0.4;
    }
    let cited = platforms_in(doc_title);
    if !cited.is_empty() {
        if cited.contains(&platform) {
            s += 0.08;
        } else {
            s -= 0.45;
        }
    }
    // PC : livres, romans et guides homonymes abondent ; sans « PC » ni collection de manuels, jamais sûr
    if platform == "pc" && cited.is_empty() && !doc_collections.iter().any(|c| c == "manuals" || c.ends_with("manuals")) {
        s -= 0.15;
    }
    let own = collections(platform);
    if doc_collections.iter().any(|c| own.contains(&c.as_str())) {
        s += 0.1;
    } else if !own.is_empty() && doc_collections.iter().any(|c| c.ends_with("manuals") && c != "consolemanuals" && c != "consolemanuals_unsorted") && cited.is_empty() {
        // rangé dans la collection d'une autre console
        s -= 0.3;
    }
    // guides de stratégie, magazines : pas des manuels
    let raw = name_key_raw(doc_title);
    if ["guide", "strategy", "magazine", "walkthrough", "soluce", "poster"].iter().any(|w| raw.split(' ').any(|x| x == *w)) {
        s -= 0.5;
    }
    if extra {
        s = s.min(0.85);
    }
    s.clamp(0.0, 1.0)
}

fn strings(v: &Value) -> Vec<String> {
    match v {
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        Value::String(s) => vec![s.clone()],
        _ => Vec::new(),
    }
}

/// Requête de recherche : mots du titre (sans ponctuation).
fn title_query(title: &str) -> Option<String> {
    let key = name_key(title);
    let words: Vec<&str> = key.split_whitespace().filter(|w| w.len() > 1 || w.chars().all(|c| c.is_ascii_digit())).take(7).collect();
    (!words.is_empty()).then(|| words.join(" AND "))
}

/// Premiers mots significatifs d'un titre long (« Zelda Skyward Sword HD » → « zelda skyward sword »).
fn short_query(title: &str) -> Option<String> {
    let key = name_key(title);
    let words: Vec<&str> = key.split_whitespace().filter(|w| !["the", "of", "and", "a", "hd", "deluxe", "remastered", "edition"].contains(w)).collect();
    (words.len() > 3).then(|| words[..3].join(" AND "))
}

pub fn find(http: &Http, game: &GameInfo, opts: &ManualOptions) -> Result<Vec<Found>> {
    let Some(words) = title_query(&game.title) else { return Ok(Vec::new()) };
    let manualish = "(title:(manual) OR title:(manuel) OR title:(instruction) OR title:(booklet) OR subject:(manual) OR subject:(manuals))";
    let mut queries = vec![
        format!("collection:(consolemanuals) AND title:({words})"),
        format!("mediatype:(texts) AND title:({words}) AND {manualish}"),
        // collections de manuels hors consoles (PC, ordinateurs…)
        format!("collection:(manuals) AND title:({words})"),
    ];
    // titre long (sous-titre, édition) : aussi les premiers mots seuls
    if let Some(short) = short_query(&game.title) {
        queries.push(format!("mediatype:(texts) AND title:({short}) AND {manualish}"));
    }
    let mut docs: Vec<(String, String, Vec<String>)> = Vec::new();
    for q in queries {
        let url = format!(
            "https://archive.org/advancedsearch.php?q={}&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=collection&rows=25&output=json",
            encode_segment(&q)
        );
        let v: Value = http.json(&url, None, "l'Internet Archive")?;
        for d in v["response"]["docs"].as_array().into_iter().flatten() {
            let (Some(id), Some(title)) = (d["identifier"].as_str(), d["title"].as_str()) else { continue };
            if !docs.iter().any(|(i, _, _)| i == id) {
                docs.push((id.to_string(), title.to_string(), strings(&d["collection"])));
            }
        }
    }
    let mut scored: Vec<(f32, String, String)> = docs
        .into_iter()
        .map(|(id, t, c)| ((score(&game.title, &game.platform, &t, &c) + language_bonus(region_of(&t).as_deref(), opts)).clamp(0.0, 1.0), id, t))
        .filter(|(s, _, _)| *s >= 0.62)
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.truncate(4);

    let mut out = Vec::new();
    for (s, id, title) in scored {
        if let Some((file, size)) = best_pdf(http, &id)? {
            // quelques centaines de Ko : scan minuscule ou page isolée
            let s = if size.is_some_and(|n| n < 400 * 1024) { s - 0.12 } else { s };
            out.push(Found {
                source: PROVIDER,
                reference: format!("{id}/{file}"),
                url: format!("https://archive.org/download/{}/{}", encode_segment(&id), file.split('/').map(encode_segment).collect::<Vec<_>>().join("/")),
                region: region_of(&title),
                title,
                size,
                score: s,
            });
        }
    }
    out.sort_by(|a, b| b.score.total_cmp(&a.score).then(opts.region_rank(a.region.as_deref()).cmp(&opts.region_rank(b.region.as_deref()))));
    Ok(out)
}

/// PDF d'origine d'un document (pas la version « texte » produite par l'Archive).
fn best_pdf(http: &Http, identifier: &str) -> Result<Option<(String, Option<u64>)>> {
    let v: Value = http.json(&format!("https://archive.org/metadata/{}", encode_segment(identifier)), None, "l'Internet Archive")?;
    let mut pdfs: Vec<(i32, String, Option<u64>)> = v["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let name = f["name"].as_str()?;
            if !name.to_lowercase().ends_with(".pdf") {
                return None;
            }
            let size = f["size"].as_str().and_then(|s| s.parse().ok()).or(f["size"].as_u64());
            let format = f["format"].as_str().unwrap_or("");
            let rank = if name.to_lowercase().ends_with("_text.pdf") || format.contains("Text PDF") {
                2
            } else if f["source"].as_str() == Some("original") {
                0
            } else {
                1
            };
            Some((rank, name.to_string(), size))
        })
        .filter(|(_, _, size)| size.map(|s| s <= super::MAX_BYTES).unwrap_or(true))
        .collect();
    pdfs.sort_by(|a, b| a.0.cmp(&b.0).then(b.2.unwrap_or(0).cmp(&a.2.unwrap_or(0))));
    Ok(pdfs.into_iter().next().map(|(_, n, s)| (n, s)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn notes_des_documents() {
        let snes = c(&["manuals_snes", "consolemanuals"]);
        assert!(score("Super Metroid", "snes", "Super Metroid (USA)", &snes) >= AUTO_SCORE);
        assert!(score("Super Metroid", "snes", "Super Metroid SNES Manual", &c(&["consolemanuals_unsorted"])) >= AUTO_SCORE);
        // autre console citée
        assert!(score("Sonic the Hedgehog", "megadrive", "Sonic the Hedgehog (Game Gear) manual", &c(&["consolemanuals"])) < 0.62);
        // guide de stratégie
        assert!(score("Super Metroid", "snes", "Super Metroid Strategy Guide", &snes) < 0.62);
        assert!(score("Super Mario 64", "n64", "Super Mario 64 (1997)(Nintendo)(US)", &c(&["nintendo64manuals"])) >= AUTO_SCORE);
        assert!(score("Crash Bandicoot", "ps1", "Crash Bandicoot Warped Manual", &c(&["consolemanuals"])) < AUTO_SCORE);
        // PC : un titre seul ne suffit pas
        assert!(score("Fortnite", "pc", "Fortnite", &c(&["opensource"])) < AUTO_SCORE);
        assert!(score("Half-Life", "pc", "Half-Life PC manual", &c(&["manuals"])) >= AUTO_SCORE);
        // suite
        assert!(score("Crash Bandicoot", "ps1", "Crash Bandicoot 2 Cortex Strikes Back PlayStation Manual", &c(&["consolemanuals"])) < 0.62);
        assert!(score("Final Fantasy VII", "ps1", "Final Fantasy VIII manual", &c(&["consolemanuals"])) < 0.62);
        // titre différent
        assert!(score("Super Metroid", "snes", "Metroid Fusion (USA)", &c(&["gameboyadvancemanuals"])) < AUTO_SCORE);
    }

    #[test]
    fn regions_des_titres() {
        assert_eq!(region_of("Super Metroid (USA)").as_deref(), Some("us"));
        assert_eq!(region_of("Zelda (Europe) (En,Fr,De)").as_deref(), Some("eu"));
        assert_eq!(region_of("Super Metroid"), None);
        assert_eq!(region_of("Super Mario Sunshine - Korean Manual (Nintendo GameCube)").as_deref(), Some("kr"));
        assert_eq!(region_of("Super Mario Sunshine - Nintendo GameCube - Mode d'emploi - France").as_deref(), Some("fr"));
        assert_eq!(region_of("Super Mario Sunshine - Nintendo GameCube - Spielanleitung").as_deref(), Some("de"));
        assert_eq!(region_of("Crash Bandicoot 2 Manuale ( IT)").as_deref(), Some("it"));
    }

    #[test]
    fn requete_par_titre() {
        assert_eq!(title_query("The Legend of Zelda: A Link to the Past").unwrap(), "legend AND of AND zelda AND link AND to AND the AND past");
        assert!(title_query("!!!").is_none());
    }
}
