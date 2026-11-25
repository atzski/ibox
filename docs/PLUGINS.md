# Plugins iBox : plan d'architecture

Statut : iClips (1.0.8) apporte la première interface empaquetée (`screen`, permission `clips`). P1 à P3 faits (18 et 19/11/2026) : socle endormi sans plugin, installation signée, Paramètres › Plugins. Le paquet Music in the Box (« pont seul » : manifeste, icône, `bridge/`) réveille l'interface intégrée `overlay.builtin: "music"` ; P4 et P5 en cours de publication. Premier plugin : Music in the Box (`docs/MUSIC.md`).

Objectif : des extensions publiées **à part d'iBox**, découvertes et installées depuis **Paramètres › Plugins**, mises à jour sans nouvelle version d'iBox, avec leur créateur affiché (profil iBox). Premier plugin : Music in the Box, créé par **atzski**.

## 1. Principe : un socle dans iBox, un paquet téléchargé

| Partie | Où | Pourquoi |
|---|---|---|
| **Socle natif** (fenêtres par-dessus le jeu, raccourcis, manette XInput, contrôles média Windows, fenêtre WebView2 isolée) | Code d'iBox, générique | Le code natif ne se télécharge pas : charger des DLL tierces poserait des problèmes de sécurité et d'anti-triche (Vanguard). |
| **Plugin** (interface, pont YouTube Music `parse.js` + `bridge.js`, manifeste, icône) | Paquet `.iboxplugin` signé, projet et dépôt séparés | La partie fragile (YouTube change ses réponses) se corrige par une mise à jour du plugin, sans republier iBox. |

Le socle reste **endormi** tant qu'aucun plugin installé et activé ne le demande : pas de raccourci réservé, pas de fil XInput, pas de fenêtre.

## 2. Le paquet `.iboxplugin`

Une archive zip :

```
manifest.json
icon.png
ui/index.html, ui/assets/*.js|css   (interface compilée, React et motion inclus)
                                    noms en « / » : un zip aux chemins « \ » (Compress-Archive) est refusé
bridge/parse.js, bridge/bridge.js   (injectés dans music.youtube.com)
```

`manifest.json` :

```json
{
  "id": "music-in-the-box",
  "name": "Music in the Box",
  "version": "1.0.0",
  "author": { "name": "atzski", "inetbox": "<identifiant du profil>" },
  "description": "Contrôlez YouTube Music ou votre lecteur par-dessus vos parties.",
  "ibox": ">=0.1.107",
  "platforms": ["windows"],
  "permissions": ["overlay", "hotkey", "gamepad", "media-session", "webview:https://music.youtube.com"],
  "overlay": { "entry": "ui/index.html", "side": "right", "width": 460, "hotkey": "Alt+C", "padCombo": ["back", "y"] },
  "webview": { "url": "https://music.youtube.com/", "scripts": ["bridge/parse.js", "bridge/bridge.js"] }
}
```

Les **permissions** sont affichées avant l'installation. Chacune ouvre un groupe précis de commandes du socle, et rien d'autre.

## 3. Confiance : signature et catalogue

