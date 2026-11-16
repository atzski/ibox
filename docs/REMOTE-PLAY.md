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
bloqué : échec expliqué) ; un seul invité ; pas de son (WASAPI/Opus à faire) ; une seule session
(hôte ou invité) à la fois ; `stuns:` non pris en charge ; demandes « je veux rejoindre » (`kind:
request`) ignorées ; un 429 du serveur suspend iNetbox quelques secondes (comportement existant du
transport iNetbox).
