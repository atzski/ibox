//! Lecture seule d'une image de disque PS2 pour retrouver l'identifiant que
//! PCSX2 donne à ses réglages par jeu : numéro de série et CRC de l'ELF de
//! démarrage. Reproduit le code de PCSX2 (vérifié le 2026-11-17) :
//! - `CDVD/InputIsoFile.cpp` `Detect` : géométries de secteurs essayées dans
//!   l'ordre (2048, 2336, 2352, 2448, puis les mêmes décalées de 150 secteurs
//!   pour les images Nero) ;
//! - `CDVD/IsoReader.cpp` : descripteur primaire à partir du secteur 16,
//!   recherche des fichiers sans casse, suffixe `;1` ignoré ;
//! - `CDVD/CDVD.cpp` `GetPS2ElfName` : `SYSTEM.CNF`, ligne `BOOT2 = …` ;
//!   `cdvdUncheckedLoadDiscElf` : préfixe `cdrom:`/`cdrom0:` et barres
//!   retirés, version `;n` ignorée ; `ExecutablePathToSerial` :
//!   `SLUS_203.12` → `SLUS-20312` ;
//! - `Elfheader.cpp` `ElfObject::GetCRC` : OU exclusif de tous les mots de
//!   32 bits (petit-boutiste) du fichier ELF, octets restants ignorés.
//!
//! Seules les images non compressées (`.iso`, `.bin`, `.img`) sont lues :
//! CHD, CSO, ZSO, GZ ou archives renvoient une erreur, jamais une supposition.
//! Rien n'est écrit, rien n'est envoyé.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const SECTOR: usize = 2048;
/// L'ELF de démarrage tient dans les 32 Mo de mémoire de la PS2.
const MAX_ELF: u32 = 32 * 1024 * 1024;
const MAX_CNF: u32 = 64 * 1024;
const MAX_DIR: u32 = 1024 * 1024;
/// Taille d'un en-tête ELF32 (`CheckElfSize` refuse un fichier plus petit).
const ELF_HEADER: u32 = 52;

/// (taille de bloc, décalage du début de fichier, décalage des données dans le bloc).
const GEOMETRIES: [(u64, u64, u64); 7] = [
    (2048, 0, 0),
    (2336, 0, 8),
    (2352, 0, 24),
    (2448, 0, 24),
    (2048, 150 * 2048, 0),
    (2352, 150 * 2048, 24),
    (2448, 150 * 2048, 24),
];

/// Identité d'un disque PS2 au sens de PCSX2.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Ps2Boot {
    /// Numéro de série tiré de `BOOT2` ; vide si le nom ne suit pas le format
    /// attendu (PCSX2 utilise alors `<CRC>.ini`).
    pub serial: String,
    pub crc: u32,
}

/// Extensions lues directement (images non compressées).
pub fn supported(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| ["iso", "bin", "img"].iter().any(|x| e.eq_ignore_ascii_case(x)))
}

struct Image {
    file: File,
    blocks: u64,
    block: u64,
    offset: u64,
    data: u64,
}

impl Image {
    fn open(path: &Path) -> Result<Self, String> {
        let file = File::open(path).map_err(|_| "image du jeu illisible".to_string())?;
        let size = file.metadata().map_err(|_| "image du jeu illisible".to_string())?.len();
        let mut img = Image { file, blocks: 0, block: 0, offset: 0, data: 0 };
        for (block, offset, data) in GEOMETRIES {
            img.block = block;
            img.offset = offset;
            img.data = data;
            img.blocks = size.saturating_sub(offset) / block;
            if img.sector(16).is_ok_and(|s| &s[1..6] == b"CD001") {
                return Ok(img);
            }
        }
        Err("format d'image non reconnu (ISO 9660 introuvable)".into())
    }