- **Signature** : chaque paquet est signé en ed25519 (`ed25519-dalek`, déjà présent). iBox vérifie la signature et le SHA-256 avant d'extraire quoi que ce soit, et refuse tout paquet non signé ou modifié.
- **Message signé** : `ibox-plugin-v1\n<id>\n<version>\n<sha256 hex>` ; la signature et l'empreinte viennent du catalogue (`scripts/plugin-sign.mjs sign` les calcule).
- **Clés** : la clé publique de l'éditeur est intégrée à iBox (`plugins/trust.rs`). Clé privée d'atzski : `Documents\iBox-sauvegarde\signature\ibox-plugins.key`. La clé privée reste **hors du dépôt et hors du coffre**, comme les autres secrets de publication, et n'est utilisée que par le script de publication du plugin. Au départ, un seul éditeur : atzski.
- **Catalogue** : une route `GET /v1/plugins` sur le serveur iNetbox (`IBOX_PLUGINS_CATALOG` la remplace, à l'exécution, par un fichier JSON local pour les essais), qui liste id, nom, version, URL du paquet, SHA-256, signature, auteur (identifiant de profil) et notes. Le créateur est donc un **vrai profil iBox** : son avatar et son nom viennent de `social.ts`, avec un lien vers son profil public.
- **Hébergement des paquets** : les Releases GitHub du dépôt public du plugin (`atzski/music-in-the-box`). Le catalogue ne contient que des liens et des empreintes.

## 4. Côté iBox

**Rust : `src-tauri/src/plugins/`**
- `catalog.rs` : lecture du catalogue iNetbox.
- `install.rs` : téléchargement, vérification (signature, SHA-256, version d'iBox minimale, plateforme), extraction sûre (aucun chemin en `..`, taille limitée) dans `AppData\plugins\<id>\<version>\`, bascule atomique de version, désinstallation.
- `registry.rs` : plugins installés et activés (`plugins.json`) ; `host.rs` réveille ou endort le socle.
- `protocol.rs` : protocole `iboxplugin://<id>/…` qui sert les fichiers du plugin (`register_asynchronous_uri_scheme_protocol`) avec sa propre CSP.
- `host.rs` + `music/overlay.rs` : le socle de `music/` devient générique. L'overlay, le raccourci et le combo sont paramétrés par le manifeste. Les scripts du pont sont lus dans le paquet au lieu de `include_str!`.

**Fenêtre du plugin** (`plugin-<id>`) : chargée depuis `iboxplugin://localhost/<id>/ui/index.html` (`http://iboxplugin.localhost/<id>/…` sous Windows). Le protocole ne sert un plugin qu'à sa propre fenêtre. **Aucune capability Tauri** ne vise cette fenêtre (une capability ouvrirait toutes les commandes d'iBox, faute de permissions par commande) : elle parle au socle par `POST /<id>/__host/<appel>` sur le même protocole, et `plugins/host.rs` vérifie chaque appel contre les permissions déclarées **et** accordées :

| Appel | Permission |
|---|---|
| `overlay.close` | `overlay` |
| `media.state`, `media.control` (`{action, value}`) | `media-session` |
| `webview.status`, `webview.open` (`{visible}`), `webview.call` (`{cmd, arg}`) | `webview:<origine>` |
| `clips.list`, `clips.update` (`{name, title?, favorite?}`), `clips.delete` (`{name}`), `clips.thumb` (`{name, jpeg, duration?}`) | `clips` |
| `clips.status`, `clips.save` | `clips-capture` |
| `edit.render` (`{kind: "mp4", segments: [{name, start, end}], title?}` ou `{kind: "gif", name, start, end}`) | `clips-edit` |
| `auto.get`, `auto.set` (`{voice?, pad?, end?}`), `auto.test`, `auto.pause` (`{ms}`, 1.0.9) | `clips-auto` |
| `shot.save`, `community.open` (et `GET /<id>/__shot` : image figée à l'ouverture du panneau) | `clips-capture` |
| `capture.get` (avec `outputs`, `inputs` : appareils de son branchés, et `overlayKeys`), `capture.set` (`{enabled?, quality?, seconds?, systemAudio?, microphone?, systemVolume?, micVolume?, tracks?, outputDevice?, micDevice?}` ; appareil `null` : celui par défaut), `capture.folder` | `clips-settings` |
| `share.copy`, `share.drag`, `share.reveal`, `share.save`, `share.link`, `share.copyLink` (`{name}`), `share.friends`, `share.send` (`{name, friendId}`) | `clips-share` |
| `screen.open`, `screen.close` | un `screen` dans le manifeste |

Les vidéos des clips se lisent par `GET /<id>/__clips/<nom>` (permission `clips`, réponses `206` par morceaux de 4 Mo pour la balise `<video>`). Événement `clips://changed` à chaque nouveau clip.

**Écran plein** (`"screen": { "entry": "ui/studio.html", "title": "iClips Studio" }`, 1.0.8) : une fenêtre `plugin-<id>:screen`, ouverte par le bouton « Ouvrir » de Paramètres › Plugins (`plugins_open_screen`, avec `?lang=fr|en&scheme=dark|light`). Elle ne navigue que dans le plugin et n'ouvre aucune fenêtre surgissante. La manette s'y lit par la Gamepad API (la fenêtre a le focus).

**Panneau en jeu empaqueté** (`overlay.entry`, 1.0.8, `plugins/panel.rs`) : fenêtre `plugin-<id>` transparente sur l'écran principal, exclue des captures, qui retient le jeu au premier plan et lui rend le focus. Raccourci du manifeste (3e emplacement de `shortcut.rs`, jamais celui de la capture ou de la musique ; pas encore réglable dans les Paramètres) et combo manette (XInput, `music::overlay::xinput_buttons` partagé). Événements `panel://open`, `panel://close-request`, `pad` (`ok`, `back`, `up`…) ; `overlay.close` cache le panneau. Un seul panneau de plugin à la fois. Langue et thème : `plugins_look`, appelé par `App.tsx`.

**Vignettes des clips** : faites par la page du plugin (WebView2 décode déjà la vidéo), gardées par `clips.thumb` à côté du clip (`<clip>.jpg`, 300 Ko au plus) et servies par `GET /<id>/__thumbs/<nom>` ; la durée va dans le fichier json du clip.

**Montage** (`clip_edit.rs`, 1.0.8) : nouveaux fichiers seulement, un rendu à la fois dans son fil, événements `edit://progress` `{job, ratio}` et `edit://done` `{job, name | error}`. MP4 : passages recopiés sans réencodage par Media Foundation (Source Reader → Sink Writer), chacun calé sur l'image clé qui précède son début ; assemblage seulement entre clips de même format (sinon message d'erreur). GIF : 10 s au plus, décodé par Media Foundation, 480 px, 12 i/s. Les GIF faits ainsi entrent dans `clips.list` (`kind: "gif"`). Essais : `clips::tests::clip_synthetique` (clip au format d'iBox, sans filmer l'écran) puis `clip_edit::tests::montage_reel` avec `IBOX_EDIT_SAMPLE`.

**Clips automatiques** (`clips_auto.rs`, `voice.rs`, 1.0.8) : trois déclencheurs, gardés dans `clips-auto.json` (au départ : « Clip ça ! » activé, Vue + A et fin de partie coupés), actifs seulement en partie avec la mémoire des clips et tant qu'un plugin activé a `clips-auto`. Voix : « Clip ça ! » / « Clip that! » par le moteur hors ligne de Windows (`Windows.Media.SpeechRecognition`, grammaire d'une liste de phrases, confiance moyenne ou haute) ; le micro ne s'ouvre que pendant la partie, une notification le dit à chaque début d'écoute. Manette : Vue + A maintenus 400 ms (fil XInput du panneau, panneau fermé). Fin de partie : le clip est gardé par la veille de `capture.rs` avant que la mémoire ne se vide. Pas deux clips voix ou manette à moins de 5 s. Le clip porte `auto` (`voice`, `pad`, `end`) dans son json et dans `clips.list`, puis une notification « Clip gardé » (montrée même en « Ne pas déranger »). `auto.test` écoute 8 s, même hors partie, et envoie `voice://heard` ; `voice://state` `{listening, error?}` suit l'écoute. `auto.pause` `{ms}` (1.0.9) rend la voix sourde pendant `ms` (10 s au plus, à renouveler tant qu'un clip joue avec le son), puis 1,5 s de grâce ; `{ms: 0}` la lève (après la grâce). Rien n'est enregistré, le micro reste ouvert : seules les phrases reconnues pendant ce temps sont écartées (le son d'un clip rejoué qui sort des haut-parleurs). `auto.get` rend `paused`. Sur iBox 1.0.8 l'appel est inconnu : le plugin doit s'en passer. Les notifications d'iBox sont exclues des captures (elles n'entrent pas dans les clips). Essai du moteur : `voice::tests::voix_reelle` (ignoré ; `IBOX_VOICE_LISTEN` ouvre le micro 2 s).

