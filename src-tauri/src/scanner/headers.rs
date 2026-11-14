//! Lecture des identifiants internes des jeux (étape 1 de la reconnaissance).
//!
//! Seuls quelques octets sont lus, en lecture seule. Chaque format est validé
//! par un nombre magique ou une somme de contrôle avant d'être accepté :
//! un fichier quelconque ne peut pas être pris pour un jeu par hasard.
//!
//! Formats couverts : GameCube / Wii (ISO, GCM, RVZ, WIA, WBFS, CISO),
//! DS, GBA, Game Boy / Color, N64 (z64, v64, n64), Super Nintendo (LoROM,
//! HiROM, en-tête copieur), 3DS (NCSD), Switch (XCI, NSP/NSZ), Switch / Switch 2
//! (conteneur NUP), images ISO 9660
//! PlayStation 1 / 2 / PSP (secteurs 2048 ou 2352), EBOOT.PBP (PSP, PS1).
//! Les formats compressés opaques (GCZ, CSO, CHD) passent à l'étape suivante.

use super::Region;
use std::io::{Read, Seek, SeekFrom};

/// Accès aléatoire en lecture seule à un fichier (ou à un tampon en test).
pub trait Source {
    fn size(&self) -> u64;
    fn read_at(&mut self, offset: u64, len: usize) -> Option<Vec<u8>>;
}

pub struct ReaderSource<R> {
    reader: R,
    size: u64,
}

impl<R: Read + Seek> ReaderSource<R> {
    pub fn new(reader: R, size: u64) -> Self {
        Self { reader, size }
    }
}