    fn sector(&mut self, lsn: u64) -> Result<[u8; SECTOR], String> {
        if lsn >= self.blocks {
            return Err("lecture hors de l'image".into());
        }
        let mut buf = [0u8; SECTOR];
        self.file.seek(SeekFrom::Start(self.offset + lsn * self.block + self.data)).map_err(|e| e.to_string())?;
        self.file.read_exact(&mut buf).map_err(|_| "image tronquée".to_string())?;
        Ok(buf)
    }

    fn read(&mut self, lsn: u32, len: u32) -> Result<Vec<u8>, String> {
        let mut out = Vec::with_capacity(len as usize);
        let count = (len as u64).div_ceil(SECTOR as u64);
        for i in 0..count {
            out.extend_from_slice(&self.sector(lsn as u64 + i)?);
        }
        out.truncate(len as usize);
        Ok(out)
    }

    /// Descripteur de volume primaire (type 1), comme `IsoReader::ReadPVD`.
    fn root(&mut self) -> Result<Entry, String> {
        for i in 0..256u64 {
            let s = self.sector(16 + i)?;
            if &s[1..6] != b"CD001" {
                continue;
            }
            if s[0] == 255 {
                break;
            }
            if s[0] == 1 {
                return Entry::parse(&s[156..190]).ok_or_else(|| "descripteur de volume invalide".to_string());
            }
        }
        Err("descripteur de volume primaire introuvable".into())
    }

    /// `IsoReader::LocateFile` : composants séparés par `/` ou `\`, sans casse.
    fn locate(&mut self, path: &str) -> Result<Entry, String> {
        let mut dir = self.root()?;
        let parts: Vec<&str> = path.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
        if parts.is_empty() {
            return Err("chemin vide".into());
        }
        for (i, part) in parts.iter().enumerate() {
            let found = self.find(&dir, part)?.ok_or_else(|| format!("« {part} » absent du disque"))?;
            if i + 1 == parts.len() {
                return Ok(found);
            }
            if !found.dir {
                return Err("chemin invalide sur le disque".into());
            }
            dir = found;
        }
        unreachable!()
    }

    fn find(&mut self, dir: &Entry, name: &str) -> Result<Option<Entry>, String> {
        if dir.len == 0 || dir.len > MAX_DIR {
            return Err("répertoire du disque invalide".into());
        }
        let sectors = dir.len.div_ceil(SECTOR as u32);
        for i in 0..sectors {
            let s = self.sector(dir.lba as u64 + i as u64)?;
            let mut off = 0usize;
            while off + 33 < SECTOR {
                let len = s[off] as usize;
                if len < 33 {
                    break;
                }
                let name_len = s[off + 32] as usize;
                let rec = &s[off..(off + len).min(SECTOR)];
                off += len;
                if 33 + name_len > rec.len() {
                    continue;
                }
                let raw = &rec[33..33 + name_len];
                if name_len == 1 && raw[0] <= 1 {
                    continue; // « . » et « .. »
                }
                let base = raw.split(|b| *b == b';' || *b == 0).next().unwrap_or_default();
                if !base.is_empty() && base.eq_ignore_ascii_case(name.as_bytes()) {
                    return Ok(Entry::parse(rec));
                }
            }
        }
        Ok(None)
    }
}

#[derive(Debug, Clone, Copy)]
struct Entry {
    lba: u32,
    len: u32,
    dir: bool,
}

impl Entry {
    fn parse(rec: &[u8]) -> Option<Self> {
        if rec.len() < 33 {
            return None;
        }
        let le = |o: usize| u32::from_le_bytes([rec[o], rec[o + 1], rec[o + 2], rec[o + 3]]);
        Some(Entry { lba: le(2), len: le(10), dir: rec[25] & 2 != 0 })
    }
}

