//! Correspondance entre un jeu et les noms d'une source (fonctions pures, testées).
//!
//! Règle : n'appliquer automatiquement que ce qui est sûr — nom identique, ou
//! même titre dans une autre région. Tout le reste est proposé à l'utilisateur.

use super::text::fold;
use crate::scanner::{filename, Region};

/// Règle de nommage libretro : `&*/:\`<>?\|"` deviennent `_`.
pub fn libretro_sanitize(name: &str) -> String {
    name.chars().map(|c| if "&*/:`<>?\\|\"".contains(c) { '_' } else { c }).collect()
}

/// Clé de comparaison : titre sans étiquettes, sans accents ni ponctuation,
/// article initial ignoré, « & » ≡ « and ».
pub fn name_key(name: &str) -> String {
    let title = filename::parse(name).title;
    let folded = fold(&title).replace('&', " and ").replace('_', " ");
    let cleaned: String = folded.chars().map(|c| if c.is_alphanumeric() { c } else { ' ' }).collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let words = match words.first() {
        Some(&"the") | Some(&"a") | Some(&"le") | Some(&"la") | Some(&"les") | Some(&"l") => &words[1..],
        _ => &words[..],
    };
    words.join(" ")
}

/// Préférence de variante : région souhaitée, puis « World », puis le reste ;
/// les démos, prototypes et bêtas en dernier.
fn variant_rank(name: &str, pref: Region) -> i32 {
    let lower = name.to_lowercase();
    let mut score = 0;
    let region_words: &[&str] = match pref {
        Region::Pal => &["europe", "france", "(fr", ",fr", "germany", "uk", "pal"],
        Region::NtscU => &["usa", "(us", "america", "canada"],
        Region::NtscJ => &["japan", "(ja"],
    };
    if region_words.iter().any(|w| lower.contains(w)) {
        score += 100;
    } else if lower.contains("world") {
        score += 60;
    } else if lower.contains("usa") || lower.contains("europe") {
        score += 30;
    }
    if pref == Region::Pal && (lower.contains("fr") || lower.contains("france")) {
        score += 10;
    }
    for bad in ["(beta", "(proto", "(demo", "(sample", "(kiosk", "(pirate", "(hack", "(unl"] {
        if lower.contains(bad) {
            score -= 200;
        }
    }
    if lower.contains("(rev") {
        score += 2; // une révision corrige souvent la précédente
    }
    score
}

/// Coefficient de Dice sur les bigrammes (0..1).
pub fn similarity(a: &str, b: &str) -> f32 {
    if a == b {
        return 1.0;
    }
    let bigrams = |s: &str| -> Vec<(char, char)> {
        let chars: Vec<char> = s.chars().filter(|c| !c.is_whitespace()).collect();
        chars.windows(2).map(|w| (w[0], w[1])).collect()
    };
    let (x, mut y) = (bigrams(a), bigrams(b));
    if x.is_empty() || y.is_empty() {
        return 0.0;
    }
    let total = x.len() + y.len();
    let mut common = 0;
    for bg in &x {
        if let Some(i) = y.iter().position(|o| o == bg) {
            y.swap_remove(i);
            common += 1;
        }
    }
    (2 * common) as f32 / total as f32
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// Sûr : appliqué automatiquement.
    Auto { name: String, confidence: f32 },
    /// Incertain : propositions à faire valider (meilleures d'abord).
    Choose(Vec<(String, f32)>),
    None,
}

/// `stem` : nom du fichier du jeu (souvent un nom No-Intro / Redump) ;
/// `title` : titre affiché (éventuellement corrigé par l'utilisateur).
pub fn decide(stem: &str, title: &str, pref: Region, names: &[String]) -> Decision {
    // 1. Nom identique (règle de nommage libretro appliquée)
    let sanitized = libretro_sanitize(stem);
    if let Some(n) = names.iter().find(|n| **n == sanitized || n.eq_ignore_ascii_case(&sanitized)) {
        return Decision::Auto { name: n.clone(), confidence: 1.0 };
    }

    // 2. Même titre, autre variante : la région préférée l'emporte
    let keys = [name_key(title), name_key(stem)];
    let mut same: Vec<&String> = names.iter().filter(|n| keys.contains(&name_key(n))).collect();
    if !same.is_empty() {
        same.sort_by_key(|n| (-variant_rank(n, pref), n.len()));
        return Decision::Auto { name: same[0].clone(), confidence: 0.9 };
    }

    // 3. Titres approchants : à confirmer par l'utilisateur
    let key = &keys[0];
    let mut scored: Vec<(String, f32)> = names
        .iter()
        .map(|n| (n.clone(), similarity(key, &name_key(n))))
        .filter(|(_, s)| *s >= 0.55)
        .collect();
    // à ressemblance égale, la région préférée d'abord
    scored.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| variant_rank(&b.0, pref).cmp(&variant_rank(&a.0, pref)))
    });
    scored.truncate(12);
    if scored.is_empty() { Decision::None } else { Decision::Choose(scored) }
}

