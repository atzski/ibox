# iBox pour Steam Deck — audit de portage

Audit du 2026-11-18, sur la branche `ibox-phases-1-3` (0.1.104). **Rien n'est encore porté** : ce document
recense les prérequis, ce qui marche tel quel, ce qui doit être adapté et ce qui doit être abandonné
ou remplacé sur Steam Deck. Il complète `SMARTCONFIG.md` §16, qui a déjà préparé la détection du
matériel Linux et SteamOS.

---

## 1. Verdict

Le portage est **faisable sans réécriture**. La logique « métier » est surtout portable : React, Three.js, base
SQLite, scanner, métadonnées, iNetbox, succès, manuels, profils et cœur de SmartConfig. Environ
**20 % du code natif** est propre à Windows, mais il est déjà en partie isolé derrière `cfg(windows)`.

Trois sujets décident du calendrier, dans cet ordre :

1. **Remote Play invité.** Sous Linux, Tauri utilise WebKitGTK et non Chromium. WebKitGTK **n'offre pas
   WebRTC** : le moteur GStreamer est désactivé, son remplaçant LibWebRTC est prévu pour la 2.56
   (vers mars 2027), et wry n'active de toute façon pas `enable-webrtc`. L'invité actuel
   (`src/services/remotePlayGuest.ts`, `RTCPeerConnection`) **ne fonctionnera pas** sur le Deck.
   Il faut une autre architecture d'invité (§6).
2. **Le Mode Jeu (gamescope).** Une seule fenêtre au premier plan, pas de raccourcis globaux, pas de
   zone de notification, échelle d'écran particulière. Les fenêtres secondaires d'iBox (toast,
   overlay, indicateur Remote Play) et Alt+E sont à repenser (§5).
3. **La chaîne de construction Linux.** Aucune n'existe aujourd'hui : pas de distribution WSL, pas
   de cible Rust Linux, et `release.ps1` ne produit qu'un NSIS. On ne peut pas compiler Tauri pour
   Linux depuis Windows sans environnement Linux (§9).

**Recommandation : une seule base de code et deux produits.** Pas de fork. On garde la compilation
conditionnelle côté Rust et on ajoute un drapeau de plateforme côté interface (`windows` ou
`steamdeck`). Les deux versions publiées sont « iBox pour Windows » (NSIS) et « iBox pour Steam Deck »
(AppImage). Une seule branche et un seul `changelog.ts`, avec des notes par plateforme si besoin.

---

## 2. La cible : Steam Deck et SteamOS

| Élément | Valeur | Conséquence pour iBox |
|---|---|---|
| Processeur graphique | APU AMD Zen 2, 4 cœurs / 8 fils, RDNA2 8 CU, 16 Go partagés | L'étagère Three.js est à mesurer, l'économie de batterie est indispensable (§7) |
| Écran | 1280×800 (16:10), 60 Hz (LCD) / 90 Hz (OLED), tactile | La mise en page actuelle vise 1440×900 (`minWidth 1100`, `minHeight 700`) : la densité est à revoir |
| Système | SteamOS 3 (base Arch), système en lecture seule, `/home` inscriptible | Pas de paquet système : AppImage dans `~/Applications`, ou Flatpak |
| Interface | Mode Jeu (gamescope, Steam au premier plan) et Mode Bureau (KDE Plasma) | iBox doit vivre **en Mode Jeu**, ajouté comme « jeu non-Steam » |
| Entrées | Steam Input (manette virtuelle de type Xbox), pavés tactiles, gyroscope, boutons Steam et « … » réservés | L'API Gamepad du WebView reçoit la manette virtuelle ; Steam et « … » ne sont jamais vus par iBox |
| Stockage | SSD interne et microSD montée sous `/run/media/<utilisateur>/<étiquette>` | Dossiers de ROMs par défaut, liens symboliques fréquents (déjà noté dans SMARTCONFIG §16.1-4) |
| Moteur web Tauri | WebKitGTK 4.1 (wry) | Pas de WebRTC, WebGL et WebCodecs moins éprouvés que dans WebView2 |

La détection du matériel existe déjà : `src-tauri/src/smartconfig/hardware/linux.rs` (DMI
`Jupiter`/`Galileo`, `ID=steamos`, batterie, Vulkan). Elle est testée, mais jamais compilée pour Linux.

---

## 3. Inventaire du code natif (Rust, ~45 000 lignes)

### 3.1 Déjà portable (aucun travail ou presque)

`db/`, `library/` (sauf chemins), `scanner/`, `metadata/` (sauf `keys.rs`), `assets/`, `manuals/`,
`achievements.rs`, `inetbox.rs` (un seul `cfg`), `profile.rs`, `wallpaper.rs`, `crash.rs` (masquage de
`USERPROFILE` à étendre à `HOME`), cœur de `smartconfig/` (modèle, validation, recommandation, INI,
sauvegardes), `remote_play/` : `protocol`, `permissions`, `config`, `signaling/`.

Dépendances portables : `rusqlite` (bundled), `reqwest` (native-tls, donc OpenSSL sous Linux),
`sysinfo`, `zip`, `sevenz-rust2`, `png`/`gif`/`jpeg-encoder`, `ed25519-dalek`, `opus-rs`, plugins
Tauri `single-instance` (D-Bus), `dialog`, `updater` (AppImage) et `autostart` (sans intérêt sur Deck).

### 3.2 Déjà isolé derrière `cfg(windows)`, avec une variante Linux à écrire

| Module | Rôle Windows | Équivalent Steam Deck |
|---|---|---|
| `pc/steam.rs` | racine Steam par le registre | `~/.local/share/Steam` (et `~/.steam/steam`). Flatpak Steam : `~/.var/app/com.valvesoftware.Steam/...`. Les analyseurs VDF/ACF servent tels quels |
| `metadata/keys.rs` | coffre Windows (`windows-native-keyring-store`) | Secret Service (KWallet ou gnome-keyring). **En Mode Jeu, le trousseau peut être verrouillé ou absent** : il faut un repli sur un fichier chiffré par une clé de l'appareil |
| `uninstall.rs` | registre et désinstalleurs | `steam://uninstall/<id>` marche aussi ; Corbeille selon la spécification freedesktop (`~/.local/share/Trash`) |
| `emulators/requirements.rs` | Visual C++, .NET, `Documents` | Les dépendances sont incluses dans les AppImage et les Flatpak. À réduire à presque rien |
| `smartconfig/hardware` | DXGI, D3D, registre | `linux.rs` est prêt, il reste à le compiler et le tester sur le Deck |
| `clips.rs`, `capture.rs` | Media Foundation, GDI, Alt+E | **À abandonner sur Deck** : Steam fait déjà les captures d'écran et l'enregistrement de partie (§5.4) |
| `pc/xbox.rs`, `pc/shortcuts.rs` | application Xbox, raccourcis Windows | Sans objet (§4) |

### 3.3 Spécifique à Windows et **non isolé** : la compilation Linux cassera ici

Ce relevé vient d'une recherche dans le code, pas d'une compilation. La première compilation Linux
en trouvera d'autres.