impl<R: Read + Seek> Source for ReaderSource<R> {
    fn size(&self) -> u64 {
        self.size
    }
    fn read_at(&mut self, offset: u64, len: usize) -> Option<Vec<u8>> {
        if offset >= self.size {
            return None;
        }
        let len = len.min((self.size - offset) as usize);
        let mut buf = vec![0u8; len];
        self.reader.seek(SeekFrom::Start(offset)).ok()?;
        self.reader.read_exact(&mut buf).ok()?;
        Some(buf)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HeaderInfo {
    pub platform_id: &'static str,
    pub title: Option<String>,
    pub serial: Option<String>,
    pub region: Option<Region>,
    pub disc: Option<u32>,
}

impl HeaderInfo {
    pub fn new(platform_id: &'static str) -> Self {
        Self {
            platform_id,
            title: None,
            serial: None,
            region: None,
            disc: None,
        }
    }
}

/// Tente d'identifier le contenu. `ext` (« .iso ») sert à départager les
/// formats dont la signature est partagée (CISO Wii / CSO PSP).
pub fn detect(src: &mut dyn Source, ext: &str) -> Option<HeaderInfo> {
    let head = src.read_at(0, 0x400)?;
    let magic = head.get(..4)?;

    match magic {
        b"RVZ\x01" | b"WIA\x01" => return gc_wii(&src.read_at(0x58, 0x80)?),
        b"WBFS" => {
            let shift = *head.get(8)?;
            if (9..=31).contains(&shift) {
                return gc_wii(&src.read_at(1u64 << shift, 0x80)?);
            }
            return None;
        }
        b"CISO" if ext == ".ciso" => return gc_wii(&src.read_at(0x8000, 0x80)?),
        b"CISO" => return None, // CSO compressé (PSP/PS2) : nom de fichier
        b"\0PBP" => return pbp(src, &head),
        b"PFS0" => return Some(nsp(src, &head)),
        b"NUP\x01" => return nup(src),
        b"3DSX" => return Some(HeaderInfo::new("3ds")),
        _ => {}
    }
    if head.get(0x100..0x104) == Some(&b"HEAD"[..]) {
        // XCI : l'identifiant du titre est chiffré ; Switch par défaut (affinable
        // en Switch 2 d'après le dossier, voir identify)
        return Some(HeaderInfo::new("switch"));
    }
    if head.get(0x100..0x104) == Some(&b"NCCH"[..]) {
        // partition exécutable 3DS (.cxi, .app) : code produit à 0x150
        let mut info = HeaderInfo::new("3ds");
        info.serial = head.get(0x150..0x160).and_then(ascii);
        return Some(info);
    }
    if head.get(0x100..0x104) == Some(&b"NCSD"[..]) {
        let mut info = HeaderInfo::new("3ds");
        if let Some(code) = src.read_at(0x1150, 16) {
            info.serial = ascii(&code);
            info.region = info
                .serial
                .as_deref()
                .and_then(|s| s.as_bytes().get(9).copied())
                .and_then(region_from_code);
        }
        return Some(info);
    }

    gc_wii(&head)
        .or_else(|| nds(&head))
        .or_else(|| gba(&head))
        .or_else(|| gameboy(&head, ext))
        .or_else(|| n64(&head))
        .or_else(|| iso9660(src))
        .or_else(|| snes(src))
}

// ——— NUP (conteneur Switch 1 / Switch 2, spécification 1.0) ———
//
// Superbloc de 0x80 octets, puis table des paquets (en-tête de 0x30 octets) :
// le premier paquet commence donc à 0xB0. Champs utilisés : identifiant du
// titre (u64 à +0x00), type (u8 à +0x18, 0 = jeu de base), bloc de
// métadonnées (u64 à +0x20, taille u32 à +0x28) fait d'enregistrements
// type/taille dont le 0x0005 est le nom du jeu.

const NUP_FIRST_PACKAGE: u64 = 0xB0;
const NUP_TLV_TITLE: u16 = 0x0005;

fn nup(src: &mut dyn Source) -> Option<HeaderInfo> {
    let rec = src.read_at(NUP_FIRST_PACKAGE, 0x30)?;
    if rec.len() < 0x2C {
        return None;
    }
    let title_id = le64(&rec, 0);
    let mut info = HeaderInfo::new(switch_platform(title_id)?);
    info.serial = Some(format!("{title_id:016X}"));
    let meta_at = le64(&rec, 0x20);
    let meta_size = le32(&rec, 0x28) as usize;
    if rec[0x18] == 0 && meta_at > 0 && meta_size <= 64 * 1024 {
        if let Some(meta) = src.read_at(meta_at, meta_size) {
            info.title = tlv_text(&meta, NUP_TLV_TITLE);
        }
    }
    Some(info)
}

/// Plateforme d'après le préfixe d'un identifiant de titre (01 = Switch, 04 = Switch 2).
pub fn switch_platform(title_id: u64) -> Option<&'static str> {
    match (title_id >> 56) as u8 {
        0x01 => Some("switch"),
        0x04 => Some("switch2"),
        _ => None,
    }
}

/// NSP / NSZ (PFS0) : la table des noms contient le ticket « <titre><clé>.tik »
/// (ou le certificat .cert) dont les 16 premiers chiffres sont l'identifiant du titre.
fn nsp(src: &mut dyn Source, head: &[u8]) -> HeaderInfo {
    let files = le32(head, 4) as usize;
    let names_size = le32(head, 8) as usize;
    let names_at = 0x10 + files * 0x18;
    let title_id = (files <= 1024 && names_size <= 64 * 1024)
        .then(|| src.read_at(names_at as u64, names_size))
        .flatten()
        .and_then(|names| {
            names
                .split(|b| *b == 0)
                .filter_map(|n| std::str::from_utf8(n).ok())
                .filter(|n| n.ends_with(".tik") || n.ends_with(".cert"))
                .find_map(|n| n.get(..16).and_then(|h| u64::from_str_radix(h, 16).ok()))
        });
    let mut info = HeaderInfo::new(title_id.and_then(switch_platform).unwrap_or("switch"));
    info.serial = title_id.map(|t| format!("{t:016X}"));
    info
}

/// main.npdm d'un jeu extrait : identifiant du titre dans la section ACI0
/// (décalage à 0x70 de l'en-tête META, identifiant à +0x10).
pub fn npdm(src: &mut dyn Source) -> Option<HeaderInfo> {
    let meta = src.read_at(0, 0x80)?;
    if meta.get(..4) != Some(&b"META"[..]) {
        return None;
    }
    let aci_at = le32(&meta, 0x70) as u64;
    let aci = src.read_at(aci_at, 0x18)?;
    if aci.get(..4) != Some(&b"ACI0"[..]) {
        return None;
    }
    let title_id = le64(&aci, 0x10);
    let mut info = HeaderInfo::new(switch_platform(title_id)?);
    info.serial = Some(format!("{title_id:016X}"));
    Some(info)
}

/// Texte UTF-8 d'un enregistrement { type u16, réservé u16, taille u32, données }.
fn tlv_text(meta: &[u8], wanted: u16) -> Option<String> {
    let mut i = 0usize;
    while i + 8 <= meta.len() {
        let kind = u16::from_le_bytes([meta[i], meta[i + 1]]);
        let size = le32(meta, i + 4) as usize;
        let data = meta.get(i + 8..i + 8 + size)?;
        if kind == wanted {
            let text = String::from_utf8_lossy(data).trim_matches(char::from(0)).trim().to_string();
            return (!text.is_empty()).then_some(text);
        }
        i += 8 + size;
    }
    None
}

// ——— Nintendo GameCube / Wii ———

const WII_MAGIC: u32 = 0x5D1C_9EA3;
const GC_MAGIC: u32 = 0xC233_9F3D;

fn gc_wii(h: &[u8]) -> Option<HeaderInfo> {
    if h.len() < 0x80 {
        return None;
    }
    let platform = if be32(h, 0x18) == WII_MAGIC {
        "wii"
    } else if be32(h, 0x1C) == GC_MAGIC {
        "gamecube"
    } else {
        return None;
    };
    let serial = ascii(&h[0..6]);
    Some(HeaderInfo {
        platform_id: platform,
        region: region_from_code(h[3]),
        title: ascii(&h[0x20..0x80]),
        serial,
        disc: Some(h[6] as u32 + 1),
    })
}

// ——— Nintendo DS ———

fn nds(h: &[u8]) -> Option<HeaderInfo> {
    if h.len() < 0x160 || le16(h, 0x15C) != 0xCF56 {
        return None;
    }
    Some(HeaderInfo {
        platform_id: "ds",
        title: ascii(&h[0..12]),
        serial: ascii(&h[0x0C..0x10]),
        region: region_from_code(h[0x0F]),
        disc: None,
    })
}

// ——— Game Boy Advance ———

fn gba(h: &[u8]) -> Option<HeaderInfo> {
    if h.len() < 0xC0 || h[0xB2] != 0x96 {
        return None;
    }
    let mut chk: u8 = 0;
    for &b in &h[0xA0..=0xBC] {
        chk = chk.wrapping_sub(b);
    }
    if chk.wrapping_sub(0x19) != h[0xBD] {
        return None;
    }
    Some(HeaderInfo {
        platform_id: "gba",
        title: ascii(&h[0xA0..0xAC]),
        serial: ascii(&h[0xAC..0xB0]),
        region: region_from_code(h[0xAF]),
        disc: None,
    })
}

// ——— Game Boy / Game Boy Color ———

fn gameboy(h: &[u8], ext: &str) -> Option<HeaderInfo> {
    if h.len() < 0x150 || h[0x104..0x108] != [0xCE, 0xED, 0x66, 0x66] {
        return None;
    }
    let mut x: u8 = 0;
    for &b in &h[0x134..=0x14C] {
        x = x.wrapping_sub(b).wrapping_sub(1);
    }
    if x != h[0x14D] {
        return None;
    }
    let cgb = h[0x143];
    let platform = match cgb {
        0xC0 => "gbc",                // Color uniquement
        0x80 if ext != ".gbc" => "gb", // compatible : on suit l'extension
        0x80 => "gbc",
        _ => "gb",
    };
    let title_end = if cgb & 0x80 != 0 { 0x143 } else { 0x144 };
    Some(HeaderInfo {
        platform_id: platform,
        title: ascii(&h[0x134..title_end]),
        serial: None,
        region: (h[0x14A] == 0).then_some(Region::NtscJ),
        disc: None,
    })
}

// ——— Nintendo 64 (trois ordres d'octets) ———

fn n64(h: &[u8]) -> Option<HeaderInfo> {
    if h.len() < 0x40 {
        return None;
    }
    let mut b = h[..0x40].to_vec();
    let magic = [b[0], b[1], b[2], b[3]];
    match magic {
        [0x80, 0x37, 0x12, 0x40] => {}
        [0x37, 0x80, 0x40, 0x12] => b
            .as_chunks_mut::<2>()
            .0
            .iter_mut()
            .for_each(|c| c.swap(0, 1)),
        [0x40, 0x12, 0x37, 0x80] => b
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .for_each(|c| c.reverse()),
        _ => return None,
    }
    Some(HeaderInfo {
        platform_id: "n64",
        title: ascii(&b[0x20..0x34]),
        serial: ascii(&b[0x3B..0x3F]),
        region: region_from_code(b[0x3E]),
        disc: None,
    })
}

// ——— Super Nintendo ———

fn snes(src: &mut dyn Source) -> Option<HeaderInfo> {
    let size = src.size();
    if !(0x8000..=0x80_0000).contains(&size) {
        return None;
    }
    let copier = if size % 1024 == 512 { 512 } else { 0 };
    for base in [0x7FC0u64, 0xFFC0, 0x40_FFC0] {
        let Some(h) = src.read_at(copier + base, 32) else {
            continue;
        };
        if h.len() < 32 {
            continue;
        }
        let checksum = le16(&h, 0x1E);
        let complement = le16(&h, 0x1C);
        let title_ok = h[..21].iter().all(|&c| (0x20..0x7F).contains(&c));
        if checksum ^ complement == 0xFFFF && title_ok {
            return Some(HeaderInfo {
                platform_id: "snes",
                title: ascii(&h[..21]),
                serial: None,
                region: match h[0x19] {
                    0x00 => Some(Region::NtscJ),
                    0x01 => Some(Region::NtscU),
                    0x02..=0x0C => Some(Region::Pal),
                    _ => None,
                },
                disc: None,
            });
        }
    }
    None
}

// ——— ISO 9660 : PlayStation, PlayStation 2, PSP ———

/// Géométries de secteur : ISO (2048), BIN brut mode 2 (2352, données à +24) ou mode 1 (+16).
const GEOMETRIES: [(u64, u64); 3] = [(2048, 0), (2352, 24), (2352, 16)];

struct Iso {
    sector: u64,
    data_offset: u64,
}

impl Iso {
    fn read_sectors(&self, src: &mut dyn Source, lba: u64, len: usize) -> Option<Vec<u8>> {
        let len = len.min(64 * 1024);
        let mut out = Vec::with_capacity(len);
        let mut lba = lba;
        while out.len() < len {
            let chunk = src.read_at(lba * self.sector + self.data_offset, 2048)?;
            let take = (len - out.len()).min(chunk.len());
            out.extend_from_slice(&chunk[..take]);
            lba += 1;
        }
        Some(out)
    }

