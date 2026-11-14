# Phase 5 — Boîtiers par console, manette, performances (en cours)

## Ce qui fonctionne

| Brique | Fichier | État |
| --- | --- | --- |
| Boîtiers 3D par console : GameCube, Wii, PS2 (DVD), PS1 (boîtier cristal), PSP (UMD), DS/3DS et Switch (carte de jeu) | `src/three/cases/caseSpecs.ts`, `KeepCase.tsx` | ✅ |
| Boîtes en carton à plateau coulissant avec cartouche : N64, Super NES, Game Boy / Color / Advance | `src/three/cases/RetroBox.tsx` | ✅ |
| Jaquettes, tranches, dos et étiquettes générés aux proportions de chaque boîtier | `src/art/covers.ts`, `useCaseTextures.ts` | ✅ |
| Étagère 3D avec boîtiers de tailles mélangées | `src/three/scenes/ShelfView.tsx` | ✅ |
| Navigation à la manette (croix, stick gauche, validation, retour, L/R) avec répétition | `src/input/gamepad.ts` | ✅ |
| Stick droit : tourner le boîtier ; gâchettes : zoom | `InspectViewer.tsx` | ✅ |
| Validation à droite (Nintendo) ou en bas (Xbox/PlayStation), automatique ou imposée | Paramètres › Manette | ✅ |
| Barre d'aide aux boutons de la manette utilisée (A/B, ✕/○, L1/R1…) | `HintBar.tsx` | ✅ |
| Three.js chargé à part (préchargé au repos) : démarrage allégé | `src/three/lazy.tsx` | ✅ |
| Annulation de l'actualisation / de la récupération accessible au clavier et à la manette | `FoldersPanel.tsx`, `MetadataPanel.tsx` | ✅ |
| Bouton OFF (barre du haut) : confirmation, fondu, fermeture propre | `PowerButton.tsx`, commande `app_quit` | ✅ |
| Sons « physiques » originaux synthétisés : charnière, plateau en carton, cartouche/disque/carte, changement de vue, sortie de l'étagère | `src/services/sound.ts` | ✅ |
| Le boîtier sort de l'étagère puis se pose dans la fiche du jeu | `ShelfView.tsx`, `InspectViewer.tsx`, `three/handoff.ts` | ✅ |

### Manette

