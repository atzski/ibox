//! Dossiers de jeux proposés d'un seul bouton (docs/HANDHELD.md) : ajouter un dossier passe sinon
//! par le sélecteur de fichiers du système, qui ne se pilote pas à la manette (Mode Jeu du Steam
//! Deck, consoles portables Windows). On propose les emplacements usuels qui existent et
//! contiennent quelque chose : EmuDeck (`Emulation/roms`, aussi sur carte SD), RetroDECK
//! (`retrodeck/roms`), et les dossiers `ROMs` à la racine d'un disque ou du dossier personnel.
//! Lecture seule : rien n'est créé ni ajouté sans que l'utilisateur le choisisse.

use std::path::{Path, PathBuf};

/// Sous-dossiers cherchés dans chaque racine (dossier personnel, carte SD, disque).
const UNDER_ROOT: [&str; 5] = ["Emulation/roms", "retrodeck/roms", "ROMs", "roms", "Documents/ROMs"];

/// Racines où chercher : dossier personnel, puis supports amovibles (Linux) ou disques (Windows).
pub fn roots() -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            out.push(PathBuf::from(home));
        }
        for letter in b'C'..=b'Z' {
            let root = PathBuf::from(format!("{}:\\", letter as char));
            if root.is_dir() {
                out.push(root);
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            out.push(PathBuf::from(home));
        }
        // SteamOS monte la carte SD dans /run/media/<utilisateur>/<étiquette> (anciennes versions :
        // /run/media/<étiquette>) ; les autres distributions aussi, ou sous /media
        for base in ["/run/media", "/media"] {
            for level1 in read_dirs(Path::new(base)) {
                out.push(level1.clone());
                out.extend(read_dirs(&level1));
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn read_dirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|d| d.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

fn has_entries(dir: &Path) -> bool {
    std::fs::read_dir(dir).is_ok_and(|mut d| d.next().is_some())
}

/// Même dossier ? (sans casse sous Windows, séparateurs indifférents)
fn same(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let s = s.trim_end_matches(['/', '\\']).replace('\\', "/");
        if cfg!(windows) { s.to_lowercase() } else { s }
    };
    norm(a) == norm(b)
}

/// Emplacements usuels présents sous `roots`, non vides, pas encore dans la collection.
/// Un dossier déjà couvert par un dossier de la collection (parent) n'est pas proposé non plus.
pub fn suggestions(roots: &[PathBuf], known: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for root in roots {
        for rel in UNDER_ROOT {
            let dir = root.join(rel);
            if !dir.is_dir() || !has_entries(&dir) {
                continue;
            }
            let path = dir.to_string_lossy().to_string();
            let covered = known.iter().any(|k| same(k, &path) || Path::new(&path).starts_with(k));
            if !covered && !out.iter().any(|o| same(o, &path)) {
                out.push(path);
            }
        }
    }
    out.truncate(8);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emplacements_usuels_seulement_s_ils_existent_et_ne_sont_pas_vides() {
        let tmp = std::env::temp_dir().join(format!("ibox-suggest-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let home = tmp.join("home");
        let sd = tmp.join("sd");
        std::fs::create_dir_all(home.join("Emulation/roms/psx")).unwrap();
        std::fs::create_dir_all(home.join("ROMs")).unwrap(); // vide : pas proposé
        std::fs::create_dir_all(sd.join("retrodeck/roms/gba")).unwrap();
        let roots = vec![home.clone(), sd.clone()];
        let found = suggestions(&roots, &[]);
        assert_eq!(found, vec![home.join("Emulation/roms").to_string_lossy().to_string(), sd.join("retrodeck/roms").to_string_lossy().to_string()]);
        // déjà dans la collection, ou couvert par un dossier parent : écarté
        let known = vec![home.join("Emulation").to_string_lossy().to_string()];
        assert_eq!(suggestions(&roots, &known), vec![sd.join("retrodeck/roms").to_string_lossy().to_string()]);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