    /// Cherche une entrée (insensible à la casse, sans « ;1 ») dans un répertoire.
    fn find(&self, src: &mut dyn Source, dir: (u64, usize), name: &str) -> Option<(u64, usize)> {
        let data = self.read_sectors(src, dir.0, dir.1)?;
        let mut i = 0usize;
        while i < data.len() {
            let len = data[i] as usize;
            if len == 0 {
                i = (i / 2048 + 1) * 2048; // fin des entrées de ce secteur
                continue;
            }
            if i + 33 > data.len() || i + len > data.len() {
                break;
            }
            let name_len = data[i + 32] as usize;
            let raw = data.get(i + 33..i + 33 + name_len)?;
            let entry = String::from_utf8_lossy(raw);
            let entry = entry.split(';').next().unwrap_or("");
            if entry.eq_ignore_ascii_case(name) {
                return Some((le32(&data, i + 2) as u64, le32(&data, i + 10) as usize));
            }
            i += len;
        }
        None
    }
}

fn iso9660(src: &mut dyn Source) -> Option<HeaderInfo> {
    for (sector, data_offset) in GEOMETRIES {
        let Some(pvd) = src.read_at(16 * sector + data_offset, 2048) else {
            continue;
        };
        if pvd.len() < 190 || pvd[0] != 1 || &pvd[1..6] != b"CD001" {
            continue;
        }
        let iso = Iso {
            sector,
            data_offset,
        };
        let system = ascii(&pvd[8..40]).unwrap_or_default();
        let root = (le32(&pvd, 156 + 2) as u64, le32(&pvd, 156 + 10) as usize);

        if system.starts_with("PSP GAME") {
            let mut info = HeaderInfo::new("psp");
            if let Some(dir) = iso.find(src, root, "PSP_GAME") {
                if let Some(sfo) = iso.find(src, dir, "PARAM.SFO") {
                    if let Some(data) = iso.read_sectors(src, sfo.0, sfo.1) {
                        apply_sfo(&mut info, &data);
                    }
                }
            }
            return Some(info);
        }
        if system.starts_with("PLAYSTATION") {
            let cnf = iso.find(src, root, "SYSTEM.CNF")?;
            let text = iso.read_sectors(src, cnf.0, cnf.1.min(4096))?;
            let text = String::from_utf8_lossy(&text);
            let ps2 = text
                .lines()
                .any(|l| l.trim_start().to_ascii_uppercase().starts_with("BOOT2"));
            let mut info = HeaderInfo::new(if ps2 { "ps2" } else { "ps1" });
            info.serial = serial_from_cnf(&text);
            info.region = info.serial.as_deref().and_then(region_from_ps_serial);
            return Some(info);
        }
        return None;
    }
    None
}

/// « BOOT2 = cdrom0:\SLUS_203.12;1 » → « SLUS-20312 »
fn serial_from_cnf(text: &str) -> Option<String> {
    let line = text
        .lines()
        .find(|l| l.trim_start().to_ascii_uppercase().starts_with("BOOT"))?;
    let path = line.split('=').nth(1)?.trim();
    let file = path.rsplit(['\\', ':', '/']).next()?;
    let file = file.split(';').next()?;
    let clean: String = file
        .chars()
        .filter(|c| *c != '.')
        .collect::<String>()
        .replace('_', "-");
    (clean.len() >= 9 && clean.is_ascii()).then_some(clean.to_ascii_uppercase())
}

/// Région d'après le préfixe d'un identifiant Sony (SLUS, SCES, ULJM, NPUH…).
fn region_from_ps_serial(serial: &str) -> Option<Region> {
    match serial.as_bytes().get(2)? {
        b'U' => Some(Region::NtscU),
        b'E' => Some(Region::Pal),
        b'J' | b'P' => Some(Region::NtscJ),
        _ => None,
    }
}

// ——— EBOOT.PBP (PSP, ou PS1 « Classics ») ———

fn pbp(src: &mut dyn Source, head: &[u8]) -> Option<HeaderInfo> {
    if head.len() < 0x28 {
        return None;
    }
    let sfo_at = le32(head, 0x08) as u64;
    let icon_at = le32(head, 0x0C) as u64;
    let psar_at = le32(head, 0x24) as u64;
    let psar = src.read_at(psar_at, 12).unwrap_or_default();
    let ps1 = psar.starts_with(b"PSISOIMG") || psar.starts_with(b"PSTITLEIMG");
    let mut info = HeaderInfo::new(if ps1 { "ps1" } else { "psp" });
    if icon_at > sfo_at {
        if let Some(sfo) = src.read_at(sfo_at, ((icon_at - sfo_at) as usize).min(8192)) {
            apply_sfo(&mut info, &sfo);
        }
    }
    Some(info)
}

/// PARAM.SFO : table clé → valeur des jeux Sony (TITLE, DISC_ID…).
fn apply_sfo(info: &mut HeaderInfo, data: &[u8]) {
    if data.len() < 20 || &data[..4] != b"\0PSF" {
        return;
    }
    let keys = le32(data, 8) as usize;
    let values = le32(data, 12) as usize;
    let count = le32(data, 16) as usize;
    for i in 0..count.min(64) {
        let e = 20 + i * 16;
        if e + 16 > data.len() {
            break;
        }
        let key_at = keys + le16(data, e) as usize;
        let len = le32(data, e + 4) as usize;
        let value_at = values + le32(data, e + 12) as usize;
        let key = cstr(data.get(key_at..).unwrap_or_default());
        let Some(raw) = data.get(value_at..value_at + len) else {
            continue;
        };
        let value = cstr(raw);
        match key.as_str() {
            "TITLE" if !value.is_empty() => info.title = Some(value),
            "DISC_ID" if !value.is_empty() => {
                info.region = region_from_ps_serial(&value);
                info.serial = Some(value);
            }
            _ => {}
        }
    }
}

// ——— Utilitaires ———

/// Lettre de région des identifiants Nintendo (4e caractère de GALE01, ADME…).
fn region_from_code(c: u8) -> Option<Region> {
    match c {
        b'E' | b'N' => Some(Region::NtscU),
        b'J' => Some(Region::NtscJ),
        b'P' | b'D' | b'F' | b'S' | b'I' | b'H' | b'X' | b'Y' | b'Z' | b'U' | b'L' | b'M'
        | b'V' => Some(Region::Pal),
        _ => None,
    }
}

/// Texte ASCII imprimable jusqu'au premier octet nul ; None sinon
/// (les titres japonais en Shift-JIS passent au nom de fichier).
fn ascii(bytes: &[u8]) -> Option<String> {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let slice = &bytes[..end];
    if !slice.iter().all(|&b| (0x20..0x7F).contains(&b)) {
        return None;
    }
    let s = String::from_utf8_lossy(slice).trim().to_string();
    (!s.is_empty()).then_some(s)
}

fn cstr(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

fn be32(b: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}
fn le64(b: &[u8], at: usize) -> u64 {
    b.get(at..at + 8).map_or(0, |s| u64::from_le_bytes(s.try_into().unwrap_or([0; 8])))
}

fn le32(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}
fn le16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn detect_bytes(data: Vec<u8>, ext: &str) -> Option<HeaderInfo> {
        let size = data.len() as u64;
        detect(&mut ReaderSource::new(Cursor::new(data), size), ext)
    }

    fn put(buf: &mut [u8], at: usize, bytes: &[u8]) {
        buf[at..at + bytes.len()].copy_from_slice(bytes);
    }

    fn gc_disc_header(id: &[u8; 6], title: &str, wii: bool) -> Vec<u8> {
        let mut h = vec![0u8; 0x440];
        put(&mut h, 0, id);
        if wii {
            put(&mut h, 0x18, &WII_MAGIC.to_be_bytes());
        } else {
            put(&mut h, 0x1C, &GC_MAGIC.to_be_bytes());
        }
        put(&mut h, 0x20, title.as_bytes());
        h
    }

    #[test]
    fn gamecube_iso() {
        let info = detect_bytes(
            gc_disc_header(b"GZLP01", "THE LEGEND OF ZELDA", false),
            ".iso",
        )
        .unwrap();
        assert_eq!(info.platform_id, "gamecube");
        assert_eq!(info.serial.as_deref(), Some("GZLP01"));
        assert_eq!(info.region, Some(Region::Pal));
        assert_eq!(info.title.as_deref(), Some("THE LEGEND OF ZELDA"));
        assert_eq!(info.disc, Some(1));
    }

    #[test]
    fn wii_iso_et_conteneurs() {
        let raw = gc_disc_header(b"RSBE01", "SUPER SMASH BROS", true);
        assert_eq!(
            detect_bytes(raw.clone(), ".iso").unwrap().platform_id,
            "wii"
        );

        // RVZ : en-tête du disque recopié à 0x58
        let mut rvz = vec![0u8; 0x58 + 0x80];
        put(&mut rvz, 0, b"RVZ\x01");
        put(&mut rvz, 0x58, &raw[..0x80]);
        let info = detect_bytes(rvz, ".rvz").unwrap();
        assert_eq!(
            (info.platform_id, info.region),
            ("wii", Some(Region::NtscU))
        );

        // WBFS : secteur de 512 octets (2^9)
        let mut wbfs = vec![0u8; 0x200 + 0x80];
        put(&mut wbfs, 0, b"WBFS");
        wbfs[8] = 9;
        put(&mut wbfs, 0x200, &raw[..0x80]);
        assert_eq!(
            detect_bytes(wbfs, ".wbfs").unwrap().serial.as_deref(),
            Some("RSBE01")
        );
    }

    #[test]
    fn nintendo_ds() {
        let mut h = vec![0u8; 0x200];
        put(&mut h, 0, b"POKEMON D");
        put(&mut h, 0x0C, b"ADAF");
        put(&mut h, 0x15C, &0xCF56u16.to_le_bytes());
        let info = detect_bytes(h, ".nds").unwrap();
        assert_eq!(
            (info.platform_id, info.serial.as_deref(), info.region),
            ("ds", Some("ADAF"), Some(Region::Pal))
        );
    }

    #[test]
    fn game_boy_advance_avec_somme_de_controle() {
        let mut h = vec![0u8; 0x200];
        put(&mut h, 0xA0, b"POKEMON EMER");
        put(&mut h, 0xAC, b"BPEE");
        h[0xB2] = 0x96;
        let mut chk: u8 = 0;
        for &b in &h[0xA0..=0xBC] {
            chk = chk.wrapping_sub(b);
        }
        h[0xBD] = chk.wrapping_sub(0x19);
        let info = detect_bytes(h.clone(), ".gba").unwrap();
        assert_eq!(
            (info.platform_id, info.region),
            ("gba", Some(Region::NtscU))
        );

        h[0xBD] ^= 0xFF; // somme fausse : rejeté
        assert!(detect_bytes(h, ".gba").is_none());
    }

    fn gb_rom(cgb: u8) -> Vec<u8> {
        let mut h = vec![0u8; 0x8000];
        put(&mut h, 0x104, &[0xCE, 0xED, 0x66, 0x66]);
        put(&mut h, 0x134, b"TETRIS");
        h[0x143] = cgb;
        let mut x: u8 = 0;
        for &b in &h[0x134..=0x14C] {
            x = x.wrapping_sub(b).wrapping_sub(1);
        }
        h[0x14D] = x;
        h
    }

    #[test]
    fn game_boy_et_color() {
        assert_eq!(detect_bytes(gb_rom(0x00), ".gb").unwrap().platform_id, "gb");
        assert_eq!(
            detect_bytes(gb_rom(0xC0), ".gb").unwrap().platform_id,
            "gbc"
        );
        assert_eq!(detect_bytes(gb_rom(0x80), ".gb").unwrap().platform_id, "gb");
        assert_eq!(
            detect_bytes(gb_rom(0x80), ".gbc").unwrap().platform_id,
            "gbc"
        );
    }

    #[test]
    fn n64_trois_ordres_d_octets() {
        let mut z64 = vec![0u8; 0x1000];
        put(&mut z64, 0, &[0x80, 0x37, 0x12, 0x40]);
        put(&mut z64, 0x20, b"SUPER MARIO 64      ");
        put(&mut z64, 0x3B, b"NSMP");
        let v64: Vec<u8> = z64.chunks(2).flat_map(|c| [c[1], c[0]]).collect();
        let n64le: Vec<u8> = z64
            .chunks(4)
            .flat_map(|c| [c[3], c[2], c[1], c[0]])
            .collect();
        for (data, ext) in [(z64, ".z64"), (v64, ".v64"), (n64le, ".n64")] {
            let info = detect_bytes(data, ext).unwrap();
            assert_eq!(info.title.as_deref(), Some("SUPER MARIO 64"), "{ext}");
            assert_eq!(info.region, Some(Region::Pal), "{ext}");
        }
    }

    #[test]
    fn super_nintendo_lorom_avec_entete_copieur() {
        let mut rom = vec![0u8; 0x8_0000 + 512];
        let base = 512 + 0x7FC0;
        put(&mut rom, base, b"SUPER MARIOWORLD     ");
        rom[base + 0x19] = 0x02;
        put(&mut rom, base + 0x1C, &0x5A5Au16.to_le_bytes());
        put(&mut rom, base + 0x1E, &(0x5A5Au16 ^ 0xFFFF).to_le_bytes());
        let info = detect_bytes(rom, ".smc").unwrap();
        assert_eq!((info.platform_id, info.region), ("snes", Some(Region::Pal)));
    }

    /// Construit une mini image ISO 9660 : PVD en 16, racine en 20, fichier en 21.
    fn mini_iso(
        system: &str,
        file_name: &str,
        content: &[u8],
        sector: usize,
        data_offset: usize,
    ) -> Vec<u8> {
        let mut img = vec![0u8; 24 * sector];
        let at = |lba: usize| lba * sector + data_offset;
        let mut pvd = vec![0u8; 2048];
        pvd[0] = 1;
        put(&mut pvd, 1, b"CD001");
        put(&mut pvd, 8, format!("{system:<32}").as_bytes());
        // enregistrement du répertoire racine
        pvd[156] = 34;
        put(&mut pvd, 156 + 2, &20u32.to_le_bytes());
        put(&mut pvd, 156 + 10, &2048u32.to_le_bytes());
        put(&mut img, at(16), &pvd);
        // répertoire racine avec une entrée
        let name = format!("{file_name};1");
        let mut rec = vec![0u8; 33 + name.len() + (name.len() + 1) % 2];
        rec[0] = rec.len() as u8;
        put(&mut rec, 2, &21u32.to_le_bytes());
        put(&mut rec, 10, &(content.len() as u32).to_le_bytes());
        rec[32] = name.len() as u8;
        put(&mut rec, 33, name.as_bytes());
        put(&mut img, at(20), &rec);
        put(&mut img, at(21), content);
        img
    }

    #[test]
    fn playstation_2_via_system_cnf() {
        let iso = mini_iso(
            "PLAYSTATION",
            "SYSTEM.CNF",
            b"BOOT2 = cdrom0:\\SLES_523.76;1\r\nVER = 1.00\r\n",
            2048,
            0,
        );
        let info = detect_bytes(iso, ".iso").unwrap();
        assert_eq!(info.platform_id, "ps2");
        assert_eq!(info.serial.as_deref(), Some("SLES-52376"));
        assert_eq!(info.region, Some(Region::Pal));
    }

    #[test]
    fn playstation_1_en_bin_brut_2352() {
        let iso = mini_iso(
            "PLAYSTATION",
            "SYSTEM.CNF",
            b"BOOT = cdrom:\\SCUS_944.26;1\r\n",
            2352,
            24,
        );
        let info = detect_bytes(iso, ".bin").unwrap();
        assert_eq!(
            (info.platform_id, info.serial.as_deref()),
            ("ps1", Some("SCUS-94426"))
        );
        assert_eq!(info.region, Some(Region::NtscU));
    }

    fn sfo(title: &str, disc_id: &str) -> Vec<u8> {
        let keys = b"DISC_ID\0TITLE\0\0\0";
        let mut v = vec![0u8; 20 + 2 * 16];
        put(&mut v, 0, b"\0PSF");
        let key_table = v.len();
        v.extend_from_slice(keys);
        let data_table = v.len();
        let mut d1 = disc_id.as_bytes().to_vec();
        d1.resize(16, 0);
        let mut d2 = title.as_bytes().to_vec();
        d2.resize(64, 0);
        v.extend_from_slice(&d1);
        v.extend_from_slice(&d2);
        put(&mut v, 8, &(key_table as u32).to_le_bytes());
        put(&mut v, 12, &(data_table as u32).to_le_bytes());
        put(&mut v, 16, &2u32.to_le_bytes());
        // entrée 0 : DISC_ID
        put(&mut v, 20, &0u16.to_le_bytes());
        put(&mut v, 24, &(disc_id.len() as u32 + 1).to_le_bytes());
        put(&mut v, 32, &0u32.to_le_bytes());
        // entrée 1 : TITLE
        put(&mut v, 36, &8u16.to_le_bytes());
        put(&mut v, 40, &(title.len() as u32 + 1).to_le_bytes());
        put(&mut v, 48, &16u32.to_le_bytes());
        v
    }

    #[test]
    fn eboot_pbp_psp_et_ps1() {
        for (psar, expected) in [(&b"NPUMDIMG"[..], "psp"), (&b"PSISOIMG0000"[..], "ps1")] {
            let param = sfo("Patapon", "UCES00995");
            let mut pbp = vec![0u8; 0x28];
            put(&mut pbp, 0, b"\0PBP");
            let sfo_at = pbp.len();
            pbp.extend_from_slice(&param);
            let psar_at = pbp.len();
            pbp.extend_from_slice(psar);
            pbp.resize(pbp.len().max(0x400), 0);
            put(&mut pbp, 0x08, &(sfo_at as u32).to_le_bytes());
            put(&mut pbp, 0x0C, &(psar_at as u32).to_le_bytes());
            put(&mut pbp, 0x24, &(psar_at as u32).to_le_bytes());
            let info = detect_bytes(pbp, ".pbp").unwrap();
            assert_eq!(info.platform_id, expected);
            assert_eq!(info.title.as_deref(), Some("Patapon"));
            assert_eq!(info.region, Some(Region::Pal));
        }
    }

    #[test]
    fn fichier_quelconque_non_reconnu() {
        assert!(detect_bytes(vec![0x42; 0x20000], ".iso").is_none());
        assert!(detect_bytes(b"hello".to_vec(), ".gba").is_none());
    }

    /// Construit un petit fichier NUP conforme à la spécification 1.0.
    fn nup_file(title_id: u64, title: &str) -> Vec<u8> {
        let mut buf = vec![0u8; 0x400];
        put(&mut buf, 0, b"NUP\x01");
        put(&mut buf, 0x80, b"TOC\x01");
        put(&mut buf, 0xB0, &title_id.to_le_bytes());
        buf[0xB0 + 0x18] = 0; // jeu de base
        put(&mut buf, 0xB0 + 0x20, &0x200u64.to_le_bytes());
        let mut meta = Vec::new();
        for (kind, data) in [(1u16, &b"META"[..]), (5u16, title.as_bytes())] {
            meta.extend_from_slice(&kind.to_le_bytes());
            meta.extend_from_slice(&0u16.to_le_bytes());
            meta.extend_from_slice(&(data.len() as u32).to_le_bytes());
            meta.extend_from_slice(data);
        }
        put(&mut buf, 0xB0 + 0x28, &(meta.len() as u32).to_le_bytes());
        put(&mut buf, 0x200, &meta);
        buf
    }

    #[test]
    fn nsp_identifiant_lu_dans_le_nom_du_ticket() {
        let names = b"0123456789abcdef0123456789abcdef.nca\0040000a0b0c0d0000000000000000005.tik\0";
        let mut buf = vec![0u8; 0x400];
        put(&mut buf, 0, b"PFS0");
        put(&mut buf, 4, &2u32.to_le_bytes());
        put(&mut buf, 8, &(names.len() as u32).to_le_bytes());
        put(&mut buf, 0x10 + 2 * 0x18, names);
        let info = detect_bytes(buf, ".nsp").unwrap();
        assert_eq!(info.platform_id, "switch2");
        assert_eq!(info.serial.as_deref(), Some("040000A0B0C0D000"));

        // sans ticket lisible : Switch (affinable par le dossier)
        let mut bare = vec![0u8; 0x100];
        put(&mut bare, 0, b"PFS0");
        assert_eq!(detect_bytes(bare, ".nsp").unwrap().platform_id, "switch");
    }

    #[test]
    fn main_npdm_d_un_jeu_extrait() {
        let mut npdm = vec![0u8; 0x600];
        put(&mut npdm, 0, b"META");
        put(&mut npdm, 0x70, &0x540u32.to_le_bytes());
        put(&mut npdm, 0x540, b"ACI0");
        put(&mut npdm, 0x550, &0x0400_C3F0_0006_E000u64.to_le_bytes());
        let size = npdm.len() as u64;
        let info = npdm_info(npdm, size);
        assert_eq!(info.as_ref().map(|i| i.platform_id), Some("switch2"));
        assert_eq!(info.and_then(|i| i.serial).as_deref(), Some("0400C3F00006E000"));
    }

    fn npdm_info(data: Vec<u8>, size: u64) -> Option<HeaderInfo> {
        npdm(&mut ReaderSource::new(Cursor::new(data), size))
    }

    #[test]
    fn partitions_3ds_ncch_et_3dsx() {
        let mut cxi = vec![0u8; 0x400];
        put(&mut cxi, 0x100, b"NCCH");
        put(&mut cxi, 0x150, b"CTR-P-AXXE");
        assert_eq!(detect_bytes(cxi, ".cxi").map(|i| i.platform_id), Some("3ds"));
        let mut x = vec![0u8; 0x40];
        put(&mut x, 0, b"3DSX");
        assert_eq!(detect_bytes(x, ".3dsx").map(|i| i.platform_id), Some("3ds"));
    }

    #[test]
    fn conteneur_nup_switch_2_et_switch() {
        let info = detect_bytes(nup_file(0x0400_4860_24DE_C000, "The Legend of Zelda: Ocarina of Time"), ".nup").unwrap();
        assert_eq!(info.platform_id, "switch2");
        assert_eq!(info.serial.as_deref(), Some("0400486024DEC000"));
        assert_eq!(info.title.as_deref(), Some("The Legend of Zelda: Ocarina of Time"));

        let info = detect_bytes(nup_file(0x0100_0000_0000_1000, "Jeu Switch"), ".nup").unwrap();
        assert_eq!(info.platform_id, "switch");

        // préfixe inconnu : pas d'attribution au hasard
        assert!(detect_bytes(nup_file(0x0700_0000_0000_0000, "?"), ".nup").is_none());
    }
}
