//! « Ajouter iBox à Steam » (Steam Deck, docs/STEAMDECK.md §8 et §12 D5) : iBox devient un jeu
//! non-Steam, lançable depuis le Mode Jeu.
//!
//! Steam range ces raccourcis dans `userdata/<compte>/config/shortcuts.vdf`, au format KeyValues
//! **binaire** (types : `0x00` bloc, `0x01` texte, `0x02` entier 32 bits, `0x08` fin de bloc ;
//! `0x03` réel et `0x07` entier 64 bits conservés tels quels). Le fichier est relu en entier, le
//! raccourci ajouté à la fin, l'original sauvegardé (`shortcuts.vdf.ibox-backup`), puis l'écriture
//! est atomique. Steam doit être fermé : il réécrit ce fichier en quittant.
//! Identifiant du raccourci (illustrations de la bibliothèque) : CRC-32 de `Exe` + `AppName`,
//! bit de poids fort forcé, comme Steam et Steam ROM Manager.
//!
//! Illustrations (`assets/steam/`, composées aux couleurs d'iBox) copiées dans
//! `userdata/<compte>/config/grid/` sous les noms que Steam lit : `<id>p` (grille 600×900),
//! `<id>` (capsule 920×430), `<id>_hero` (1920×620), `<id>_logo` (transparent), `<id>_icon`.
//! Grille et capsule portent un sous-titre : version française ou anglaise selon la langue d'iBox.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq)]
pub enum BVal {
    Map(Vec<(String, BVal)>),
    Str(String),
    Int(u32),
    /// Réel (`0x03`) ou entier 64 bits (`0x07`) : octets conservés.
    Raw(u8, Vec<u8>),
}

fn read_cstr(b: &[u8], at: &mut usize) -> Result<String, String> {
    let end = b[*at..].iter().position(|&c| c == 0).ok_or("texte non terminé")?;
    let s = String::from_utf8_lossy(&b[*at..*at + end]).into_owned();
    *at += end + 1;
    Ok(s)
}

fn read_map(b: &[u8], at: &mut usize) -> Result<Vec<(String, BVal)>, String> {
    let mut out = Vec::new();
    loop {
        let t = *b.get(*at).ok_or("fin de fichier inattendue")?;
        *at += 1;
        if t == 0x08 {
            return Ok(out);
        }
        let key = read_cstr(b, at)?;
        let v = match t {
            0x00 => BVal::Map(read_map(b, at)?),
            0x01 => BVal::Str(read_cstr(b, at)?),
            0x02 | 0x03 => {
                let raw: [u8; 4] = b.get(*at..*at + 4).ok_or("entier tronqué")?.try_into().unwrap();
                *at += 4;
                if t == 0x02 { BVal::Int(u32::from_le_bytes(raw)) } else { BVal::Raw(t, raw.to_vec()) }
            }
            0x07 => {
                let raw = b.get(*at..*at + 8).ok_or("entier 64 bits tronqué")?.to_vec();
                *at += 8;
                BVal::Raw(t, raw)
            }
            other => return Err(format!("type inconnu 0x{other:02x} : fichier non modifié")),
        };
        out.push((key, v));
    }
}

/// Lit un fichier KeyValues binaire (bloc racine compris).
pub fn parse(b: &[u8]) -> Result<Vec<(String, BVal)>, String> {
    let mut at = 0;
    let root = read_map(b, &mut at)?;
    if at != b.len() {
        return Err("données après la fin du fichier".into());
    }
    Ok(root)
}

fn write_map(items: &[(String, BVal)], out: &mut Vec<u8>) {
    for (k, v) in items {
        let key = |out: &mut Vec<u8>, t: u8| {
            out.push(t);
            out.extend_from_slice(k.as_bytes());
            out.push(0);
        };
        match v {
            BVal::Map(m) => {
                key(out, 0x00);
                write_map(m, out);
            }
            BVal::Str(s) => {
                key(out, 0x01);
                out.extend_from_slice(s.as_bytes());
                out.push(0);
            }
            BVal::Int(i) => {
                key(out, 0x02);
                out.extend_from_slice(&i.to_le_bytes());
            }
            BVal::Raw(t, raw) => {
                key(out, *t);
                out.extend_from_slice(raw);
            }
        }
    }
    out.push(0x08);
}

pub fn write(root: &[(String, BVal)]) -> Vec<u8> {
    let mut out = Vec::new();
    write_map(root, &mut out);
    out
}

/// Identifiant du raccourci (nom des illustrations `grid/<id>p.png`…).
pub fn shortcut_id(exe: &str, name: &str) -> u32 {
    crc32fast::hash(format!("{exe}{name}").as_bytes()) | 0x8000_0000
}

/// Chemin entre guillemets, comme Steam l'enregistre.
fn quoted(p: &str) -> String {
    format!("\"{p}\"")
}

