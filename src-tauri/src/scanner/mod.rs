//! Scanner de collection (fondations de la phase 2).
//!
//! Pipeline : `walk::collect` → `walk::group` → `headers::detect` →
//! `identify::identify` → `fingerprint` → `reconcile::reconcile` → base SQLite.
//!
//! Garantie : aucun fichier de jeu n'est jamais déplacé, modifié ni supprimé.
//! Tous les accès disque de ce module sont en lecture seule.

pub mod archive;
pub mod filename;
pub mod fingerprint;
pub mod formats;
pub mod headers;
pub mod identify;
pub mod reconcile;
pub mod walk;

use serde::Serialize;
use headers::Source as _;
use std::fs::File;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Region {
    #[serde(rename = "PAL")]
    Pal,
    #[serde(rename = "NTSC-U")]
    NtscU,
    #[serde(rename = "NTSC-J")]
    NtscJ,
}

impl Region {
    pub fn as_str(self) -> &'static str {
        match self {
            Region::Pal => "PAL",
            Region::NtscU => "NTSC-U",
            Region::NtscJ => "NTSC-J",
        }
    }
}

/// Méthode d'identification (colonne `games.id_method`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IdMethod {
    Header,
    Folder,
    Filename,
    Database,
    Manual,
}

impl IdMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            IdMethod::Header => "header",
            IdMethod::Folder => "folder",
            IdMethod::Filename => "filename",
            IdMethod::Database => "database",
            IdMethod::Manual => "manual",
        }
    }
}

/// Le fichier ressemble-t-il vraiment à un jeu ?
///
/// Certaines extensions sont banales (`.bin`, `.img`, `.iso`, `.wad`…) et
/// apparaissent partout (Téléchargements, données de jeux extraites, outils).
/// Pour elles, le contenu doit porter la signature du format attendu ; sinon
/// le fichier est ignoré au lieu d'être rangé, au hasard, dans une console.
pub fn plausible(entry: &walk::Entry) -> bool {
    let path = &entry.main.path;
    if is_extracted_main(path) {
        return true;
    }
    let Some(ext) = formats::extension_of(path) else {
        return false;
    };
    if !formats::is_known_extension(&ext) {
        return false;
    }
    match ext.as_str() {
        // feuilles de disques : valables seulement si elles désignent des fichiers présents
        ".cue" | ".m3u" | ".ccd" => !entry.parts.is_empty(),
        // Media Descriptor : DuckStation (PS1) l'ouvre ; un disque PS2 se lance par son .mdf
        ".mds" => entry
            .parts
            .iter()
            .find(|p| formats::extension_of(&p.path).as_deref() == Some(".mdf"))
            .and_then(|mdf| read_header(&mdf.path))
            .is_some_and(|h| h.platform_id == "ps1"),
        // image PS2 compressée en gzip : « jeu.iso.gz »
        ".gz" => {
            path.file_stem().is_some_and(|s| s.to_string_lossy().to_lowercase().ends_with(".iso"))
                && read_magic(path, 2).is_some_and(|m| m == [0x1F, 0x8B])
        }
        _ => match File::open(path) {
            Ok(file) => {
                let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                plausible_content(&mut headers::ReaderSource::new(file, size), &ext)
            }
            Err(_) => true, // illisible : l'erreur sera signalée plus loin
        },
    }
}

/// Synchronisation d'un secteur de CD brut (2352 octets).
const CD_SYNC: [u8; 12] = [0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0];

