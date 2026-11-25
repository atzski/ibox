# iBox Remote Play — étude technique (Phase 0)

> État : **expérimental**. Image et commandes circulent en boucle locale sur un même PC (§11) ; la
> signalisation iNetbox, STUN et l'interface d'invitation sont branchés (§12) et essayés de bout en
> bout sur un seul PC (sans WebView2). **Aucun essai entre deux ordinateurs n'a encore été fait** :
> premier essai réel avec un ami, guide `docs/REMOTE-PLAY-AMI.md`.
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
| `capture/` | WGC (fenêtre/écran) sur device D3D11 partagé ; repli DXGI Desktop Duplication à faire | 1b ✅ |
| `encode/` | BGRA→NV12 GPU, MFT H.264 matériel asynchrone, repli logiciel MS H.264 ; HEVC/AV1 à faire | 1b ✅ |
| `audio/` | WASAPI loopback, loopback par processus, Opus | 1 |
| `transport/` | str0m (ICE, DTLS, SRTP, SCTP, BWE), vidéo H.264, DataChannels, débit adaptatif, statistiques, client STUN (`stun.rs`) | 1c/2/4 ✅ (§11, §12) |
| `input/` | SendInput, arrêt d'urgence global, priorité locale, manettes virtuelles ViGEm (§9) | 3 ✅ (natif) |
| `signaling/` | identité des appareils, enveloppes signées, épinglage TOFU, code de sécurité | 4 ✅ |
| `online/` | client iNetbox Remote Play, côtés hôte/invité sans E/S (`sides.rs`), fils de signalisation, indicateur, commandes | 4 ✅ (§12) |
| `sources.rs` | écrans et fenêtres partageables, jeu lancé depuis iBox présélectionné | 5 ✅ |

## 3. Comparaison des bibliothèques

### Transport P2P (hôte)
| Candidat | Licence | Points forts | Points faibles | Verdict |
|---|---|---|---|---|
| **str0m** | MIT/Apache-2.0 | Rust pur, *sans E/S* (on maîtrise le fil réseau), ICE, DTLS, SRTP, SCTP, BWE, statistiques | API bas niveau | **Retenu** |
| webrtc-rs | MIT/Apache-2.0 | API proche du navigateur | lourd (tokio partout), maintenance ralentie au profit d'une réécriture | écarté |
| libwebrtc (Google) | BSD | référence | build C++ énorme, liaison fragile | écarté |
| QUIC (quinn) + ICE maison | MIT/Apache | moderne | pas de traversée NAT ni de compatibilité navigateur | écarté |

Back-end cryptographique de str0m : **vérifié sur str0m 0.25.0** (MIT/Apache-2.0, Rust ≥ 1.89) — voir §11.
Retenu : `default-features = false, features = ["wincrypto"]` (DTLS `dimpl` en Rust + primitives
Windows CNG). Ni OpenSSL ni AWS-LC (C, CMake/NASM) ne sont compilés ni livrés.

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
| ViGEmBus | signé, très répandu, BSD-3, **fin de vie annoncée (2023)** | utilisé **seulement s'il est déjà installé** ; iBox n'installe jamais de pilote (client : §9) |
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
| `0x13` | Wheel | dx i16, dy i16 — unités Windows (120 = un cran), dy > 0 = vers l'avant/haut, dx > 0 = vers la droite |
| `0x20` | Key | scancode u16, appui u8 |
| `0x21` | KeyState | seq u32, n u8 (≤ 16), n × scancode u16 — resynchronisation toutes les 250 ms |
| `0x30` | Gamepad | pad u8 (0–3), seq u32, boutons u16, LT u8, RT u8, LX/LY/RX/RY i16 (disposition XInput) |
| `0x31` | Rumble (hôte → invité) | pad u8 (0–3), gros moteur u8, petit moteur u8 ; refusé s'il vient d'un invité |
| `0x40` | Chat | longueur u16, UTF-8 |
| `0x50`/`0x51` | Ping/Pong | id u32, horodatage µs u64 |
| `0x52` | Timing (hôte → invité, `control`) | temps RTP de l'image u32, capture µs Unix u64, envoi du message µs Unix u64, capture → dernier paquet remis au réseau µs u32 ; refusé s'il vient d'un invité (§15) |
| `0x53` | Report (invité → hôte, `control`) | latence mesurée par l'invité : capture → affichage µs u32, réception → affichage µs u32 ; envoyé seulement après réception d'un `Timing` (§15) |

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
| 1b | capture WGC + encodage MF H.264 + mesure capture/encodage (fichier `.h264` local) | ✅ (§9) |
| 1c | boucle locale : hôte str0m ↔ invité sur la même machine (audio WASAPI/Opus à faire) | vidéo + entrées ✅ (§11) ; WebView2 réel à essayer à la main |
| 2 | deux PC du même réseau, adaptation du débit, statistiques | code ✅, échange manuel (§11) ; essai à deux PC à faire |
| 3 | SendInput, manettes (ViGEm si présent), arrêt d'urgence global | natif ✅ (§9) ; essai à deux PC à faire |
| 4 | signalisation iNetbox, STUN, identité d'appareil, invitations | ✅ code + essai de bout en bout sur un PC (§12) ; essai entre deux connexions Internet à faire |
| 5 | interface complète, overlay de session, paramètres détaillés | en partie : invitation, acceptation, vue invité, indicateur hôte, sélecteur de source (§12) ; à essayer dans WebView2 |
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

## 9. Phase 1b — capture et encodage (mesures)

