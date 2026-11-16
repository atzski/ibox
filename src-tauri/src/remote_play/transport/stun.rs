//! Client STUN minimal (RFC 5389, requête *Binding* seulement) : l'hôte découvre ses adresses
//! publiques (candidats *server-reflexive*). str0m n'a aucune E/S : c'est à nous d'interroger les
//! serveurs STUN depuis **la socket même** qui portera la session, avant de démarrer sa lecture.
//!
//! Aucune authentification (STUN public), aucun TURN : jamais de relais. Les serveurs STUN voient
//! l'adresse IP publique, comme tout STUN (`docs/REMOTE-PLAY.md` §6).

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::time::{Duration, Instant};

pub const MAGIC_COOKIE: u32 = 0x2112_A442;
const BINDING_REQUEST: u16 = 0x0001;
const BINDING_SUCCESS: u16 = 0x0101;
const BINDING_ERROR: u16 = 0x0111;
const ATTR_MAPPED_ADDRESS: u16 = 0x0001;
const ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;
const HEADER: usize = 20;
pub const DEFAULT_PORT: u16 = 3478;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StunError {
    /// Pas un message STUN (premiers bits, cookie, longueur).
    NotStun,
    /// Message STUN, mais pas la réponse à notre requête (autre type ou autre transaction).
    Unrelated,
    /// Le serveur a répondu par une erreur.
    ErrorResponse,
    /// Réponse sans adresse lisible.
    NoAddress,
}

/// Requête *Binding* : en-tête seul (20 octets), sans attribut.
pub fn binding_request(transaction: &[u8; 12]) -> [u8; HEADER] {
    let mut out = [0u8; HEADER];
    out[0..2].copy_from_slice(&BINDING_REQUEST.to_be_bytes());
    // longueur des attributs : 0
    out[4..8].copy_from_slice(&MAGIC_COOKIE.to_be_bytes());
    out[8..20].copy_from_slice(transaction);
    out
}

/// Nouvel identifiant de transaction aléatoire (96 bits).
pub fn new_transaction() -> [u8; 12] {
    let mut t = [0u8; 12];
    // l'aléa système ne devrait jamais manquer ; à défaut, l'horloge évite un identifiant nul
    if getrandom::fill(&mut t).is_err() {
        let n = Instant::now().elapsed().as_nanos() ^ std::process::id() as u128;
        t.copy_from_slice(&n.to_le_bytes()[..12]);
    }
    t
}

/// Le paquet ressemble-t-il à un message STUN ? (RFC 5389 §6 : deux premiers bits à 0, cookie)
pub fn is_stun(data: &[u8]) -> bool {
    data.len() >= HEADER && data[0] & 0xC0 == 0 && u32::from_be_bytes([data[4], data[5], data[6], data[7]]) == MAGIC_COOKIE
}

/// Décode la réponse à **notre** requête `transaction` : adresse publique vue par le serveur.
/// XOR-MAPPED-ADDRESS d'abord, MAPPED-ADDRESS (serveurs RFC 3489) en repli.
pub fn parse_binding_response(data: &[u8], transaction: &[u8; 12]) -> Result<SocketAddr, StunError> {
    if !is_stun(data) {
        return Err(StunError::NotStun);
    }
    let kind = u16::from_be_bytes([data[0], data[1]]);
    let length = u16::from_be_bytes([data[2], data[3]]) as usize;
    if !length.is_multiple_of(4) || HEADER + length != data.len() {
        return Err(StunError::NotStun);
    }
    if data[8..20] != transaction[..] {
        return Err(StunError::Unrelated);
    }
    match kind {
        BINDING_SUCCESS => {}
        BINDING_ERROR => return Err(StunError::ErrorResponse),
        _ => return Err(StunError::Unrelated),
    }
    let mut mapped = None;
    let mut xor_mapped = None;
    let mut at = HEADER;
    while at + 4 <= data.len() {
        let attr = u16::from_be_bytes([data[at], data[at + 1]]);
        let len = u16::from_be_bytes([data[at + 2], data[at + 3]]) as usize;
        let start = at + 4;
        let end = start + len;
        if end > data.len() {
            return Err(StunError::NotStun);
        }
        let value = &data[start..end];
        match attr {
            ATTR_XOR_MAPPED_ADDRESS if xor_mapped.is_none() => xor_mapped = parse_address(value, Some(transaction)),
            ATTR_MAPPED_ADDRESS if mapped.is_none() => mapped = parse_address(value, None),
            _ => {}
        }
        // les attributs sont alignés sur 4 octets
        at = start + len.div_ceil(4) * 4;
    }
    xor_mapped.or(mapped).ok_or(StunError::NoAddress)
}

