# iBox Asset Manager et iiDB — refonte visuelle

## Audit (phase 0)

| Élément | Où | État avant la refonte |
| --- | --- | --- |
| Pile technique | Tauri 2 (Rust), React 19 + TypeScript, Vite, Tailwind 4, Motion, Three.js / R3F, SQLite | inchangée |
| Thèmes | `src/theme/platformTheme.ts`, `src/domain/platforms.ts` | une palette par console (`primary`, `soft`, `deep`), variables CSS `--accent*` |
| Accueil | `src/screens/HomeScreen.tsx` | carte « Reprendre », rangée de consoles (`PlatformCard`), ajouts récents, favoris |
| Pages de consoles | `src/screens/LibraryScreen.tsx` | en-tête compact (pictogramme + nom), étagère 3D / grille, filtres |
| Fiches | `GameScreen.tsx` (boîtier 3D), `PcGameSheet.tsx` (PC, sans boîtier) | fond = bannière SteamGridDB ou jaquette floutée |
| Médias des jeux | `src-tauri/src/metadata` (libretro-thumbnails, SteamGridDB, imports), table `media` | cache local, priorités, choix manuels |
| Médias des consoles | — | **aucun** : pictogrammes vectoriels iBox (`PlatformGlyph`) uniquement |
| Navigation | `src/input` (manette, clavier), focus spatial | inchangée |

Plateformes : GameCube, Wii, DS, 3DS, N64, Game Boy, Game Boy Color, GBA, Super NES,
Switch, Switch 2, PC, PS1, PS2, PSP.

## Ce qui est fait (phases 1 à 3, consoles)

### Asset Manager (`src-tauri/src/assets`)

| Rôle | Fichier |
| --- | --- |
| Fournisseur iiDB : clé, requêtes, limites, erreurs | `assets/iidb.rs` |
| Résolution console ↔ plateforme iiDB, choix, téléchargement, cache, préférences | `assets/mod.rs` |
| Catalogue local | tables `platform_links` et `platform_assets` (migration `008_platform_art.sql`) |
| Interface (aucun appel réseau dans les composants) | `src/services/platformArt.ts` (`artApi`, `usePlatformArtStore`, `usePlatformArt`) |

- **Clé** : vérifiée par `GET /me/access`, rangée dans le Gestionnaire d'identifiants
  Windows (`iidb`), envoyée seulement dans l'en-tête `X-API-Key`, jamais réaffichée,
  jamais écrite dans un journal. La réponse `/me/access` peut contenir la clé : seuls le
  palier et l'usage sont lus.
- **Résolution** : `POST /resolve/platforms/batch` (25 lignes au plus), avec
  `artwork: "recommended"`, les quatre emplacements et 3 propositions par emplacement.
  Une console déjà associée est retrouvée par son identifiant iiDB (`platform_id`).
  `needs_choice` / `not_found` : association manuelle (`/search/platforms`).
  L'identifiant iiDB n'est jamais confondu avec l'identifiant iBox.
- **Requêtes** : une à la fois, espacées ; 429 → `Retry-After` (jusqu'à 30 s, deux
  reprises) ; 5xx → deux reprises ; 401 → « clé invalide », sans reprise.