**Partage des clips** (`share.rs`, 1.0.8) : rien n'est stocké chez iNetbox. `share.drag` (appelé au `dragstart` de la page) lance sur le fil de la fenêtre le glisser-déposer de l'Explorateur (`SHDoDragDrop` sur l'objet de données du fichier) : le clip se dépose dans Discord, un dossier, un navigateur. `share.copy` met ce même objet dans le presse-papiers (`OleSetClipboard` + `OleFlushClipboard`). `share.save` : boîte « Enregistrer sous » (`tauri-plugin-dialog`), `share.reveal` : Explorateur, clip sélectionné. `share.link` : envoi chez Litterbox (`litterbox.catbox.moe`, 72 h, sans compte ; adresse fixée dans iBox, jamais par le plugin), `share://progress` `{job, ratio}` puis `share://done` `{job, name, link, until}` ou `{…, error}` ; le lien est gardé dans le json du clip (`link`, `linkUntil`, aussi dans `clips.list`) et resservi tant qu'il vaut plus d'une heure. `share.send` envoie ce lien en message privé iNetbox (route existante). Format vertical : `edit.render` `{kind: "vertical", name, start, end, focus}` (recadrage 9:16 réencodé en H.264, coupe à l'image près, son recopié). Essais : `share::tests::lien_reel` (`IBOX_SHARE_SAMPLE`), `clip_edit::tests::vertical_reel`.

