//! Analyse des noms de fichiers (conventions No-Intro / Redump / GoodTools).
//!
//! « Legend of Zelda, The - The Wind Waker (Europe) (En,Fr,De) (Disc 1) [GZLP01].iso »
//!   → titre « The Legend of Zelda - The Wind Waker », région PAL, disque 1, série GZLP01.

use super::Region;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedName {
    pub title: String,
    pub region: Option<Region>,
    pub disc: Option<u32>,
    pub serial: Option<String>,
    /// Étiquettes brutes entre () et [] (langues, révision, etc.).
    pub tags: Vec<String>,
}

pub fn parse(stem: &str) -> ParsedName {
    let mut title = String::new();
    let mut tags = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();

    for ch in stem.chars() {
        match ch {
            '(' | '[' => {
                if depth == 0 {
                    current.clear();
                } else {
                    current.push(ch);
                }
                depth += 1;
            }
            ')' | ']' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    tags.push(current.trim().to_string());
                } else {
                    current.push(ch);
                }
            }
            _ if depth > 0 => current.push(ch),
            _ => title.push(ch),
        }
    }

    let title = title.replace('_', " ");
    let title = collapse_spaces(&title);
    let title = tidy_hand_typed(title.trim_matches(|c: char| c == '-' || c.is_whitespace()));
    let title = move_trailing_article(&title);

    let mut parsed = ParsedName {
        title,
        tags,
        ..Default::default()
    };
    for tag in &parsed.tags {
        if parsed.region.is_none() {
            parsed.region = region_from_tag(tag);
        }
        if parsed.disc.is_none() {
            parsed.disc = disc_from_tag(tag);
        }
        if parsed.serial.is_none() {
            parsed.serial = serial_from_tag(tag);
        }
    }
    parsed
}

