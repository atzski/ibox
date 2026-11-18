//! Extraction sûre d'une archive (.zip, .7z) dans un dossier temporaire isolé :
//! aucun chemin absolu, aucun « .. », aucun lien symbolique, taille totale et
//! nombre de fichiers plafonnés, annulable.

use super::catalog::Archive;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_ENTRIES: usize = 60_000;
pub const MAX_TOTAL: u64 = 4 * 1024 * 1024 * 1024;

/// Chemin relatif sûr à l'intérieur du dossier cible, ou `None` s'il faut refuser l'entrée.
pub fn safe_relative(name: &str) -> Option<PathBuf> {
    let name = name.replace('\\', "/");
    if name.is_empty() || name.starts_with('/') || name.contains(':') || name.contains('\0') {
        return None;
    }
    let mut out = PathBuf::new();
    for part in Path::new(&name).components() {
        match part {
            Component::Normal(p) => {
                let s = p.to_string_lossy();
                // noms réservés de Windows et points finaux (C:\a\con, « a. »)
                let stem = s.split('.').next().unwrap_or("").to_ascii_lowercase();
                if matches!(stem.as_str(), "con" | "prn" | "aux" | "nul" | "com1" | "com2" | "com3" | "lpt1" | "lpt2") || s.ends_with(['.', ' ']) {
                    return None;
                }
                out.push(p);
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!out.as_os_str().is_empty()).then_some(out)
}

#[derive(Debug, Default)]
pub struct Stats {
    pub files: usize,
    pub bytes: u64,
}

pub fn extract(kind: Archive, archive: &Path, dest: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64)) -> Result<Stats, String> {
    fs::create_dir_all(dest).map_err(|e| super::download::disk_message(&e))?;
    match kind {
        Archive::Zip => extract_zip(archive, dest, cancel, progress),
        Archive::SevenZ => extract_7z(archive, dest, cancel, progress),
        Archive::TarXz => extract_tar_xz(archive, dest, cancel, progress),
    }
}

/// Type d'archive d'après le nom du fichier téléchargé (`.tar.xz`, `.tar_.xz` de GitHub…).
pub fn kind_for(file_name: &str) -> Option<Archive> {
    let n = file_name.to_ascii_lowercase();
    if n.ends_with(".xz") && n.contains(".tar") {
        Some(Archive::TarXz)
    } else if n.ends_with(".zip") {
        Some(Archive::Zip)
    } else if n.ends_with(".7z") {
        Some(Archive::SevenZ)
    } else {
        None
    }
}

/// `.tar.xz` : mêmes refus que le zip (chemins dangereux, liens, taille), droits d'exécution gardés.
fn extract_tar_xz(archive: &Path, dest: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64)) -> Result<Stats, String> {
    let file = fs::File::open(archive).map_err(|e| super::download::disk_message(&e))?;
    let xz = lzma_rust2::XzReader::new(std::io::BufReader::new(file), true);
    let mut tar = tar::Archive::new(xz);
    let mut stats = Stats::default();
    for entry in tar.entries().map_err(|_| "archive tar.xz illisible".to_string())? {
        let mut entry = entry.map_err(|_| "archive tar.xz endommagée".to_string())?;
        let kind = entry.header().entry_type();
        let name = entry.path().map_err(|_| "nom de fichier illisible".to_string())?.to_string_lossy().into_owned();
        if kind.is_symlink() || kind.is_hard_link() {
            return Err("archive refusée : lien symbolique".into());
        }
        let rel = safe_relative(&name).ok_or_else(|| format!("archive refusée : chemin dangereux « {name} »"))?;
        if kind.is_dir() {
            fs::create_dir_all(dest.join(&rel)).map_err(|e| super::download::disk_message(&e))?;
            continue;
        }
        if !kind.is_file() {
            continue;
        }
        let mode = entry.header().mode().unwrap_or(0o644);
        write_entry(dest, &rel, &mut entry, &mut stats, cancel)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(dest.join(&rel), fs::Permissions::from_mode(mode & 0o755));
        }
        let _ = mode;
        progress(stats.bytes);
    }
    Ok(stats)
}