**iClips remplace l'overlay de capture** (1.0.8) : quand le panneau d'un plugin activé a `clips-capture`, le raccourci de l'overlay (Alt+X) ouvre ce panneau au lieu de l'overlay d'iBox (`capture::on_hotkey`, `panel::takes_capture`), et l'ouverture du panneau fige l'image de l'écran (`capture::freeze`) pour « Garder la capture ». Réglages des clips depuis le plugin : `capture.set` les applique et les envoie à la fenêtre principale (`clip-settings`), qui les garde comme ceux de Paramètres › Captures. Qualité « max » (1440p 60 i/s, 20 Mbit/s), durée jusqu'à 2 minutes, volumes du son de Windows et du micro dans le mélange, pistes séparées : le MP4 garde le mélange seul (un MP4 à plusieurs pistes n'est pas relu dans l'ordre écrit : un lecteur pourrait jouer la mauvaise), le jeu et le micro vont dans `<clip>.game.m4a` et `<clip>.mic.m4a` (json : `tracks`). `edit.render` `{kind: "mix", name, game, mic}` refait le son (image recopiée, son décodé, mélangé, réencodé) et recopie les pistes. Notification `clip` (kind de `toast.rs`, toujours montrée) avec la jaquette du jeu et le son `clip` (`sound.ts`) pour les clips automatiques ; un clic ouvre le Studio. Les captures d'écran (`.png`) entrent dans `clips.list` (`kind: "image"`). Essai : `clip_edit::tests::mix_reel` sur `clip_synthetique` avec `IBOX_SYNTH_TRACKS`.

**Aucune commande d'iBox pour les fenêtres de plugin** (1.0.8) : Tauri tient la page `http://iboxplugin.localhost/…` pour locale (protocole déclaré par iBox), et sans manifeste de commandes, une page locale peut appeler toutes les commandes de l'application, capability ou pas. `lib.rs` enveloppe donc `generate_handler!` et refuse toute commande venue d'une fenêtre `plugin-…` ; les commandes `plugin:…` de Tauri restent soumises aux capabilities, que ces fenêtres n'ont pas.