fn collapse_spaces(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Nom tapé à la main, tout en minuscules (« joker-poker », « space impakto », « pong-3ds ») :
/// sans espace, tirets et points séparent les mots ; puis majuscule à chaque mot, sauf les petits
/// mots de liaison, et sigles courts avec chiffres en capitales (« 3DS »). Un nom qui a déjà une
/// majuscule (No-Intro, Redump, GoodTools) ou aucune lettre latine reste tel quel.
fn tidy_hand_typed(title: &str) -> String {
    let lower = title.chars().any(|c| c.is_lowercase());
    if !lower || title.chars().any(|c| c.is_uppercase()) {
        return title.to_string();
    }
    let spaced = if title.contains(' ') {
        title.to_string()
    } else {
        collapse_spaces(&title.replace(['-', '.'], " "))
    };
    const SMALL: [&str; 14] = [
        "of", "the", "and", "a", "an", "in", "on", "to", "de", "du", "des", "la", "le", "et",
    ];
    let capital = |w: &str| -> String {
        let mut c = w.chars();
        c.next()
            .map(|f| f.to_uppercase().chain(c).collect())
            .unwrap_or_default()
    };
    spaced
        .split(' ')
        .enumerate()
        .map(|(i, word)| {
            if i > 0 && SMALL.contains(&word) {
                return word.to_string();
            }
            let digits = word.chars().any(|c| c.is_ascii_digit());
            let letters = word.chars().any(|c| c.is_alphabetic());
            if digits
                && letters
                && word.chars().count() <= 4
                && word.chars().all(|c| c.is_ascii_alphanumeric())
            {
                return word.to_uppercase();
            }
            // « spider-man » → « Spider-Man »
            word.split('-').map(capital).collect::<Vec<_>>().join("-")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// « Legend of Zelda, The - Wind Waker » → « The Legend of Zelda - Wind Waker ».
fn move_trailing_article(title: &str) -> String {
    const ARTICLES: [&str; 7] = ["The", "A", "An", "Le", "La", "Les", "L'"];
    // L'article se place avant le premier séparateur de sous-titre, s'il y en a un.
    let (main, rest) = match title.find(" - ").or_else(|| title.find(": ")) {
        Some(i) => (&title[..i], &title[i..]),
        None => (title, ""),
    };
    for art in ARTICLES {
        let suffix = format!(", {art}");
        if main.len() > suffix.len() && main.to_lowercase().ends_with(&suffix.to_lowercase()) {
            let base = &main[..main.len() - suffix.len()];
            let joiner = if art.ends_with('\'') { "" } else { " " };
            return format!("{art}{joiner}{base}{rest}");
        }
    }
    title.to_string()
}

fn region_from_tag(tag: &str) -> Option<Region> {
    // Le premier pays reconnu détermine la région (« USA, Europe » → NTSC-U).
    for part in tag.split(',') {
        let p = part.trim().to_lowercase();
        let r = match p.as_str() {
            "europe" | "eu" | "e" | "pal" | "france" | "germany" | "spain" | "italy" | "uk"
            | "united kingdom" | "australia" | "netherlands" | "sweden" | "scandinavia" => {
                Some(Region::Pal)
            }
            "usa" | "us" | "u" | "ntsc-u" | "ntsc" | "america" | "canada" => Some(Region::NtscU),
            "japan" | "jp" | "jpn" | "j" | "ntsc-j" => Some(Region::NtscJ),
            _ => None,
        };
        if r.is_some() {
            return r;
        }
    }
    None
}

fn disc_from_tag(tag: &str) -> Option<u32> {
    let t = tag.to_lowercase();
    for prefix in ["disc ", "disk ", "cd "] {
        if let Some(rest) = t.strip_prefix(prefix) {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}

/// Identifiants de type GameCube/Wii (GZLP01) ou PlayStation (SLUS-01234).
fn serial_from_tag(tag: &str) -> Option<String> {
    let t = tag.trim();
    if !t.is_ascii() {
        return None;
    }
    let is_gc_id = t.len() == 6
        && t.chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    let is_ps_id = t.len() >= 9
        && t.len() <= 11
        && t[..4].chars().all(|c| c.is_ascii_uppercase())
        && matches!(t.as_bytes()[4], b'-' | b'_')
        && t[5..].chars().all(|c| c.is_ascii_digit() || c == '.');
    (is_gc_id || is_ps_id).then(|| t.replace('_', "-").replace('.', ""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nom_no_intro_complet() {
        let p =
            parse("Legend of Zelda, The - The Wind Waker (Europe) (En,Fr,De) (Disc 1) [GZLP01]");
        assert_eq!(p.title, "The Legend of Zelda - The Wind Waker");
        assert_eq!(p.region, Some(Region::Pal));
        assert_eq!(p.disc, Some(1));
        assert_eq!(p.serial.as_deref(), Some("GZLP01"));
    }

    #[test]
    fn premiere_region_l_emporte() {
        assert_eq!(parse("Tetris (USA, Europe)").region, Some(Region::NtscU));
        assert_eq!(parse("Puyo Puyo (Japan)").region, Some(Region::NtscJ));
        assert_eq!(parse("Game (World)").region, None);
    }

    #[test]
    fn conventions_goodtools_et_tirets_bas() {
        let p = parse("Super_Mario_World_(U)_[!]");
        assert_eq!(p.title, "Super Mario World");
        assert_eq!(p.region, Some(Region::NtscU));
    }

    #[test]
    fn noms_tapes_a_la_main_en_titre_propre() {
        assert_eq!(parse("joker-poker").title, "Joker Poker");
        assert_eq!(parse("space impakto").title, "Space Impakto");
        assert_eq!(parse("ucity").title, "Ucity");
        assert_eq!(parse("pong-3ds").title, "Pong 3DS");
        assert_eq!(
            parse("legend_of_the_mystical_ninja (usa)").title,
            "Legend of the Mystical Ninja"
        );
        assert_eq!(parse("spider-man 2").title, "Spider-Man 2");
        assert_eq!(parse("super.mario.world").title, "Super Mario World");
    }

    #[test]
    fn noms_deja_en_casse_mixte_inchanges() {
        assert_eq!(parse("Spider-Man (USA)").title, "Spider-Man");
        assert_eq!(parse("Dr. Mario (World)").title, "Dr. Mario");
        assert_eq!(parse("ゼルダの伝説").title, "ゼルダの伝説");
        assert_eq!(parse("1942").title, "1942");
    }

    #[test]
    fn article_francais_elide() {
        assert_eq!(parse("Odyssée d'Abe, L'").title, "L'Odyssée d'Abe");
    }

    #[test]
    fn serie_playstation() {
        assert_eq!(
            parse("Crash (SCES-00344)").serial.as_deref(),
            Some("SCES-00344")
        );
    }

    #[test]
    fn les_langues_ne_sont_pas_des_regions() {
        assert_eq!(parse("Jeu (En,Fr,De)").region, None);
        assert_eq!(parse("Jeu (Été 2003)").serial, None);
    }

    #[test]
    fn nom_simple_sans_etiquette() {
        let p = parse("Lumen Grove");
        assert_eq!(
            p,
            ParsedName {
                title: "Lumen Grove".into(),
                ..Default::default()
            }
        );
    }
}