- **`explorer.exe`** à 6 endroits : `shell.rs:160` et `:228`, `capture.rs:378`,
  `emulators/commands.rs:286` et `:319`, `library/extras.rs:450`. À remplacer par une fonction unique
  `shell::reveal(path)` / `shell::open_url(url)` (`xdg-open` sous Linux, sans effet ou masquée en
  Mode Jeu).
- **Variables d'environnement Windows** (`USERPROFILE` ×7, `APPDATA` ×5, `LOCALAPPDATA` ×3,
  `ProgramFiles`, `ProgramData`, `SystemRoot`, `COMPUTERNAME`) : `launcher/detect.rs`,
  `emulators/install.rs:87`, `library/extras.rs:243`, `pc/connectors.rs`, `crash.rs`,
  `pc/mod.rs:250` (`rundll32.exe`). Il faut un module `paths` unique (`home`, `data`, `config`,
  `documents`) qui s'appuie sur XDG sous Linux. `smartconfig/platform.rs` a déjà `UnixDirs`, à
  réutiliser.
- **`.exe` codé en dur** (environ 300 occurrences, dont `pc/mod.rs` ×39, `library/repo.rs` ×27,
  `emulators/catalog.rs` ×26, `launcher/` ×50). Beaucoup sont des tests ou des noms de processus
  Windows légitimes. Le vrai travail est **le catalogue d'émulateurs et le lanceur** (§4.2).
- **`smartconfig/backup.rs:357`** : `cmd /C mklink /J` (à vérifier, probablement dans un test).
- **`str0m` avec `wincrypto`** : le transport Remote Play est restreint à Windows à cause du
  chiffrement. Sous Linux, il faut la fonction `openssl` ou une cryptographie Rust de str0m. C'est
  un prérequis de l'invité (§6).

### 3.4 Remote Play : ce qui reste à Windows (hôte)

`capture/` (WGC, D3D11), `encode/` (Media Foundation), `audio.rs` (boucle WASAPI), `input/win.rs`
(injection SendInput), `pad_driver.rs`/`input/pads.rs` (ViGEmBus), `latency_critical_thread` (MMCSS).
Ces modules **ne seront pas portés** : le Deck ne sera pas hôte (§6.1).

Point d'attention : `online/` et `transport/` sont restreints à Windows **en bloc**, alors qu'ils
contiennent aussi la partie invité (`online/sides.rs` : côtés hôte et invité). Il faut séparer les
deux côtés pour que l'invité compile sous Linux.

---

## 4. Bibliothèque, jeux PC et émulateurs

### 4.1 Jeux PC : les sources changent complètement

