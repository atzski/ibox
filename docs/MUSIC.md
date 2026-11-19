# Music in the Box : plan d'architecture (Windows)

Statut : étapes 0 et 1 faites (18/11/2026) : pont YouTube Music, lecteur Windows (SMTC), panneau Lecture, Alt+C et Vue + Y (raccourci réglable, `shortcut.rs`). Écart avec le plan : pas encore d'effet Acrylic (panneau sombre semi-opaque), prévu à l'étape 4.

Objectif : contrôler sa musique (YouTube Music en priorité) depuis un overlay léger et animé, pendant une partie, au clavier ou à la manette : lecture, titre suivant, recherche, playlists.

Le module reprend la logique de l'overlay Ctrl+Maj+S (`src-tauri/src/capture.rs`) : une fenêtre créée hors commande synchrone, cachée puis réaffichée, avec son propre aiguillage dans `src/main.tsx`. La musique arrive par **deux sources** qui partagent un même contrat :

- **Contrôles média de Windows (SMTC)** : marche avec n'importe quel lecteur, mais seulement pour lire, mettre en pause et changer de titre.
- **YouTube Music piloté dans une WebView2 cachée** : ajoute la recherche et les playlists.

Maquette interactive de l'overlay : artifact « Music in the Box » (privé).

## 1. Vue d'ensemble

```
 Raccourci clavier / combo manette (fil natif)
                │
                ▼
 ┌─ Rust : src-tauri/src/music/ ──────────────────────────────┐
 │  mod.rs       état central (NowPlaying, file d'attente),    │
 │               commandes music_*, événement music://state    │
 │  source.rs    trait Source { play, pause, next, seek, ... } │
 │  smtc.rs      Source SMTC (tout lecteur Windows)            │
 │  ytm/host.rs  Source YT Music : WebView2 cachée « ytmusic » │
 │  ytm/bridge.js  script injecté dans music.youtube.com       │
 │  hotkeys.rs   clavier (RegisterHotKey) + XInput (manette)   │
 │  window.rs    fenêtre « music » : affichage, focus          │
 └─────────────────────────────────────────────────────────────┘
        │ music://state, music://pad            ▲ invoke music_*
        ▼                                       │
 ┌─ Interface : fenêtre « music » (React) ────────────────────┐
 │  services/music.ts        store zustand + appels            │
 │  components/music/        MusicWindow, NowPlaying, Search,  │
 │                           Playlists, MiniPill (motion/react)│
 └─────────────────────────────────────────────────────────────┘
```

## 2. Côté Rust : module `music/`

### État central (`mod.rs`)

- Il garde `NowPlaying { source, title, artist, album, art_id, duration_ms, position_ms, playing, can_next, can_prev, liked? }` et la file d'attente.
- Il émet `music://state` uniquement quand quelque chose change. La position n'est pas envoyée en continu : l'interface l'interpole à partir de `position_ms` et de l'heure de l'instantané.
- La pochette est servie en octets par `music_art(id)`, comme `overlay_preview` le fait déjà avec `ipc::Response`.

### Source SMTC (`smtc.rs`)

- Elle utilise `GlobalSystemMediaTransportControlsSessionManager`, via la crate `windows` déjà présente. Il faut ajouter les fonctionnalités `Media_Control` et `Storage_Streams`.
- Elle s'abonne aux changements de session, de métadonnées, de lecture et de position. Les actions utilisées sont `TryTogglePlayPause`, `TrySkipNext/Previous` et `TryChangePlaybackPosition`.
- Elle choisit la session en cours, avec priorité à YouTube Music, que ce soit dans un navigateur ou dans l'appli PWA.

### Source YouTube Music (`ytm/`)

- **L'hôte** est une fenêtre `ytmusic` qui charge `https://music.youtube.com`. Elle est invisible, sauf pour la première connexion Google, et elle est créée depuis un fil séparé avec `run_on_main_thread`, comme dans `capture::show`.
- **Un dossier de données WebView2 à part** (`data_directory`, sous `AppData\…\ytmusic-webview`) est obligatoire, pour deux raisons :
  1. Les cookies Google restent isolés d'iBox.
  2. Cette fenêtre peut recevoir ses propres arguments de navigateur (`--autoplay-policy=no-user-gesture-required`). Des fenêtres WebView2 qui partagent un même dossier avec des arguments différents ne se créent pas.
