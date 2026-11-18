# Sources de métadonnées et de jaquettes (phase 3)

Vérification faite le 12/11/2026 avant toute intégration (API, authentification, limites,
licences). Règle : aucun scraping non autorisé, aucune clé dans le code.

| Source | Apporte | Accès | Statut |
| --- | --- | --- | --- |
| **libretro-thumbnails** | jaquette avant, écran-titre, captures, logo (PNG) | `https://thumbnails.libretro.com/<Système>/Named_<Type>/<Nom>.png`, index des dossiers public, sans clé | ✅ intégré |
| **SteamGridDB** | jaquettes (« grids »), logos | API v2 `https://www.steamgriddb.com/api/v2`, en-tête `Authorization: Bearer <clé>` (401 sans clé). Clé personnelle à créer sur steamgriddb.com | ✅ intégré, clé dans le Gestionnaire d'identifiants Windows |
| **GameTDB — bases de titres** | titre localisé, synopsis, éditeur, développeur, année, genre, joueurs (GameCube, Wii, DS, 3DS) | `https://www.gametdb.com/{wiitdb,dstdb,3dstdb}.zip` (XML). L'en-tête du fichier : « *meant as a collaborative database … for anyone to use* » | ✅ intégré, crédit affiché |
| **libretro-database** (`metadat/`) | éditeur, développeur, genre, année, joueurs (N64, GB, GBC, GBA, SNES, DS, 3DS, PSP…) | fichiers DAT sur GitHub, licence **CC BY-SA 4.0** | ✅ intégré, crédit affiché |
| GameTDB — visuels | scans complets, dos, tranche, disque | site en 403, liens d'images en 404 : vérification humaine en place | ❌ non intégré (contournement exclu) |
| ScreenScraper | manuels (PDF) des jeux de consoles | API v2 `api.screenscraper.fr/api2` : identifiants **développeur** d'iBox fournis à la compilation (`IBOX_SS_DEVID` / `IBOX_SS_DEVPASSWORD`, brouillés par `build.rs`, jamais dans les sources) + compte utilisateur facultatif (coffre Windows), quotas par compte, un fil | ✅ intégré pour les manuels (0.1.86) |
| Steam (manuels) | manuel officiel des jeux PC | `store.steampowered.com/manual/<appid>/` redirige vers le PDF publié par l'éditeur, sans clé | ✅ intégré (0.1.86) |
| Internet Archive | scans de manuels (collection « consolemanuals » et sous-collections par console) | `archive.org/advancedsearch.php` puis `archive.org/metadata/<id>`, sans clé | ✅ intégré (0.1.86), correspondance par titre notée : appliquée seule à partir de 0,9 |

## Manuels (0.1.86)

Un PDF par jeu dans `manuals/` (données d'iBox), table `game_manuals` (migration 016). Ordre :
import local, Steam, ScreenScraper (fichier du jeu : nom, taille, CRC, série ; sinon titre quasi
identique), Internet Archive. Recherche automatique à l'ouverture d'une fiche (réessai après
14 jours sans résultat, jamais après un retrait par l'utilisateur). Les manuels ne sont jamais
redistribués. Lecteur : pdf.js (ressources servies sous `/pdfjs/` par `vite.config.ts`), doubles
pages scannées coupées en deux. Essai réel : `cargo test --lib manuals::live -- --ignored --nocapture`.

## Conséquences pour l'interface

- La face avant du boîtier est la vraie jaquette dès qu'elle est trouvée.
- Le dos, la tranche et le disque restent des **habillages générés** (jamais de faux scans),
  désormais construits à partir de la vraie jaquette : couleurs, captures d'écran réelles,
  synopsis réel.
- Chaque image importée par l'utilisateur (avant, dos, tranche, scan complet, disque) remplace
  l'habillage correspondant.

## Correspondances

- **Identifiant interne** (GameTDB) : correspondance exacte, appliquée automatiquement.
- **Nom No-Intro / Redump identique** (libretro) : appliquée automatiquement.
- **Même titre, autre région** : la région préférée l'emporte, appliquée automatiquement.
- **Titre approchant** : proposé, jamais appliqué sans validation (« Jaquette à choisir »).
- **SteamGridDB** (recherche par nom) : toujours proposé au choix, sauf titre identique unique.

## Crédits affichés

- Jaquettes et captures : libretro-thumbnails — illustrations © leurs éditeurs respectifs.
- Informations : GameTDB (gametdb.com) ; libretro-database (CC BY-SA 4.0).
- SteamGridDB : images de la communauté steamgriddb.com.

## Sources consultées

- https://docs.libretro.com/guides/roms-playlists-thumbnails/
- https://github.com/libretro-thumbnails/libretro-thumbnails
- https://github.com/libretro/libretro-database (licence CC-BY-SA-4.0 via l'API GitHub)
- https://docs.rs/crate/steamgriddb_api/0.3.1/source/src/client.rs (authentification Bearer)
- https://www.gametdb.com (en-tête des fichiers `wiitdb.xml`, `dstdb.xml`, `3dstdb.xml`)
- https://itch.io/devlog/1012998/nostlan-v31-new-image-databases (vérification humaine GameTDB)