| Source Windows (aujourd'hui) | Sur Steam Deck |
|---|---|
| Steam | **Oui.** Même format de fichiers, racine différente. Lancement `steam://rungameid/<id>` |
| Epic, GOG, Amazon | Par **Heroic Games Launcher** (Flatpak `com.heroicgameslauncher.hgl`, bibliothèques JSON dans `~/.var/app/.../config/heroic`). Nouveau connecteur à écrire |
| EA, Ubisoft, Battle.net, Rockstar, RSI | Seulement à travers Heroic, Lutris ou Bottles (Proton/Wine). Connecteurs Lutris et Bottles possibles plus tard |
| Riot (LoL, Valorant) | **Non** : l'anti-triche (Vanguard) bloque Linux. À masquer |
| Xbox (Game Pass PC) | **Non**. À masquer |
| Ajout manuel `.exe/.bat/.cmd` (`pc/mod.rs`) | `.sh`, `.AppImage`, `.desktop`, binaire exécutable. Un `.exe` passerait par Proton (`umu-launcher`) : option avancée, pas pour la v1 |
| Jeu en cours (`pc/running.rs`, `sysinfo`) | Marche, mais un jeu Proton apparaît comme `wine64-preloader`/`reaper`. Le lanceur Steam `reaper SteamLaunch AppId=<id>` sert à la détection |

**Mode Jeu et lancement d'un jeu Steam depuis iBox.** iBox est lui-même un « jeu non-Steam ». Un
`steam://rungameid` envoyé depuis iBox lance le jeu, et Steam le met au premier plan, tandis qu'iBox
reste « en cours » derrière. C'est le comportement des frontends comme ES-DE et RetroDECK. Le retour
se fait en quittant le jeu. Ce point est à valider sur le matériel : retour au premier plan, suivi du
temps de jeu, succès.

### 4.2 Émulateurs (iBox Platforms, `emulators/catalog.rs`)

Le catalogue cible les archives Windows (`PPSSPPWindows64.exe`, `Eden-Windows-*-amd64-msvc*.zip`…).
Il faut **une deuxième colonne de sources par émulateur** : AppImage officielle (GitHub) en priorité,
Flatpak (Flathub) sinon.

| Émulateur | Piste Linux probable (à vérifier un par un avant la phase 3) |
|---|---|
| DuckStation, PCSX2, RPCS3, Cemu, melonDS, Azahar, Eden, mGBA, RMG, xemu, Vita3K | AppImage publiée sur GitHub |
| Dolphin, PPSSPP, SameBoy, Mesen | Flatpak (Flathub) ou version Linux propre au projet |
| Xenia Canary | **Pas de version Linux native** : passerait par Proton. À exclure de la v1 Deck |
| Lichii / Fritchii | À vérifier |

Conséquences :
- **Lanceur** (`launcher/launch.rs`, `profiles.rs`) : une AppImage se lance directement. Un Flatpak se
  lance par `flatpak run <id> <args>`. Les arguments de chaque profil restent valables en général,
  mais les chemins doivent être absolus et sans `\`.
- **Détection** (`launcher/detect.rs`) : chercher aussi les installations **EmuDeck** et
  **RetroDECK**, très répandues sur Deck (`~/Emulation`, `~/retrodeck`, `~/.var/app/*`). C'est un
  gros gain d'adoption : beaucoup d'utilisateurs ont déjà leurs émulateurs, BIOS et ROMs.
- **SmartConfig** : `locate_unix` par adaptateur (dossiers de configuration XDG et Flatpak), déjà
  listé dans SMARTCONFIG §16.1. Le Deck est classé « intermédiaire ».
- **Contrôle d'exécution** (`running_inside`, `launch_status`) : sous Linux, un processus Flatpak
  passe par `bwrap`.

### 4.3 Bibliothèque existante

La base SQLite d'un PC Windows contient des chemins `D:\Roms\...` : elle **n'est pas transférable**.
Sur le Deck, on repart d'un scan. Le compte iNetbox, les amis, les succès RetroAchievements et Steam
suivent l'utilisateur, car ils vivent sur des serveurs. Une future « importation depuis le PC »
(réglages, collections, jaquettes choisies) peut être envisagée, mais pas en v1.

---

## 5. Interface et Mode Jeu (gamescope)

### 5.1 Fenêtres

gamescope affiche **une seule fenêtre au premier plan**. iBox crée aujourd'hui quatre fenêtres :
`main`, `overlay` (`capture.rs:233`), le toast en bas à droite (`toast.rs:20`) et l'indicateur
Remote Play (`remote_play/mod.rs:283`).

Sur Deck, **tout doit vivre dans la fenêtre principale** : toasts en surimpression React, aucun
overlay séparé, indicateur intégré. Ces notifications ne seront visibles que quand iBox est au
premier plan. Pendant un jeu, c'est l'interface de Steam qui a la main. Les notifications Steam
natives ne sont pas accessibles aux applications tierces.

### 5.2 Raccourcis et touches

- Alt+E (overlay et capture), hotkey d'arrêt Remote Play (`input/hotkey.rs`) : **impossible** en
  Mode Jeu, car il n'y a pas de raccourci global sous gamescope et Wayland. Le menu rapide de la
  manette (`QuickMenu.tsx`) les remplace.
- Les boutons Steam et « … » appartiennent à Steam. Il faut vérifier que les actions d'iBox n'en
  dépendent pas.
- Clavier : `PadKeyboard.tsx` reste utile. Le clavier de Steam (Steam + X) existe aussi.

### 5.3 Affichage

- **1280×800** : à tester écran par écran (étagère, fiches, Paramètres). Prévoir un mode « compact »
  piloté par le drapeau de plateforme ou par la taille de la fenêtre.
- **Échelle** : sous gamescope, Xwayland annonce un facteur d'échelle supérieur à 1, ce qui a déjà
  cassé d'autres lanceurs Tauri. Il faut forcer l'échelle 1 ou la compenser.
- **Rendu WebKitGTK** : des problèmes d'écran noir sous gamescope ont été réglés par
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` ou `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Ces variables sont à
  définir dans le lanceur de l'AppImage selon les essais.
- **Tactile** : l'écran est tactile. iBox ne vise pas le tactile, mais le défilement au doigt
  devrait au moins fonctionner.

### 5.4 Fonctions à masquer ou remplacer sur Deck

| Fonction | Décision proposée |
|---|---|
| Capture Alt+E, clips MP4 (`capture.rs`, `clips.rs`) | Masquer. Steam fait les captures et l'enregistrement de partie. Plus tard, peut-être une importation de ces captures dans Communauté |
| Icône de zone de notification (`tray-icon`) | Masquer, car il n'y en a pas en Mode Jeu |
| Démarrage avec Windows (`autostart`) | Masquer. Équivalent possible : iBox ajouté à Steam et choisi par l'utilisateur |
| Fond d'écran Windows (`wallpaper.rs`) | À vérifier : il ne reste que le fond interne |
| `PowerButton.tsx` (« Windows ») | Proposer Quitter et Retour à Steam, pas Éteindre ni Redémarrer (c'est le rôle de Steam) |
| Textes qui citent Windows | Environ 80 occurrences dans `src/`. Il faut des libellés selon la plateforme, et `en.ts` à mettre à jour |
| Désinstallation | Steam : oui. Autres : Corbeille freedesktop |

### 5.5 Manettes

L'API Gamepad de WebKitGTK passe par libmanette, et Steam Input présente au jeu une manette
virtuelle. `input/gamepad.ts` (P1–P8, répétition, gâchettes) devrait fonctionner.

**À confirmer sur le matériel dès le premier jour** : correspondance des boutons (`mapping:
"standard"`), vibrations (`vibrationActuator`), et comportement quand le profil Steam Input d'iBox
est « Bureau » plutôt que « Manette ». On peut livrer un profil Steam Input conseillé.

---

## 6. Remote Play sur Deck

### 6.1 Choix confirmé : invité seulement

Le Deck pourrait techniquement être hôte (capture PipeWire de gamescope, encodage VA-API). Mais son
budget de puissance et de batterie, et le fait que tout le moteur hôte repose sur WGC, Media
Foundation, WASAPI, SendInput et ViGEm, en font un mauvais candidat. **La version Deck est invitée
seulement.** Elle rejoint un hôte Windows, en réseau local ou par Internet via iNetbox. Dans
l'interface, les réglages hôte (sources, permissions, pilote de manettes, débit montant, indicateur)
sont masqués, et la page Remote Play devient « Rejoindre ».

### 6.2 Le problème : pas de WebRTC dans WebKitGTK

Aujourd'hui, l'invité s'exécute **dans le WebView** : `RTCPeerConnection`, décodage H.264 de
Chromium, `jitterBufferTarget`, `getStats()`, `requestVideoFrameCallback`. Rien de cela n'existe
dans WebKitGTK sous Tauri en novembre 2026.

| Option | Principe | Avantages | Inconvénients |
|---|---|---|---|
| **A. Invité natif + WebCodecs (recommandée)** | str0m reçoit côté Rust (réseau, DTLS/SRTP, DataChannels, comme l'hôte). Les images H.264 sont envoyées au WebView par un `Channel` Tauri, décodées par `VideoDecoder` (WebCodecs), puis dessinées dans un `<canvas>`. Le son Opus passe par `AudioDecoder` ou est joué en Rust | Une seule fenêtre (compatible gamescope). Réutilise str0m et le protocole existants. Aucune dépendance au WebRTC du navigateur. Le même invité peut servir sous Windows plus tard | Tampon de gigue, synchronisation et statistiques à réécrire, ce que Chromium faisait seul. Le décodage matériel de WebCodecs (VA-API) sous WebKitGTK est **à vérifier**. La copie par IPC est probablement faible (images de 20 à 100 Ko), mais à mesurer |
| B. Moteur Chromium (CEF) pour la version Linux | Tauri CEF (`tauri-runtime-cef`) remplace WebKitGTK | Le code invité actuel marche tel quel, et le rendu ressemble à Windows | Encore expérimental et réglé à la main sous Linux. Environ 200 Mo de plus. Change le moteur de **toute** l'application pour un seul module |
| C. WebKitGTK maison avec GstWebRTC | Livrer un WebKitGTK compilé avec WebRTC dans l'AppImage | — | Moteur abandonné par ses auteurs, sans TURN ni mDNS complets, et wry à modifier. Fragile, à écarter |
| D. Attendre WebKitGTK 2.56 (LibWebRTC) | Prévu vers mars 2027, puis il faudrait que wry l'active et que l'AppImage le livre | Aucun travail | Calendrier incertain. Il faudrait un WebKitGTK récent dans l'AppImage |
| E. Invité entièrement natif (décodage VA-API et rendu en Rust) | Fenêtre de rendu native | Latence minimale | Deuxième fenêtre sous gamescope, ou rendu natif dans la fenêtre Tauri, ce qui est difficile. Beaucoup plus de code |

**Décision (2026-11-18) : option A retenue, précédée d'un prototype d'une semaine sur le Deck**, avant tout autre
chantier Remote Play. Le prototype doit mesurer :
1. `VideoDecoder.isConfigSupported` pour le H.264 High, Main et Baseline, et si le décodage est
   matériel.
2. La latence de bout en bout avec l'hôte Windows actuel.
3. La charge processeur et la batterie.

Si le prototype échoue sur le décodage, on retient l'option B (CEF), réservée à la version Linux.

### 6.3 Travaux de l'invité Deck (option A)

- `str0m` avec cryptographie portable. Séparer `online/` et `transport/` en côté hôte (Windows) et
  côté invité (multiplateforme).
- Invité Rust : réponse SDP (codecs annoncés selon `isConfigSupported`), réception RTP, reconstitution
  des images H.264, tampon de gigue minimal, demandes d'images clés (PLI) en cas de perte.
- Pont vers le WebView : un `tauri::ipc::Channel` binaire, `VideoDecoder`, `<canvas>`. Le son passe
  par `AudioDecoder` (Opus) ou par Rust (PipeWire).
- Entrées : la manette est lue dans le WebView (déjà fait) et envoyée en Rust sur les DataChannels.
  Le protocole `protocol.rs` ne change pas. Vibrations : `0x31 Rumble` vers `vibrationActuator`, à
  vérifier.
- Statistiques : celles de `getStats()` sont remplacées par celles de str0m côté invité.
- **Compatibilité de l'hôte Windows** : il ne voit qu'un pair SDP standard, donc aucune modification
  n'est attendue. À vérifier par le test de bout en bout `online/e2e_tests.rs` porté sous Linux.

---

## 7. Performances et batterie

- **Three.js (étagère, boîtes 3D, manuels)** : le WebGL de WebKitGTK sur RDNA2 est à mesurer. Prévoir
  des seuils comme `SMARTCONFIG`, en images par seconde et en watts.
- Ne rendre la scène qu'à la demande (`frameloop="demand"` de R3F) quand rien ne bouge, plafonner
  les images par seconde, réduire les textures procédurales (`art/covers.ts`) et l'anticrénelage.
- Veilles de fond : MAJ toutes les 15 s puis 30 min, pouls iNetbox toutes les 10 s, veille
  RetroAchievements en direct. À espacer sur batterie et à suspendre quand iBox n'est pas au premier
  plan.
- **Mise en veille du Deck** (fréquente) : reprendre proprement le pouls iNetbox, les veilles et les
  sessions Remote Play, qui seront coupées.

---

## 8. Distribution et mises à jour

| Sujet | Windows (aujourd'hui) | Steam Deck (proposé) |
|---|---|---|
| Format | NSIS, utilisateur courant | **AppImage** : un seul fichier dans `~/Applications`, et c'est le format mis à jour par le plugin `updater` de Tauri sous Linux. Flatpak plus tard (Flathub), mais le bac à sable complique le lancement des émulateurs (`flatpak-spawn --host`) |
| Mise à jour | `latest.json`, plateforme `windows-x86_64` | Même fichier, avec une entrée `linux-x86_64` qui pointe vers l'AppImage signée (même clé minisign). `release.ps1` doit fusionner les deux |
| Installation en Mode Jeu | — | Ajouter iBox à Steam comme jeu non-Steam, avec ses illustrations de bibliothèque (grille, héros, logo) et ses options de lancement (variables WebKit). Une commande « Ajouter iBox à Steam » peut écrire `shortcuts.vdf` (format binaire, Steam fermé), comme le font EmuDeck et Steam ROM Manager |
| Dépôt public `atzski/ibox` | synchronisation par correctif | Inchangé. Les notes de version précisent la plateforme |
| Taille | — | WebKitGTK et GStreamer embarqués dans l'AppImage : prévoir 80 à 120 Mo |
| Règle « pas d'installation automatique » | respectée | Respectée : l'utilisateur copie l'AppImage lui-même |

---

## 9. Prérequis avant de lancer quoi que ce soit

### 9.1 Matériel et accès
1. **Un Steam Deck pour les essais**, LCD ou OLED, idéalement les deux un jour. En Mode Bureau :
   définir un mot de passe utilisateur (`passwd`, à faire soi-même), activer `sshd` pour déployer et
   lire les journaux depuis ce PC.
2. Une microSD de test avec quelques ROMs, et si possible une installation EmuDeck ou RetroDECK
   pour tester la détection.
3. Un hôte Windows iBox sur le même réseau local pour Remote Play (ce PC suffit).

### 9.2 Chaîne de construction Linux (aucune n'existe aujourd'hui)
- **Option 1 (recommandée pour démarrer)** : WSL2 avec Ubuntu 22.04 sur ce PC. On y installe Rust,
  Node et les dépendances Tauri (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`,
  `libayatana-appindicator3-dev`, `libssl-dev`, `patchelf`). Construire sur une glibc ancienne
  rend l'AppImage compatible avec SteamOS. **Remote Play (D3)** : `gstreamer1.0-libav` et
  `gstreamer1.0-plugins-bad` doivent être installés sur la machine de construction, sinon
  l'AppImage n'emporte aucun décodeur H.264 et WebCodecs refuse tout flux (installés dans WSL le
  2026-11-18 ; l'AppImage passe de 100 à 155 Mo).
  À noter : WSL n'a **aucune distribution installée** aujourd'hui.
- Option 2 : construire directement sur le Deck (distrobox en Mode Bureau). Plus lent, mais c'est
  le vrai matériel.
- Option 3 : intégration continue. Le dépôt local n'a pas de remote : il faudrait un dépôt privé ou
  passer par `atzski/ibox`. À décider.
- ~~`release.ps1` : étape Linux~~ : fait le 2026-11-18. `.\scripts\release.ps1 -Linux` construit
  aussi l'AppImage signée dans WSL (`scripts/linux-build.sh release` : tests stricts, chemins de
  compilation effacés, adresse de mise à jour vérifiée), l'analyse (anti-fuite) et ajoute
  `linux-x86_64` au même `latest.json` ; `SHA256SUMS.txt` liste les deux fichiers et `-Publish`
  envoie l'AppImage et sa signature. Clé, adresse et identifiants ScreenScraper passent par
  `WSLENV`, jamais en argument. Sans `-Linux`, le script refuse de construire si la version en
  ligne inclut déjà Linux (sinon la mise à jour du Deck échouerait).

### 9.3 Décisions à prendre (par toi)
1. ~~Stratégie de l'invité Remote Play~~ : **tranché le 2026-11-18, option A** (invité natif str0m +
   WebCodecs). Le prototype D3 valide le décodage ; le repli CEF n'est étudié que s'il échoue.
2. **Périmètre de la v1 Deck** : bibliothèque, émulateurs, Steam, succès, iNetbox et Remote Play
   invité ? Ou bien sans Remote Play dans un premier temps ?
3. **Format** : AppImage seule pour commencer ?
4. **Nom et image** : « iBox » avec un drapeau de plateforme, ou « iBox Deck » ?
5. **Connecteurs PC** : Heroic dès la v1, Lutris et Bottles plus tard ?
6. **Émulateurs** : AppImage officielles téléchargées par iBox, réutilisation d'EmuDeck et RetroDECK,
   ou les deux ?

---

## 10. Feuille de route proposée

Les tailles sont relatives : P (petit), M (moyen), G (grand).

| Phase | Contenu | Taille | Sortie vérifiable |
|---|---|---|---|
| D0 — Socle | WSL Ubuntu, première compilation Linux, corrections de compilation (§3.3), module `paths`, `shell::reveal/open_url`, `cargo test --lib` vert sous Linux, drapeau de plateforme exposé à l'interface | M | AppImage qui démarre en Mode Bureau |
| D1 — Mode Jeu | Lancement sous gamescope (variables WebKit, échelle), fenêtre unique (toasts et indicateur intégrés), masquage des fonctions Windows, textes selon la plateforme, mesure de l'étagère 3D, profil Steam Input | M | iBox utilisable à la manette en Mode Jeu |
| D2 — Bibliothèque | Steam (racines Linux, `steam://`), ROMs sur microSD, catalogue d'émulateurs Linux, lanceur AppImage/Flatpak, détection EmuDeck/RetroDECK, SmartConfig `locate_unix` | G | Un jeu console et un jeu Steam lancés depuis iBox, avec retour propre |
| D3 — Prototype invité | Option A en prototype : str0m invité, WebCodecs, mesures (§6.2) | M | Mesures de latence et de batterie, choix A ou B tranché |
| D4 — Remote Play invité | Invité complet (entrées, son, statistiques, iNetbox), page « Rejoindre » | G | Partie à distance Deck → PC Windows en réseau local puis par Internet |
| D5 — Finitions | Heroic, trousseau de repli, batterie et veille, « Ajouter à Steam », `release.ps1`, `latest.json` double, site et notes | M | Version publiée |

D0 et D1 conditionnent tout le reste. D3 peut démarrer juste après D0, en parallèle de D1 et D2,
pour lever le risque principal au plus tôt.

---

## 11. Risques

| Risque | Probabilité | Parade |
|---|---|---|
| WebCodecs sans décodage matériel ou instable dans WebKitGTK | moyenne | Prototype D3 tôt ; repli CEF (option B) |
| WebKitGTK sous gamescope : écran noir, échelle, performances 3D | moyenne | Variables WebKit, mode compact, rendu à la demande ; CEF si les performances sont insuffisantes |
| Trousseau indisponible en Mode Jeu | élevée | Repli sur un fichier chiffré |
| Changements de SteamOS (mises à jour fréquentes) | moyenne | Essais sur la branche stable et la branche de prévisualisation |
| Émulateurs sans version Linux (Xenia) ou au format qui change | faible à moyenne | Exclusion explicite, catalogue à double source |
| Retour vers iBox après un jeu Steam en Mode Jeu | moyenne | À valider en D2 ; c'est le comportement connu d'ES-DE |
| Charge de maintenance : deux plateformes à publier à chaque version | certaine | Une seule base de code, intégration continue ou WSL scriptée, tests Linux dans `npm test` / `cargo test` |

---

## 12. Avancement

### D0 — Socle (2026-11-18)
- WSL : Ubuntu 22.04 installé dans `C:\WSL\Ubuntu-22.04` (hors AppData, utilisateur root, sans mot de
  passe). Outils : Node 22, Rust stable, WebKitGTK 4.1 (2.50), dépendances Tauri.
- `scripts/linux-build.sh check|test|bundle` copie le dépôt dans `~/ibox` (Linux), puis compile,
  teste ou construit l'AppImage. Depuis PowerShell :
  `wsl -d Ubuntu-22.04 -u root -- bash -lc "tr -d '\r' < /mnt/c/<dépôt>/scripts/linux-build.sh > /root/lb.sh && IBOX_SRC=/mnt/c/<dépôt> bash /root/lb.sh test"`
- Le code compile sous Linux. Changements :
  - `opus-rs` et `sevenz-rust2` sont devenus communs aux deux systèmes ;
  - `windows-native-keyring-store` est limité à Windows ;
  - `remote_play/unavailable.rs` fournit les commandes en ligne de remplacement hors Windows, et les
    commandes hôte de remplacement sont dans `remote_play/mod.rs` ;
  - `shell::open_target`/`reveal` remplacent les 6 appels à `explorer.exe` ;
  - le module `paths` (`home`, `documents`) remplace `USERPROFILE` ;
  - le code Windows non appelé sous Linux est autorisé (`allow(dead_code)` hors Windows).
- Plateforme : la commande `platform_info` (`src-tauri/src/platform.rs` : os, modèle de Steam Deck,
  Mode Jeu par gamescope) est lue au démarrage par `src/services/platform.ts` (`usePlatform`,
  `isLinux`). Rien n'est encore masqué dans l'interface (phase D1).
- Tests : Linux 370 réussis, 25 ignorés, dont 14 marqués `cfg_attr(not(windows), ignore)` (chemins
  Windows, `locate_unix` en D2). Windows 429 réussis, interface 91 réussis.
- AppImage : `iBox_0.1.104_amd64.AppImage`, 89,6 Mo, construite dans WSL (`linux-build.sh bundle`,
  sans artefacts de mise à jour). Essai de démarrage sous WSLg :
  - en Wayland, GTK s'arrête sur « Error 71 (Protocol error) », un défaut connu de WSLg ;
  - en X11 (`GDK_BACKEND=x11`), iBox reste en marche (environ 250 Mo) : base créée, fenêtre `main`
    et icône de notification présentes ;
  - WSLg annonce un écran factice de 131072×1 : la fenêtre plein écran est mal dimensionnée et
    l'affichage n'a pas pu être vérifié par une capture. **À vérifier sur le Deck.**
- Constats pour D1 :
  - `GStreamer element autoaudiosink not found` : le son de l'interface demandera
    `bundle.linux.appimage.bundleMediaFramework` ou les greffons GStreamer du système ;
  - le message de nettoyage du coffre parle encore du « Coffre d'identifiants Windows ».
- Reste hors D0 : coffre de clés Linux (les clés API ne s'enregistrent pas encore), Steam et
  émulateurs Linux (D2).

### D1 — Mode Jeu (2026-11-18, code prêt, à essayer sur le Deck)
- **Une seule fenêtre** (`platform::SINGLE_WINDOW`, Linux) : `toast::push` prévient la fenêtre
  principale au lieu d'ouvrir la fenêtre `toast`. `ToastWindow inline` est monté dans `App.tsx`
  (en bas à droite, au-dessus de l'interface). L'overlay Alt+E et l'indicateur hôte ne s'ouvrent
  jamais sous Linux (capture et hôte absents).
- **Mode Jeu** (`platform::game_mode()`, par gamescope) :
  - aucune icône de zone de notification, et la fermeture ne masque pas la fenêtre ;
  - `hide_main` ne masque jamais la fenêtre : il met seulement l'interface au repos (musique
    coupée) pendant une partie ;
  - le bouton Réduire est caché.
- **WebKitGTK** : `platform::prepare_webview()` définit `WEBKIT_DISABLE_DMABUF_RENDERER=1` en Mode
  Jeu, si l'utilisateur ne l'a pas déjà fait. `WEBKIT_DISABLE_COMPOSITING_MODE=1` reste un recours
  manuel dans les options de lancement Steam, car il coupe l'accélération 3D.
- **GStreamer** embarqué dans l'AppImage (`bundle.linux.appimage.bundleMediaFramework`) pour le
  son de l'interface.
- **Interface** (drapeau `usePlatform`) :
  - Système : pas de « Lancer avec Windows », ni de groupe Overlay ou clips. Le groupe
    Arrière-plan est caché en Mode Jeu. Textes « coffre du système » et « sur Steam Deck ».
  - Le démarrage automatique n'est plus activé d'office sous Linux.
  - L'assistant n'a plus d'étape « iBox et Windows » et ne liste que Steam.
  - Remote Play : page d'explication (invité à venir).
  - Communauté : les captures se font avec Steam (Steam + R1).
  - Apparence : « Suit le système ».
  - Boutiques PC : ajout manuel et Steam seulement (`pc/connectors.rs`).
  - Les textes anglais sont ajoutés dans `en.ts`.
- **Vérification** : aperçu navigateur en 1280×800, avec `?platform=deck` (simulation réservée au
  développement). L'accueil et les Paramètres tiennent à l'écran, et le mode Windows est inchangé.
- **Reste à faire sur le matériel** : affichage sous gamescope (échelle, écran noir), fluidité de
  l'étagère 3D, manette Steam Input, retour au premier plan après un jeu, notifications
  intégrées. Profil Steam Input conseillé : modèle « Manette » (pas « Bureau »).

### D2 — Bibliothèque (2026-11-18, première partie)
- **Steam sous Linux** (`pc/steam.rs`) :
  - racines `~/.local/share/Steam`, `~/.steam/steam`, `~/.steam/root`, puis Flatpak
    `~/.var/app/com.valvesoftware.Steam/...`, reconnues par leur dossier `steamapps` ;
  - `steam::executable()` lance la commande `steam` du PATH (SteamOS), sinon `steam.sh`, ou
    `flatpak run com.valvesoftware.Steam`. Le lancement (`-applaunch`), l'installation
    (`steam://install`) et la désinstallation (`steam://uninstall`) passent par elle ;
  - les bibliothèques sur microSD (`libraryfolders.vdf`) sont testées.
- **Corbeille Linux** (`uninstall.rs`) par `gio trash`, sans aucune suppression définitive.
  Garde-fous Linux :
  - dossiers larges (`home`, `run`, `media`, `.local`…) ;
  - racines de support amovible (`/run/media/<utilisateur>/<carte>`) ;
  - dossiers système et personnels protégés.
  Test dédié sous Linux.
- **Émulateurs installés** (`launcher/detect.rs`) :
  - AppImage (`*.AppImage`), reconnues par leur nom ;
  - Flatpak, par les lanceurs de `exports/bin` (système et utilisateur, liens symboliques
    acceptés), reconnus par le dernier segment de l'identifiant (`org.DolphinEmu.dolphin-emu`
    donne `dolphin-emu`). Aucun identifiant n'est codé en dur. Le lanceur Flatpak se lance
    comme un exécutable, donc le profil d'arguments est inchangé ;
  - `~/Applications` et `~/Emulation` (EmuDeck) sont parcourus.
- **iBox Platforms** : l'installation automatique est refusée hors Windows, avec un message qui
  oriente vers Discover, EmuDeck ou l'AppImage officielle. Le catalogue ne connaît que des
  archives Windows.
- **iBox Platforms sous Linux** (2e partie) :
  - `catalog::LINUX` : 14 émulateurs dont la release officielle publie une AppImage x86_64
    (PPSSPP, DuckStation, PCSX2, Cemu, Azahar, Eden en version Steam Deck, Lichii, Fritchii,
    mGBA, RMG, RPCS3, xemu, Vita3K, Flycast) ;
  - noms relevés le 2026-11-18 et figés dans le test `appimages_linux_officielles` (aarch64,
    zsync et debug écartés) ;
  - `for_this_system` donne au paquet sa source Linux, ou le rend manuel s'il n'en a pas
    (Dolphin, RetroArch et ses cœurs, melonDS, Mesen et shadPS4 en archive zip, SameBoy,
    Stella, Xenia) ;
  - à l'installation, l'AppImage est contrôlée (en-tête ELF), placée telle quelle puis rendue
    exécutable (`install::place_appimage`), avec l'empreinte SHA-256 de GitHub quand elle
    existe. Les marqueurs « portables » de Windows sont ignorés ;
  - essai réel dans WSL : mGBA 0.10.5, Cemu 2.6 (empreinte vérifiée) et Eden 0.2.1 Steam Deck
    installés.
- **Aperçu Steam Deck** : fenêtre WSLg accélérée de 1280×800 par défaut. Xephyr, sans
  accélération et donc très lent, reste disponible avec `-Xephyr`.
- **Reste en D2** :
  - ~~`locate_unix` de SmartConfig~~ : fait pour les 8 adaptateurs, d'après le code de chaque
    émulateur (2026-11-18) ; Flatpak reconnu par son lanceur `flatpak/exports/bin/<id>`
    (dossiers `~/.var/app/<id>/config` et `data`) :
    - Dolphin : `portable.txt` → `User`, sinon `~/.dolphin-emu` s'il existe (hors Flatpak),
      sinon `$XDG_DATA_HOME/dolphin-emu` (UICommon.cpp) ; correctifs `share/dolphin-emu/Sys` ;
    - PCSX2 : `$XDG_CONFIG_HOME/PCSX2` ; une AppImage n'est jamais portable (Pcsx2Config.cpp) ;
      `GameIndex.yaml` illisible dans une AppImage : ses deux réglages sont préservés ;
    - DuckStation : `portable.txt`/`settings.ini` à côté de l'AppImage, sinon
      `$XDG_CONFIG_HOME/duckstation` si la variable existe, sinon `~/.local/share/duckstation`
      (core.cpp) ;
    - PPSSPP : `$XDG_CONFIG_HOME/ppsspp` (PathUtil.cpp) ;
    - RPCS3 : `$XDG_CONFIG_HOME/rpcs3`, sans sous-dossier `config` sous Linux (File.cpp) ;
    - Azahar, Eden : `user/` du dossier courant (iBox lance l'émulateur depuis son dossier),
      sinon `$XDG_CONFIG_HOME/azahar-emu` ou `eden` ;
    - RetroArch : `$XDG_CONFIG_HOME/retroarch/config` ou `rgui_config_directory` sous ce
      dossier (platform_unix.c) ; cœurs `.so` reconnus comme les `.dll`.
    Essayé seulement par des tests sur des dossiers simulés, pas encore sur un vrai Deck ;
  - ~~connecteur Heroic~~ : fait (`src-tauri/src/pc/heroic.rs`, source `heroic`, identifiant
    `<runner>/<appName>`). Titres GOG et Amazon lus dans le cache de Heroic
    (`store_cache/gog_library.json` clé `games`, `store_cache/nile_library.json` clé `library`),
    à défaut le nom du dossier ; lancement par `xdg-open heroic://launch/<runner>/<appName>`.
    Pas encore essayé avec un vrai Heroic. Faits relevés dans le code de Heroic
    (`src/backend/protocol.ts`, `storeManagers/*/constants.ts`) le 2026-11-18 :
    - dossier de Heroic : `~/.config/heroic`, ou en Flatpak
      `~/.var/app/com.heroicgameslauncher.hgl/config/heroic` ;
    - Epic : `legendaryConfig/legendary/installed.json` (objet `app_name` → `title`,
      `install_path`, `is_dlc`…), ancien emplacement `~/.config/legendary/installed.json` ;
    - GOG : `gog_store/installed.json` (`{"installed": [{appName, install_path, platform…}]}`,
      sans titre) ;
    - Amazon : `nile_config/nile/installed.json` (liste `{id, path…}`, sans titre) ;
    - lancement : `heroic://launch/<runner>/<appName>`, runners `legendary`, `gog`, `nile` ;
  - essai de lancement de jeux depuis iBox sur un vrai Deck ;
  - essai réel de lancement et de retour en Mode Jeu.

### Aperçu Steam Deck sur PC (2026-11-18)
`.\scripts\deck-preview.ps1` (`-Build` pour reconstruire l'AppImage d'abord) lance la vraie
AppImage Linux dans WSL, dans une fenêtre WSLg de 1280×800 accélérée par la carte graphique du
PC. Variables utilisées :
- `XDG_CURRENT_DESKTOP=gamescope` : chemins Mode Jeu d'iBox ;
- `IBOX_SIMULATE_DECK=1` : iBox se croit sur un Steam Deck, en fenêtre 1280×800 jamais en plein
  écran (`platform::apply_preview`).

`-Xephyr` ouvre plutôt un écran isolé sans gestionnaire de fenêtres, plus proche de gamescope,
mais sans accélération : la 3D y est très lente.
- Les données sont propres à WSL (`/root/.local/share/app.ibox.desktop`). Les dossiers de jeux
  Windows sont accessibles en lecture par `/mnt/c/...` ou `/mnt/d/...`.
- **Fidèle** : version Linux réelle, WebKitGTK, résolution, chemins Mode Jeu, interface
  Steam Deck, installation des émulateurs en AppImage.
- **Non fidèle** :
  - les performances (GPU du PC) ;
  - Steam Input, car WSL ne voit pas la manette sans `usbipd` : utiliser le clavier ;
  - gamescope lui-même, la veille, Steam (absent de WSL).

### D3 — Prototype de l'invité Remote Play (2026-11-18, sans Deck)
Option A en prototype : `src-tauri/src/remote_play/guest/` (Rust, Windows et Linux) et
`src/services/nativeGuest.ts` (WebCodecs).
- **Transport** : str0m compile sous Linux avec `rust-crypto` (Rust pur, rien de l'OpenSSL du
  système) ; Windows garde `wincrypto`. `transport/` est séparé : `sdp`, `stats`, `stun` communs,
  hôte (`host`, `peer`, `rate`, `router`) réservé à Windows.
- **Invité** : `GuestPeer` (sans E/S) répond à l'offre de l'hôte actuel, reçoit les images H.264
  et le son Opus, écrit sur `input`/`control`, jette les images non décodables et redemande une
  image clé (PLI, au plus toutes les 500 ms). `NativeGuest` : socket UDP, candidats local et STUN,
  fil réseau. Images envoyées au WebView par un `Channel` binaire (en-tête de 16 octets).
  L'hôte Windows n'a pas changé.
- **Validé** :
  - en mémoire face au vrai `HostPeer` : images à l'octet près, image clé repérée, entrée souris
    injectée, PLI → IDR ;
  - poignée de main DTLS/SRTP avec la cryptographie de Linux (test portable) ;
  - en boucle locale réelle (capture WGC, encodage MF, UDP) : 456 images en 8 s (57 im/s),
    15 Mbit/s, connexion en 18 ms, aucune interruption.
- **Mesures WebCodecs dans WebKitGTK 2.50.4** (banc de l'aperçu, extrait réel 720p de l'hôte,
  rythme de 60 im/s) :
  - sans `gstreamer1.0-libav`/`plugins-bad` : `VideoDecoder` existe mais aucun profil H.264 ;
  - avec eux : Baseline, Main, High et High 5.1 acceptés ;
  - **WebKitGTK exige le format AVC avec `description` (avcC)** : le flux Annex B de l'hôte est
    refusé (`h264parse` : « AVC caps, but no codec_data »). L'invité convertit donc chaque image
    (`annexBToAvc`, `avcConfig`), ce qui marche aussi sous Chromium ;
  - décodeur logiciel `avdec_h264` (celui du Deck avec cette AppImage : `vah264dec` est de rang
    nul dans GStreamer 1.20) : **3 ms** de décodage médian, 225/225 images ;
  - affichage : canvas 2D **34 ms** médian (le dessin coûte 2 ms, le reste est la composition de
    WSLg), `bitmaprenderer` 76 ms, WebGL `texImage2D(VideoFrame)` inutilisable (1,2 s). Canvas 2D
    retenu ;
  - **la scène 3D d'iBox affame le fil principal** (3 im/s dans l'aperçu) et WebCodecs rend ses
    images sur ce fil : l'écran de l'invité devra arrêter la scène 3D pendant une session.
