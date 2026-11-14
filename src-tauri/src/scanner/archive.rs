//! Archives de jeux à cartouche (.zip) : on lit seulement la liste des
//! fichiers (répertoire central), jamais le contenu compressé.
//!
//! Une archive n'est retenue que si elle contient exactement UNE image de
//! jeu reconnaissable par son extension : un pack de 500 jeux ou une archive
//! quelconque (sauvegardes, données extraites…) est ignoré.

use super::formats;
use super::headers::Source;

/// Extensions qu'un émulateur ouvre directement dans une archive, avec leur
/// console. Seules les extensions propres à une console comptent (pas .bin).
const ROM_EXTENSIONS: [(&str, &str); 19] = [
    (".nds", "ds"),
    (".srl", "ds"),
    (".dsi", "ds"),
    (".ids", "ds"),
    (".gb", "gb"),
    (".sgb", "gb"),
    (".gbc", "gbc"),
    (".gba", "gba"),
    (".agb", "gba"),
    (".z64", "n64"),
    (".n64", "n64"),
    (".v64", "n64"),
    (".ndd", "n64"),
    (".sfc", "snes"),
    (".smc", "snes"),
    (".swc", "snes"),
    (".fig", "snes"),
    (".bs", "snes"),
    (".st", "snes"),
];

const EOCD: u32 = 0x0605_4b50;
const ZIP64_LOCATOR: u32 = 0x0706_4b50;
const ZIP64_EOCD: u32 = 0x0606_4b50;
const CENTRAL: u32 = 0x0201_4b50;
/// Répertoire central lu au maximum (largement assez pour une archive de jeu).
const MAX_DIRECTORY: u64 = 4 * 1024 * 1024;

/// Console du jeu contenu dans une archive .zip, et nom de ce fichier.
pub fn zip_game(src: &mut dyn Source) -> Option<(&'static str, String)> {
    let names = zip_names(src)?;
    let roms: Vec<(&'static str, String)> = names
        .into_iter()
        .filter_map(|name| {
            let ext = formats::extension_of(std::path::Path::new(&name))?;
            ROM_EXTENSIONS.iter().find(|(e, _)| *e == ext).map(|(_, p)| (*p, name))
        })
        .collect();
    match roms.as_slice() {
        [one] => Some(one.clone()),
        _ => None,
    }
}

/// Noms des fichiers d'une archive .zip (zip64 compris).
fn zip_names(src: &mut dyn Source) -> Option<Vec<String>> {
    let size = src.size();
    if size < 22 {
        return None;
    }
    // la fin de répertoire est dans les 64 Ko + 22 derniers octets
    let tail_len = size.min(65_557);
    let tail_at = size - tail_len;
    let tail = src.read_at(tail_at, tail_len as usize)?;
    let eocd = (0..=tail.len().saturating_sub(22)).rev().find(|&i| le32(&tail, i) == EOCD)?;
    let mut dir_size = le32(&tail, eocd + 12) as u64;
    let mut dir_at = le32(&tail, eocd + 16) as u64;
    let mut count = le16(&tail, eocd + 10) as usize;

    if dir_at == 0xFFFF_FFFF || dir_size == 0xFFFF_FFFF || count == 0xFFFF {
        let locator = eocd.checked_sub(20)?;
        if le32(&tail, locator) != ZIP64_LOCATOR {
            return None;
        }
        let z64_at = le64(&tail, locator + 8);
        let z64 = src.read_at(z64_at, 56)?;
        if le32(&z64, 0) != ZIP64_EOCD {
            return None;
        }
        count = le64(&z64, 32) as usize;
        dir_size = le64(&z64, 40);
        dir_at = le64(&z64, 48);
    }
    if dir_size > MAX_DIRECTORY || dir_at.checked_add(dir_size)? > size {
        return None;
    }
    let dir = src.read_at(dir_at, dir_size as usize)?;
    let mut names = Vec::new();
    let mut i = 0usize;
    while names.len() < count.min(100_000) && i + 46 <= dir.len() {
        if le32(&dir, i) != CENTRAL {
            break;
        }
        let name_len = le16(&dir, i + 28) as usize;
        let extra_len = le16(&dir, i + 30) as usize;
        let comment_len = le16(&dir, i + 32) as usize;
        let name = dir.get(i + 46..i + 46 + name_len)?;
        let name = String::from_utf8_lossy(name).to_string();
        if !name.ends_with('/') {
            names.push(name);
        }
        i += 46 + name_len + extra_len + comment_len;
    }
    Some(names)
}

fn le16(b: &[u8], at: usize) -> u16 {
    b.get(at..at + 2).map_or(0, |s| u16::from_le_bytes([s[0], s[1]]))
}
fn le32(b: &[u8], at: usize) -> u32 {
    b.get(at..at + 4).map_or(0, |s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}
fn le64(b: &[u8], at: usize) -> u64 {
    b.get(at..at + 8).map_or(0, |s| u64::from_le_bytes(s.try_into().unwrap_or([0; 8])))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::scanner::headers::ReaderSource;
    use std::io::{Cursor, Write};

    /// Archive .zip réelle (non compressée) contenant les fichiers donnés.
    pub(crate) fn make_zip(files: &[&str]) -> Vec<u8> {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut zip = zip::ZipWriter::new(&mut buf);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            for f in files {
                zip.start_file(*f, opts).unwrap();
                zip.write_all(b"data").unwrap();
            }
            zip.finish().unwrap();
        }
        buf.into_inner()
    }

    fn game(data: Vec<u8>) -> Option<(&'static str, String)> {
        let size = data.len() as u64;
        zip_game(&mut ReaderSource::new(Cursor::new(data), size))
    }

    #[test]
    fn une_seule_rom_dans_l_archive() {
        assert_eq!(
            game(make_zip(&["Advance Wars (Europe).gba", "readme.txt"])),
            Some(("gba", "Advance Wars (Europe).gba".to_string()))
        );
        assert_eq!(game(make_zip(&["Super Mario 64 (USA).z64"])).map(|g| g.0), Some("n64"));
    }

    #[test]
    fn pack_ou_archive_quelconque_refuses() {
        assert_eq!(game(make_zip(&["a.gba", "b.gba"])), None, "un pack de jeux n'est pas UN jeu");
        assert_eq!(game(make_zip(&["romfs/data.bin", "exefs/main"])), None);
        assert_eq!(game(b"pas une archive".to_vec()), None);
    }
}