pub fn plausible_content(src: &mut dyn headers::Source, ext: &str) -> bool {
    let head = src.read_at(0, 0x110).unwrap_or_default();
    let starts = |magic: &[u8]| head.starts_with(magic);
    let iso9660 = |src: &mut dyn headers::Source| {
        [0x8001u64, 16 * 2352 + 24 + 1, 16 * 2352 + 16 + 1]
            .iter()
            .any(|&at| src.read_at(at, 5).as_deref() == Some(&b"CD001"[..]))
    };
    let at = |offset: usize, magic: &[u8]| head.get(offset..offset + magic.len()) == Some(magic);
    match ext {
        // image brute : secteur de CD synchronisé, ISO 9660, ou en-tête de jeu reconnu
        // (Dolphin, mupen64plus, mGBA ouvrent aussi des .bin)
        ".bin" | ".img" | ".mdf" => {
            head.starts_with(&CD_SYNC) || iso9660(src) || headers::detect(src, ext).is_some()
        }
        // .rom (mGBA) et .dmg (aussi les images disque macOS) : en-tête Game Boy obligatoire
        ".rom" | ".dmg" => headers::detect(src, ext).is_some(),
        // un ISO de données ordinaire (Windows, Linux…) n'est pas un jeu
        ".iso" => headers::detect(src, ext).is_some() || !iso9660(src),
        ".chd" => starts(b"MComprHD"),
        ".cso" | ".ciso" => starts(b"CISO"),
        ".zso" => starts(b"ZISO"),
        ".ecm" => starts(b"ECM\0"),
        ".tgc" => starts(&[0xAE, 0x0F, 0x38, 0xA2]),
        ".pbp" => starts(b"\0PBP"),
        ".nro" => at(0x10, b"NRO0"),
        ".3dsx" => starts(b"3DSX"),
        ".3ds" | ".cci" => at(0x100, b"NCSD"),
        ".cxi" | ".app" => at(0x100, b"NCCH"),
        ".zip" => archive::zip_game(src).is_some(),
        ".gcz" => starts(&[0x01, 0xC0, 0x0B, 0xB1]),
        ".rvz" => starts(b"RVZ\x01"),
        ".wia" => starts(b"WIA\x01"),
        ".wbfs" => starts(b"WBFS"),
        // WAD Wii : en-tête de 0x20 octets puis « Is » / « ib » (pas un WAD de Doom)
        ".wad" => starts(&[0, 0, 0, 0x20]) && matches!(head.get(4..6), Some(b"Is") | Some(b"ib")),
        ".nup" => starts(b"NUP\x01"),
        ".nsp" | ".nsz" => starts(b"PFS0"),
        ".xci" | ".xcz" => head.get(0x100..0x104) == Some(&b"HEAD"[..]),
        _ => true,
    }
}

/// Garde les jeux plausibles. Une feuille refusée (.cue cassée, .mds d'un disque
/// PS2…) ne masque pas ses fichiers : chacun est alors examiné seul.
pub fn accept(entries: Vec<walk::Entry>) -> Vec<walk::Entry> {
    let mut out = Vec::new();
    for entry in entries {
        if plausible(&entry) {
            out.push(entry);
            continue;
        }
        for part in entry.parts {
            let alone = walk::Entry { main: part, parts: Vec::new() };
            if plausible(&alone) {
                out.push(alone);
            }
        }
    }
    out
}

/// `exefs/main` d'un jeu Switch extrait (à côté de `main.npdm`), hors mises à
/// jour et contenus additionnels qui ne sont pas des jeux à part entière.
pub fn is_extracted_main(path: &Path) -> bool {
    let named = |p: Option<&std::ffi::OsStr>, name: &str| p.is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(name));
    named(path.file_name(), "main")
        && named(path.parent().and_then(Path::file_name), "exefs")
        && path.with_file_name("main.npdm").is_file()
        && !path.ancestors().skip(2).take(4).any(|a| named(a.file_name(), "updates") || named(a.file_name(), "dlc"))
}

fn read_magic(path: &Path, len: usize) -> Option<Vec<u8>> {
    let file = File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    headers::ReaderSource::new(file, size).read_at(0, len)
}