- **Non mesuré, faute de Deck** : décodage matériel VA-API (forcer `vah264dec` par
  `GST_PLUGIN_FEATURE_RANK`, ou un GStreamer plus récent dans l'AppImage), latence de bout en
  bout, processeur et batterie. Le réseau WSL (NAT, pare-feu Windows) empêche la session réelle
  aperçu ↔ hôte ; le banc décode donc un extrait enregistré (`enregistre_un_extrait`).
- **Verdict provisoire** : l'option A tient (pas besoin de CEF à ce stade), sous réserve des
  mesures sur le Deck.
- **Décision à prendre (licences)** : livrer `avdec_h264` (FFmpeg, LGPL) et le H.264 dans
  l'AppImage : vérifier les obligations LGPL et la question des brevets H.264 avant publication.
- **Banc** : `cargo test --lib remote_play::guest::tests::enregistre_un_extrait -- --ignored`, puis
  `.\scripts\deck-preview.ps1 -RemotePlay` ; mesures dans `/tmp/deck-ibox.log`, lignes
  `[webcodecs]`. Session réelle : `hote_pour_apercu` (réseau local) au lieu de l'extrait.
- **Reste pour D4** : séparer `online/` (signalisation iNetbox) pour l'invité Linux, l'écran de
  l'invité (arrêt de la scène 3D, son Opus, manette vers `input`, vibrations), puis les mesures
  sur un vrai Deck.

### D4 — Invité Remote Play dans iBox (2026-11-18, à essayer sur un Deck)
- **Signalisation** : `remote_play/online/` compile désormais sous Linux (il remplace
  `unavailable.rs`). La partie hôte (fil d'hôte, invitation, capture) reste réservée à Windows ;
  sous Linux, `HostHandle` est un type vide impossible à construire, donc aucune session d'hôte
  n'existe. Les invitations iNetbox sont relevées aussi sur le Deck ; `remote_play_invite` y
  répond « Sur Steam Deck, iBox rejoint une partie mais n'en héberge pas. ».
- **Clé d'appareil (secret)** : sous Linux, pas de trousseau fiable en Mode Jeu. Les secrets vont
  dans `<données>/vault`, un fichier par clé, **non chiffré** mais en droits 0600 (dossier
  0700), écrit de façon atomique (`metadata/keys.rs`). Le Secret Service reste possible plus tard.
- **Écran de l'invité** (`RemotePlayOnline.tsx`, `GuestView`) : sous Linux, `NativeGuestSession`
  (`nativeGuest.ts`) remplace `GuestSession` (WebRTC) avec la même interface. L'image passe par
  un `<canvas>` (WebCodecs) et le son Opus par `AudioDecoder` (lecture avec 60 ms d'avance,
  démarrée au premier geste). La manette part par `attachPad`, inchangé (`InputSink`). Ping et
  pong se font sur `control`, et l'hôte muet 6 s met fin à la session. Sans image 20 s après la
  réponse, le message « Connexion impossible » s'affiche. Clavier et souris : pas encore sur
  le Deck.
- **Scène 3D en pause** (`scenePause.ts`, `ShelfView` en `frameloop="never"`) pendant toute
  session d'invité, Windows compris.
- **Paramètres › Remote Play (Deck)** : activation, acceptation des invitations, et état du
  décodage vidéo (sonde WebCodecs).
- **Non vérifié** : session réelle par iNetbox entre un PC et un Deck (deux comptes, deux
  appareils), décodage matériel, batterie. Le transport et le décodage sont validés à part (D3).
- **Reste** : clavier et souris de l'invité sur le Deck (pavés tactiles), vibrations
  (`vibrationActuator`), écran Steam Input, puis D5.

### D5 — Finitions (2026-11-18, à essayer sur un Deck)
Déjà faits plus tôt : connecteur Heroic, `release.ps1 -Linux` et `latest.json` commun, secrets
dans un fichier privé (D4).
- **Batterie** (`src-tauri/src/power.rs`, `src/services/power.ts`) : lecture de
  `/sys/class/power_supply` (batterie `BAT1`, secteur `ACAD` sur le Deck) ou
  `GetSystemPowerStatus` sous Windows. Sur batterie :
  - le pouls iNetbox passe de 10 à 30 s ;
  - la veille RetroAchievements passe de 45 à 90 s ;
  - la relecture des manifestes Steam passe de 4 à 12 s ;
  - l'étagère 3D est rendue sans suréchantillonnage (`dpr` 1).
  L'état est relu toutes les minutes.
- **Sortie de veille** : `SleepWatch` compare l'horloge monotone (arrêtée pendant la veille sous
  Linux) au temps réel. Un écart de 20 s ou plus envoie `system-resumed` : le pouls iNetbox part
  aussitôt, et l'interface relance la recherche de mise à jour et la veille RetroAchievements.
  Une session Remote Play coupée par la veille se termine comme une perte de l'hôte (D4).
- **« Ajouter iBox à Steam »** (Paramètres › Système, Deck) : `pc/steam_shortcut.rs` écrit le
  raccourci non-Steam dans `userdata/<compte>/config/shortcuts.vdf`, au format KeyValues binaire,
  lu et réécrit à l'octet près.
  - Le compte est le dernier connecté (`loginusers.vdf`). Le programme est l'AppImage
    (`$APPIMAGE`). L'identifiant du raccourci est le CRC-32 de `Exe` + `AppName`, avec le bit
    haut forcé.
  - L'original est sauvegardé (`shortcuts.vdf.ibox-backup`) et l'écriture est atomique. Rien
    n'est écrit si iBox y est déjà.
  - **Refus tant que Steam tourne** : il réécrit ce fichier en quittant. En Mode Jeu, Steam est
    toujours lancé, donc l'ajout se fait en Mode Bureau, Steam fermé.
  - **Illustrations** (`src-tauri/assets/steam/`, refaites par `scripts/steam-art.py`, 180 Ko,
    embarquées dans le seul programme Linux) copiées dans `userdata/<compte>/config/grid/` :
    `<id>p.jpg` (grille 600×900), `<id>.jpg` (capsule 920×430), `<id>_hero.jpg` (1920×620,
    sans texte : Steam y pose le logo), `<id>_logo.png` (transparent), `<id>_icon.png`
    (icône du raccourci). Composition originale aux couleurs d'iBox : boîte corail, Cal Sans,
    bleu nuit. Grille et capsule existent en français et en anglais (`portrait_en.jpg`,
    `wide_en.jpg`), choisies selon la langue d'iBox. Relancer l'ajout met les illustrations à
    jour (y compris après un changement de langue) et complète une icône vide.
- **Reste** :
  - la décision de licence sur le décodeur H.264 (D3) ;
  - **tous les essais sur un vrai Steam Deck** (D1 à D5).

### Site et notes de version Steam Deck (2026-11-18)
- **Site** (`site/index.html`, `site/en.html`) : section « iBox sur Steam Deck » (en essai) avec
  ses fonctions, les trois étapes d'installation (AppImage exécutable, puis « Ajouter iBox à
  Steam ») et ce qui reste propre à Windows. Lien dans le menu et sous le bouton principal.
  Illustration : la capsule Steam d'iBox (`site/img/steam-deck.webp`).