/// (XOR-)MAPPED-ADDRESS : 0, famille (1 = IPv4, 2 = IPv6), port, adresse.
fn parse_address(value: &[u8], xor: Option<&[u8; 12]>) -> Option<SocketAddr> {
    if value.len() < 4 {
        return None;
    }
    let cookie = MAGIC_COOKIE.to_be_bytes();
    let mut port = u16::from_be_bytes([value[2], value[3]]);
    if xor.is_some() {
        port ^= (MAGIC_COOKIE >> 16) as u16;
    }
    let ip = match (value[1], value.len()) {
        (0x01, 8) => {
            let mut b = [value[4], value[5], value[6], value[7]];
            if xor.is_some() {
                b.iter_mut().zip(cookie).for_each(|(x, k)| *x ^= k);
            }
            IpAddr::V4(Ipv4Addr::from(b))
        }
        (0x02, 20) => {
            let mut b = [0u8; 16];
            b.copy_from_slice(&value[4..20]);
            if let Some(t) = xor {
                let key: Vec<u8> = cookie.iter().chain(t.iter()).copied().collect();
                b.iter_mut().zip(key).for_each(|(x, k)| *x ^= k);
            }
            IpAddr::V6(Ipv6Addr::from(b))
        }
        _ => return None,
    };
    Some(SocketAddr::new(ip, port))
}

/// `stun:hôte[:port]` → (hôte, port). `stuns:` (TLS) n'est pas pris en charge : ignoré.
pub fn parse_url(url: &str) -> Option<(String, u16)> {
    let rest = url.trim().strip_prefix("stun:")?;
    let rest = rest.split('?').next()?;
    if rest.is_empty() {
        return None;
    }
    // [IPv6]:port
    if let Some(inner) = rest.strip_prefix('[') {
        let (host, tail) = inner.split_once(']')?;
        let port = match tail.strip_prefix(':') {
            Some(p) => p.parse().ok()?,
            None if tail.is_empty() => DEFAULT_PORT,
            None => return None,
        };
        return Some((host.to_string(), port));
    }
    match rest.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => Some((host.to_string(), port.parse().ok()?)),
        None => Some((rest.to_string(), DEFAULT_PORT)),
        _ => None,
    }
}

/// Adresse publique obtenue d'un serveur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mapping {
    pub server: usize,
    pub mapped: SocketAddr,
}

/// Ce que la collecte a appris d'une socket (jamais journalisé avec les adresses).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Gathered {
    pub local: Option<SocketAddr>,
    /// Serveurs interrogés (résolus dans la bonne famille d'adresses).
    pub asked: usize,
    pub mappings: Vec<Mapping>,
}

/// Comportement du NAT déduit des réponses (RFC 4787) : la même socket vue sous deux adresses
/// différentes par deux serveurs = correspondance dépendante de la destination (« symétrique »),
/// que le perçage UDP ne traverse pas sans relais.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NatKind {
    /// Aucune réponse STUN : UDP sortant bloqué, ou serveurs injoignables.
    NoResponse,
    /// Adresse publique = adresse locale : pas de NAT (souvent IPv6).
    Open,
    /// Même adresse publique pour tous les serveurs (ou un seul a répondu) : perçage possible.
    Consistent,
    /// Adresses publiques différentes selon le serveur : perçage peu probable.
    Symmetric,
}

impl Gathered {
    pub fn nat(&self) -> NatKind {
        let Some(first) = self.mappings.first() else { return NatKind::NoResponse };
        if self.mappings.iter().any(|m| m.mapped != first.mapped) {
            return NatKind::Symmetric;
        }
        if self.local.is_some_and(|l| l == first.mapped) {
            NatKind::Open
        } else {
            NatKind::Consistent
        }
    }

    /// Adresses publiques distinctes (candidats `srflx`).
    pub fn reflexive(&self) -> Vec<SocketAddr> {
        let mut out: Vec<SocketAddr> = Vec::new();
        for m in &self.mappings {
            if !out.contains(&m.mapped) {
                out.push(m.mapped);
            }
        }
        out
    }
}

/// Résout les serveurs dans la famille d'adresses de la socket.
pub fn resolve(servers: &[String], ipv6: bool) -> Vec<SocketAddr> {
    servers
        .iter()
        .filter_map(|s| parse_url(s))
        .filter_map(|(host, port)| (host.as_str(), port).to_socket_addrs().ok()?.find(|a| a.is_ipv6() == ipv6))
        .collect()
}

