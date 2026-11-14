# Plateforme PC — bibliothèque multi-boutiques

Le PC est **une console comme les autres** dans iBox : même carte dans la rangée des
consoles, même navigation (souris, clavier, manette), mêmes favoris, recherche,
« Reprendre » et temps de jeu. Sa bibliothèque réunit **tous** les jeux PC, quelle
que soit leur boutique : les boutiques sont des *sources*, pas des consoles.

## Architecture

| Élément | Où | Rôle |
| --- | --- | --- |
| Console « PC » | `src/domain/platforms.ts`, `shared/platform-formats.json` | thème pastel (bleu ciel, turquoise, menthe), icône d'écran ; aucune extension scannée (les `.exe` des dossiers de jeux ne sont jamais importés par erreur) |
| Jeux | table `games` (`platform_id = 'pc'`) | la même table que les consoles |
| Versions | table `pc_installs` (migrations `005_pc.sql`, `006_pc_sync.sql`) | une ligne par source : `steam`, `epic`, `gog`, `manual`… ; installée ou non, masquée ou non, temps de jeu de la boutique |
| Connecteurs | `src-tauri/src/pc/connectors.rs` | interface commune `Connector` (présence, capacités, note, clé) ; une boutique s'ajoute sans toucher au reste |
| Lecture des boutiques | `pc/steam.rs`, `pc/epic.rs`, `pc/gog.rs`, `pc/vdf.rs` | fichiers locaux en lecture seule ; API Web officielle de Steam (clé facultative) |
| Synchronisation | `pc::sync_source` | ajoute les nouveaux jeux, met à jour les connus, marque « non installé » ceux qui ont disparu ; **ne supprime jamais rien** ; un jeu masqué le reste |
| Lancement | `launcher/repo.rs::plan` → `pc::launch_target` | même suivi de session que les émulateurs ; lancement par la boutique (« détaché ») : la boutique suit la partie |
| Installation | `pc::install_target`, commande `pc_install` | ouvre la fenêtre d'installation de la boutique ; iBox ne télécharge rien |
| Bibliothèque PC | `src/screens/LibraryScreen.tsx` | grille de jaquettes verticales ; catégories (tous, installés, non installés, récemment joués, récemment ajoutés, favoris) ; filtres par boutique ; jaquette adoucie pour un jeu non installé |
| Fiche PC | `src/screens/PcGameSheet.tsx` | pas de boîtier 3D : grande illustration en fond, jaquette flottante en relief, versions disponibles ; bouton principal « Jouer » ou « Installer » |
| Paramètres › PC | `src/components/pc/PcSettingsPanel.tsx` | boutiques détectées, capacités réelles, synchronisation activable, clé Steam, jeux masqués, ajout manuel |

## État réel des connecteurs

| Source | Jeux installés | Jeux possédés non installés | Lancement | Installation |
| --- | --- | --- | --- | --- |
| Ajout manuel (`.exe`) | ✅ choisi par l'utilisateur | — | ✅ exécutable direct | — |
| Steam | ✅ `libraryfolders.vdf`, `appmanifest_*.acf` ; temps de jeu `localconfig.vdf` | ✅ avec la clé API Web Steam de l'utilisateur (`IPlayerService/GetOwnedGames`) ; ✅ Famille Steam (voir ci-dessous) | ✅ `steam.exe -applaunch <id>` | ✅ `steam.exe steam://install/<id>` |
| Epic Games Store | ✅ manifestes `*.item` du lanceur | ❌ Epic ne publie pas d'API pour lire la bibliothèque (son cache local mélange contenus additionnels, logiciels et jeux non possédés : non utilisé). Un jeu vu installé puis désinstallé reste, avec « Installer » | ✅ `com.epicgames.launcher://apps/…?action=launch` | ✅ `…?action=install` |
| GOG Galaxy | ✅ base locale `galaxy-2.0.db` (lecture seule) | ✅ même base : bibliothèque du compte, sans contenus additionnels ni lots | ✅ `GalaxyClient.exe /command=runGame /gameId=<id> /path=<dossier>` | ✅ `goggalaxy://openGameView/gog_<id>` |
| Ubisoft Connect, EA app, Battle.net, Rockstar, itch.io | présence seulement | ⏳ à étudier | ⏳ | ⏳ |
| Xbox app / Game Pass | présence seulement | ⏳ à étudier (applications empaquetées, sans contourner les protections) | ⏳ | ⏳ |


Les liens `com.epicgames.launcher://` et `goggalaxy://` sont confiés à Windows via
`explorer.exe` (argument unique, préfixe et caractères vérifiés). Les identifiants Steam
et GOG doivent être numériques.

## Clé API Web Steam (facultative)