- **Les commandes de Rust vers la page** passent par `window.eval("__ibox.cmd({...})")`.
- **Les remontées de la page vers Rust** passent par une seule commande, `music_bridge_report`. Elle est ouverte à ce domaine par une *capability* Tauri `remote` limitée à `https://music.youtube.com/*`, qui ne donne accès à rien d'autre.
- **Le script `bridge.js`** :
  - pilote la lecture avec l'API du lecteur de la page (`#movie_player` : `playVideo`, `pauseVideo`, `nextVideo`, `seekTo`, `setVolume`, `getPlayerState`), ce qui est plus stable que de cliquer dans le DOM ;
  - fait la recherche et lit la bibliothèque en appelant InnerTube (`/youtubei/v1/search`, `/browse` pour les playlists) **depuis la page elle-même**, avec ses cookies et sa configuration `ytcfg`. Rust ne voit jamais les identifiants Google ;
  - transforme les réponses en types simples (`Track`, `Playlist`). **C'est le seul point fragile**, d'où un fichier de traduction à part, testé sur des réponses enregistrées.

### Raccourcis (`hotkeys.rs`)

- **Clavier** : on sort la boucle `RegisterHotKey` de `capture.rs` pour en faire un registre commun (fait : `shortcut.rs`, Alt+X pour la capture et Alt+C pour la musique), au lieu d'un fil par fonctionnalité.
- **Manette** : il faut une lecture native par XInput, toutes les 16 ms environ.
  - La Gamepad API de Chromium ne voit rien quand la fenêtre est cachée ou n'a pas le focus.
  - Elle n'expose pas non plus le bouton Guide, que seul `XInputGetStateEx` (ordinal 100 de `xinput1_4.dll`) permet de lire.
  - Ce même fil transmet l'état de la manette à l'overlay ouvert (`music://pad`). On évite ainsi le piège connu où Chromium n'expose la manette qu'après un appui.

### Fenêtre et focus (`window.rs`)