fn write_entry(dest: &Path, rel: &Path, reader: &mut dyn Read, stats: &mut Stats, cancel: &AtomicBool) -> Result<(), String> {
    let target = dest.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| super::download::disk_message(&e))?;
        // un dossier parent ne doit pas être un lien ou un point de réanalyse
        if fs::symlink_metadata(parent).map(|m| m.file_type().is_symlink()).unwrap_or(true) {
            return Err("archive refusée : lien symbolique".into());
        }
    }
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists { "archive refusée : fichier en double".to_string() } else { super::download::disk_message(&e) }
    })?;
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("annulé".into());
        }
        let n = reader.read(&mut buf).map_err(|_| "archive endommagée".to_string())?;
        if n == 0 {
            break;
        }
        stats.bytes += n as u64;
        if stats.bytes > MAX_TOTAL {
            return Err("archive refusée : contenu trop volumineux".into());
        }
        file.write_all(&buf[..n]).map_err(|e| super::download::disk_message(&e))?;
    }
    stats.files += 1;
    if stats.files > MAX_ENTRIES {
        return Err("archive refusée : trop de fichiers".into());
    }
    Ok(())
}

fn extract_zip(archive: &Path, dest: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64)) -> Result<Stats, String> {
    let file = fs::File::open(archive).map_err(|e| super::download::disk_message(&e))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "archive ZIP illisible".to_string())?;
    if zip.len() > MAX_ENTRIES {
        return Err("archive refusée : trop de fichiers".into());
    }
    let mut stats = Stats::default();
    for i in 0..zip.len() {
        let mut item = zip.by_index(i).map_err(|e| format!("archive ZIP endommagée ({e})"))?;
        let name = item.name().map_err(|_| "nom de fichier illisible".to_string())?.into_owned();
        if item.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
            return Err("archive refusée : lien symbolique".into());
        }
        let rel = safe_relative(&name).ok_or_else(|| format!("archive refusée : chemin dangereux « {name} »"))?;
        if item.is_dir() {
            fs::create_dir_all(dest.join(&rel)).map_err(|e| super::download::disk_message(&e))?;
            continue;
        }
        if stats.bytes + item.size() > MAX_TOTAL {
            return Err("archive refusée : contenu trop volumineux".into());
        }
        write_entry(dest, &rel, &mut item, &mut stats, cancel)?;
        progress(stats.bytes);
    }
    Ok(stats)
}