- Créée par l'utilisateur sur `steamcommunity.com/dev/apikey`, collée dans Paramètres › PC.
- Vérifiée auprès de Steam avant d'être enregistrée dans le **Gestionnaire d'identifiants
  Windows** (jamais dans la base, les réglages ou le code) ; jamais réaffichée.
- Compte utilisé : le dernier connecté à Steam sur ce PC (`config/loginusers.vdf`).
- Profil privé (« Détails des jeux ») : erreur claire, aucune liste inventée.
- Sans clé, ou en cas d'échec, les jeux installés sont lus normalement ; l'erreur est
  affichée sous le connecteur.

## Famille Steam

- Steam ne donne pas accès à la bibliothèque familiale avec une clé API Web (le service
  `IFamilyGroupsService` répond 401) ; il demanderait un jeton de session tiré des cookies, non utilisé.
- Méthode retenue, officielle : les membres sont lus dans le bloc `FamilyGroup` du
  `localconfig.vdf` de l'utilisateur, puis la bibliothèque **publique** de chacun par
  `GetOwnedGames` (jeux gratuits exclus : ils ne se partagent pas).
- Jeux absents de la bibliothèque de l'utilisateur : colonne `pc_installs.family`
  (migration `007_pc_family.sql`), badge et filtre « Famille Steam ». Un jeu installé ici
  mais possédé par un autre membre est aussi marqué « Famille Steam ».
- Installation par Steam (`steam://install/<id>`). Certains éditeurs excluent leurs jeux
  du partage : l'API ne le dit pas, Steam le signale à l'installation.
- Membre à la bibliothèque privée : ses jeux ne sont pas listés, un avertissement le dit.
- Option « Inclure la Famille Steam » (Paramètres › PC) : désactivée, les jeux de la famille
  non installés ne sont plus affichés (rien n'est supprimé).
- Vérifié avec une vraie clé : 5 membres lus, 221 jeux de la famille (dont 1 installé).

## Synchronisation

- Au démarrage, au retour dans iBox (fenêtre réactivée, au plus toutes les 20 s) et
  avec « Actualiser ». Chaque boutique est activée par défaut et peut être ignorée.
- Une boutique illisible (base GOG verrouillée…) ne marque aucun jeu « désinstallé ».
- Outils et logiciels (Wallpaper Engine…) : « Masquer » sur la fiche ; réaffichables
  dans Paramètres › PC.

## Garanties

- Aucun mot de passe de boutique n'est demandé ni stocké dans iBox.
- Aucune protection ni DRM n'est contournée ; chaque jeu est lancé par sa boutique.
- « Retirer » / « Masquer » n'enlèvent qu'une entrée de la bibliothèque : le jeu reste sur le disque.
- Les arguments de lancement sont une liste passée telle quelle au processus (jamais
  une ligne de commande interprétée par un shell).
- Les jeux ne sont pas fusionnés sur une simple ressemblance de titre : un même jeu
  possédé sur deux boutiques forme pour l'instant deux fiches.

## Vérifié

- 127 tests Rust (dont : Steam, API Web, Famille Steam, GOG, Epic, synchronisation, installation,
  identifiants refusés), 35 tests interface.
- Application Windows, PC de test : 4 jeux Steam, 2 Epic (Fortnite, Rocket League),
  1 GOG (Cyberpunk 2077, 180 h de jeu importées, extensions écartées) ; préparation du
  lancement par chaque boutique ; affichage « Installer » (simulé : aucun jeu possédé
  non installé sur ce PC sans clé Steam).

## Étapes suivantes

1. Regroupement des versions d'un même jeu par identifiants fiables, avec confirmation
   et dissociation manuelle.
2. Ubisoft, EA, Xbox, Battle.net… un par un, chacun vérifié sur une vraie installation.
3. Raccourcis `.lnk` / `.url` dans l'ajout manuel.

## Vérifications locales sous Windows

| Source | Détection locale | Lancement observé | Catalogue de compte |
| --- | --- | --- | --- |
| Steam | Manifestes et bibliothèques locales | Plan vérifié | API Web facultative, selon visibilité |
| Epic / GOG | Manifestes Epic et base locale Galaxy | Plans automatisés | Galaxy expose son catalogue local |
| Xbox | Jeux empaquetés avec manifeste accessible | Gaming Services ouvert pour Mouthwashing | — |
| Riot | League of Legends via raccourci | Riot Client démarré | — |
| Ubisoft | Raccourcis et dossiers déclarés | Ubisoft Connect ouvert | — |
| RSI | Star Citizen LIVE détecté | RSI Launcher ouvert | — |
| EA / Battle.net / Rockstar | Raccourcis et installations Windows vérifiables | En attente d’un titre installé détectable | — |

Le détail des scans se trouve dans **Paramètres → PC**. Les versions regroupées manuellement peuvent être dissociées depuis leur fiche.
