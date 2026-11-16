//! Outils SDP pour l'échange manuel (boucle locale, LAN) en attendant la signalisation iNetbox.

use sha2::{Digest, Sha256};

use crate::remote_play::signaling::envelope::normalize_fingerprint;

/// Retire les candidats ICE en `.local` (mDNS) : Chromium masque ainsi les adresses locales et
/// str0m ne les résout pas. L'invité est alors découvert comme candidat *peer-reflexive* quand
/// ses requêtes STUN arrivent sur un candidat de l'hôte.
pub fn strip_mdns_candidates(sdp: &str) -> String {
    let mut out = String::with_capacity(sdp.len());
    for line in sdp.split_inclusive('\n') {
        let l = line.trim_end_matches(['\r', '\n']);
        let mdns = l.strip_prefix("a=candidate:").is_some_and(|c| c.split_whitespace().nth(4).is_some_and(|a| a.to_ascii_lowercase().ends_with(".local")));
        if !mdns {
            out.push_str(line);
        }
    }
    out
}

/// Première empreinte DTLS (`a=fingerprint:`) du SDP, normalisée.
pub fn fingerprint(sdp: &str) -> Option<String> {
    sdp.lines().find_map(|l| l.trim_end_matches('\r').strip_prefix("a=fingerprint:")).and_then(|f| normalize_fingerprint(f).ok())
}

/// Code de vérification de l'échange manuel : 3 groupes de 4 chiffres dérivés des empreintes
/// DTLS de l'offre puis de la réponse. Identique sur les deux PC si personne ne s'est interposé ;
/// calculé de la même façon par `src/services/remotePlayGuest.ts`.
pub fn verification_code(offer_fingerprint: &str, answer_fingerprint: &str) -> String {
    let digest = Sha256::new()
        .chain_update(b"ibox-rp-lan/1\n")
        .chain_update(offer_fingerprint.as_bytes())
        .chain_update(b"\n")
        .chain_update(answer_fingerprint.as_bytes())
        .finalize();
    digest
        .chunks(2)
        .take(3)
        .map(|c| format!("{:04}", u16::from_be_bytes([c[0], c[1]]) % 10_000))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const FP: &str = "sha-256 ab:CD:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD";

    #[test]
    fn retire_seulement_les_candidats_mdns() {
        let sdp = "v=0\r\na=candidate:1 1 udp 2122260223 4b1c-xx.local 53211 typ host\r\na=candidate:2 1 udp 2122260223 192.168.1.20 53212 typ host\r\na=end-of-candidates\r\n";
        let out = strip_mdns_candidates(sdp);
        assert!(!out.contains(".local"));
        assert!(out.contains("192.168.1.20 53212"));
        assert!(out.ends_with("a=end-of-candidates\r\n"));
    }

    #[test]
    fn empreinte_et_code() {
        let sdp = format!("v=0\r\na=fingerprint:{FP}\r\n");
        let fp = fingerprint(&sdp).unwrap();
        assert!(fp.starts_with("sha-256 AB:CD:00"));
        let code = verification_code(&fp, "sha-256 00");
        assert_eq!(code.len(), 14);
        assert!(code.chars().all(|c| c.is_ascii_digit() || c == ' '));
        assert_ne!(code, verification_code("sha-256 00", &fp), "l'ordre offre/réponse compte");
        // valeur figée : le calcul TypeScript doit donner la même (remotePlayGuest.test.ts)
        assert_eq!(verification_code("A", "B"), EXPECTED_AB);
    }

    /// SHA-256("ibox-rp-lan/1\nA\nB") — partagé avec le test TypeScript.
    const EXPECTED_AB: &str = "0351 4052 4831";
}