fn extract_7z(archive: &Path, dest: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(u64)) -> Result<Stats, String> {
    let mut reader = sevenz_rust2::ArchiveReader::open(archive, sevenz_rust2::Password::empty()).map_err(|_| "archive 7z illisible".to_string())?;
    let mut stats = Stats::default();
    let mut failure: Option<String> = None;
    let res = reader.for_each_entries(|entry, data| {
        if entry.is_anti_item() {
            return Ok(true);
        }
        let Some(rel) = safe_relative(entry.name()) else {
            failure = Some(format!("archive refusée : chemin dangereux « {} »", entry.name()));
            return Ok(false);
        };
        // attributs Windows : FILE_ATTRIBUTE_REPARSE_POINT (0x400) ; Unix : lien symbolique
        let attrs = entry.windows_attributes();
        if attrs & 0x400 != 0 || (attrs & 0x8000 != 0 && (attrs >> 16) & 0o170000 == 0o120000) {
            failure = Some("archive refusée : lien symbolique".into());
            return Ok(false);
        }
        if entry.is_directory() {
            if let Err(e) = fs::create_dir_all(dest.join(&rel)) {
                failure = Some(super::download::disk_message(&e));
                return Ok(false);
            }
            return Ok(true);
        }
        if let Err(e) = write_entry(dest, &rel, data, &mut stats, cancel) {
            failure = Some(e);
            return Ok(false);
        }
        progress(stats.bytes);
        Ok(true)
    });
    if let Some(f) = failure {
        return Err(f);
    }
    res.map_err(|e| format!("archive 7z endommagée ({e})"))?;
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    #[test]
    fn chemins_dangereux_refuses() {
        assert!(safe_relative("../evil.exe").is_none());
        assert!(safe_relative("a/../../evil.exe").is_none());
        assert!(safe_relative("/abs/evil.exe").is_none());
        assert!(safe_relative("C:/Windows/evil.exe").is_none());
        assert!(safe_relative("C:evil.exe").is_none());
        assert!(safe_relative("dir\\..\\..\\evil.exe").is_none());
        assert!(safe_relative("con.txt").is_none());
        assert!(safe_relative("a/b.").is_none());
        assert_eq!(safe_relative("./PPSSPP/PPSSPPWindows64.exe").unwrap(), PathBuf::from("PPSSPP").join("PPSSPPWindows64.exe"));
    }

    fn make_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
        for (n, d) in entries {
            w.start_file(*n, SimpleFileOptions::default()).unwrap();
            w.write_all(d).unwrap();
        }
        w.finish().unwrap();
    }

    #[test]
    fn zip_valide_extrait() {
        let t = tempfile::tempdir().unwrap();
        let z = t.path().join("a.zip");
        make_zip(&z, &[("emu/emu.exe", b"MZ.."), ("emu/readme.txt", b"hello")]);
        let s = extract(Archive::Zip, &z, &t.path().join("out"), &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!((s.files, s.bytes), (2, 9));
        assert!(t.path().join("out/emu/emu.exe").is_file());
    }

    #[test]
    fn zip_avec_traversee_refuse() {
        let t = tempfile::tempdir().unwrap();
        let z = t.path().join("evil.zip");
        make_zip(&z, &[("ok.txt", b"1"), ("../../evil.exe", b"MZ")]);
        let err = extract(Archive::Zip, &z, &t.path().join("out"), &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("chemin dangereux"), "{err}");
        assert!(!t.path().join("evil.exe").exists());
    }

    #[test]
    fn archive_invalide_refusee() {
        let t = tempfile::tempdir().unwrap();
        let z = t.path().join("faux.zip");
        fs::write(&z, b"pas une archive").unwrap();
        assert!(extract(Archive::Zip, &z, &t.path().join("o"), &AtomicBool::new(false), &mut |_| {}).is_err());
        let s = t.path().join("faux.7z");
        fs::write(&s, b"pas une archive").unwrap();
        assert!(extract(Archive::SevenZ, &s, &t.path().join("o2"), &AtomicBool::new(false), &mut |_| {}).is_err());
    }

    #[test]
    fn tar_xz_linux_extrait_avec_ses_droits() {
        let t = tempfile::tempdir().unwrap();
        let (ok, evil) = (t.path().join("x.tar.xz"), t.path().join("e.tar.xz"));
        std::fs::write(&ok, include_bytes!("fixtures/xenia-like.tar.xz")).unwrap();
        std::fs::write(&evil, include_bytes!("fixtures/evil.tar.xz")).unwrap();
        assert!(matches!(kind_for("xenia_canary_linux.tar_.xz"), Some(Archive::TarXz)));
        assert!(matches!(kind_for("Mesen_2.1.1_Linux_x64.zip"), Some(Archive::Zip)));
        assert!(kind_for("emu.AppImage").is_none());
        let dest = t.path().join("out");
        let stats = extract(Archive::TarXz, &ok, &dest, &AtomicBool::new(false), &mut |_| {}).unwrap();
        assert_eq!(stats.files, 2);
        let exe = dest.join("build/bin/Linux/Release/xenia_canary");
        assert!(exe.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&exe).unwrap().permissions().mode() & 0o777, 0o755);
        }
        let err = extract(Archive::TarXz, &evil, &t.path().join("out2"), &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("dangereux"), "{err}");
        assert!(!t.path().join("evil").exists());
    }

    #[test]
    fn extraction_annulable() {
        let t = tempfile::tempdir().unwrap();
        let z = t.path().join("a.zip");
        make_zip(&z, &[("a.bin", &[0u8; 1000])]);
        let err = extract(Archive::Zip, &z, &t.path().join("out"), &AtomicBool::new(true), &mut |_| {}).unwrap_err();
        assert_eq!(err, "annulé");
    }
}