/// Interroge chaque serveur depuis `socket` (requêtes répétées à 0, 250, 750 ms, comme RFC 5389
/// §7.2.1 en plus court) jusqu'à `timeout`. Les paquets étrangers sont ignorés. La socket ne doit
/// pas encore être lue par un autre fil.
pub fn gather(socket: &UdpSocket, servers: &[SocketAddr], timeout: Duration) -> Gathered {
    let mut out = Gathered { local: socket.local_addr().ok(), asked: servers.len(), mappings: Vec::new() };
    if servers.is_empty() {
        return out;
    }
    let pending: Vec<[u8; 12]> = servers.iter().map(|_| new_transaction()).collect();
    let mut done = vec![false; servers.len()];
    let started = Instant::now();
    let resend_at = [Duration::ZERO, Duration::from_millis(250), Duration::from_millis(750)];
    let mut sent = 0usize;
    let mut buf = [0u8; 1500];
    while started.elapsed() < timeout && done.iter().any(|d| !d) {
        if sent < resend_at.len() && started.elapsed() >= resend_at[sent] {
            for (i, server) in servers.iter().enumerate() {
                if !done[i] {
                    let _ = socket.send_to(&binding_request(&pending[i]), server);
                }
            }
            sent += 1;
        }
        let next = resend_at.get(sent).copied().unwrap_or(timeout).min(timeout);
        let wait = next.saturating_sub(started.elapsed()).max(Duration::from_millis(5));
        let _ = socket.set_read_timeout(Some(wait));
        // délai écoulé ou paquet étranger : on continue jusqu'à l'échéance
        if let Ok((n, from)) = socket.recv_from(&mut buf) {
            for (i, t) in pending.iter().enumerate() {
                if done[i] || from != servers[i] {
                    continue;
                }
                if let Ok(mapped) = parse_binding_response(&buf[..n], t) {
                    done[i] = true;
                    out.mappings.push(Mapping { server: i, mapped });
                }
            }
        }
    }
    let _ = socket.set_read_timeout(None);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Transaction des vecteurs de test de la RFC 5769 (§2.2, §2.3).
    const TX: [u8; 12] = [0xb7, 0xe7, 0xa7, 0x01, 0xbc, 0x34, 0xd6, 0x86, 0xfa, 0x87, 0xdf, 0xae];

    fn header(kind: u16, len: u16, tx: &[u8; 12]) -> Vec<u8> {
        let mut v = kind.to_be_bytes().to_vec();
        v.extend_from_slice(&len.to_be_bytes());
        v.extend_from_slice(&MAGIC_COOKIE.to_be_bytes());
        v.extend_from_slice(tx);
        v
    }

    /// RFC 5769 §2.2 : réponse IPv4 (SOFTWARE, XOR-MAPPED-ADDRESS, MESSAGE-INTEGRITY, FINGERPRINT).
    fn rfc5769_ipv4() -> Vec<u8> {
        let mut v = header(BINDING_SUCCESS, 0x3c, &TX);
        v.extend_from_slice(&[0x80, 0x22, 0x00, 0x0b]);
        v.extend_from_slice(b"test vector ");
        v.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x01, 0xa1, 0x47, 0xe1, 0x12, 0xa6, 0x43]);
        v.extend_from_slice(&[0x00, 0x08, 0x00, 0x14]);
        v.extend_from_slice(&[0x2b, 0x91, 0xf5, 0x99, 0xfd, 0x9e, 0x90, 0xc3, 0x8c, 0x74, 0x89, 0xf9, 0x2a, 0xf9, 0xba, 0x53, 0xf0, 0x6b, 0xe7, 0xd7]);
        v.extend_from_slice(&[0x80, 0x28, 0x00, 0x04, 0xc0, 0x7d, 0x4c, 0x96]);
        v
    }

    #[test]
    fn requete_binding() {
        let r = binding_request(&TX);
        assert_eq!(&r[0..4], &[0x00, 0x01, 0x00, 0x00]);
        assert_eq!(&r[4..8], &[0x21, 0x12, 0xa4, 0x42]);
        assert_eq!(&r[8..], &TX);
        assert!(is_stun(&r));
        // une requête n'est pas une réponse
        assert_eq!(parse_binding_response(&r, &TX), Err(StunError::Unrelated));
        assert_ne!(new_transaction(), new_transaction());
    }

    #[test]
    fn xor_mapped_address_ipv4_rfc5769() {
        let v = rfc5769_ipv4();
        assert_eq!(v.len(), 80);
        assert_eq!(parse_binding_response(&v, &TX), Ok("192.0.2.1:32853".parse().unwrap()));
    }

    #[test]
    fn xor_mapped_address_ipv6_rfc5769() {
        let mut v = header(BINDING_SUCCESS, 24, &TX);
        v.extend_from_slice(&[0x00, 0x20, 0x00, 0x14, 0x00, 0x02, 0xa1, 0x47]);
        v.extend_from_slice(&[0x01, 0x13, 0xa9, 0xfa, 0xa5, 0xd3, 0xf1, 0x79, 0xbc, 0x25, 0xf4, 0xb5, 0xbe, 0xd2, 0xb9, 0xd9]);
        assert_eq!(parse_binding_response(&v, &TX), Ok("[2001:db8:1234:5678:11:2233:4455:6677]:32853".parse().unwrap()));
    }

    #[test]
    fn autre_transaction_refusee() {
        let v = rfc5769_ipv4();
        let mut other = TX;
        other[11] ^= 1;
        assert_eq!(parse_binding_response(&v, &other), Err(StunError::Unrelated));
    }

    #[test]
    fn mapped_address_en_repli_et_xor_prioritaire() {
        // MAPPED-ADDRESS seul (serveur ancien) : 198.51.100.7:4000 en clair
        let mut v = header(BINDING_SUCCESS, 12, &TX);
        v.extend_from_slice(&[0x00, 0x01, 0x00, 0x08, 0x00, 0x01, 0x0f, 0xa0, 198, 51, 100, 7]);
        assert_eq!(parse_binding_response(&v, &TX), Ok("198.51.100.7:4000".parse().unwrap()));
        // les deux : XOR-MAPPED-ADDRESS l'emporte (un NAT « intelligent » réécrit l'adresse en clair)
        let mut both = header(BINDING_SUCCESS, 24, &TX);
        both.extend_from_slice(&[0x00, 0x01, 0x00, 0x08, 0x00, 0x01, 0x0f, 0xa0, 198, 51, 100, 7]);
        both.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x01, 0xa1, 0x47, 0xe1, 0x12, 0xa6, 0x43]);
        assert_eq!(parse_binding_response(&both, &TX), Ok("192.0.2.1:32853".parse().unwrap()));
    }

    #[test]
    fn messages_invalides() {
        let v = rfc5769_ipv4();
        // tronqué, longueur annoncée fausse, cookie absent, octets RTP/DTLS
        assert_eq!(parse_binding_response(&v[..60], &TX), Err(StunError::NotStun));
        let mut bad_len = v.clone();
        bad_len[3] = 0x40;
        assert_eq!(parse_binding_response(&bad_len, &TX), Err(StunError::NotStun));
        let mut no_cookie = v.clone();
        no_cookie[4] = 0;
        assert_eq!(parse_binding_response(&no_cookie, &TX), Err(StunError::NotStun));
        assert_eq!(parse_binding_response(&[0x80; 40], &TX), Err(StunError::NotStun));
        assert_eq!(parse_binding_response(&[22, 254, 253, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], &TX), Err(StunError::NotStun));
        // attribut qui déborde du message
        let mut overflow = header(BINDING_SUCCESS, 8, &TX);
        overflow.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x01, 0xa1, 0x47]);
        assert_eq!(parse_binding_response(&overflow, &TX), Err(StunError::NotStun));
        // réponse d'erreur, réponse sans adresse, famille inconnue
        assert_eq!(parse_binding_response(&header(BINDING_ERROR, 0, &TX), &TX), Err(StunError::ErrorResponse));
        assert_eq!(parse_binding_response(&header(BINDING_SUCCESS, 0, &TX), &TX), Err(StunError::NoAddress));
        let mut family = header(BINDING_SUCCESS, 12, &TX);
        family.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x03, 0xa1, 0x47, 0xe1, 0x12, 0xa6, 0x43]);
        assert_eq!(parse_binding_response(&family, &TX), Err(StunError::NoAddress));
    }

    #[test]
    fn adresses_de_serveurs() {
        assert_eq!(parse_url("stun:stun.cloudflare.com:3478"), Some(("stun.cloudflare.com".into(), 3478)));
        assert_eq!(parse_url("stun:stun.l.google.com:19302"), Some(("stun.l.google.com".into(), 19302)));
        assert_eq!(parse_url("stun:example.net"), Some(("example.net".into(), DEFAULT_PORT)));
        assert_eq!(parse_url("stun:[2001:db8::1]:3479"), Some(("2001:db8::1".into(), 3479)));
        assert_eq!(parse_url("stun:[2001:db8::1]"), Some(("2001:db8::1".into(), DEFAULT_PORT)));
        assert_eq!(parse_url("stun:2001:db8::1"), None);
        assert_eq!(parse_url("stuns:example.net:5349"), None);
        assert_eq!(parse_url("turn:example.net"), None);
        assert_eq!(parse_url("stun:host:notaport"), None);
        assert_eq!(parse_url("stun:"), None);
    }

    #[test]
    fn type_de_nat() {
        let local: SocketAddr = "192.168.1.10:5000".parse().unwrap();
        let a: SocketAddr = "203.0.113.5:40000".parse().unwrap();
        let b: SocketAddr = "203.0.113.5:40001".parse().unwrap();
        let g = |m: Vec<SocketAddr>| Gathered { local: Some(local), asked: 2, mappings: m.into_iter().enumerate().map(|(server, mapped)| Mapping { server, mapped }).collect() };
        assert_eq!(g(vec![]).nat(), NatKind::NoResponse);
        assert_eq!(g(vec![a]).nat(), NatKind::Consistent);
        assert_eq!(g(vec![a, a]).nat(), NatKind::Consistent);
        assert_eq!(g(vec![a, a]).reflexive(), vec![a]);
        assert_eq!(g(vec![a, b]).nat(), NatKind::Symmetric);
        assert_eq!(g(vec![a, b]).reflexive(), vec![a, b]);
        assert_eq!(g(vec![local]).nat(), NatKind::Open);
    }

    /// Faux serveur STUN local : répond à la deuxième requête seulement (la première est
    /// « perdue ») et envoie d'abord une réponse pour une autre transaction, à ignorer.
    #[test]
    fn collecte_avec_perte_et_reponse_etrangere() {
        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        let server_addr = server.local_addr().unwrap();
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        let client_addr = client.local_addr().unwrap();
        let t = std::thread::spawn(move || {
            let mut buf = [0u8; 100];
            let (_, _) = server.recv_from(&mut buf).unwrap(); // perdue
            let (n, from) = server.recv_from(&mut buf).unwrap();
            assert_eq!(n, 20);
            let mut tx = [0u8; 12];
            tx.copy_from_slice(&buf[8..20]);
            let reply = |tx: &[u8; 12], port: u16| {
                let mut v = header(BINDING_SUCCESS, 12, tx);
                let xport = port ^ 0x2112;
                v.extend_from_slice(&[0x00, 0x20, 0x00, 0x08, 0x00, 0x01]);
                v.extend_from_slice(&xport.to_be_bytes());
                v.extend_from_slice(&[203 ^ 0x21, 0 ^ 0x12, 113 ^ 0xa4, 9 ^ 0x42]);
                v
            };
            let mut other = tx;
            other[0] ^= 0xff;
            server.send_to(&reply(&other, 1111), from).unwrap();
            server.send_to(&reply(&tx, 50000), from).unwrap();
        });
        let got = gather(&client, &[server_addr], Duration::from_secs(2));
        t.join().unwrap();
        assert_eq!(got.local, Some(client_addr));
        assert_eq!(got.mappings, vec![Mapping { server: 0, mapped: "203.0.113.9:50000".parse().unwrap() }]);
        assert_eq!(got.nat(), NatKind::Consistent);
    }

    #[test]
    fn collecte_sans_reponse() {
        let silent = UdpSocket::bind("127.0.0.1:0").unwrap();
        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        let started = Instant::now();
        let got = gather(&client, &[silent.local_addr().unwrap()], Duration::from_millis(400));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(got.nat(), NatKind::NoResponse);
    }

    /// Essai réel (réseau requis) : `cargo test --lib stun_real -- --ignored --nocapture`.
    #[test]
    #[ignore = "réseau réel : serveurs STUN publics"]
    fn stun_real() {
        let servers: Vec<String> = crate::remote_play::config::Config::default().stun_servers;
        let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
        let resolved = resolve(&servers, false);
        let got = gather(&socket, &resolved, Duration::from_secs(3));
        // pas d'adresse dans la sortie : seulement le nombre de réponses et le type de NAT
        println!("STUN IPv4 : {} serveur(s) interrogé(s), {} réponse(s), NAT {:?}", got.asked, got.mappings.len(), got.nat());
        assert!(!got.mappings.is_empty(), "aucune réponse STUN");
        let v6 = resolve(&servers, true);
        if let Ok(s6) = UdpSocket::bind("[::]:0") {
            let g6 = gather(&s6, &v6, Duration::from_secs(3));
            println!("STUN IPv6 : {} serveur(s), {} réponse(s), NAT {:?}", g6.asked, g6.mappings.len(), g6.nat());
        }
    }
}