- **Téléchargement** : URL publique de l'asset, **sans la clé**, https et adresse
  publique uniquement ; une image à la fois ; format réel vérifié (PNG, JPEG, WebP),
  25 Mo au plus, taille minimale par emplacement (une illustration panoramique de moins
  de 960 px n'est pas utilisée) ; si la recommandation échoue, la suivante est essayée.
- **Cache** : `<données>/media/platforms/<console>/<emplacement>.<ext>` ; identifiant et
  révision d'asset comparés pour éviter les téléchargements inutiles.
- **Priorités** : fichier importé (`user`) > image choisie dans une galerie (`manual`) >
  recommandation iiDB (`auto`) > habillage iBox. Une synchronisation ne remplace jamais
  un choix `user` ou `manual`. « Restaurer la recommandation » retire le choix.
- **Images animées** : écartées (interface calme).
- **Hors ligne** : seules les images en cache sont lues ; sans image, chaque composant
  garde son habillage iBox.

### Interface

- **Paramètres › Sources graphiques — iiDB** (`src/components/assets/IidbPanel.tsx`) :
  clé + « Connecter iiDB », statut (palier, usage du mois, limite), synchronisation avec
  progression, bilan, nombre d'associations et d'illustrations, taille du cache, liste des
  consoles avec leurs 4 emplacements, association manuelle.
- **Sélecteur** (`ArtworkPicker.tsx`) : galerie iiDB paginée (`GET /assets/platforms/{id}/gallery`,
  dédoublonnée), fichier local, restauration ; appliqué et visible aussitôt.
- **Cartes de consoles** (`PlatformCard.tsx`) : illustration panoramique sous un voile de la
  couleur de la console, icône iiDB dans la pastille, logo à la place du nom (nom conservé
  pour les lecteurs d'écran) ; au focus, la carte se soulève et l'image avance à peine.
- **En-tête des pages de consoles** (`ConsoleHeader.tsx`) : bandeau panoramique recadré
  sans déformation, voile latéral, icône, logo, compteurs, actions.

## Jeux (phase 4)

| Rôle | Où |
| --- | --- |
| Correspondance et illustrations | `src-tauri/src/assets/games.rs` |
| Catalogue | table `game_links` (jeu ↔ parent iiDB), colonne `media.pinned` (migration `009_game_art.sql`) |
| Interface | `GamesArtPanel.tsx` (Paramètres › Sources graphiques), sélecteur d'images (iiDB en premier) |

- **Correspondance** (gardée, une fois par jeu) : `POST /resolve/batch` par 25, avec l'identifiant
  le plus fiable connu accompagné du titre — CRC32, identifiant de titre Switch
  (`nintendo-switch.title-id`) ou Switch 2 —, sinon le titre seul ; un identifiant inconnu
  d'iiDB est retenté avec le titre seul. `needs_choice` reste en attente d'un choix
  (« Associer… ») ; `not_found` est retenté après 14 jours ; une ligne refusée n'est pas enregistrée.
- **Illustrations** : `POST /assets/batch` par 25 pour les jeux reconnus, avec
  `preferred_artwork_console` = console iiDB du jeu (évite la jaquette d'une autre console).
  Emplacements : jaquette (`boxart`), logo, fond (`hero` puis `banner`). Images animées
  écartées, tailles minimales vérifiées. Pas de captures d'écran : retirées à la demande
  (place disque) ; celles déjà reçues sont supprimées à la synchronisation suivante.
- **Aucune image existante n'est remplacée** : seuls les emplacements vides sont complétés.
  Les choix faits avant cette version n'étaient pas marqués comme manuels (enregistrés sous
  « steamgriddb ») : par prudence, rien n'est écrasé. Désormais, tout choix dans le sélecteur
  est « épinglé » (`pinned`).
- **Sélecteur d'images d'un jeu** : la galerie iiDB du jeu reconnu apparaît en premier (le jeu
  est reconnu à la demande s'il ne l'a jamais été).
- Crédit « Images : iiDB (iisu.network) » sur les fiches concernées.

## Accueil, fiches et options d'affichage (phase 5)

- **Carte « Reprendre »** (`HomeScreen.tsx`) : grande illustration du jeu (fond large) recadrée
  sans déformation, logo officiel à la place du titre, voile choisi d'après la tonalité du logo
  (clair → voile « nuit » aux couleurs de la console, texte blanc) ; sans illustration, l'ancienne
  ambiance (jaquette floutée).
- **Fiches des jeux de console** (`GameScreen.tsx`, `GameTitle`) : logo officiel au-dessus du nom
  (marges vides ignorées, ombre adaptée à sa tonalité) ; fiche PC : même traitement du logo.
- **Paramètres › Apparence** : « Taille des jaquettes » (compacte ×0,8 · standard · confortable
  ×1,25) appliquée aux grilles de toutes les bibliothèques, et « Fond animé » (désactivé : fond
  immobile, sans parallaxe ni mouvement lent).

## Pages de consoles (phase 6)

- **Présentation** : une phrase originale par console sous le nom (`src/domain/platformBlurbs.ts`).
- **Zone secondaire** (`ConsoleHighlights.tsx`) : récemment joués, favoris, ajoutés récemment, en
  petites jaquettes cliquables ; affichée pour une bibliothèque d'au moins 8 jeux, hors recherche,
  seulement les groupes qui ont du contenu.
- **Cadres de console iiDB** (`platform_border`) : option « Cadres de console » (Paramètres ›
  Apparence), **désactivée par défaut** ; posés sur les jaquettes des grilles par découpe en 9
  parties (`border-image`), le coin portant l'emblème garde ses proportions.

## Performances, écrans, manette (phase 7)

Mesures sur la version publiée (écran 240 Hz, bibliothèque PC de 372 jeux), images par seconde
mesurées dans la page :

| Situation | Avant | Après |
| --- | --- | --- |
| Ouverture de la bibliothèque PC | 20 i/s, 30 images > 50 ms, pire 612 ms | 152 i/s, 0 image > 50 ms, pire 38 ms |
| Défilement de la grille | 228 i/s, 2 images > 50 ms | 151 i/s, 0 image > 50 ms |
| Repos | 232 i/s | 240 i/s |

- Jaquettes chargées **à l'approche de l'écran** (`IntersectionObserver`, marge 700 px) et
  décodées hors du fil principal (`decoding="async"`).
- Grille **progressive** : 36 cartes tout de suite, puis 48 par image (`useProgressive`).
- **Écrans** vérifiés en 1366×768 et 1920×1080 à 150 % (1280×720 effectifs) : la zone secondaire
  des consoles est masquée sous 900 px de haut, le logo des fiches réduit sous 860 px — le bouton
  « Jouer » reste visible.
- **Navigation au clavier / à la manette** (même navigation spatiale) suivie touche par touche :
  recherche → filtres → zone secondaire → grille, sans élément inaccessible.
- **Hors connexion** (réseau de la fenêtre coupé, rechargement) : 60 images affichées, aucune cassée.

## Personnalisation et accueil vivant

- Douze palettes (Paramètres › Thèmes et fonds), avec aperçu miniature.
- Fond d'écran : jeu sélectionné, image choisie (illustrations iiDB des consoles,
  illustrations SteamGridDB/iiDB des jeux avec recherche, ou **image du PC**),
  ou halos seuls. L'image du PC est **copiée** dans `wallpaper/` du dossier de
  données (PNG, JPEG ou WebP reconnus d'après leur contenu, 40 Mo au plus) ;
  l'original n'est jamais déplacé ni modifié. « Retirer mon image » supprime la copie.
- Icônes des consoles : galerie iiDB ou image locale, choix prioritaire.
- Accueil : illustration en dérive lente et reflet sur « Reprendre », compteur
  de la collection et jaquettes renouvelées, consoles sans jeu en retrait.
- Retour fiche → étagère : le boîtier quitte la visionneuse et revient en vol
  jusqu'à sa place (même couche de vol qu'à l'aller, en sens inverse).
- Temps de jeu : le compteur d'un jeu de la Famille Steam (celui du membre qui
  le possède) n'est plus compté comme le vôtre.

## Sécurité des données

- Une copie de la base est faite au lancement (`backups/library-<horodatage>.db`, base saine
  seulement, au plus toutes les 6 h, 7 gardées) — ajoutée après la corruption du 13/11/2026.

## Droits et crédits

- Données de catalogue iiDB : CC BY-SA 4.0. Illustrations : propriété de leurs auteurs et
  ayants droit, **non couvertes** par cette licence. Elles sont téléchargées par chaque
  utilisateur avec sa propre clé, jamais ajoutées au dépôt.
- Crédit affiché dans les paramètres et le sélecteur ; provenance (fournisseur, asset,
  révision, URL) conservée dans `platform_assets`.

## Vérifié

- 133 tests Rust (dont : lecture de `/me/access` sans relire la clé, résolution, galerie
  et pagination, priorités, refus des images trop petites ou douteuses, choix manuels
  conservés), 35 tests interface, typage.
- Application : appel réel de `/me/access` avec une clé invalide → « Clé iiDB invalide »,
  rien n'est enregistré ; panneau, cartes et en-têtes sans illustration (habillage iBox).
- Avec une vraie clé : les 15 consoles reconnues (dont PC → « PC »), 59 illustrations
  téléchargées (pas d'illustration panoramique pour PC), galerie réelle (7 logos GameCube).
- Ajustements faits après examen des vraies images :
  - les icônes iiDB sont des tuiles illustrées complètes : affichées entières, pas dans une pastille ;
  - beaucoup de logos sont blancs : la tonalité du logo est mesurée (`src/art/imageTone.ts`)
    et choisit un voile sombre (couleur profonde de la console) ou clair ; un logo clair
    n'est jamais posé sur le fond crème ;
  - certains logos sont livrés dans un grand carré vide (Switch 2 : 3840×3840) : leurs
    marges sont ignorées avec `object-view-box`, sans retoucher l'image ;
  - vignettes de logos sur fond gris neutre dans les paramètres et le sélecteur.

- Jeux, sur la vraie bibliothèque (376 jeux) : 290 reconnus, 67 à associer, 19 introuvables ;
  correspondances par le titre contrôlées (138 tests Rust) ; images iiDB dans le sélecteur.

## Étapes suivantes

1. Fiches des jeux de console, densités de grille, options d'affichage.
2. Option pour remplacer les images automatiques existantes par celles d'iiDB (les choix
   épinglés restant intouchables).