**Chaîne** (`capture/`, `encode/`, aucune copie par le processeur) : `capture::d3d::Device` (device
D3D11 matériel, `VIDEO_SUPPORT`, multi-fil protégé) → `capture::wgc::Capture` (WGC écran ou fenêtre,
réserve *free-threaded* de 2 tampons réveillée par `FrameArrived`, seule l'image la plus récente est
gardée, curseur réglable, bordure retirée si build ≥ 20348, réserve recréée quand la taille change,
arrêt `SourceClosed` à la fermeture de la fenêtre — jamais de repli sur le bureau) →
`encode::convert::Converter` (copie privée + processeur vidéo D3D11 BGRA→NV12, BT.709 plage
limitée, mise à l'échelle sans déformation dans une taille de sortie fixe, rotation de 4 textures) →
`encode::mf::Encoder` (MFT matériel **asynchrone** piloté par ses événements sur un fil dédié,
gestionnaire de device DXGI ; `ICodecAPI` : CBR, `AVLowLatencyMode`, 0 image B, GOP désactivé par
défaut, IDR à la demande `AVEncVideoForceKeyFrame` ; repli MFT logiciel Microsoft synchrone ; chaque
IDR est précédée de SPS/PPS). Chaque candidat est **ouvert puis essayé sur une vraie image** avant
d'être retenu. `encode::pipeline::record` encode une image nouvelle dès son arrivée, au plus `fps`
fois par seconde, et réencode la dernière à l'échéance si rien n'a changé.

**Essais** (`encode/gpu_tests.rs`, `#[ignore]`, à lancer à la main sur un bureau ouvert) :
`cargo test --lib remote_play::encode::gpu_tests -- --ignored --nocapture --test-threads=1`.
Les fichiers `.h264` sont écrits dans `%TEMP%\ibox-remote-play-1b\` puis **relus par le décodeur
H.264 de Media Foundation** (nombre d'images, dimensions, image non uniforme).

**Mesures du 16/11/2026** — RTX 5080, Windows build 26300, écran principal 3840×2160 à 240 Hz,
sortie 60 i/s, CBR 20 Mbit/s, 5 s, une petite fenêtre animée sur l'écran (sauf « tel quel ») :

| Essai | Encodeur | Sortie | Capture | Encodage (envoi → paquet) | Débit réel | Vérification |
|---|---|---|---|---|---|---|
| Automatique + IDR toutes les 60 images | NVIDIA H.264 Encoder MFT | 3840×2160 | 302 images, 60,3 i/s | moy 4,03 ms · méd. 3,84 · p95 5,66 · max 9,76 | 22,6 Mbit/s | 301/301 décodées, 6 IDR |
| Écran tel quel, sans IDR forcée | NVIDIA H.264 Encoder MFT | 3840×2160 | 302 images, 60,3 i/s | moy 4,06 ms · méd. 3,82 · p95 5,04 | 20,0 Mbit/s | 301/301 décodées, 1 IDR |
| Repli logiciel forcé | Microsoft H264 Encoder MFT | 1920×1080 | 300 images, 59,9 i/s | moy 8,47 ms · méd. 8,35 · p95 10,28 | 1,2 Mbit/s | 300/300 décodées (1920×1088) |

- Conversion BGRA→NV12 : ≈ 0,01 ms côté processeur (soumission au GPU) ; son exécution GPU est
  comprise dans le temps d'encodage, qui va de l'envoi de l'image au paquet H.264 disponible.
- Encodage tenu à 60 i/s dans tous les essais. Images reçues de WGC toutes les ≈ 16,6 ms (60 i/s)
  alors que l'écran tourne à 240 Hz : la cause (contenu affiché ou limitation de WGC) n'est pas
  établie. Lors d'un premier essai sur un bureau immobile, WGC n'a livré que 2 images en 5 s :
  sans changement à l'écran, le flux repose sur les images répétées.
- **Latence de capture non mesurée** : `SystemRelativeTime` de WGC s'est révélé *postérieur* de
  ≈ 7 ms (médiane) à la réception de l'image ; ce n'est donc pas un instant de composition et on ne
  peut pas en déduire une latence. Mesure de bout en bout à faire en Phase 1c (horloge commune).
- Débit : NVENC suit la consigne CBR (20–22,6 Mbit/s) ; l'encodeur logiciel accepte le mode CBR
  mais est resté très en dessous sur ce contenu (1,2 Mbit/s ; ≈ 10 Mbit/s lors d'un autre essai).
- **Encodeurs réellement essayés** : NVIDIA H.264 Encoder MFT ✅ ; `AMDh264Encoder` (enregistré sur ce
  PC) ❌ `0x8007000E` dès l'essai — DXGI n'expose aucun GPU AMD (WMI liste pourtant une « AMD
  Radeon(TM) Graphics », probablement l'iGPU désactivé) ; Microsoft H264 Encoder MFT ✅ (son message
  `COMMAND_FLUSH` initial échoue, il est ignoré).
- IDR à la demande avec GOP désactivé : IDR exactement aux images 0, 37 et 101 sur 150, sur NVENC
  comme sur l'encodeur logiciel.
- Fenêtre : redimensionnement suivi (938×709 → 1328×1039 pixels physiques, réserve recréée),
  puis capture arrêtée dès `DestroyWindow` (`IsWindow` + événement `Closed`), aucune image après.
- Bordure : `SetIsBorderRequired(false)` accepté (build 26300) ; disparition de la bordure et
  présence du curseur non vérifiées à l'œil.

**Reste à faire** : repli DXGI Desktop Duplication, choix de l'adaptateur qui affiche l'écran
capturé (ici le même), HEVC/AV1, intra-refresh, mesure de latence de bout en bout (Phase 1c).
## 10. Entrées distantes (Phase 3, côté natif)

Module `src-tauri/src/remote_play/input/`. Chaîne : message décodé → `Engine::handle` →
`Session::authorize` → `Injector` → `SendInput` / ViGEmBus. L'accès au système passe par trois
traits (`Sink`, `Screen`, `Pads`) ; les tests utilisent des enregistreurs factices.

- **Clavier** : `SendInput` + `KEYEVENTF_SCANCODE`, `KEYEVENTF_EXTENDEDKEY` pour 0xE0xx (flèches,
  Ctrl/Alt droits…). Le préfixe 0xE1 (Pause) n'est pas transmis par le protocole v1.
- **Souris absolue** : position 0–65535 normalisée sur la zone partagée (`Area` : bureau, écran
  `HMONITOR`, zone client d'une fenêtre relue à chaque mouvement, ou rectangle) → pixel physique →
  coordonnée `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` (centre du pixel, origines négatives
  comprises, testé pixel par pixel contre la formule de Windows `abs × largeur / 65536`). Lecture des
  rectangles et `SendInput` sous `DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2` : pixels physiques
  quel que soit le DPI de chaque écran. Fenêtre fermée ou réduite : rien n'est injecté (`AreaGone`).
- **Souris relative** : `MOUSEEVENTF_MOVE` (soumis à l'accélération du pointeur Windows ; les jeux en
  Raw Input reçoivent le delta brut). Non bornée à la zone partagée.
- **Boutons** gauche/droit/milieu/X1/X2, **molettes** verticale et horizontale.
- **Refus de Windows** (fenêtre administrateur / UIPI, UAC, écran verrouillé) : remonté tel quel
  (`InjectError::Refused`), jamais contourné. Aucune élévation.

**Arrêt d'urgence** : fil dédié `remote-play-guard` avec sa boucle de messages et une fenêtre jamais
affichée. `RegisterHotKey` (défaut Ctrl+Alt+Shift+F12, réglage `stopHotkey`, au moins deux
modificateurs, `MOD_NOREPEAT`) et `WTSRegisterSessionNotification` : verrouillage, déconnexion de la
console ou fermeture de session → `Session::suspend` + exécution des relâchements (touches, boutons,
manettes au neutre). Si le raccourci est déjà pris ou la notification impossible, la garde refuse de
démarrer (la session ne doit pas démarrer sans elle). Reprise uniquement par l'hôte (`resume`), jamais
au déverrouillage. Chaque relâchement est tenté même si un précédent échoue.

**Priorité à l'hôte** : crochets `WH_MOUSE_LL` + `WH_KEYBOARD_LL` sur le fil de garde ; une entrée
sans `LLMHF_INJECTED`/`LLKHF_INJECTED` est physique. Pendant 500 ms après la dernière entrée physique,
mouvements, molette et appuis de la souris distante sont ignorés ; relâchements, clavier et manettes
passent. Choix : le crochet distingue exactement le physique de l'injecté, alors que
`GetLastInputInfo` compte aussi nos injections. Celui-ci reste le **repli** si les crochets ne peuvent
pas être posés : une entrée postérieure de plus de 30 ms à notre dernier `SendInput` est attribuée à
l'hôte. Limite connue : Windows retire silencieusement un crochet trop lent (`LowLevelHooksTimeout`) ;
le nôtre ne fait qu'un horodatage atomique.

**Manettes virtuelles** : crate `vigem-client` 0.1.4 (MIT, Rust pur, parle directement au pilote par
`DeviceIoControl`, aucune DLL à livrer ; dernière version 2022-08, dépôt actif jusqu'en 2023, ~80 k
téléchargements). Préféré à `ViGEmClient.dll` (C, à compiler et livrer) et à une réimplémentation
des IOCTL (même code, sans relecture publique). Fonction `unstable_xtarget_notification` pour la
vibration : un fil par manette relaie (gros moteur, petit moteur) vers l'invité (`0x31 Rumble`).
ViGEmBus absent → `PadError::BusMissing` explicite, aucune installation. Une manette Xbox 360 est
branchée au premier état reçu et débranchée en fin de session ; l'indice XInput est attribué par
Windows (il peut différer du numéro de joueur si l'hôte a ses propres manettes).

**Tests** : `cargo test --lib` (enregistreurs factices) couvre chaque chemin de permission, l'arrêt
d'urgence, les relâchements (départ, blocage, retrait de droit, `KeyState`, changement de manette),
la conversion des coordonnées, les codes étendus, la priorité locale et son repli, le raccourci et
les événements de session. Tests réels marqués `#[ignore]`, lancés à la main :
`cargo test --lib -- --ignored guard_real vigem_real sendinput_real`. **Non testé** : sessions à deux
PC, écrans de DPI différents, jeux réels, vibration avec ViGEmBus installé, verrouillage réel.

## 11. Transport P2P (Phases 1c et 2)

Module `src-tauri/src/remote_play/transport/`, invité `src/services/remotePlayGuest.ts`, écran
`src/components/remoteplay/RemotePlaySession.tsx` (Paramètres › Remote Play › Session d'essai,
visible seulement si Remote Play est activé).

**str0m 0.25.0** (MIT/Apache-2.0, Rust ≥ 1.89 ; iBox compile avec 1.99). Fonctions :
`default-features = false` (retire `aws-lc-rs` — C, CMake, NASM — et les exemples `rouille`) et
`wincrypto` : DTLS 1.2/1.3 par `dimpl` (Rust pur), primitives par Windows CNG. Arbre ajouté : `str0m`,
`str0m-proto`, `str0m-wincrypto`, `dimpl`, `is` (ICE), `sctp-proto`, tous MIT/Apache-2.0 ; **ni
OpenSSL, ni AWS-LC, ni tokio**. Écartés : `openssl` (bibliothèque C à livrer et à tenir à jour),
`aws-lc-rs` (défaut de str0m, chaîne de compilation C), `rust-crypto` (possible, mais CNG est déjà
dans Windows et suit ses mises à jour de sécurité).

**Fils (aucun runtime asynchrone)** :
- `remote-play-transport` possède le `Rtc` (`peer::HostPeer`, machine à états sans E/S) ; il reçoit
  par un seul `mpsc` les paquets UDP, les images encodées et les commandes, et dort jusqu'au
  prochain délai de str0m. Résolution de l'horloge Windows à 1 ms pendant la session
  (`timeBeginPeriod`), sinon les délais du pacer sont arrondis à ≈ 15,6 ms ;
- `remote-play-udp` : une socket par candidat (on connaît ainsi l'adresse de destination), tampons
  portés à 4 Mo (défaut Windows 64 Ko : débordement sous une IDR 4K), `WSAECONNRESET` ignoré ;
- `remote-play-video` : `encode::pipeline::stream` (même boucle que la Phase 1b, pilotée par
  `pipeline::Control` : arrêt, débit, IDR), démarré seulement à la connexion DTLS.

**Média** : piste vidéo en envoi seul ; l'hôte n'offre que H.264 `packetization-mode=1`, retient le
meilleur profil accepté par l'invité (High › Main › Constrained Baseline) et configure l'encodeur
en conséquence. str0m découpe chaque unité d'accès Annex B en RTP (FU-A, STAP-A), temps RTP 90 kHz
= horodatage de l'encodeur ; PLI/FIR → IDR à la demande ; NACK/RTX par str0m.

**DataChannels** (créés par l'hôte dans l'offre) : `input` non ordonné, `maxRetransmits = 0` ;
`control` fiable et ordonné. Chaque message reçu passe par `router::route` (taille bornée **avant**
décodage : 64 octets sur `input`, 503 sur `control` ; `protocol::decode` strict ; type attendu sur
ce canal, ex. un appui de touche refusé sur `input` où il pourrait se perdre), puis par
`input::Engine::handle` = `Session::authorize` → `Injector`. `Ping` est renvoyé en `Pong` sans
passer par l'injection ; `Rumble` (ViGEm) part vers l'invité sur `control`. À la fermeture, tout ce
que l'invité tenait est relâché. Dès qu'une entrée est permise, la garde d'arrêt d'urgence est
obligatoire (`input::start_guard`) ; son déclenchement termine la session.

**Débit adaptatif** (`rate.rs`) : BWE TWCC de str0m (`enable_bwe`, plancher 500 kbit/s, cible
désirée = plafond de l'hôte) → consigne = estimation × 0,85 ; pertes > 10 % → 80 % du débit
courant ; baisse immédiate (< 95 %), hausse ≤ 1/s et ≤ +25 % (> 105 %) ; borne [500, plafond].
La consigne est appliquée à chaud (`CODECAPI_AVEncCommonMeanBitRate`, `Encoder::set_bitrate`).

**Statistiques réelles** — hôte (`TransportStats`, commande `remote_play_host_stats`) : état ICE,
délai de connexion, RTT, pertes et gigue rapportées par l'invité (RTCP), BWE, consigne, débit
réellement émis, i/s, IDR, PLI/FIR/NACK, temps d'encodage, type de réseau de la paire ICE
(`loopback`/`lan`/`internet`, jamais l'adresse), compteurs d'entrées (reçues, rejetées, refusées,
injectées). Invité (`getStats()`) : i/s, débit, gigue, pertes, retard moyen du tampon de gigue,
décodage (matériel ou non), images perdues, gels, RTT ICE, ping applicatif, capture → affichage
(`requestVideoFrameCallback.captureTime`, si le navigateur le fournit).

**Invité (WebView2)** : `RTCPeerConnection` sans STUN, accepte l'offre, réponse complète après
collecte des candidats (≤ 1,5 s). `jitterBufferTarget = 0` (repli `playoutDelayHint = 0`), vidéo
muette en `object-fit: contain`. Souris absolue sur l'image réelle (bandes noires exclues), boutons,
molette (unités Windows), clavier par `KeyboardEvent.code` → code de balayage (indépendant
AZERTY/QWERTY) capturé avant la navigation d'iBox, `KeyState` toutes les 250 ms, relâchement au
`blur` ; première manette (disposition standard → XInput) à chaque changement et toutes les
100 ms, navigation d'iBox à la manette suspendue (`padCapture`) ; vibration via
`vibrationActuator`. Chromium masque ses adresses (mDNS `.local`) : l'hôte retire ces candidats et
découvre l'invité en *peer-reflexive* sur son propre candidat.

**Signalisation provisoire** (sans iNetbox) :
- boucle locale : `remote_play_host_start({lan:false})` → offre ; l'invité du même WebView répond ;
  `remote_play_host_answer` ; candidat 127.0.0.1 seulement ; **invité spectateur imposé** (ses
  entrées reviendraient sur ce même PC) ;
- réseau local : `remote_play_host_start({lan:true, profile})` ; candidat = IPv4 de la route par
  défaut ; offre et réponse échangées à la main sous forme `IBOX-RP1-OFFRE:`/`IBOX-RP1-REPONSE:`
  + base64 ; **code de vérification** (3 × 4 chiffres, SHA-256 des empreintes DTLS de l'offre puis
  de la réponse, même calcul en Rust et en TypeScript) affiché des deux côtés : différent = arrêter.
  Contrôle complet refusé dans ce mode. QR code non fait (SDP ≈ 2–3 Ko : QR version 30+ peu
  lisible) ; le copier-coller suffit en attendant la boîte aux lettres iNetbox signée (§5).

**Tests** (`cargo test --lib`, sans réseau ni GPU) : `rate` (baisse immédiate, hausse bornée,
hystérésis, bornes, pertes), `router` (tailles avant décodage, malformés, hors domaine, mauvais
canal, texte), `sdp` (mDNS, empreinte, code figé partagé avec le test TypeScript), `stats`, et
`transport::tests` : hôte ↔ invité **str0m réel relié en mémoire** (ICE, DTLS, SRTP, SCTP) —
IDR de 6 000 octets fragmentée puis reconstituée à l'octet près, temps RTP conservé, RTT/BWE/paire
ICE remontés ; messages trop longs, malformés, sur le mauvais canal ou non autorisés sans aucun
effet ; ping → pong ; touche injectée puis relâchée à la fermeture. Côté TypeScript
(`remotePlayGuest.test.ts`) : octets du protocole identiques à `protocol.rs`, codes de balayage,
manette → XInput, souris (bandes noires), molette, échange empaqueté, code de vérification.

**Essais réels** (`#[ignore]`, bureau ouvert, GPU) — `transport/loopback_tests.rs` :
```
cargo test --release --lib remote_play::transport::loopback_tests::phase1c_loopback -- --ignored --nocapture --test-threads=1
```
(`IBOX_RP_HEIGHT=1080` pour réduire ; `CARGO_PROFILE_RELEASE_LTO=false` accélère la compilation.)
Hôte complet (WGC → NVENC → str0m → UDP 127.0.0.1) face à un invité str0m sur une vraie socket,
même horloge : latence **image par image** de l'envoi à l'encodeur jusqu'à l'image reconstituée
chez l'invité (décodage et affichage exclus). Profil spectateur : la souris envoyée toutes les
100 ms doit être refusée.

**Mesures du 16/11/2026** (RTX 5080, build 26300, écran 3840×2160, 60 i/s, une petite fenêtre en
mouvement, 10 s, build **release**, tampons 4 Mo) :

| Sortie | Connexion | Images | Débit reçu | Latence images suivantes (méd. · p95 · max) | dont str0m → invité (méd. · p95) | IDR initiale |
|---|---|---|---|---|---|---|
| 3840×2160 (3 essais) | 24–26 ms | 580/580, 60,1 i/s | 8,7–10,7 Mbit/s | 3,9–8,2 · 6,9–11,0 · 15,7–39,1 ms | 0,42–0,51 · 0,59–0,71 ms | 98 Ko, 16,5–19,0 ms |
| 1920×1080 (2 essais) | ≈ 26 ms | 580–582, 60,1 i/s | 4,6–7,3 Mbit/s | 2,0–2,1 · 2,35–2,56 · 4,1–5,8 ms | 0,25–0,40 · 0,37–0,53 ms | 98–139 Ko, 13,5–16,9 ms |

- L'essentiel de la latence est l'encodage (NVENC 4K : 3,5–7,7 ms ; 1080p : 1,7 ms). Ping/pong sur
  `control` : médiane 0,12–0,17 ms, p95 ≤ 0,23 ms. 0 perte RTCP ; 0 à 3 NACK par essai en 4K.
- BWE : 63–76 Mbit/s estimés ; consigne montée de 20 à 26,6 Mbit/s par paliers de +25 %/s (3
  changements acceptés à chaud par NVENC). Le contenu n'a produit que 5–12 Mbit/s : **adaptation à
  la baisse sous contrainte réelle non mesurée** (pas de limitation de débit simulée).
- **Pièges trouvés en mesurant** : (1) en build *debug*, SRTP/SCTP non optimisés font monter la
  latence à p95 25–250 ms ; seules les mesures *release* comptent. (2) Tampon UDP par défaut de
  Windows (64 Ko) : sous un contenu à 20–25 Mbit/s en 4K, pertes → NACK → l'invité str0m bloque les
  images suivantes jusqu'à la retransmission (p95 jusqu'à 546 ms, max 780 ms) ; corrigé par
  `SO_RCVBUF`/`SO_SNDBUF` = 4 Mo. Les essais avec tampons 4 Mo n'ont eu que du contenu à ≤ 11 Mbit/s :
  **un contenu très animé à 30–50 Mbit/s reste à mesurer**. (3) Le RTT de str0m (`PeerStats.rtt`)
  oscille entre 0,1 et 17 ms en boucle locale alors que le ping applicatif reste < 0,5 ms : à
  comprendre avant de s'en servir ; l'interface affiche les deux.

**Invité navigateur réel** (`phase1c_browser_bridge` + `remote-play-dev.html`, page de
développement servie par `npx vite --port 1430`, hors build) : le code de `remotePlayGuest.ts` dans
le **Chromium 156 du navigateur intégré à l'application Claude** (pas WebView2), face à l'hôte
release, 1080p, 127.0.0.1 : connecté (paire `loopback`/`loopback`, découverte *peer-reflexive*
malgré les candidats mDNS), **codes de vérification identiques** calculés en Rust et en TypeScript,
`jitterBufferTarget = 0` accepté, 60 i/s affichées, 7,3–9,2 Mbit/s, tampon de gigue moyen
8,4–10,8 ms (médiane 8,8), décodage 0,27–0,44 ms, 0 paquet perdu, 0 image perdue, 0 gel, ping
`control` 0,3–0,4 ms, 571 images envoyées, 1 IDR, 0 PLI ; 86 messages reçus par l'hôte (`KeyState`
périodiques, pings), 77 refusés par les permissions (spectateur), 0 injecté. Non fournis par ce
Chromium : `captureTime` (latence capture → affichage), `decoderImplementation`,
`powerEfficientDecoder` (masqués sans autorisation média) — affichés « — ».

**Reste à tester à la main** :
1. **WebView2 réel** : `npm run tauri dev` depuis ce dépôt, Paramètres › Remote Play › activer ›
   Session d'essai › « Boucle locale sur ce PC ». Vérifier : image affichée, i/s ≈ 60, « Tampon de
   gigue » (avec et sans `jitterBufferTarget` : message affiché si refusé), décodage matériel
   (`powerEfficientDecoder` peut y être exposé), « Capture → affichage », absence de bordure jaune et
   présence du curseur, arrêt propre (« Arrêter la session », fermeture de la page).
2. **Deux PC du même réseau** (Phase 2), chacun en `npm run tauri dev` ou version de développement :
   - hôte : « Héberger sur le réseau local », profil Spectateur puis Joueur puis Collaborateur ;
     **pare-feu Windows** : autoriser le port UDP choisi (aléatoire) ou l'exécutable de dev, sinon
     aucune connexion — à documenter pour l'utilisateur ;
   - copier l'offre vers l'invité (messagerie, clé USB), « Rejoindre », renvoyer la réponse,
     « Valider la réponse » ; **comparer le code de vérification** sur les deux écrans ;
   - mesurer : délai de connexion, i/s, débit, tampon de gigue, pertes, RTT, latence perçue (photo
     des deux écrans avec un chronomètre à l'écran de l'hôte, horloges différentes) ;
   - entrées : souris (bords de l'image, plein écran, écrans de DPI différents), clavier AZERTY →
     QWERTY, touches tenues puis perte de focus de l'invité (tout doit être relâché), manette avec et
     sans ViGEmBus, vibration ;
   - arrêt d'urgence de l'hôte (Ctrl+Alt+Shift+F12) pendant que l'invité tient une touche ;
     verrouillage de Windows de l'hôte ; câble réseau débranché (fin de session, relâchements) ;
   - débit adaptatif : limiter le lien (Wi-Fi faible, ou `clumsy` : pertes 2 %/5 %, gigue, débit
     5 Mbit/s) et vérifier que la consigne descend, que l'image reste fluide et qu'aucune latence ne
     s'accumule ; puis qu'elle remonte par paliers ;
   - contenu très animé en 4K (jeu) à 30–50 Mbit/s.
3. **À faire ensuite** : STUN (candidats `srflx`) et câblage iNetbox signé (§5) au lieu du
   copier-coller ; plusieurs interfaces réseau (aujourd'hui : seule la route par défaut) et IPv6 ;
   audio WASAPI/Opus ; choix de la fenêtre partagée (aujourd'hui : écran principal) ; indicateur
   permanent de session côté hôte ; QR code éventuel.

## 12. Remote Play entre amis par Internet (Phase 4, expérimental)

Modules `src-tauri/src/remote_play/online/`, `transport/stun.rs`, `sources.rs` ; interface
`src/components/remoteplay/RemotePlayOnline.tsx` (invitation, acceptation, vue invité, carte hôte),
`RemotePlayIndicator.tsx` (fenêtre `remote-play-indicator`), service `src/services/remotePlayOnline.ts`.
Aucune route serveur ajoutée ni modifiée : iBox utilise les routes 0.11.0 de
`services/inetbox/src/remoteplay.ts` telles quelles.

**Déroulé.**
1. Activation (Paramètres › Remote Play, *Expérimental*, désactivé par défaut) : la clé Ed25519 de
   l'appareil (coffre Windows) est déclarée (`POST /v1/remote-play/devices`, preuve liée au compte),
   et le réglage serveur `acceptRequests` est aligné. « Accepter les demandes Remote Play de mes
   amis » (`rp_accept_requests`, désactivé par défaut) se change à part (`PUT /settings` d'abord,
   puis `remote-play.json`). Désactiver Remote Play arrête toute session, repasse `acceptRequests` à
   `false` sur le serveur et oublie les invitations.
2. Hôte : profil d'un ami › **Inviter à jouer** → droits (Spectateur, Joueur ; Collaborateur derrière
   une case de confirmation ; Contrôle complet refusé par Internet) et source (écran principal,
   un écran, une fenêtre ; la fenêtre du jeu lancé depuis iBox est présélectionnée). Une fenêtre
   = mode Game Share (manettes seulement, jamais clavier/souris : plafond de `permissions.rs`).
   `POST /invites` (`kind: invite`, `mode: watch|play`).
3. Invité : l'actualisation iNetbox (toutes les 10 s) relève `GET /invites` **seulement** si Remote
   Play est activé et les demandes acceptées ; chaque nouvelle invitation devient une notification
   `toast.rs` (kind `invite`, `remotePlay: true`) ; le clic ouvre Accepter / Refuser. Refuser =
   `DELETE /invites/:id`. Le jeton reste natif, jamais dans la WebView.
4. Accepter = `POST /invites/redeem` (jeton à usage unique) ; le fil de l'hôte, en long-poll sur la
   session, la voit s'ouvrir et démarre l'hôte (`Network::Internet`) : sockets IPv4 (route par
   défaut) et IPv6 globale si présente, **STUN depuis chaque socket** avant toute lecture (1,5 s
   au plus, en parallèle), candidats `host` + `srflx` dans une offre complète.
5. Offre scellée (`online::sides::HostSide`, enveloppe `ibox-rp-signal/1` liée à la session, au
   destinataire, au jeton, à l'heure, au numéro et à l'empreinte DTLS) → boîte aux lettres.
6. Invité (`GuestSide`) : le message doit venir du compte de l'hôte, d'un appareil actif de ce compte
   dont la signature est vérifiée **avant** l'épinglage TOFU ; clé changée = session bloquée
   (`KeyChanged`) ; un seul appareil par session ; offre rejouée refusée. Le WebView répond
   (`RTCPeerConnection` avec les serveurs STUN, jamais de TURN) ; réponse scellée avec sa propre
   empreinte ; les candidats trouvés après 2,5 s partent en *trickle* (`Kind::Ice`, mDNS retirés).
7. Hôte : réponse vérifiée, jeton consommé **aussi côté hôte** (`TokenLedger`), SDP accepté par str0m
   (qui impose l'empreinte DTLS du SDP signé). Le **code de sécurité** (6 × 5 chiffres, deux clés
   d'appareil) s'affiche des deux côtés avec la confiance (premier contact, nouvel appareil, connu).
8. Fin : « Terminer », « Quitter », arrêt d'urgence, verrouillage de Windows ou départ du pair →
   message `Bye` signé, `DELETE /sessions/:id`, arrêt de l'hôte (relâchements compris).

**Connexion et diagnostic.** Pas de relais, jamais en silence. La paire ICE retenue est affichée
comme type de connexion (`TransportStats.path` : `lan`, `internet` = P2P direct, `loopback`), avec le
comportement du NAT vu par STUN en IPv4/IPv6 (`natV4`/`natV6` : sans NAT, compatible, symétrique —
même socket vue sous deux adresses par deux serveurs —, sans réponse). Si ICE n'aboutit pas (30 s
après la réponse, ou plus tôt si str0m abandonne toutes les paires), la session échoue avec une
explication : UDP sortant bloqué (aucune réponse STUN), NAT symétrique chez l'hôte, ou côté de
l'ami (pare-feu, NAT symétrique). Avant ce correctif, un abandon ICE fermait la session **sans
message** : trouvé par l'essai `IBOX_RP_SRFLX_ONLY=1` ci-dessous.

**Sécurité (rappel du §5).** Indicateur permanent côté hôte (fenêtre toujours au premier plan :
pair, type de connexion, raccourci, boutons « Arrêt d'urgence » et « Terminer ») ; par Internet la
garde d'arrêt d'urgence est **toujours** démarrée, même pour un spectateur : raccourci global et
arrêt au verrouillage / changement de session de Windows (`WTSRegisterSessionNotification`).
Avertissement unique avant la première session P2P (« votre ami voit votre adresse IP »,
`ipWarningSeen`), exigé aussi côté natif. Aucune adresse, aucun jeton, aucun SDP dans les journaux
ou les statistiques. Messages d'erreur du serveur remplacés par des textes fixes. Les messages de
signalisation refusés sont comptés et affichés (`rejected`).

**Tests automatiques** (`cargo test --lib`) : `stun` (requête, XOR-MAPPED-ADDRESS IPv4 et IPv6 avec
les vecteurs de la RFC 5769, MAPPED-ADDRESS en repli, transaction différente refusée, messages
tronqués/longueur fausse/attribut qui déborde/erreur, adresses `stun:`, type de NAT, collecte avec
paquet perdu et réponse étrangère sur un faux serveur UDP local, collecte sans réponse) ;
`online::sides` (échange complet, codes identiques, trickle, `Bye`, session suivante « connue »,
serveur qui substitue la clé → `KeyChanged`, expéditeur/appareil/révocation/altération refusés sans
épinglage, rejeu, second appareil refusé, jeton expiré refusé côté hôte) ; `envelope` (canal lié
après coup) ; `online::api` (identifiants, messages fixes, HTTPS, formes JSON du serveur) ; `host`
(choix du diagnostic) ; `sources`. TypeScript : `remotePlayOnline.test.ts`. Serveur : inchangé,
`npm test` 28/28.

**Essais réels du 16/11/2026** (ce PC, RTX 5080) :
- `cargo test --lib stun_real -- --ignored` : 2/2 serveurs STUN publics répondent en IPv4 et en IPv6.
- `GET https://inetbox-server.onrender.com/health` : `version 0.11.0`, `remote-play-signaling` présent.
- `online::e2e_tests` (serveur iNetbox **local** PGlite, deux comptes temporaires supprimés à la fin,
  hôte complet `Network::Internet` face à un invité str0m qui a fait sa propre collecte STUN) :
  refus par défaut (`REQUESTS_REFUSED`), invitation reçue, jeton à usage unique, offre et réponse
  signées via la boîte aux lettres, vérifiées, **codes de sécurité identiques**, connexion en
  2,7 ms, 279 images reçues en 5 s (720p, build debug), `Bye` vu par l'hôte. Paire retenue : `lan`
  (même PC). Hôte : NAT IPv4 « compatible », IPv6 sans NAT, offre de 3 candidats dont 1 `srflx`.
- Même essai avec `IBOX_RP_SRFLX_ONLY=1` (candidats publics seuls) : **échec attendu** — le routeur
  de ce PC ne renvoie pas vers le réseau local un paquet adressé à sa propre adresse publique
  (pas de *hairpinning*, vérifié aussi par un script UDP indépendant d'iBox). Le NAT conserve les
  ports (favorable au perçage). L'échec est désormais expliqué à l'écran.

**Non testé (à faire avec l'essai réel entre amis)** : deux connexions Internet distinctes ;
WebView2 réel (invité `RTCPeerConnection` avec STUN, trickle, réponse en 2,5 s) ; l'interface
elle-même (notifications, dialogues, vue invité, indicateur, navigation manette/clavier) n'a été
vérifiée que par `tsc` et les tests unitaires, jamais affichée ; pare-feu Windows (invite de
première écoute UDP) ; verrouillage réel pendant une session Internet ; IPv6 de bout en bout ; NAT
symétrique / CGNAT réels ; sélection d'une fenêtre de jeu réelle ; reprise après expiration de la
boîte aux lettres (15 min sans message : la session P2P continue, la fin n'est alors plus signalée
au pair que par la coupure DTLS/ICE).

**Limites connues** : pas de TURN (réseaux en NAT symétrique des deux côtés, CGNAT strict, UDP
bloqué : échec expliqué) ; jusqu'à 5 invités (0.1.60), une connexion et une capture par invité ; son : WASAPI en boucle (sortie par défaut) → Opus 128 kbit/s (`audio.rs`, 0.1.59), « jeu seulement » pas encore ; une seule session
(hôte ou invité) à la fois ; `stuns:` non pris en charge ; demandes « je veux rejoindre » (`kind:
request`) ignorées ; un 429 du serveur suspend iNetbox quelques secondes (comportement existant du
transport iNetbox).

## 13. Audit de sécurité du contrôle à distance (0.1.60)

Relecture du chemin des entrées distantes : DataChannel → `permissions::Session::authorize` →
`input::Engine` → `Injector` → `SendInput` / ViGEm, et de la garde (`win.rs`).

**Solide (inchangé)** : un invité arrive sans aucun droit ; les droits effectifs sont l'intersection
du profil et du plafond du mode ; numéros de séquence par canal (rejeu refusé) ; 16 touches tenues
au plus ; tout est relâché à la perte de droit, à la déconnexion et à l'arrêt d'urgence ; priorité
locale de 500 ms (crochets bas niveau) ; aucune élévation : `SendInput` vers une fenêtre
administrateur, l'UAC ou l'écran de verrouillage échoue (UIPI) ; Contrôle complet impossible par
Internet ; Collaborateur sur confirmation explicite ; garde obligatoire par Internet (raccourci
d'arrêt, verrouillage / changement de session) ; signalisation signée, clés épinglées, empreinte DTLS
comparée à l'offre, code de sécurité.

**Corrigé dans cette version**
1. *Game Share sans clavier ni souris* : le plafond retirait clavier et souris au partage d'une
   fenêtre, ce qui privait le Collaborateur de souris sans le dire. Ils sont désormais permis mais
   **confinés** : position ramenée dans la zone client de la fenêtre, appui de touche seulement si
   elle est au premier plan, clic et molette seulement si le curseur est sur elle (pas sur une
   fenêtre posée par-dessus), déplacement relatif refusé (`Outcome::OutsideArea`). Les relâchements
   passent toujours.
2. *Raccourcis système en Game Share* : touche Windows (Win+R → « Exécuter »), Menu, Alt+Tab,
   Alt+Échap, Alt+F4, Ctrl+Échap, Ctrl+Alt+Suppr refusés (`Denied::SystemShortcut`, testé). En
   partage d'écran entier, le Collaborateur confirmé garde ces touches (choix de l'hôte).
3. *Plusieurs invités* : chaque invité a sa propre `Session` (droits, manette, séquences isolés). Le
   raccourci d'arrêt d'urgence est désormais **partagé** : une garde le détient et relaie l'appui à
   toutes les autres sessions ; si elle s'arrête la première, une autre le reprend (sans quoi la
   deuxième session échouait à l'enregistrer). L'arrêt d'urgence et « Terminer » coupent tous les
   invités.
4. *Fin de session côté invité* : l'hôte fermait la session iNetbox avant d'envoyer son « au revoir »
   signé (refusé). L'au revoir part maintenant d'abord ; l'invité détecte aussi la fermeture du canal
   de contrôle et 6 s sans réponse à ses pings, puis revient à iBox.

**Risques résiduels connus** : un Collaborateur en partage d'écran entier a, par conception, le
clavier et la souris du bureau (mêmes droits que l'utilisateur de la session Windows, sans
élévation) ; un jeu peut lui-même offrir des actions sensibles (ouvrir un navigateur, un dossier) ;
les manettes virtuelles restent visibles de tous les programmes de l'hôte.

## 14. Faible latence (0.1.68)

Inspiré de Sunshine/Moonlight, Parsec et GeForce Now. Chaque point a été mesuré ou vérifié le 17/11/2026
(RTX 5080, 1080p, 60 i/s, ≈ 20 Mbit/s, build release).

| Levier | Où | Effet |
|---|---|---|
| Cadence en seau à jetons (`pipeline::Cadence`) au lieu d'une grille | hôte | une image nouvelle part dès son arrivée (jusqu'à 16,7 ms d'attente supprimés) ; débit moyen = `fps` exactement (un premier essai « 90 % d'intervalle » montait à 64 i/s et dépassait la consigne CBR) |
| Sondage BWE jusqu'à 3 × le plafond (`probe_ceiling_kbps`) | hôte | le pacer de str0m lisse à 1,1 × l'estimation ; collée au plafond, chaque image mettait presque un intervalle à sortir. Réseau (str0m → invité) p95 **7,4–8,9 → 1,7 ms** ; total p95 ≈ 10 → 4–5 ms |
| Extension RTP `playout-delay` 0/0 sur chaque image | hôte → Chromium | rendu dès décodage (moteur faible latence de Chromium). Tampon de gigue de l'invité **8,4–10,8 → 0,39 ms** (Chromium réel, `phase1c_browser_bridge`) |
| Son dans un flux distinct (`ibox-sound`) | hôte | Chromium ne retarde plus l'image pour la synchroniser sur le tampon audio (dizaines de ms, non mesuré seul) |
| Opus 10 ms, `jitterBufferTarget = 0` sur le son | hôte, invité | son plus direct |
| `abs-capture-time` | hôte | l'invité peut calculer capture → affichage (`captureTime` de rVFC ; non exposé par le Chromium de test) |
| VBV d'une image, `QualityVsSpeed` 20, 1 référence | encodeur matériel | best effort : NVENC MFT accepte, mais l'IDR initiale reste à ≈ 186 Ko (VBV apparemment non appliquée à l'IDR) |
| MMCSS « Games » + priorité haute (capture, réseau, son), `SetGPUThreadPriority(7)` | hôte | pas de mesure isolée (dépend de la charge du jeu) |
| Manette lue toutes les 4 ms, souris par `pointerrawupdate` | invité | jusqu'à ≈ 12 ms (manette) et une image (souris) de moins avant l'envoi |

Reste à mesurer : la latence perçue entre deux PC par Internet (chronomètre filmé), et sous un lien contraint (`clumsy`).

## 15. Latence de bout en bout : mesure et réductions (24/11/2026)

Tout ce qui suit a été mesuré **sur un seul PC** (RTX 5080, écran 3840×2160 à 240 Hz, Windows build
26300, build release sans LTO), hôte réel face à un invité str0m sur la même horloge. Rien n'a été
essayé entre deux ordinateurs, par Internet, ni avec une carte AMD ou Intel.

### 15.1 La chaîne, étape par étape

| # | Étape | Délai | Mesuré ou estimé |
|---|---|---|---|
| 1 | Le jeu présente son image, Windows la compose, WGC la livre | jusqu'à un rafraîchissement de l'écran de l'hôte (4 ms à 240 Hz, 17 ms à 60 Hz) | **estimé** : l'horodatage de WGC n'est pas un instant de composition (§9) |
| 2 | Image capturée → envoyée à l'encodeur (jeton de cadence, encodeur occupé) | médiane 0,2–0,4 ms quand la source ne dépasse pas la cadence du flux ; ≈ 2 ms quand elle la dépasse (on envoie la plus récente) | **mesuré** par image (`captureWaitMsP50`) |
| 3 | Conversion NV12 + encodage NVIDIA 1080p | médiane 1,3–1,9 ms, p95 2,3–3,8 ms | **mesuré** par image (`encodeMsP50`) ; AMD, Intel et logiciel **non mesurés** |
| 4 | Mise en paquets, chiffrement, file d'envoi (lissage de str0m) | médiane 0,1–0,3 ms ; ≈ 12 ms pour une image de plus de 63 Ko (rafale maximale du lissage) | **mesuré** par image (`sendQueueMsP50`) |
| 5 | Réseau, aller | 0,1 ms en boucle locale ; sur lien simulé : délai fixé + taille de l'image / débit du lien | **mesuré** par image sur un seul PC ; entre deux PC, déduit des horloges alignées (§15.2) |
| 6 | Tampon de gigue de Chromium | 0,3–0,8 ms (`playout-delay` 0/0) | **mesuré** (`getStats`) dans le Chromium de l'application Claude, pas dans WebView2 |
| 7 | Décodage | 0,5–0,9 ms | **mesuré** (`getStats`), même réserve |
| 8 | Image décodée → remise à l'écran | jusqu'à un rafraîchissement de l'écran de l'invité | **mesuré** par image dans iBox (`requestVideoFrameCallback` : réception → affichage prévu) ; **non relevé ici**, le panneau navigateur étant masqué pendant l'essai |
| 9 | Composition de Windows et dalle de l'invité | ≈ 1 rafraîchissement + temps de réponse de la dalle | **estimé**, hors de portée d'un logiciel |
| 10 | Retour : manette lue toutes les 4 ms, souris et clavier à l'événement | 0–4 ms | **estimé** (cadence de lecture) |
| 11 | Retour : réseau | la moitié de l'aller-retour | **mesuré** (ping `control`, 0,2 ms en boucle locale) |
| 12 | Retour : paquet reçu → commande injectée | non relevé (l'invité des essais est spectateur, rien n'est injecté sur ce PC) | **instrumenté** (`inputMsP50`), à lire lors d'un essai à deux PC |
| 13 | Le jeu lit la commande à son image suivante, puis retour à l'étape 1 | jusqu'à une image du jeu | **estimé** |

### 15.2 Ce que l'invité et l'hôte affichent

L'hôte suit chaque image jusqu'à son **dernier paquet remis au réseau** (en-tête RTP des paquets
sortants) et envoie quatre fois par seconde un message `Timing` (§4) : temps RTP de l'image, heure
de sa capture, part de l'hôte. L'invité date la réception et l'affichage de chaque image
(`requestVideoFrameCallback`), retrouve celle du message par son temps RTP et obtient la latence
**capture → affichage**, répartie en hôte / réseau / invité (`LatencyTracker`,
`src/services/remotePlayGuest.ts`). Il la renvoie à l'hôte (`Report`), qui l'affiche par invité.

Les deux horloges ne sont pas les mêmes : leur écart est estimé comme le fait NTP (le message le
plus vite arrivé a mis la moitié du plus court aller-retour des pings). L'erreur vaut au plus la
**moitié de l'asymétrie du trajet** ; le total affiché est donc honnête à cette réserve près, et il
ne comprend ni l'étape 1 ni l'étape 9. Vérifié : sur un même PC l'écart réel est nul, l'invité
Chromium l'estime à 0,01 et −0,03 ms ; les mesures portées par `Timing` diffèrent de 0,00 ms de la
vérité de l'horloge commune (essai `phase1c_loopback`). Sans mesure de l'hôte (hôte plus ancien),
l'invité n'affiche que sa propre part. Où : menu de session de l'invité (ligne d'état et
Statistiques), carte de l'hôte (« Latence de l'image », « Dont ce PC »), Session d'essai, panneau
des performances.

**Compatibilité.** `Timing` (0x52) et `Report` (0x53) s'ajoutent au protocole v1 sans le casser :
un invité plus ancien ignore le message inconnu (WebView comme invité natif) ; `Report` n'est
envoyé qu'après réception d'un `Timing`, donc jamais à un hôte plus ancien, qui le compterait comme
une entrée rejetée. Le chemin « ancien invité ↔ nouvel hôte » est lu dans le code, pas essayé.

### 15.3 Mesures avant / après

Référence au début du chantier (capture de l'écran en 1080p, machine chargée par d'autres
compilations, contenu à 22 Mbit/s) : envoi à l'encodeur → image reconstituée chez l'invité médiane
11,5 ms, p95 27,3 ms ; encodage médian 12,6 ms.

| Changement | Appliqué à | Conditions | Avant | Après |
|---|---|---|---|---|
| Classe de priorité du processus relevée pendant un flux (`ProcessPriority`) | tous | 16 cœurs occupés par des boucles en priorité normale, 1080p, 2 tours | 24–26 images/s · encodage médiane 38–41 ms, p95 78–81 · total médiane 39–43 ms, p95 80–82 | 60 images/s · encodage médiane 1,35 ms, p95 2,3 · total médiane 2,1 ms, p95 13–14 |
| idem | | machine au repos | total médiane 2,5–3,5 ms | 2,7 ms (aucun effet, comme attendu) |
| Conversion NV12 seulement pour l'image qui part (`pipeline.rs`) | tous | écran 240 Hz très animé, machine chargée, 2–3 tours | attente avant l'encodeur médiane 2,9–3,4 ms | 1,3–2,0 ms |
| Retenue : pas d'image encodée derrière une image encore en file d'envoi | tous | lien simulé 8 Mbit/s + 15 ms, contenu qui remplit le débit | p95 287–328 ms (2 tours) | p95 202 ms (1 tour comparable) |
| Garde de délai : -15 % dès que l'aller-retour dépasse de 40 ms son plancher (`rate.rs`) | tous | même lien, 4 tours de 15 s | p95 59 / 125 / 190 / 64 ms, max 133–298 | p95 65 / 67 / 69 / 107 ms, max 119–249 |
| « Priorité à la réactivité » (70 % de l'estimation au lieu de 85 %) | réglage, désactivé par défaut | même lien, 2 à 4 tours | médiane 40–56 ms, p95 79–256 ms | médiane 29–36 ms, p95 61–80 ms |
| Une image clé par 250 ms au plus | tous | test unitaire | — | non mesuré en charge (aucune rafale de demandes dans les essais) |
| Manette répétée 2 fois à 8 ms après un changement ; état répété après touche ou bouton | tous | tests unitaires | paquet perdu : jusqu'à 100 ms (manette), délai de retransmission SCTP (touches) | **non mesuré** : aucune perte simulée dans le sens invité → hôte |
| Priorité GPU du processus (`GpuPriority`), fil d'événements de l'encodeur prioritaire | tous | 3 tours chacun | — | **aucun effet mesurable ici** (écarts dans le bruit) ; gardés, sans coût |
| Copie de chaque image encodée évitée (`Packet` passé par valeur) | tous | — | — | non mesurable (quelques microsecondes) |

Lecture honnête : seuls la priorité du processus et le réglage « Priorité à la réactivité » ont un
effet net et répété. La retenue et la garde de délai vont dans le bon sens mais sur trop peu de
tours pour conclure ; la variance d'un tour à l'autre est forte (l'estimateur de bande passante
dépasse parfois la capacité du lien, parfois non).

**Pourquoi un réglage.** Sur un lien limité, l'estimateur de str0m monte jusqu'à dépasser la
capacité (10 Mbit/s estimés pour 8 réels) ; à 85 % de cette estimation l'encodeur sature le lien
et une file se forme chez le routeur. À 70 % elle ne se forme presque plus, au prix d'une image
moins fine : c'est une contrepartie de qualité, d'où le réglage plutôt qu'un changement imposé.

### 15.4 Pièges de mesure rencontrés

- Mesurer pendant que d'autres compilations tournent ne sépare pas les leviers (écarts de 1 à 3
  entre deux tours identiques) : comparer à charge **contrôlée** (seize boucles occupées
  en priorité normale, lancées le temps de l'essai) et en tours entrelacés, avec `IBOX_RP_OFF=…`
  dans le même exécutable.
- Une fenêtre de mesure hors écran, même à 2 pixels près, ne livre aucune image nouvelle à WGC :
  Windows ne dessine que ce qui est dans l'écran. `Mover::hidden` reste à l'écran mais transparente
  à 1/255, derrière tout, sans focus : rien de visible, et la capture en reçoit le contenu opaque.
- Dans un panneau navigateur masqué, `requestVideoFrameCallback` ne se déclenche pas : la part de
  l'invité ne se relève que dans une fenêtre réellement affichée.
- Le lien simulé doit être lu par le fil de l'hôte avant que l'essai ne l'efface (course corrigée).

### 15.5 À éprouver à deux PC : protocole pour Gébril

Matériel : deux PC avec iBox de cette branche, un jeu à 60 images/s chez l'hôte, un chronomètre à
l'écran de l'hôte (centièmes), un téléphone qui filme à 120 ou 240 images/s.

1. **Même réseau, câble.** Hôte : inviter l'ami en Joueur. Invité : menu de session ›
   Statistiques. Noter « Latence de l'image » et « Hôte / réseau / vous ». Attendu : réseau ≈ 1 ms.
2. **Vérité terrain.** Filmer les deux écrans côte à côte avec le chronomètre ; l'écart lu sur une
   image du film doit valoir la latence affichée plus un à deux rafraîchissements d'écran (étapes 1
   et 9, que le logiciel ne voit pas). Un écart bien plus grand met la mesure en cause.
3. **Hôte chargé.** Lancer un jeu lourd chez l'hôte : « Dont ce PC » (carte de l'hôte) doit rester
   à quelques millisecondes et l'invité à 60 images/s.
4. **Par Internet**, sans puis avec « Priorité à la réactivité » (Paramètres › Remote Play, côté
   hôte), cinq minutes chacun : comparer la latence affichée, les à-coups ressentis, la finesse de
   l'image. Relever le débit montant de l'hôte (test de débit) pour situer l'essai.
5. **Wi-Fi faible ou partage de connexion** chez l'invité : la latence doit monter puis
   redescendre en quelques secondes, sans rester haute ; l'image peut se dégrader.
6. **Commandes.** Manette et clavier pendant les étapes 4 et 5 : aucune touche qui reste
   enfoncée, pas d'appui avalé. Relever « Commande reçue → injectée » dans la Session d'essai.
7. **Compatibilité.** Un PC en 1.0.7 et l'autre sur cette branche, dans les deux sens : la session
   doit fonctionner ; seule la latence de bout en bout manque (« — »), et « Entrées refusées » ne
   doit pas grimper chez l'hôte en 1.0.7.
8. **AMD / Intel** si un tel PC est disponible comme hôte : relever l'encodeur retenu et
   « Encodage (médiane) » dans la Session d'essai.

Essais sur un seul PC, à refaire à volonté (fenêtre invisible, sans son) :
```
cargo test --release --lib remote_play::transport::loopback_tests::phase1c_loopback -- --ignored --nocapture --test-threads=1
```
Variables : en tête de `transport/loopback_tests.rs` (`IBOX_RP_LINK`, `IBOX_RP_OFF`,
`IBOX_RP_RESPONSIVE`, `IBOX_RP_NOISE`).