/// Toutes les variantes d'un même titre (pour réutiliser le nom retenu sur
/// les autres types d'images : écran-titre, captures, logo).
pub fn best_variant<'a>(chosen: &str, pref: Region, names: &'a [String]) -> Option<&'a String> {
    if let Some(exact) = names.iter().find(|n| *n == chosen) {
        return Some(exact);
    }
    let key = name_key(chosen);
    let mut same: Vec<&String> = names.iter().filter(|n| name_key(n) == key).collect();
    same.sort_by_key(|n| (-variant_rank(n, pref), n.len()));
    same.first().copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    const INDEX: &[&str] = &[
        "Legend of Zelda, The - The Wind Waker (Europe) (En,Fr,De,Es,It)",
        "Legend of Zelda, The - The Wind Waker (USA)",
        "Legend of Zelda, The - The Wind Waker (Japan)",
        "Legend of Zelda, The - Twilight Princess (Europe) (En,Fr,De,Es,It)",
        "Super Mario Sunshine (Europe) (En,Fr,De,Es,It)",
        "Super Mario Sunshine (USA) (Demo)",
        "Q_bert's Qubes (USA)",
    ];

    #[test]
    fn nom_identique_avec_caracteres_interdits() {
        let d = decide("Q*bert's Qubes (USA)", "Q*bert's Qubes", Region::Pal, &names(INDEX));
        assert_eq!(d, Decision::Auto { name: "Q_bert's Qubes (USA)".into(), confidence: 1.0 });
    }

    #[test]
    fn meme_titre_region_preferee() {
        let idx = names(INDEX);
        match decide("Zelda WW", "The Legend of Zelda - The Wind Waker", Region::Pal, &idx) {
            Decision::Auto { name, .. } => assert!(name.contains("(Europe)")),
            other => panic!("{other:?}"),
        }
        match decide("Zelda WW", "The Legend of Zelda - The Wind Waker", Region::NtscJ, &idx) {
            Decision::Auto { name, .. } => assert!(name.contains("(Japan)")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn les_demos_passent_apres_les_versions_completes() {
        match decide("x", "Super Mario Sunshine", Region::NtscU, &names(INDEX)) {
            Decision::Auto { name, .. } => assert!(!name.contains("Demo"), "{name}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn titre_approchant_jamais_applique_seul() {
        match decide("Zelda Wind Waker", "Zelda Wind Waker", Region::Pal, &names(INDEX)) {
            Decision::Choose(list) => assert!(list[0].0.contains("Wind Waker"), "{list:?}"),
            other => panic!("{other:?}"),
        }
        match decide("Zelda Wind Waker", "Zelda Wind Waker", Region::NtscU, &names(INDEX)) {
            Decision::Choose(list) => assert!(list[0].0.contains("(USA)"), "{list:?}"),
            other => panic!("{other:?}"),
        }
        assert_eq!(decide("Pikmin", "Pikmin", Region::Pal, &names(INDEX)), Decision::None);
    }

    #[test]
    fn cles_de_comparaison() {
        assert_eq!(name_key("Legend of Zelda, The - The Wind Waker (USA)"), "legend of zelda the wind waker");
        assert_eq!(name_key("Pokémon - Version Émeraude (France)"), "pokemon version emeraude");
        assert_eq!(name_key("Ratchet & Clank"), name_key("Ratchet and Clank"));
        assert!(similarity("zelda wind waker", "legend of zelda the wind waker") > 0.55);
    }

    #[test]
    fn variante_pour_les_autres_images() {
        let idx = names(&["Super Mario Sunshine (USA)", "Super Mario Sunshine (Europe) (En,Fr,De,Es,It)"]);
        assert_eq!(
            best_variant("Super Mario Sunshine (Europe) (En,Fr,De,Es,It)", Region::NtscU, &idx).unwrap(),
            "Super Mario Sunshine (Europe) (En,Fr,De,Es,It)"
        );
        assert_eq!(best_variant("Super Mario Sunshine (Japan)", Region::NtscU, &idx).unwrap(), "Super Mario Sunshine (USA)");
    }
}