/// Lit l'en-tête d'un fichier sur disque (lecture seule).
pub fn read_header(path: &Path) -> Option<headers::HeaderInfo> {
    if is_extracted_main(path) {
        let npdm = path.with_file_name("main.npdm");
        let file = File::open(&npdm).ok()?;
        let size = file.metadata().ok()?.len();
        return headers::npdm(&mut headers::ReaderSource::new(file, size));
    }
    let file = File::open(path).ok()?;
    let size = file.metadata().ok()?.len();
    let ext = formats::extension_of(path)?;
    let mut src = headers::ReaderSource::new(file, size);
    if ext == ".zip" {
        // console du jeu contenu, d'après son extension (le contenu reste compressé)
        return archive::zip_game(&mut src).map(|(platform, _)| headers::HeaderInfo::new(platform));
    }
    headers::detect(&mut src, &ext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn check(data: Vec<u8>, ext: &str) -> bool {
        let size = data.len() as u64;
        plausible_content(&mut headers::ReaderSource::new(Cursor::new(data), size), ext)
    }

    #[test]
    fn un_bin_quelconque_n_est_pas_un_disque() {
        // données de jeu extraites, firmware, modèles… : rien d'un CD
        assert!(!check(vec![0x42; 0x20000], ".bin"));
        assert!(!check(b"\x89PNG....".to_vec(), ".img"));
    }

    #[test]
    fn image_de_cd_brute_ou_iso9660_acceptee() {
        let mut raw = vec![0u8; 0x10000];
        raw[..12].copy_from_slice(&CD_SYNC);
        assert!(check(raw, ".bin"));

        let mut iso = vec![0u8; 0x9000];
        iso[0x8000] = 1;
        iso[0x8001..0x8006].copy_from_slice(b"CD001");
        assert!(check(iso, ".img"));
    }

    #[test]
    fn iso_de_donnees_refuse_iso_inconnu_garde() {
        // ISO 9660 sans « PLAYSTATION » ni « PSP GAME » : un disque de données
        let mut iso = vec![0u8; 0x9000];
        iso[0x8000] = 1;
        iso[0x8001..0x8006].copy_from_slice(b"CD001");
        assert!(!check(iso, ".iso"));
        // contenu indéchiffrable : proposé, mais « à vérifier » plus loin
        assert!(check(vec![0x42; 0x20000], ".iso"));
    }

    #[test]
    fn signatures_des_formats_compresses_et_conteneurs() {
        assert!(check(b"NUP\x01rest".to_vec(), ".nup"));
        assert!(!check(b"PK\x03\x04".to_vec(), ".nup"));
        assert!(check(b"MComprHD....".to_vec(), ".chd"));
        assert!(!check(b"IWAD....".to_vec(), ".wad"), "un WAD de Doom n'est pas un jeu Wii");
        let mut wad = vec![0u8; 0x40];
        wad[..6].copy_from_slice(&[0, 0, 0, 0x20, b'I', b's']);
        assert!(check(wad, ".wad"));
        assert!(check(b"PFS0....".to_vec(), ".nsp"));
        assert!(check(b"ROM sans signature".to_vec(), ".gba"), "les extensions propres restent acceptées");
    }

    #[test]
    fn extensions_banales_exigent_un_en_tete() {
        // .dmg est aussi une image disque macOS, .rom un firmware quelconque
        assert!(!check(vec![0x42; 0x400], ".dmg"));
        assert!(!check(vec![0x42; 0x400], ".rom"));
        let mut nro = vec![0u8; 0x40];
        nro[0x10..0x14].copy_from_slice(b"NRO0");
        assert!(check(nro, ".nro"));
        assert!(!check(vec![0u8; 0x40], ".nro"));
        assert!(check(b"3DSX....".to_vec(), ".3dsx"));
        assert!(check(b"ZISO....".to_vec(), ".zso"));
        assert!(check(b"ECM\0....".to_vec(), ".ecm"));
        assert!(!check(b"%PDF-1.7".to_vec(), ".app"));
    }

    #[test]
    fn archive_zip_d_un_seul_jeu() {
        assert!(check(archive::tests::make_zip(&["Pokemon Emeraude.gba"]), ".zip"));
        assert!(!check(archive::tests::make_zip(&["mkw/romfs/a.bin", "mkw/exefs/main"]), ".zip"));
    }

    #[test]
    fn jeu_switch_extrait_reconnu_hors_mises_a_jour() {
        let tmp = tempfile::tempdir().unwrap();
        let mk = |rel: &str| {
            let p = tmp.path().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, b"x").unwrap();
            p
        };
        let main = mk("Kirby/base/base/exefs/main");
        mk("Kirby/base/base/exefs/main.npdm");
        let update = mk("Kirby/base/updates/65536/exefs/main");
        mk("Kirby/base/updates/65536/exefs/main.npdm");
        let lonely = mk("Autre/exefs/main");
        assert!(is_extracted_main(&main));
        assert!(!is_extracted_main(&update), "une mise à jour n'est pas un jeu à part");
        assert!(!is_extracted_main(&lonely), "sans main.npdm ce n'est pas un jeu");
    }
}