- **Bouton « Télécharger pour Steam Deck »** (`site/download.js`) : il pointe vers
  `iBox_<version>_amd64.AppImage` de la dernière version publiée. Sans AppImage, il est grisé
  avec « Bientôt disponible ». Les deux cas ont été vérifiés.
- **Notes de version** : `docs/STEAMDECK-NOTES.md`, ajoutées par `release.ps1 -Linux` aux notes
  de la version GitHub, avec le nom réel du fichier à la place de `iBox_VERSION_amd64.AppImage`.
  Elles ne vont pas dans « Quoi de neuf » (`changelog.ts`), que les utilisateurs Windows voient
  aussi. **À relire avant chaque version Linux** : le texte actuel présente la première version.
- Le site n'est pas publié : il se publie avec le reste, par la procédure habituelle.

## 13. Sources externes consultées (2026-11)

- WebKitGTK 2.54 (WebRTC désactivé, passage à LibWebRTC) : https://webkitgtk.org/2026/09/16/webkitgtk-2.54-highlights.html
- FAQ WPE (LibWebRTC par défaut prévu en 2.56) : https://wpewebkit.org/about/faq.html
- FOSDEM 2026, WebRTC dans WebKitGTK : https://archive.fosdem.org/2026/events/attachments/KMMLGM-webrtc_support_in_webkitgtk_and_wpewebkit_with_gstreamer_current_status_and_plan/slides/266710/webrtc_su_twrfhlu.pdf
- wry n'active pas `enable-webrtc` : https://github.com/LanternOps/breeze/issues/9557
- WebCodecs dans WebKit avec GStreamer : https://indico.freedesktop.org/event/5/contributions/170/attachments/107/165/WebCodecs%20in%20WebKit%2C%20with%20GStreamer%21.pdf
- Échelle sous gamescope (lanceur Tauri) : https://github.com/openOMSI-org/openOMSI/pull/2413
- Applications WebKit/Electron en Mode Jeu : https://steamcommunity.com/app/1675200/discussions/1/3416557114747120335/
- Tauri et CEF (cef-rs) : https://awesome.ecosyste.ms/projects/github.com%2Ftauri-apps%2Fcef-rs
- Protocole `steam://` : https://developer.valvesoftware.com/wiki/Steam_browser_protocol
- Lancement Steam depuis un frontend (RetroDECK) : https://retrodeck.readthedocs.io/en/latest/wiki_experiments/desktop-launch/desktop-launch-steam/
