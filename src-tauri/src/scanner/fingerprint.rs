//! Empreinte rapide d'un fichier : taille + xxh3 des 64 premiers et derniers Kio.
//! Lit quelques octets seulement (même pour une image de 8 Go), en lecture seule.
//! Sert à reconnaître un jeu déplacé ou renommé, et les doublons.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use xxhash_rust::xxh3::Xxh3;

const CHUNK: u64 = 64 * 1024;

pub fn fingerprint(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?; // lecture seule
    let size = file.metadata()?.len();
    fingerprint_reader(&mut file, size)
}

pub fn fingerprint_reader<R: Read + Seek>(r: &mut R, size: u64) -> io::Result<String> {
    let mut hasher = Xxh3::new();
    hasher.update(&size.to_le_bytes());

    let mut buf = vec![0u8; CHUNK.min(size) as usize];
    r.seek(SeekFrom::Start(0))?;
    r.read_exact(&mut buf)?;
    hasher.update(&buf);

    if size > CHUNK {
        let tail = CHUNK.min(size - CHUNK);
        let mut buf = vec![0u8; tail as usize];
        r.seek(SeekFrom::Start(size - tail))?;
        r.read_exact(&mut buf)?;
        hasher.update(&buf);
    }
    Ok(format!("{size:x}-{:016x}", hasher.digest()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn fp(data: &[u8]) -> String {
        fingerprint_reader(&mut Cursor::new(data), data.len() as u64).unwrap()
    }

    #[test]
    fn identique_pour_un_meme_contenu() {
        let a = vec![7u8; 300_000];
        assert_eq!(fp(&a), fp(&a.clone()));
    }

    #[test]
    fn differe_si_le_debut_la_fin_ou_la_taille_change() {
        let base = vec![1u8; 300_000];
        let mut head = base.clone();
        head[10] = 2;
        let mut tail = base.clone();
        tail[299_990] = 2;
        let mut longer = base.clone();
        longer.push(1);
        let f = fp(&base);
        assert_ne!(f, fp(&head));
        assert_ne!(f, fp(&tail));
        assert_ne!(f, fp(&longer));
    }

    #[test]
    fn gere_les_petits_fichiers() {
        assert!(fp(b"abc").starts_with("3-"));
        assert!(fp(b"").starts_with("0-"));
    }
}