/// `GetPS2ElfName` : dernière ligne `BOOT2 = …` de `SYSTEM.CNF`.
fn boot2(cnf: &[u8]) -> Result<String, String> {
    let text = String::from_utf8_lossy(cnf);
    let lines: Vec<&str> = text.split('\n').collect();
    let mut boot2 = None;
    let mut ps1 = false;
    for (n, line) in lines.iter().enumerate() {
        let Some((k, v)) = line.trim().split_once('=') else { continue };
        let (k, v) = (k.trim(), v.trim());
        if v.is_empty() && n + 1 == lines.len() {
            continue;
        }
        match k {
            "BOOT2" => boot2 = Some(v.to_string()),
            "BOOT" => ps1 = true,
            _ => {}
        }
    }
    boot2.ok_or_else(|| if ps1 { "disque PlayStation 1, pas PlayStation 2".into() } else { "SYSTEM.CNF sans BOOT2".into() })
}

/// `ExecutablePathToSerial` : `cdrom0:\SLUS_203.12;1` → `SLUS-20312` (vide si format inattendu).
pub fn serial_of(elf_path: &str) -> String {
    let name = match elf_path.rfind('\\') {
        Some(p) => &elf_path[p + 1..],
        None => elf_path.rfind(':').map(|p| &elf_path[p + 1..]).unwrap_or(elf_path),
    };
    let name = name.rfind(';').map(|p| &name[..p]).unwrap_or(name);
    let b = name.as_bytes();
    if !(b.len() >= 11 && (b[4] == b'_' || b[4] == b'-') && b[8] == b'.') {
        return String::new();
    }
    name.bytes().filter(|c| *c != b'.').map(|c| if c == b'_' { '-' } else { c.to_ascii_uppercase() as char }).collect()
}

/// `ElfObject::GetCRC`.
pub fn elf_crc(data: &[u8]) -> u32 {
    data.as_chunks::<4>().0.iter().fold(0u32, |crc, w| crc ^ u32::from_le_bytes(*w))
}

