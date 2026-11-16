# iBox Remote Play — étude technique (Phase 0)

> État : **fondations**. Aucune image ni aucune commande ne circule encore entre deux ordinateurs.
> Ce document fixe l'architecture, les choix techniques, le protocole, le modèle de menaces et la
> feuille de route. Tout ce qui est marqué « à vérifier » doit être confirmé par une mesure ou un
> essai avant d'être annoncé aux utilisateurs.

## 1. Existant réutilisé

| Besoin Remote Play | Existant iBox |
|---|---|
| Amis, présence, invitations | `inetbox.rs` (pouls natif 10 s, `route`/`perform`), `services/inetbox.ts`, `FriendViews.tsx`, serveur Fastify `services/inetbox/` (Render + Neon) |
| Fenêtre de notification (invitation reçue) | `toast.rs` + `ToastWindow.tsx` (kind `invite`) |
| Jeu en cours (Game Share automatique) | `pc/running.rs::find_process`, `launcher/` |
| Manettes côté invité | `input/gamepad.ts` (API Gamepad de WebView2, P1–P8) |
| Secrets locaux | `metadata/keys` (coffre Windows via `keyring-core`) |
| Overlay pendant une partie | fenêtre `overlay` (`capture.rs`, Alt+E) |
| Paramètres, traductions | `SettingsScreen.tsx` (`CATEGORIES`), `i18n/en.ts` |

## 2. Architecture retenue : hôte natif, invité WebView2

```
 HÔTE (Rust natif)                                         INVITÉ (WebView2 d'iBox)
 ┌───────────────────────────────────────────┐            ┌──────────────────────────────┐
 │ capture  : Windows Graphics Capture (D3D11)│            │ RTCPeerConnection (Chromium) │
 │ encodage : Media Foundation matériel       │  SRTP/UDP  │  décodage matériel, rendu    │
 │            (NVENC / AMF / QSV via MFT)     │ ─────────► │  <video>, tampon minimal     │
 │ audio    : WASAPI loopback → Opus          │            │                              │
 │ transport: str0m (ICE, DTLS, SRTP, SCTP)   │ ◄───────── │ DataChannels : entrées,      │
 │ entrées  : SendInput + manettes virtuelles │  SCTP/DTLS │  manettes (API Gamepad), chat│
 │ permissions : remote_play::permissions     │            └──────────────────────────────┘
 └───────────────────────────────────────────┘
          ▲  signalisation seulement (SDP, candidats ICE, empreintes signées)
          └──────────── iNetbox (Render) ─────────────┘   jamais de média, jamais d'entrées
```

**Pourquoi l'invité dans WebView2 plutôt qu'un décodeur natif ?** WebView2 embarque la pile WebRTC
de Chromium : décodage matériel H.264/AV1 (HEVC selon le matériel), tampon de gigue, contrôle de
congestion (GCC/TWCC), rendu vidéo sans aucune copie passant par l'IPC Tauri. iBox utilise déjà
l'API Gamepad dans ce WebView. Le même client servira plus tard de client web / mobile.
Le tampon est réglable (`RTCRtpReceiver.jitterBufferTarget`, à vérifier sur la version de WebView2
livrée) ; un client natif reste possible si les mesures montrent un retard inacceptable.

**Pourquoi l'hôte en Rust natif ?** `getDisplayMedia` ne permet ni de choisir l'encodeur, ni de
capturer le son d'un seul processus, ni d'injecter des entrées. L'hôte doit être natif pour la
capture, l'encodage matériel, l'injection d'entrées et le contrôle des permissions.

### Modules (`src-tauri/src/remote_play/`)