fn s(k: &str, v: &str) -> (String, BVal) {
    (k.into(), BVal::Str(v.into()))
}
fn i(k: &str, v: u32) -> (String, BVal) {
    (k.into(), BVal::Int(v))
}

/// Entrée de raccourci telle que Steam l'écrit lui-même.
pub fn entry(name: &str, exe: &str, icon: &str) -> BVal {
    let exe_q = quoted(exe);
    let dir = Path::new(exe).parent().map(|d| quoted(&d.to_string_lossy())).unwrap_or_default();
    BVal::Map(vec![
        i("appid", shortcut_id(&exe_q, name)),
        s("AppName", name),
        s("Exe", &exe_q),
        s("StartDir", &dir),
        s("icon", icon),
        s("ShortcutPath", ""),
        s("LaunchOptions", ""),
        i("IsHidden", 0),
        i("AllowDesktopConfig", 1),
        i("AllowOverlay", 1),
        i("OpenVR", 0),
        i("Devkit", 0),
        s("DevkitGameID", ""),
        i("DevkitOverrideAppID", 0),
        i("LastPlayTime", 0),
        s("FlatpakAppID", ""),
        ("tags".into(), BVal::Map(Vec::new())),
    ])
}

/// Illustrations embarquées pour une langue (`fr` par défaut, `en`) : (suffixe du nom de fichier
/// Steam, contenu).
#[cfg(any(target_os = "linux", test))]
pub fn artwork(lang: &str) -> [(&'static str, &'static [u8]); 5] {
    let english = lang.eq_ignore_ascii_case("en");
    [
        ("p.jpg", if english { include_bytes!("../../assets/steam/portrait_en.jpg") } else { include_bytes!("../../assets/steam/portrait.jpg") }),
        (".jpg", if english { include_bytes!("../../assets/steam/wide_en.jpg") } else { include_bytes!("../../assets/steam/wide.jpg") }),
        ("_hero.jpg", include_bytes!("../../assets/steam/hero.jpg")),
        ("_logo.png", include_bytes!("../../assets/steam/logo.png")),
        ("_icon.png", include_bytes!("../../assets/steam/icon.png")),
    ]
}

/// Copie les illustrations dans `grid/` (remplace celles d'iBox, jamais celles d'un autre jeu).
/// Renvoie le chemin de l'icône, à inscrire dans le raccourci.
#[cfg(any(target_os = "linux", test))]
pub fn write_artwork(grid: &Path, id: u32, lang: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(grid).map_err(|e| format!("dossier des illustrations Steam : {e}"))?;
    let mut icon = PathBuf::new();
    for (suffix, bytes) in artwork(lang) {
        let path = grid.join(format!("{id}{suffix}"));
        std::fs::write(&path, bytes).map_err(|e| format!("illustration Steam : {e}"))?;
        if suffix == "_icon.png" {
            icon = path;
        }
    }
    Ok(icon)
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    /// `false` : un raccourci vers ce même programme existait déjà (seule son icône manquante est
    /// complétée).
    pub added: bool,
    pub shortcut_id: u32,
    pub file: String,
}

/// Ajoute iBox aux raccourcis de `file` (créé s'il manque). Sauvegarde puis écriture atomique.
pub fn add_to(file: &Path, name: &str, exe: &str, icon: &str) -> Result<Added, String> {
    let exe_q = quoted(exe);
    let id = shortcut_id(&exe_q, name);
    let existing = match std::fs::read(file) {
        Ok(b) => Some(b),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("raccourcis Steam illisibles : {e}")),
    };
    let mut root = match &existing {
        Some(b) => parse(b)?,
        None => vec![("shortcuts".into(), BVal::Map(Vec::new()))],
    };
    let Some((_, BVal::Map(list))) = root.iter_mut().find(|(k, _)| k.eq_ignore_ascii_case("shortcuts")) else {
        return Err("raccourcis Steam : bloc « shortcuts » absent, fichier non modifié".into());
    };
    let same = list.iter_mut().find_map(|(_, e)| match e {
        BVal::Map(f) if f.iter().any(|(k, v)| k.eq_ignore_ascii_case("Exe") && *v == BVal::Str(exe_q.clone())) => Some(f),
        _ => None,
    });
    let file_s = file.to_string_lossy().into_owned();
    let added = match same {
        Some(fields) => {
            // raccourci déjà là (ajouté avant les illustrations) : seule une icône vide est complétée
            let empty = fields.iter_mut().find(|(k, v)| k.eq_ignore_ascii_case("icon") && *v == BVal::Str(String::new()));
            match empty {
                Some((_, v)) if !icon.is_empty() => *v = BVal::Str(icon.into()),
                _ => return Ok(Added { added: false, shortcut_id: id, file: file_s }),
            }
            false
        }
        None => {
            list.push((list.len().to_string(), entry(name, exe, icon)));
            true
        }
    };
    let bytes = write(&root);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if let Some(old) = &existing {
        std::fs::write(file.with_extension("vdf.ibox-backup"), old).map_err(|e| format!("sauvegarde impossible : {e}"))?;
    }
    let tmp = file.with_extension("vdf.ibox-tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())?;
    Ok(Added { added, shortcut_id: id, file: file_s })
}

