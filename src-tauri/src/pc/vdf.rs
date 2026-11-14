//! Lecture du format texte « KeyValues » de Valve (fichiers .vdf / .acf de
//! Steam) : des paires « clé » « valeur » et des blocs { … }. Lecture seule,
//! tolérante : une erreur de syntaxe arrête la lecture sans planter.

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Str(String),
    Obj(Vec<(String, Value)>),
}

impl Value {
    /// Enfant par clé (sans tenir compte de la casse, comme Steam).
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Obj(items) => items.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            Value::Str(_) => None,
        }
    }

    /// Chemin de clés : `v.path(&["AppState", "name"])`.
    pub fn path(&self, keys: &[&str]) -> Option<&Value> {
        keys.iter().try_fold(self, |v, k| v.get(k))
    }

    pub fn str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            Value::Obj(_) => None,
        }
    }

    pub fn entries(&self) -> &[(String, Value)] {
        match self {
            Value::Obj(items) => items,
            Value::Str(_) => &[],
        }
    }
}

/// Analyse un document : renvoie le bloc racine (toutes les paires de premier niveau).
pub fn parse(text: &str) -> Value {
    let mut chars = text.chars().peekable();
    Value::Obj(parse_block(&mut chars, 0))
}

type It<'a> = std::iter::Peekable<std::str::Chars<'a>>;

fn parse_block(it: &mut It, depth: usize) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if depth > 64 {
        return out;
    }
    loop {
        let Some(key) = token(it) else { return out };
        match key {
            Token::Close => return out,
            Token::Open => continue, // accolade isolée : ignorée
            Token::Text(k) => match token(it) {
                Some(Token::Text(v)) => out.push((k, Value::Str(v))),
                Some(Token::Open) => out.push((k, Value::Obj(parse_block(it, depth + 1)))),
                _ => return out,
            },
        }
    }
}

enum Token {
    Text(String),
    Open,
    Close,
}

fn token(it: &mut It) -> Option<Token> {
    loop {
        let c = *it.peek()?;
        if c.is_whitespace() {
            it.next();
        } else if c == '/' {
            // commentaire « // … »
            it.next();
            if it.peek() == Some(&'/') {
                for c in it.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
        } else {
            break;
        }
    }
    match it.next()? {
        '{' => Some(Token::Open),
        '}' => Some(Token::Close),
        '"' => {
            let mut s = String::new();
            while let Some(c) = it.next() {
                match c {
                    '"' => break,
                    '\\' => match it.next() {
                        Some('n') => s.push('\n'),
                        Some('t') => s.push('\t'),
                        Some(other) => s.push(other),
                        None => break,
                    },
                    _ => s.push(c),
                }
            }
            Some(Token::Text(s))
        }
        first => {
            // valeur sans guillemets (rare)
            let mut s = String::from(first);
            while let Some(&c) = it.peek() {
                if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                    break;
                }
                s.push(c);
                it.next();
            }
            Some(Token::Text(s))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifeste_steam() {
        let v = parse(
            r#""AppState"
{
	"appid"		"1966720"
	"name"		"Lethal Company"
	"StateFlags"		"4"
	"installdir"		"Lethal Company"
	"InstalledDepots"
	{
		"1966721" { "manifest" "123" }
	}
}"#,
        );
        assert_eq!(v.path(&["AppState", "name"]).and_then(Value::str), Some("Lethal Company"));
        assert_eq!(v.path(&["appstate", "stateflags"]).and_then(Value::str), Some("4"));
        assert_eq!(v.path(&["AppState", "InstalledDepots", "1966721", "manifest"]).and_then(Value::str), Some("123"));
    }

    #[test]
    fn echappements_et_dossiers() {
        let v = parse("\"libraryfolders\" { \"0\" { \"path\" \"C:\\\\Program Files (x86)\\\\Steam\" } // note\n \"1\" { \"path\" \"G:\\\\SteamLibrary\" } }");
        let paths: Vec<_> = v.get("libraryfolders").unwrap().entries().iter().filter_map(|(_, f)| f.get("path").and_then(Value::str)).collect();
        assert_eq!(paths, vec!["C:\\Program Files (x86)\\Steam", "G:\\SteamLibrary"]);
    }

    #[test]
    fn document_tronque_sans_plantage() {
        let v = parse("\"a\" { \"b\" \"c\" \"d\" { \"e\"");
        assert_eq!(v.path(&["a", "b"]).and_then(Value::str), Some("c"));
    }
}