- La fenêtre `music` est **de la taille du panneau** (environ 440 px × hauteur de l'écran, collée à droite). Elle est transparente, toujours au premier plan, absente de la barre des tâches, avec un **effet Acrylic** (`effects` de Tauri 2). C'est ce qui donne le vrai flou du jeu derrière : un `backdrop-filter` CSS ne voit pas les autres fenêtres.
- **À l'ouverture**, on retient la fenêtre du jeu (`GetForegroundWindow`) puis on prend le focus. Les émulateurs ignorent la manette quand ils ne sont pas au premier plan (réglage par défaut de RetroArch, Dolphin, PCSX2), donc le jeu ne reçoit plus les entrées.
- **À la fermeture**, on rend le focus au jeu (`SetForegroundWindow`). Sans ça, on revient au jeu sans contrôle.
- **En plein écran exclusif**, la fenêtre ne peut pas s'afficher par-dessus. On le détecte (`SHQueryUserNotificationState` = `QUNS_RUNNING_D3D_FULL_SCREEN`) et on passe en mode réduit : les combos manette marchent toujours, et une notification indique le titre.

## 3. Côté interface

- **`services/music.ts`** : un store zustand alimenté par `music://state`, avec des fonctions simples (`play`, `next`, `search`, `playlists`, `playPlaylist`, etc.).
- **`components/music/MusicWindow.tsx`** : branché dans `main.tsx` comme l'overlay. Il contient trois vues (Lecture, Recherche, Playlists) qui reprennent la maquette, avec `motion/react`, déjà utilisé par `OverlayWindow.tsx`.
- **Navigation à la manette** : on réutilise `InputController` et `PadKeyboard` (clavier virtuel). La recherche fonctionne pendant la frappe, avec un délai de 250 ms et l'historique en pastilles.
- **Couleur d'ambiance** : la couleur dominante de la pochette est calculée côté interface (échantillonnage sur un canvas) et conservée par pochette.
- **Paramètres › Musique** :
  - choix de la source (automatique, YouTube Music, autre lecteur) ;
  - raccourci et combo manette ;
  - connexion et déconnexion YouTube Music (la déconnexion supprime le dossier WebView2) ;
  - position du panneau.
- **Textes** en français, traduits dans `i18n/en.ts`. La fonctionnalité est signalée Windows uniquement dans `platform.rs`, comme la capture.

## 4. Contrat entre Rust et l'interface

| Commande | Rôle |
|---|---|
| `music_state()` | instantané au chargement de la fenêtre |
| `music_control(action)` | `toggle`, `next`, `prev`, `seek{ms}`, `volume{0-100}`, `shuffle`, `repeat`, `like` |
| `music_search(q)` | `Track[]` (YouTube Music seulement) |
| `music_playlists()` / `music_playlist(id)` | bibliothèque / titres d'une playlist |
| `music_play(target)` | `{track}` ou `{playlist, index}` |
| `music_art(id)` | octets de la pochette |
| `music_account(action)` | `status`, `login` (montre la fenêtre `ytmusic`), `logout` |

Événements : `music://state`, `music://pad`, `music://open` et `music://close`.

## 5. Sécurité, vie privée, conditions d'utilisation

- Les cookies Google restent dans le dossier WebView2 dédié. Rust ne les lit jamais et rien ne part vers iNetbox.
- La page YouTube n'a accès qu'à une seule commande Tauri.
- On utilise le client web officiel, avec ses publicités, sans téléchargement ni blocage. C'est l'équivalent d'un onglet ouvert.
- Le nom reste neutre (« Music in the Box ») ; YouTube Music n'apparaît que comme source.

## 6. Pièges déjà connus

- Ne jamais créer une fenêtre dans une commande synchrone (règle d'iBox).
- WebView2 : des arguments différents sur un même dossier de données empêchent la création des fenêtres, d'où le dossier dédié.
- La connexion Google dans une WebView2 passe en général (user-agent Edge), mais c'est **le risque principal**. Le prototype de l'étape 0 doit le lever en premier.
- Ne pas tester avec l'iBox installé depuis le shell (AppData virtualisé). Utiliser plutôt une copie isolée `app.ibox.manualtest` pilotée par CDP, comme pour les tests CSP.

## 7. Étapes

| Étape | Contenu | Critère de fin |
|---|---|---|
| **0. Prototype** (1–2 j) | Fenêtre `ytmusic` : connexion, lecture cachée, une recherche InnerTube depuis la page | On décide de continuer ou non la partie YouTube Music |
| **1. Lecture universelle** | `smtc.rs`, état central, registre de raccourcis, XInput, fenêtre `music` avec Acrylic et focus, vue Lecture | Pause et titre suivant pendant une partie RetroArch, focus rendu au jeu |
| **2. Pont YouTube Music** | `bridge.js`, playlists, lancer une playlist, file d'attente, « j'aime » | Lancer une de ses playlists depuis l'overlay |
| **3. Recherche** | Vue Recherche, clavier virtuel, historique | Chercher et lancer un titre à la manette seule |
| **4. Finitions** | Animations, Paramètres › Musique, mode plein écran exclusif, traduction, notes de version | Prêt pour `release.ps1` |

**Tests** :

- Rust (`cargo test --lib`) : logique de l'état central, lecture des raccourcis, choix de la session SMTC.
- Vitest : traduction des réponses InnerTube à partir de réponses enregistrées. Quand YouTube change son format, on ajoute la nouvelle réponse aux tests et on corrige.
- Une liste d'essais manuels en jeu.

## 8. Questions à trancher

1. **Combo manette** : Guide+Y entre en conflit avec la Xbox Game Bar. Proposition : « Vue + Y maintenus 0,4 s », réglable.
2. **Si le prototype échoue**, on peut quand même publier l'étape 1 (SMTC seul).
3. **Mini-lecteur dans iBox** : faut-il aussi une pastille dans l'accueil d'iBox, en dehors des parties ?