/// Steam tourne-t-il ? (Linux : nom de processus `steam` dans `/proc`.)
pub fn steam_running() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::fs::read_dir("/proc").into_iter().flatten().flatten().any(|e| {
            e.file_name().to_string_lossy().bytes().all(|b| b.is_ascii_digit())
                && std::fs::read_to_string(e.path().join("comm")).is_ok_and(|c| c.trim() == "steam")
        })
    }
    #[cfg(not(target_os = "linux"))]
    {
        false
    }
}

/// Fichier de raccourcis du compte Steam de cet appareil (dernier connecté).
pub fn shortcuts_file(root: &Path) -> Option<PathBuf> {
    let id64: u64 = super::steam::account(root, &[])?.parse().ok()?;
    let account = id64.checked_sub(76_561_197_960_265_728)?;
    Some(root.join("userdata").join(account.to_string()).join("config").join("shortcuts.vdf"))
}

/// Ajoute iBox à Steam pour le compte de cet appareil (Linux, AppImage).
#[tauri::command]
pub async fn steam_add_ibox(lang: Option<String>) -> Result<Added, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = &lang; // utilisée sous Linux seulement
        if !cfg!(target_os = "linux") {
            return Err("« Ajouter à Steam » sert à la version Steam Deck.".into());
        }
        // chemin réel de l'AppImage (le programme lui-même tourne depuis une image montée)
        let exe = std::env::var("APPIMAGE").ok().filter(|p| Path::new(p).is_file()).ok_or("iBox ne tourne pas depuis son AppImage : ajout impossible.")?;
        if steam_running() {
            return Err("Fermez d'abord Steam (Mode Bureau : menu Steam › Quitter) : il réécrit ses raccourcis en quittant.".into());
        }
        let root = super::steam::root().ok_or("Steam est introuvable sur cet appareil.")?;
        let file = shortcuts_file(&root).ok_or("Compte Steam introuvable : lancez Steam et connectez-vous une fois.")?;
        #[cfg(target_os = "linux")]
        {
            let grid = file.parent().map(|d| d.join("grid")).ok_or("dossier Steam invalide")?;
            let icon = write_artwork(&grid, shortcut_id(&format!("\"{exe}\""), "iBox"), lang.as_deref().unwrap_or("fr"))?;
            add_to(&file, "iBox", &exe, &icon.to_string_lossy())
        }
        #[cfg(not(target_os = "linux"))]
        add_to(&file, "iBox", &exe, "")
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Raccourci écrit par Steam lui-même (structure réelle, valeurs d'exemple).
    fn steam_file() -> Vec<u8> {
        write(&[("shortcuts".into(), BVal::Map(vec![("0".into(), BVal::Map(vec![
            i("appid", 0x9234_5678),
            s("AppName", "Lutris"),
            s("Exe", "\"/usr/bin/lutris\""),
            ("LastPlayTime".into(), BVal::Int(1_700_000_000)),
            ("Weight".into(), BVal::Raw(0x03, 1.5f32.to_le_bytes().to_vec())),
            ("Big".into(), BVal::Raw(0x07, 42u64.to_le_bytes().to_vec())),
            ("tags".into(), BVal::Map(vec![s("0", "favorite")])),
        ]))]))])
    }

    #[test]
    fn format_binaire_aller_retour_a_l_octet() {
        let bytes = steam_file();
        assert_eq!(&bytes[..11], b"\x00shortcuts\x00");
        assert_eq!(*bytes.last().unwrap(), 0x08);
        assert_eq!(write(&parse(&bytes).unwrap()), bytes, "relu puis réécrit à l'identique");
        assert!(parse(&bytes[..bytes.len() - 1]).is_err(), "fichier tronqué refusé");
        let mut odd = bytes.clone();
        odd[0] = 0x0b;
        assert!(parse(&odd).unwrap_err().contains("non modifié"));
    }

    #[test]
    fn identifiant_du_raccourci() {
        let id = shortcut_id("\"/home/deck/Applications/iBox.AppImage\"", "iBox");
        assert!(id & 0x8000_0000 != 0);
        assert_eq!(id, crc32fast::hash(b"\"/home/deck/Applications/iBox.AppImage\"iBox") | 0x8000_0000);
    }

    #[test]
    fn ajout_conserve_les_raccourcis_existants() {
        let t = tempfile::tempdir().unwrap();
        let file = t.path().join("userdata/123/config/shortcuts.vdf");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, steam_file()).unwrap();
        let exe = "/home/deck/Applications/iBox.AppImage";
        let r = add_to(&file, "iBox", exe, "").unwrap();
        assert!(r.added);
        let root = parse(&std::fs::read(&file).unwrap()).unwrap();
        let BVal::Map(list) = &root[0].1 else { panic!() };
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].1, parse(&steam_file()).unwrap().remove(0).1.clone().as_map_entry(0), "Lutris intact");
        let BVal::Map(ibox) = &list[1].1 else { panic!() };
        assert_eq!(list[1].0, "1");
        assert!(ibox.contains(&s("Exe", "\"/home/deck/Applications/iBox.AppImage\"")));
        assert!(ibox.contains(&s("StartDir", "\"/home/deck/Applications\"")));
        assert!(ibox.contains(&i("appid", r.shortcut_id)));
        assert_eq!(std::fs::read(file.with_extension("vdf.ibox-backup")).unwrap(), steam_file(), "original sauvegardé");
        // second ajout : rien n'est réécrit
        let again = add_to(&file, "iBox", exe, "").unwrap();
        assert!(!again.added && again.shortcut_id == r.shortcut_id);
        // aucun fichier : créé avec le seul raccourci d'iBox
        let fresh = t.path().join("userdata/456/config/shortcuts.vdf");
        assert!(add_to(&fresh, "iBox", exe, "").unwrap().added);
        assert_eq!(parse(&std::fs::read(&fresh).unwrap()).unwrap()[0].0, "shortcuts");
    }

    impl BVal {
        fn as_map_entry(self, n: usize) -> BVal {
            match self {
                BVal::Map(mut m) => m.remove(n).1,
                other => other,
            }
        }
    }

    #[test]
    fn illustrations_et_icone() {
        let t = tempfile::tempdir().unwrap();
        let grid = t.path().join("config/grid");
        let id = shortcut_id("\"/home/deck/iBox.AppImage\"", "iBox");
        let icon = write_artwork(&grid, id, "fr").unwrap();
        for name in [format!("{id}p.jpg"), format!("{id}.jpg"), format!("{id}_hero.jpg"), format!("{id}_logo.png"), format!("{id}_icon.png")] {
            assert!(grid.join(&name).metadata().unwrap().len() > 1000, "{name}");
        }
        assert_eq!(icon, grid.join(format!("{id}_icon.png")));
        // formats réels : JPEG pour les fonds, PNG (transparence) pour le logo et l'icône
        let (fr, en) = (artwork("fr"), artwork("en"));
        assert_eq!(&fr[0].1[..3], &[0xFF, 0xD8, 0xFF]);
        assert_eq!(&fr[3].1[..4], &[0x89, b'P', b'N', b'G']);
        // grille et capsule traduites ; héros, logo et icône communs
        assert_eq!(std::fs::read(grid.join(format!("{id}p.jpg"))).unwrap(), fr[0].1);
        assert!(fr[0].1 != en[0].1 && fr[1].1 != en[1].1);
        assert!(fr[2].1 == en[2].1 && fr[3].1 == en[3].1 && fr[4].1 == en[4].1);
        assert_eq!(artwork("EN")[0].1, en[0].1);
        write_artwork(&grid, id, "en").unwrap();
        assert_eq!(std::fs::read(grid.join(format!("{id}.jpg"))).unwrap(), en[1].1, "relancer en anglais remplace les illustrations");

        // raccourci ajouté avant les illustrations : l'icône vide est complétée, une seule fois
        let file = t.path().join("config/shortcuts.vdf");
        add_to(&file, "iBox", "/home/deck/iBox.AppImage", "").unwrap();
        let r = add_to(&file, "iBox", "/home/deck/iBox.AppImage", &icon.to_string_lossy()).unwrap();
        assert!(!r.added);
        let root = parse(&std::fs::read(&file).unwrap()).unwrap();
        let BVal::Map(list) = &root[0].1 else { panic!() };
        let BVal::Map(e) = &list[0].1 else { panic!() };
        assert_eq!(list.len(), 1);
        assert!(e.contains(&s("icon", &icon.to_string_lossy())));
    }

    #[test]
    fn compte_steam_du_deck() {
        let t = tempfile::tempdir().unwrap();
        let cfg = t.path().join("config");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::write(cfg.join("loginusers.vdf"), "\"users\"\n{\n\t\"76561198988343648\"\n\t{\n\t\t\"MostRecent\"\t\t\"1\"\n\t}\n}\n").unwrap();
        assert_eq!(shortcuts_file(t.path()).unwrap(), t.path().join("userdata/1028077920/config/shortcuts.vdf"));
    }
}
