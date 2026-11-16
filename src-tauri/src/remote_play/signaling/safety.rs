//! Code de sécurité : 6 groupes de 5 chiffres dérivés des deux clés publiques, identiques des
//! deux côtés (ordre des clés indifférent). Les deux amis le comparent de vive voix ; un serveur
//! qui aurait substitué une clé produirait un code différent.

use ed25519_dalek::VerifyingKey;
use sha2::{Digest, Sha512};

const CONTEXT: &[u8] = b"ibox-rp-safety/1";
/// Itérations du hachage : rend coûteuse la recherche d'une clé au code voisin.
const ROUNDS: usize = 4096;

pub fn safety_code(a: &VerifyingKey, b: &VerifyingKey) -> String {
    let (a, b) = (a.to_bytes(), b.to_bytes());
    let (low, high) = if a <= b { (a, b) } else { (b, a) };
    let mut digest = Sha512::new().chain_update(CONTEXT).chain_update(low).chain_update(high).finalize();
    for _ in 1..ROUNDS {
        digest = Sha512::new().chain_update(digest).chain_update(low).chain_update(high).finalize();
    }
    digest
        .chunks(5)
        .take(6)
        .map(|chunk| {
            let n = chunk.iter().fold(0u64, |acc, &x| (acc << 8) | u64::from(x));
            format!("{:05}", n % 100_000)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote_play::signaling::identity::DeviceKey;

    #[test]
    fn meme_code_des_deux_cotes() {
        let a = DeviceKey::from_seed(&[1; 32]).verifying_key();
        let b = DeviceKey::from_seed(&[2; 32]).verifying_key();
        let code = safety_code(&a, &b);
        assert_eq!(code, safety_code(&b, &a));
        let groups: Vec<&str> = code.split(' ').collect();
        assert_eq!(groups.len(), 6);
        assert!(groups.iter().all(|g| g.len() == 5 && g.chars().all(|c| c.is_ascii_digit())));
    }

    #[test]
    fn cle_substituee_code_different() {
        let a = DeviceKey::from_seed(&[1; 32]).verifying_key();
        let b = DeviceKey::from_seed(&[2; 32]).verifying_key();
        let mallory = DeviceKey::from_seed(&[3; 32]).verifying_key();
        assert_ne!(safety_code(&a, &b), safety_code(&a, &mallory));
        assert_ne!(safety_code(&a, &b), safety_code(&mallory, &b));
    }
}