/// Numéro de série et CRC tels que PCSX2 les calcule pour ce disque.
pub fn ps2_boot(path: &Path) -> Result<Ps2Boot, String> {
    if !supported(path) {
        return Err("format d'image non lu par iBox (CHD, CSO, archive…) : identifiant introuvable".into());
    }
    let mut img = Image::open(path)?;
    let cnf = img.locate("SYSTEM.CNF")?;
    if cnf.dir || cnf.len > MAX_CNF {
        return Err("SYSTEM.CNF invalide".into());
    }
    let cnf = img.read(cnf.lba, cnf.len)?;
    let elf_path = boot2(&cnf)?;
    let rest = elf_path.strip_prefix("cdrom0:").or_else(|| elf_path.strip_prefix("cdrom:")).ok_or("chemin de démarrage inattendu")?;
    let file = rest.split(';').next().unwrap_or_default().trim_start_matches(['\\', '/']);
    if file.is_empty() {
        return Err("chemin de démarrage vide".into());
    }
    let elf = img.locate(file)?;
    if elf.dir || elf.len <= ELF_HEADER || elf.len > MAX_ELF {
        return Err("exécutable de démarrage invalide".into());
    }
    let data = img.read(elf.lba, elf.len)?;
    Ok(Ps2Boot { serial: serial_of(&elf_path), crc: elf_crc(&data) })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    fn dir_record(name: &[u8], lba: u32, len: u32, dir: bool) -> Vec<u8> {
        let mut r = vec![0u8; 33];
        r[2..6].copy_from_slice(&lba.to_le_bytes());
        r[6..10].copy_from_slice(&lba.to_be_bytes());
        r[10..14].copy_from_slice(&len.to_le_bytes());
        r[14..18].copy_from_slice(&len.to_be_bytes());
        r[25] = if dir { 2 } else { 0 };
        r[32] = name.len() as u8;
        r.extend_from_slice(name);
        if r.len() % 2 == 1 {
            r.push(0);
        }
        r[0] = r.len() as u8;
        r
    }

    /// Image ISO 9660 minimale : `SYSTEM.CNF` et un ELF dans `/DATA`.
    pub(crate) fn ps2_iso(cnf: &str, elf: &[u8], raw: bool) -> Vec<u8> {
        let mut sectors = vec![[0u8; SECTOR]; 24];
        let root = dir_record(&[0], 18, 2048, true);
        sectors[16][0] = 1;
        sectors[16][1..6].copy_from_slice(b"CD001");
        sectors[16][156..156 + root.len()].copy_from_slice(&root);
        sectors[17][0] = 255;
        sectors[17][1..6].copy_from_slice(b"CD001");
        let mut d = Vec::new();
        d.extend(dir_record(&[0], 18, 2048, true));
        d.extend(dir_record(&[1], 18, 2048, true));
        d.extend(dir_record(b"SYSTEM.CNF;1", 20, cnf.len() as u32, false));
        d.extend(dir_record(b"DATA", 19, 2048, true));
        sectors[18][..d.len()].copy_from_slice(&d);
        let sub = dir_record(b"SLUS_203.12;1", 21, elf.len() as u32, false);
        sectors[19][..sub.len()].copy_from_slice(&sub);
        sectors[20][..cnf.len()].copy_from_slice(cnf.as_bytes());
        for (i, chunk) in elf.chunks(SECTOR).enumerate() {
            sectors[21 + i][..chunk.len()].copy_from_slice(chunk);
        }
        if !raw {
            return sectors.concat();
        }
        sectors
            .iter()
            .flat_map(|s| {
                let mut b = vec![0u8; 2352];
                b[24..24 + SECTOR].copy_from_slice(s);
                b
            })
            .collect()
    }

    pub(crate) fn elf_bytes() -> Vec<u8> {
        let mut e = b"\x7fELF".to_vec();
        e.extend((0..196u32).map(|i| (i * 7) as u8));
        e
    }

    #[test]
    fn crc_et_numero_de_serie_comme_pcsx2() {
        let elf = elf_bytes();
        let tmp = tempfile::tempdir().unwrap();
        for (name, raw) in [("jeu.iso", false), ("jeu.bin", true)] {
            let p = tmp.path().join(name);
            std::fs::write(&p, ps2_iso("BOOT2 = cdrom0:\\DATA\\SLUS_203.12;1\r\nVER = 1.00\r\nVMODE = NTSC\r\n", &elf, raw)).unwrap();
            let b = ps2_boot(&p).unwrap();
            assert_eq!(b.serial, "SLUS-20312");
            assert_eq!(b.crc, elf_crc(&elf));
        }
        assert_eq!(elf_crc(&[1, 0, 0, 0, 3, 0, 0, 0, 0xFF]), 2);
        assert_eq!(serial_of("cdrom0:\\SCES_534.56;1"), "SCES-53456");
        assert_eq!(serial_of("cdrom0:/SCES_534.56;1"), "");
        assert_eq!(serial_of("cdrom0:\\MAIN.ELF;1"), "");
    }

    #[test]
    fn images_non_prises_en_charge_ou_invalides() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(ps2_boot(&tmp.path().join("jeu.chd")).unwrap_err().contains("identifiant introuvable"));
        let p = tmp.path().join("vide.iso");
        std::fs::write(&p, vec![0u8; 40 * SECTOR]).unwrap();
        assert!(ps2_boot(&p).is_err());
        // disque PS1 : jamais pris pour un disque PS2
        let p = tmp.path().join("ps1.iso");
        std::fs::write(&p, ps2_iso("BOOT = cdrom:\\SCUS_944.26;1\r\n", &elf_bytes(), false)).unwrap();
        assert!(ps2_boot(&p).unwrap_err().contains("PlayStation 1"));
        // ELF absent : erreur, pas de CRC inventé
        let p = tmp.path().join("sans_elf.iso");
        std::fs::write(&p, ps2_iso("BOOT2 = cdrom0:\\ABSENT.ELF;1\r\n", &elf_bytes(), false)).unwrap();
        assert!(ps2_boot(&p).is_err());
        // image tronquée
        let p = tmp.path().join("tronquee.iso");
        let full = ps2_iso("BOOT2 = cdrom0:\\DATA\\SLUS_203.12;1\r\n", &elf_bytes(), false);
        std::fs::write(&p, &full[..21 * SECTOR]).unwrap();
        assert!(ps2_boot(&p).is_err());
    }
}
