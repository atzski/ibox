//! Parcours des dossiers choisis — strictement en lecture seule.
//!
//! - ignore les dossiers cachés et système ;
//! - ne suit pas les liens symboliques (pas de boucles, pas de sortie du dossier) ;
//! - regroupe les jeux multi-fichiers : une .cue et ses pistes .bin, une
//!   playlist .m3u et ses disques ne forment qu'un seul jeu.

use super::formats;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, PartialEq)]
pub struct FoundFile {
    pub path: PathBuf,
    pub size: u64,
    /// Secondes Unix.
    pub modified: Option<i64>,
}

/// Un jeu potentiel : fichier principal + fichiers rattachés.
#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub main: FoundFile,
    pub parts: Vec<FoundFile>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WalkError {
    pub path: PathBuf,
    pub message: String,
}

const IGNORED_DIRS: [&str; 8] = [
    "$recycle.bin",
    "system volume information",
    "__macosx",
    "node_modules",
    "__pycache__",
    "site-packages",
    // données internes d'un jeu Switch extrait (son exefs/main, lui, est lu)
    "romfs",
    "cache",
];
/// Taille maximale lue pour une .cue ou une .m3u (ce sont de petits fichiers texte).
const MAX_SHEET_BYTES: u64 = 256 * 1024;

pub fn collect(root: &Path, recursive: bool) -> (Vec<FoundFile>, Vec<WalkError>) {
    let mut files = Vec::new();
    let mut errors = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .max_depth(if recursive { usize::MAX } else { 1 })
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            e.depth() == 0
                || !(name.starts_with('.')
                    || (e.file_type().is_dir() && IGNORED_DIRS.contains(&name.as_str())))
        });

    for entry in walker {
        match entry {
            Ok(e) if e.file_type().is_file() => {
                let path = e.path();
                let known = formats::extension_of(path).is_some_and(|ext| formats::is_known_extension(&ext));
                // jeu Switch extrait : exefs/main (sans extension), à côté de main.npdm
                if !known && !super::is_extracted_main(path) {
                    continue;
                }
                match e.metadata() {
                    Ok(meta) => files.push(FoundFile {
                        path: path.to_path_buf(),
                        size: meta.len(),
                        modified: meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64),
                    }),
                    Err(err) => errors.push(WalkError {
                        path: path.to_path_buf(),
                        message: err.to_string(),
                    }),
                }
            }
            Ok(_) => {}
            Err(err) => errors.push(WalkError {
                path: err
                    .path()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| root.to_path_buf()),
                message: err.to_string(),
            }),
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    (files, errors)
}

/// Regroupe pistes et disques sous leur fichier principal.
/// Une .m3u réunit ses .cue, qui réunissent leurs .bin : tout le lot devient un seul jeu.
pub fn group(files: Vec<FoundFile>) -> Vec<Entry> {
    let key = |p: &Path| p.to_string_lossy().to_lowercase();

    // Fichiers référencés directement par chaque feuille (.m3u / .cue)
    let mut direct: HashMap<String, Vec<String>> = HashMap::new();
    for f in &files {
        let ext = formats::extension_of(&f.path);
        // CloneCD (.ccd + .img + .sub) et Media Descriptor (.mds + .mdf) : même nom
        let sidecars: &[&str] = match ext.as_deref() {
            Some(".ccd") => &["img", "sub"],
            Some(".mds") => &["mdf"],
            _ => &[],
        };
        if !sidecars.is_empty() {
            let refs = sidecars.iter().map(|s| key(&f.path.with_extension(s))).collect();
            direct.insert(key(&f.path), refs);
            continue;
        }
        let is_cue = ext.as_deref() == Some(".cue");
        if !is_cue && ext.as_deref() != Some(".m3u") {
            continue;
        }
        let dir = f.path.parent().unwrap_or(Path::new(""));
        let refs = referenced_files(&f.path, is_cue)
            .into_iter()
            .map(|r| key(&dir.join(r)))
            .collect();
        direct.insert(key(&f.path), refs);
    }

    // Fermeture transitive (m3u → cue → bin), protégée contre les cycles
    let all_parts = |sheet: &str| -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        let mut stack = vec![sheet.to_string()];
        while let Some(cur) = stack.pop() {
            for r in direct.get(&cur).into_iter().flatten() {
                if r != sheet && !out.contains(r) {
                    out.push(r.clone());
                    stack.push(r.clone());
                }
            }
        }
        out
    };

    let claimed: HashSet<String> = direct.values().flatten().cloned().collect();
    files
        .iter()
        .filter(|f| !claimed.contains(&key(&f.path)))
        .map(|f| {
            let parts_keys = all_parts(&key(&f.path));
            let parts = files
                .iter()
                .filter(|p| parts_keys.contains(&key(&p.path)))
                .cloned()
                .collect();
            Entry {
                main: f.clone(),
                parts,
            }
        })
        .collect()
}