| Module | Rôle | Phase |
|---|---|---|
| `mod.rs` | interrupteur général, commandes Tauri, arrêt d'urgence | 1 ✅ |
| `config.rs` | réglages bornés (`remote-play.json`), désactivé par défaut | 1 ✅ |
| `permissions.rs` | droits par participant, profils, plafond par mode, arrêt d'urgence | 1 ✅ |
| `protocol.rs` | format binaire des messages des DataChannels, décodage strict | 1 ✅ |
| `diagnostics.rs` | version Windows, capture, GPU, encodeurs/décodeurs, audio | 1 ✅ |
| `capture/` | WGC (fenêtre/écran), repli DXGI Desktop Duplication | 1 |
| `encode/` | MFT matériels H.264/HEVC/AV1, repli logiciel MS H.264 | 1 |
| `audio/` | WASAPI loopback, loopback par processus, Opus | 1 |
| `transport/` | str0m, ICE/STUN, statistiques | 2 |
| `input/` | SendInput, état des touches tenues, manettes virtuelles | 3 |
| `signaling/` | échanges iNetbox, identité des appareils | 4 |

## 3. Comparaison des bibliothèques

### Transport P2P (hôte)
| Candidat | Licence | Points forts | Points faibles | Verdict |
|---|---|---|---|---|
| **str0m** | MIT/Apache-2.0 | Rust pur, *sans E/S* (on maîtrise le fil réseau), ICE, DTLS, SRTP, SCTP, BWE, statistiques | API bas niveau | **Retenu** |
| webrtc-rs | MIT/Apache-2.0 | API proche du navigateur | lourd (tokio partout), maintenance ralentie au profit d'une réécriture | écarté |
| libwebrtc (Google) | BSD | référence | build C++ énorme, liaison fragile | écarté |
| QUIC (quinn) + ICE maison | MIT/Apache | moderne | pas de traversée NAT ni de compatibilité navigateur | écarté |

Back-end cryptographique de str0m : OpenSSL ou cryptographie Windows (fonction `wincrypto`) — à
vérifier sur la version retenue ; la cryptographie Windows évite de livrer OpenSSL.