Le socle envoie ses événements (`music://state`, `music://pad`, `music://open`, `music://close-request`) par `window.dispatchEvent(new CustomEvent("ibox:host", { detail: { event, payload } }))`.

**Socle endormi** : sans plugin activé, ni raccourci (`shortcut.rs` ne réserve pas Alt+C), ni lecture XInput, ni fenêtre. `plugins::host::apply` ouvre seulement ce que le plugin a reçu : `hotkey` (combinaison des réglages, le manifeste ne donne que la valeur par défaut), `gamepad` (combo du manifeste), `webview:https://music.youtube.com` (avec les scripts du pont fournis par le paquet), `backdrop`. Désactiver, mettre à jour ou désinstaller ferme le panneau et la WebView. En développement, `IBOX_MUSIC_DEV=1` réveille le tout sans plugin, avec le pont intégré.

**Interface : Paramètres › Plugins** (nouvelle catégorie dans `SettingsScreen.tsx`, page `screens/settings/PluginsPage.tsx`)
- Catalogue : cartes avec icône, nom, créateur (avatar et nom du profil), version, description.
- Fiche : permissions demandées, notes de version, boutons Installer, Activer/Désactiver, Mettre à jour, Désinstaller.
- Réglages propres au plugin : raccourci, connexion YouTube Music.
- Navigation à la manette comme le reste des Paramètres. Textes traduits dans `en.ts`.

## 5. Le projet séparé Music in the Box

- **Dossier local** : `music-in-the-box`, à côté du dossier iBox (comme `ibox-video`). Dépôt public `atzski/music-in-the-box`, commits au nom d'atzski.
- **Contenu** : l'interface actuelle (`MusicWindow.tsx`, `musicBox.ts`), le pont (`parse.js`, `bridge.js`), leurs tests (fixtures), le manifeste et l'icône.
- **Kit de plugin minimal** (`@ibox/plugin-sdk`, d'abord copié dans le projet) : types et appels du socle (`overlay.close`, `media.state`, `ytm.call`…), sons de l'interface.
- **Scripts** : `build` (Vite, un seul paquet), `pack` (zip, SHA-256, signature), `release` (Release GitHub, puis mise à jour du catalogue iNetbox). La publication passe, comme pour iBox, par une demande explicite.

## 6. Étapes

| Étape | Contenu | Critère de fin |
|---|---|---|
| **P1. Socle générique** | Sortir `music/` de son rôle « Music in the Box » : hôte d'overlay et WebView paramétrés par un manifeste, endormi par défaut | iBox sans plugin : aucun raccourci réservé, aucune fenêtre |
| **P2. Installation** | Catalogue, téléchargement, signature, extraction, protocole `iboxplugin://`, capabilities par plugin | Un paquet de test signé s'installe ; un paquet modifié est refusé |
| **P3. Paramètres › Plugins** | Catalogue, fiche, permissions, activer, mettre à jour, désinstaller ; créateur relié à son profil iBox | Parcours complet à la souris et à la manette |
| **P4. Projet Music in the Box** | Dossier et dépôt séparés, kit de plugin, build, signature, première Release, entrée du catalogue | Installation depuis iBox sur un PC sans le code de la musique |
| **P5. Nettoyage d'iBox** | Retirer de l'application l'interface et le pont de la musique (ils vivent dans le plugin) | Les tests iBox passent ; le plugin marche seul |

## 7. Pièges connus

- Les fenêtres se créent hors commande synchrone ; la WebView YouTube garde son propre dossier de données (voir `docs/MUSIC.md`).
- Un paquet est une donnée non sûre : extraction sans `..` ni lien symbolique, taille limitée, jamais d'exécution native.
- La CSP de la fenêtre du plugin autorise ses propres fichiers et les images de son domaine (pochettes), pas plus.
- Dépôt public d'iBox : le socle y part par la synchro habituelle ; le plugin a son propre dépôt.