- Les boutons sont lus par **position** (disposition « standard » de l'API Gamepad) :
  « valider » est le bouton du bas sur Xbox/PlayStation, celui de droite sur Nintendo.
- La manette est ignorée quand iBox n'a pas le focus (par exemple pendant une partie
  dans l'émulateur) : aucune navigation fantôme en arrière-plan.
- La barre d'aide repasse aux touches du clavier dès que la souris bouge.

## Vérification

- 34 tests interface (dont manette : familles, validation inversée, répétition, zone
  morte ; navigation spatiale avec carte agrandie), 88 tests Rust.
- Application Windows pilotée avec une manette simulée (Pro Controller) : navigation
  dans l'accueil, ouverture d'un jeu avec A, retour avec B, rotation au stick droit,
  zoom à la gâchette.
- Une vraie manette Xbox (045e:0b13) est reconnue (famille Xbox, boutons A/B/LB/RB
  dans la barre d'aide).
- Bouton OFF : la confirmation s'ouvre sur « Annuler », Échap annule, « Éteindre »
  ferme bien le processus.
- Rendu contrôlé pour chaque console, boîtier fermé et ouvert, et étagère mixte.
- Bundle : interface 510 Ko, Three.js et scènes 3D dans un module séparé (990 Ko).

## Corrigé au passage

- Un « bas » depuis une carte focalisée (agrandie) pouvait sauter sur la carte voisine
  de la même rangée : la tolérance de direction suit désormais la taille des éléments.

### Sons et animations

- Aucun fichier audio : chaque son est fabriqué à la volée (bruit filtré + notes),
  donc rien n'est copié d'une console existante. Ils suivent le réglage « Sons ».
- Avec « Animations réduites », la sortie de l'étagère et l'entrée du boîtier sont
  supprimées : la fiche s'ouvre immédiatement.

## Lancer iBox sans terminal

```bash
npm run tauri build -- --no-bundle   # produit src-tauri/target/release/ibox.exe
```

L'exécutable est autonome (interface intégrée, WebView2 fourni par Windows 11).
Une copie est placée dans `app/iBox.exe` (ignorée par Git) avec un raccourci « iBox »
sur le Bureau. Après une modification du code, il faut le reconstruire.

## Correctif : dossiers « fourre-tout » (Téléchargements)

Constat : ajouter Téléchargements rangeait des milliers de fichiers dans la PS1.
Ces fichiers venaient de données de jeux extraites, d'outils et de projets. En cause :
l'extension `.bin`, commune à la PS1 et à la PS2, était acceptée sans examen, et
en cas de doute la première console proposée était la PS1.

- Les extensions banales doivent maintenant porter la signature de leur format
  (`scanner::plausible`). Un `.bin`/`.img` doit être une image de CD (secteur brut
  synchronisé ou ISO 9660). Un `.iso` de données ordinaire est écarté. Les `.chd`,
  `.cso`, `.pbp`, `.gcz`, `.rvz`, `.wia`, `.wbfs`, `.wad` (Wii, pas Doom), `.nsp`,
  `.xci` et `.nup` sont tous vérifiés par leur signature.
- Dossiers ignorés en plus : `romfs`, `exefs` (contenu d'un jeu extrait),
  `__pycache__`, `site-packages`.
- Essai à blanc sur un dossier réel, sans écrire dans la base :
  `IBOX_DRY_SCAN="D:/…" cargo test --test dry_scan -- --ignored --nocapture`.
  Sur le dossier Téléchargements testé : 8 candidats, 1 seul retenu, le bon.

## Switch 2 et conteneur NUP

- Nouvelle console « Nintendo Switch 2 » (extension `.nup`, dossiers « Switch 2 »,
  « NSW2 »…), boîtier Switch avec carte rouge.
- NUP ([spécification 1.0-draft](https://github.com/a55uka/nup/blob/meow/SPEC.md)) :
  signature `NUP\x01`, identifiant du titre du premier paquet et nom du jeu
  (enregistrement 0x0005). Le préfixe de l'identifiant départage : `01` = Switch,
  `04` = Switch 2 ; un préfixe inconnu n'est pas deviné.
- Profil Lichii (voir EMULATORS.md), détecté automatiquement d'après `lichii.exe`.
- Les jeux extraits en dossiers sont importés par leur `exefs/main` (à côté de
  `main.npdm`, identifiant du titre lu dans la section ACI0) ; les dossiers
  `updates/` et `dlc/` ne deviennent pas des jeux à part.

## Formats de fichiers vérifiés, console par console

Règle : une extension n'est acceptée que si l'émulateur prévu pour la console
l'ouvre réellement. Les listes viennent du code source de chaque émulateur ou
des fichiers .info officiels des cœurs libretro. Les extensions banales doivent
en plus porter la signature de leur format (voir `scanner::plausible`).

| Console | Extensions | Émulateur (source) | Contrôle du contenu |
| --- | --- | --- | --- |
| GameCube | .iso .gcm .tgc .ciso .gcz .rvz .wia .bin | Dolphin (`UICommon/GameFileCache.cpp`) | en-tête GC, signatures CISO/GCZ/RVZ/WIA/TGC |
| Wii | .iso .wbfs .rvz .wia .gcz .ciso .wad .bin | Dolphin | en-tête Wii, WBFS, WAD (pas Doom) |
| DS | .nds .srl .dsi .ids .zip .7z .rar | melonDS (`qt_sdl/Window.cpp`, archives via libarchive) | en-tête DS ; .zip = un seul jeu dedans |
| 3DS | .3ds .cci .cxi .3dsx .app .z3dsx .zcci .zcxi .bcci | Azahar (`citra_qt/game_list.cpp`) | NCSD, NCCH, 3DSX |
| N64 | .z64 .n64 .v64 .ndd .u1 .bin .zip .7z | RetroArch + mupen64plus-next (.info) | en-tête N64 pour .bin |
| Game Boy | .gb .sgb .dmg .rom .bin .zip .7z | mGBA (`qt/utils.cpp`), gambatte (.info) | en-tête GB obligatoire pour .dmg/.rom/.bin |
| Game Boy Color | .gbc .rom .bin .zip .7z | mGBA, gambatte | en-tête GB |
| Game Boy Advance | .gba .agb .mb .rom .bin .zip .7z | mGBA | en-tête GBA pour .rom/.bin |
| Super Nintendo | .sfc .smc .swc .fig .bs .st .zip .7z | RetroArch + snes9x (.info) | — |
| Switch | .nsp .nsz .xci .xcz .nup .nro + jeux extraits | Lichii (`qt_common/qt_common.cpp`) | PFS0, HEAD, NUP, NRO0 ; `exefs/main` + `main.npdm` |
| Switch 2 | .nup .nsp .nsz .xci .xcz + jeux extraits | Lichii | identifiant du titre (04…) ou dossier « NSW2 » |
| PS1 | .cue .bin .img .iso .chd .ecm .mds .ccd .pbp .m3u | DuckStation (`duckstation-qt/mainwindow.cpp`) | CD brut ou ISO 9660 ; CHD, ECM, PBP |
| PS2 | .iso .bin .cue .mdf .chd .cso .zso .gz | PCSX2 (`pcsx2-qt/MainWindow.cpp`) | ISO 9660, CSO/ZSO, « .iso.gz » |
| PSP | .iso .cso .chd .pbp | PPSSPP (`Core/Loaders.cpp`) | en-tête « PSP GAME », PBP |

Volontairement écartés :
- **Exécutables et fichiers techniques** (.exe, .elf, .dol, .prx, .psf, .irx,
  .json…) : ce ne sont pas des jeux, et ces extensions sont partout sur un PC.
- **.cia (3DS)** : Azahar l'installe (`-i`) mais ne le lance pas.
- **.tar (Switch 2)** : Lichii ne l'ouvre pas (absent de sa liste d'extensions
  et de son chargeur). Les .tar produits par OunceCake (`exefs.tar`, `romfs.tar`)
  sont à décompresser ; le dossier obtenu est alors reconnu comme jeu extrait.
- **.7z et .rar** : leur contenu ne se lit pas sans décompression. Ils ne sont
  acceptés que dans un dossier associé à une console (ou nommé d'après elle).
- **ISO de PSP dans un .zip** : PPSSPP l'accepte, mais rien ne distingue alors
  un ISO PSP d'un ISO GameCube ou PS2 sans décompresser.

## Plein écran, jaquettes et fonds des nouveaux jeux

- iBox démarre en plein écran (réglage « Plein écran » dans Apparence, F11 pour
  basculer). Vérifié sur un écran 4K (3840 × 2160, échelle 150 %).
- Visionneuse : textures 1,6 fois plus fines et filtrage anisotrope ×16 ;
  l'étagère garde des textures légères (des dizaines de boîtiers).
- SteamGridDB récupère désormais, pour le même jeu, la **jaquette**, le **fond**
  (« hero », affiché derrière la fiche) et le **logo**. Le fond et le logo
  suivent aussi une jaquette choisie à la main dans « Jaquettes ».
- Nouveau type d'image « Fond » (migration `004_hero.sql`).
- Sans clé SteamGridDB, une fiche sans jaquette l'explique et mène au réglage.
  Dès qu'une clé est enregistrée, les jeux sans jaquette sont relancés.
- Couverture vérifiée : libretro et libretro-database ne couvrent pas la Switch
  ni la Switch 2 ; la base Switch de GameTDB (`switchtdb.zip`) ne référence ni
  les identifiants de titre ni les jeux Switch 2. SteamGridDB est donc la source
  de ces consoles.

## Ambiance : fonds de jeu, animations, jaquettes détaillées

Inspiration : les menus des consoles portables (DS, 3DS, PSP) et les frontends
récents comme iiSU, pour l'esprit (fonds vivants, accueil animé), sans reprise
de leurs visuels.

- **Fond selon le jeu** : la jaquette sélectionnée (accueil, bibliothèque,
  étagère) colore et remplit l'arrière-plan avec son fond (ou sa jaquette très
  floutée), en fondu, avec un lent mouvement de caméra et une légère parallaxe
  à la souris. La fiche du jeu affiche ce fond net (`components/shell/Backdrop.tsx`).
- **Mode vitrine** : après 45 s sans action sur l'accueil, le fond fait défiler
  les jeux de la collection ; la moindre action l'arrête (`app/attract.ts`).
- **Animations** : transitions d'écran plus douces (sortie brève, entrée avec
  mise au point), reflet qui balaie la jaquette sélectionnée, inclinaison 3D au
  survol. Tout est coupé avec « Animations réduites ».
- **Jaquettes** : bandeau de console en haut (couleurs et nom de la console,
  aucun logo officiel), grain d'impression léger ; au dos, logo du jeu,
  grande illustration et code-barres décoratif propre à chaque jeu.

## Reste à faire dans cette phase

- Thèmes supplémentaires.
- Boîtiers : les formes de cartouches sont simplifiées (pas de détail propre à chaque
  console au-delà des dimensions, couleurs et étiquettes).
