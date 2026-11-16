//! Remote Play, Phases 1c et 2 : transport P2P de l'hôte avec str0m (ICE, DTLS, SRTP, SCTP, BWE).
//!
//! - [`peer::HostPeer`] : machine à états sans E/S (offre, réponse, vidéo H.264, DataChannels
//!   `input`/`control`, estimation de bande passante, statistiques) ;
//! - [`host::Host`] : fils réels — sockets UDP bloquantes, capture + encodage, boucle str0m ;
//! - [`router`] : filtre des messages reçus avant `Session::authorize` ;
//! - [`rate`] : adaptation du débit de l'encodeur à l'estimation TWCC.
//!
//! Signalisation provisoire : échange manuel des SDP (boucle locale par commandes Tauri, LAN par
//! copier-coller) tant que la boîte aux lettres iNetbox n'est pas déployée. Voir
//! `docs/REMOTE-PLAY.md` §11.

pub mod host;
pub mod peer;
pub mod rate;
pub mod router;
pub mod sdp;
pub mod stats;
pub mod stun;


#[cfg(test)]
mod tests;
#[cfg(test)]
mod loopback_tests;