### Capture
| Candidat | Couverture | Verdict |
|---|---|---|
| **Windows Graphics Capture** (`windows` crate, déjà dans l'arbre) | fenêtre ou écran, DX9/11/12, Vulkan, OpenGL fenêtré/sans bordure, curseur, Windows 10 1803+ (bordure jaune retirable : Windows 11 / build 20348+) | **Retenu** |
| DXGI Desktop Duplication | écran entier, plein écran exclusif, Windows 8+ | **Repli** |
| crate `windows-capture` | WGC enveloppé (MIT) | écarté : on garde le contrôle du device D3D11 partagé avec l'encodeur |
| GDI (`capture.rs` actuel) | lent, copie CPU | réservé aux captures d'écran Alt+E |

Les contenus protégés (DRM, fenêtres `WDA_EXCLUDEFROMCAPTURE`) apparaissent noirs : c'est voulu, aucun contournement.

### Encodage / décodage
| Candidat | Licence / brevets | Verdict |
|---|---|---|
| **Media Foundation (MFT matériels)** | API Windows ; NVENC, AMF, Quick Sync s'y exposent ; les codecs sont fournis par le système/le pilote : iBox ne distribue aucun codec breveté | **Retenu** |
| SDK NVENC / AMF / oneVPL directs | en-têtes MIT/permissives | plus tard, si MF limite la latence (mode bas délai, intra-refresh) |
| FFmpeg | LGPL/GPL + brevets à la distribution | écarté |
| openh264 (Cisco) | BSD, binaire Cisco couvert par leur licence MPEG LA | repli logiciel possible ; MS H.264 MFT d'abord |

HEVC : le décodeur Windows nécessite l'extension « HEVC Video Extensions » ; il est proposé
seulement si les deux côtés le déclarent. AV1 : encodeur matériel sur RTX 40+, RX 7000+, Arc.
**Négociation** : l'hôte n'offre dans le SDP que les codecs qu'il sait encoder ; l'invité ne
répond qu'avec ceux qu'il sait décoder (`RTCRtpReceiver.getCapabilities`).

### Audio
WASAPI loopback (son complet) ; loopback **par processus** (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`,
Windows 10 build 20348+, à vérifier sur 19041) pour « le jeu seulement ». Opus 48 kHz stéréo
(libopus, BSD) — crate de liaison à choisir en Phase 1 (compilation C requise).

### Manettes virtuelles (hôte)
| Candidat | État | Verdict |
|---|---|---|
| ViGEmBus | signé, très répandu, BSD-3, **fin de vie annoncée (2023)** | utilisé **seulement s'il est déjà installé** ou après accord explicite ; jamais installé en silence |
| Pilote VHF maison | signature EV + WHQL coûteuse | écarté à court terme |
| Entrée native des émulateurs | sans pilote, au cas par cas | à étudier (RetroArch) |

Risque principal du projet : sans pilote de manette virtuelle maintenu, le mode Local Multiplayer
dépend de ViGEmBus. Le diagnostic le signale honnêtement.

### Entrées clavier/souris
`SendInput` avec **codes de balayage** (indépendants de la disposition AZERTY/QWERTY de l'hôte).
Limites Windows respectées : l'UIPI empêche d'agir sur une fenêtre élevée (iBox n'est jamais
élevé), le bureau sécurisé (UAC, Ctrl+Alt+Suppr, écran de connexion) est inaccessible.

## 4. Protocole (v1)

Signalisation (via iNetbox, TLS) : `offer`/`answer` SDP + candidats ICE, enveloppés et **signés
par la clé d'appareil** (voir §5). Média : RTP/SRTP. Données : deux DataChannels SCTP/DTLS.

| Canal | Mode | Contenu |
|---|---|---|
| `input` | non ordonné, 0 retransmission | souris (absolue/relative), état complet des manettes, état des touches tenues — la donnée la plus récente gagne (`seq`) |
| `control` | fiable, ordonné | touches (appui/relâchement), boutons, molette, chat, ping |

Format binaire, petit-boutiste, 1 octet de type puis charge de **longueur exacte**
(`src-tauri/src/remote_play/protocol.rs`, taille max 64 octets hors chat, chat ≤ 500 octets UTF-8) :

| Type | Message | Charge |
|---|---|---|
| `0x10` | MouseAbs | seq u32, x u16, y u16 (0–65535 normalisés sur la zone partagée) |
| `0x11` | MouseRel | seq u32, dx i16, dy i16 |
| `0x12` | MouseButton | bouton u8 (0–4), appui u8 (0/1) |
| `0x13` | Wheel | dx i16, dy i16 |
| `0x20` | Key | scancode u16, appui u8 |
| `0x21` | KeyState | seq u32, n u8 (≤ 16), n × scancode u16 — resynchronisation toutes les 250 ms |
| `0x30` | Gamepad | pad u8 (0–3), seq u32, boutons u16, LT u8, RT u8, LX/LY/RX/RY i16 (disposition XInput) |
| `0x40` | Chat | longueur u16, UTF-8 |
| `0x50`/`0x51` | Ping/Pong | id u32, horodatage µs u64 |

Toute anomalie (type inconnu, longueur différente, valeur hors domaine, UTF-8 invalide) rejette le
message sans effet. Une touche absente d'un `KeyState` est relâchée ; à la déconnexion, tout ce que
le participant tenait est relâché.

## 5. Identité et modèle de menaces

**Identité d'appareil** : chaque iBox crée une paire Ed25519 gardée dans le coffre Windows ; la clé
publique est déclarée à iNetbox. Chaque offre/réponse SDP est signée et contient l'empreinte DTLS ;
le pair vérifie la signature, puis que l'empreinte DTLS négociée est bien celle signée. La clé du
pair est **épinglée** au premier contact et un **code de sécurité** (6 groupes de chiffres dérivés des
deux clés) peut être comparé de vive voix. Un changement de clé bloque la session et prévient.

| Menace | Contre-mesure |
|---|---|
| Interception de la signalisation | TLS vers iNetbox ; SDP signé par l'appareil ; DTLS lié à l'empreinte signée |
| Serveur iNetbox compromis qui substitue une clé | épinglage au premier contact, alerte en cas de changement, code de sécurité |
| Rejeu d'une invitation | jeton aléatoire 128 bits à usage unique, expiration 2 min, consommé côté serveur et côté hôte |
| Invitations abusives | limite par compte et par ami côté serveur, blocage d'utilisateur, « refuser toutes les demandes » |
| Invité qui envoie des entrées non autorisées | `permissions::Session::authorize` dans le moteur Rust, refus par défaut, plafond par mode |
| Messages malformés / trop gros | décodage strict à longueur exacte, tailles bornées, aucun `panic` |
| Touches restées enfoncées | relâchement fiable + `KeyState` périodique + `release_all` à la déconnexion |
| Prise de contrôle de l'ordinateur | aucune API de commande, de terminal ou de fichiers ; UAC et bureau sécurisé hors d'atteinte ; Contrôle complet derrière une confirmation distincte |
| Session cachée | indicateur permanent côté hôte, raccourci d'arrêt d'urgence, arrêt au verrouillage / changement d'utilisateur |
| Fuite d'adresse IP | avertissement avant la première session P2P ; pas de relais imposé |
| Journaux | aucun jeton, SDP complet ou adresse dans les journaux |

## 6. Rôle strict d'iNetbox

Autorisé : authentification, présence, invitations, identifiant de session, boîte aux lettres de
signalisation **en mémoire** (TTL 60 s, supprimée à la lecture, ≤ 16 Ko par message), clés publiques
d'appareil. Interdit : média, entrées, captures, presse-papiers, relais. Le serveur Render n'a pas
de serveur TURN ; un TURN personnel pourra être saisi plus tard, jamais utilisé en silence.
STUN par défaut : serveurs publics configurables (ils voient l'adresse IP publique, comme tout STUN).

## 7. Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 0 | cette étude | ✅ |
| 1a | interrupteur général (désactivé par défaut), permissions, protocole, configuration, diagnostic réel | ✅ |
| 1b | capture WGC + encodage MF H.264 + mesure capture/encodage (fichier `.h264` local) | à faire |
| 1c | boucle locale : hôte str0m ↔ WebView2 sur la même machine, audio WASAPI/Opus | à faire |
| 2 | deux PC du même réseau, adaptation du débit, statistiques | à faire |
| 3 | SendInput, manettes (ViGEm si présent), arrêt d'urgence global | à faire |
| 4 | signalisation iNetbox, STUN, identité d'appareil, invitations | à faire |
| 5 | interface complète, overlay de session, paramètres détaillés | à faire |
| 6 | plusieurs invités, spectateurs, voix | à faire |
| 7 | audit sécurité/dépendances, docs, bêta expérimentale | à faire |

## 8. Stratégie de tests

- **Unitaires** (`cargo test --lib`) : décodage du protocole (valide, tronqué, trop long, valeurs
  hors domaine, UTF-8 invalide), permissions (refus par défaut, profils, plafonds par mode, arrêt
  d'urgence, blocage, relâchement des touches), bornes de configuration.
- **Intégration** : boucle locale hôte ↔ WebView2 ; perte/gigue simulées (clumsy) ; changement de
  résolution ; déconnexion brutale ; verrouillage de Windows.
- **Réseau réel** : LAN, deux FAI, IPv6, CGNAT, pare-feu restrictif ; vérification par capture de
  paquets qu'aucun média ne passe par Render.
- **Matériel** : NVIDIA, AMD, Intel ; Dolphin, PCSX2, RetroArch, jeux PC.
- Aucune latence ni fréquence n'est publiée sans mesure documentée.
