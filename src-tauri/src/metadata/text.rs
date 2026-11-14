//! Petits outils de lecture XML / DAT (formats simples et connus, lus sans
//! dépendance lourde) et normalisation de texte.

/// Contenu texte du premier `<tag>…</tag>` (ou None ; `<tag/>` vide → None).
pub fn tag<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&format!("</{name}>"))? + start;
    let v = xml[start..end].trim();
    (!v.is_empty()).then_some(v)
}

/// Valeur d'un attribut dans la première balise `<name …>`.
pub fn attr<'a>(xml: &'a str, name: &str, attribute: &str) -> Option<&'a str> {
    let start = xml.find(&format!("<{name} "))?;
    let end = xml[start..].find('>')? + start;
    let head = &xml[start..end];
    let key = format!("{attribute}=\"");
    let a = head.find(&key)? + key.len();
    let b = head[a..].find('"')? + a;
    Some(&head[a..b])
}

/// Bloc `<locale lang="XX">…</locale>`.
pub fn locale<'a>(xml: &'a str, lang: &str) -> Option<&'a str> {
    let open = format!("<locale lang=\"{lang}\">");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find("</locale>")? + start;
    Some(&xml[start..end])
}

/// Entités XML usuelles et numériques.
pub fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let Some(semi) = tail.find(';').filter(|&n| n <= 10) else {
            out.push('&');
            rest = &tail[1..];
            continue;
        };
        let ent = &tail[1..semi];
        let decoded = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &tail[semi + 1..];
            }
            None => {
                out.push('&');
                rest = &tail[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Valeur suivant `key` dans un bloc DAT clrmamepro : `key "texte"` ou `key 2`.
pub fn dat_value<'a>(block: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\t{key} ");
    let alt = format!("\n{key} ");
    let start = block.find(&needle).map(|i| i + needle.len()).or_else(|| block.find(&alt).map(|i| i + alt.len()))?;
    let rest = &block[start..];
    if let Some(quoted) = rest.strip_prefix('"') {
        let end = quoted.find('"')?;
        Some(&quoted[..end])
    } else {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        (end > 0).then(|| &rest[..end])
    }
}

/// Valeur CRC dans `rom ( crc XXXXXXXX … )`.
pub fn dat_crc(block: &str) -> Option<String> {
    let i = block.find("crc ")? + 4;
    let v: String = block[i..].chars().take_while(|c| c.is_ascii_hexdigit()).collect();
    (v.len() == 8).then(|| v.to_ascii_uppercase())
}

/// Minuscules, sans accents courants.
pub fn fold(s: &str) -> String {
    s.chars()
        .flat_map(|c| c.to_lowercase())
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' => 'e',
            'ì' | 'í' | 'î' | 'ï' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'ō' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
            'ý' | 'ÿ' => 'y',
            other => other,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAME: &str = r#"<game name="X">
        <id>GZLP01</id>
        <type>GameCube</type>
        <locale lang="EN"><title>The Legend of Zelda</title><synopsis>Link &amp; friends</synopsis></locale>
        <locale lang="FR"><title>Zelda : The Wind Waker</title><synopsis/></locale>
        <date year="2003" month="5" day="2"/>
        <input players="1"/>
    </game>"#;

    #[test]
    fn lecture_xml_gametdb() {
        assert_eq!(tag(GAME, "id"), Some("GZLP01"));
        assert_eq!(attr(GAME, "date", "year"), Some("2003"));
        assert_eq!(attr(GAME, "input", "players"), Some("1"));
        let fr = locale(GAME, "FR").unwrap();
        assert_eq!(tag(fr, "title"), Some("Zelda : The Wind Waker"));
        assert_eq!(tag(fr, "synopsis"), None);
        assert_eq!(unescape(tag(locale(GAME, "EN").unwrap(), "synopsis").unwrap()), "Link & friends");
    }

    #[test]
    fn entites() {
        assert_eq!(unescape("A &lt;B&gt; &#233;t&#xE9; &unknown; R&D"), "A <B> été &unknown; R&D");
    }

    #[test]
    fn lecture_dat() {
        let block = "game (\n\tcomment \"Tetris (World)\"\n\treleaseyear \"1989\"\n\tusers 2\n\trom ( crc 46df91ad )\n)";
        assert_eq!(dat_value(block, "comment"), Some("Tetris (World)"));
        assert_eq!(dat_value(block, "releaseyear"), Some("1989"));
        assert_eq!(dat_value(block, "users"), Some("2"));
        assert_eq!(dat_value(block, "developer"), None);
        assert_eq!(dat_crc(block).as_deref(), Some("46DF91AD"));
    }

    #[test]
    fn pliage() {
        assert_eq!(fold("Pokémon Émeraude"), "pokemon emeraude");
    }
}