/// Fichiers cités par une .cue (`FILE "x.bin" BINARY`) ou une .m3u (une ligne par disque).
fn referenced_files(sheet: &Path, is_cue: bool) -> Vec<String> {
    let Ok(meta) = fs::metadata(sheet) else {
        return Vec::new();
    };
    if meta.len() > MAX_SHEET_BYTES {
        return Vec::new();
    }
    let Ok(text) = fs::read_to_string(sheet) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if is_cue {
                let rest = line
                    .strip_prefix("FILE ")
                    .or_else(|| line.strip_prefix("file "))?;
                let rest = rest.trim();
                if let Some(q) = rest.strip_prefix('"') {
                    q.split('"').next().map(str::to_string)
                } else {
                    rest.split_whitespace().next().map(str::to_string)
                }
            } else {
                (!line.is_empty() && !line.starts_with('#')).then(|| line.to_string())
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(dir: &Path, rel: &str, content: &[u8]) {
        let p = dir.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    #[test]
    fn clonecd_regroupe_et_jeu_extrait_collecte() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(root, "PS1/Crash.ccd", b"[CloneCD]");
        touch(root, "PS1/Crash.img", b"x");
        touch(root, "MK/base/exefs/main", b"NSO0");
        touch(root, "MK/base/exefs/main.npdm", b"META");
        touch(root, "MK/base/romfs/data.bin", b"x");

        let (files, _) = collect(root, true);
        let names: Vec<_> = files.iter().map(|f| f.path.file_name().unwrap().to_string_lossy().to_string()).collect();
        assert_eq!(names, vec!["main", "Crash.ccd", "Crash.img"], "romfs ignoré, main.npdm non collecté");

        let entries = group(files);
        assert_eq!(entries.len(), 2);
        let ccd = entries.iter().find(|e| e.main.path.ends_with("Crash.ccd")).unwrap();
        assert_eq!(ccd.parts.len(), 1, "l'image .img est rattachée à sa .ccd");
    }

    #[test]
    fn collecte_les_jeux_et_ignore_le_reste() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(root, "GameCube/Zelda.iso", b"x");
        touch(root, "GameCube/notes.txt", b"x");
        touch(root, "GBA/sous/Advance Wars.gba", b"x");
        touch(root, ".cache/cache.iso", b"x");
        touch(root, "$RECYCLE.BIN/old.iso", b"x");

        let (files, errors) = collect(root, true);
        let names: Vec<_> = files
            .iter()
            .map(|f| f.path.file_name().unwrap().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, vec!["Advance Wars.gba", "Zelda.iso"]);
        assert!(errors.is_empty());

        let (shallow, _) = collect(&root.join("GBA"), false);
        assert!(
            shallow.is_empty(),
            "non récursif : le sous-dossier est ignoré"
        );
    }

    #[test]
    fn regroupe_cue_bin_et_m3u() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        touch(
            root,
            "FF7 (Disc 1).cue",
            b"FILE \"FF7 (Disc 1).bin\" BINARY\n  TRACK 01 MODE2/2352\n",
        );
        touch(root, "FF7 (Disc 1).bin", b"data");
        touch(
            root,
            "FF7 (Disc 2).cue",
            b"FILE \"FF7 (Disc 2).bin\" BINARY\n",
        );
        touch(root, "FF7 (Disc 2).bin", b"data");
        touch(root, "FF7.m3u", b"FF7 (Disc 1).cue\nFF7 (Disc 2).cue\n");
        touch(root, "Crash (Track 1).bin", b"lonely bin");

        let (files, _) = collect(root, true);
        let entries = group(files);
        let mains: Vec<_> = entries
            .iter()
            .map(|e| {
                e.main
                    .path
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        assert_eq!(mains, vec!["Crash (Track 1).bin", "FF7.m3u"]);
        let m3u = entries
            .iter()
            .find(|e| e.main.path.ends_with("FF7.m3u"))
            .unwrap();
        assert_eq!(
            m3u.parts.len(),
            4,
            "2 .cue + 2 .bin rattachés à la playlist"
        );
    }

    #[test]
    fn ne_modifie_aucun_fichier() {
        let tmp = tempfile::tempdir().unwrap();
        touch(tmp.path(), "Wii/Game.wbfs", b"original");
        let before = fs::metadata(tmp.path().join("Wii/Game.wbfs"))
            .unwrap()
            .modified()
            .unwrap();
        let (files, _) = collect(tmp.path(), true);
        let _ = group(files);
        let after = fs::metadata(tmp.path().join("Wii/Game.wbfs"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(before, after);
        assert_eq!(
            fs::read(tmp.path().join("Wii/Game.wbfs")).unwrap(),
            b"original"
        );
    }
}
