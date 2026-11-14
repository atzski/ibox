# iBox — Architecture et design system

> Nom provisoire. Phase actuelle : **1 — prototype visuel**.

## 1. Architecture technique

```
┌──────────────────────────── Fenêtre Tauri 2 (WebView2) ────────────────────────────┐
│  Interface React 19 + TypeScript + Vite                                            │
│  ┌──────────── screens/ ────────────┐   ┌──────── three/ (R3F + Drei) ─────────┐   │
│  │ Accueil · Consoles · Bibliothèque│──▶│ KeepCase paramétrique · Étagère ·     │   │
│  │ Fiche jeu · Paramètres           │   │ Visionneuse · InspectController       │   │
│  └───────────────┬──────────────────┘   └──────────────────────────────────────┘   │
│        components/ (UI réutilisable) · theme/ · art/ (habillages procéduraux)        │
│  ┌──────────────── services/ (logique métier) ────────────────┐  input/            │
│  │ library (LibrarySource) · settings · sound · native (pont)  │  clavier → actions │
│  └─────────────────────────────┬──────────────────────────────┘  (manette phase 5)  │
│                     domain/ (types, registre des consoles, texte) — sans React       │
└────────────────────────────────┼───────────────────────────────────────────────────┘
                                 │ invoke()
┌────────────────────────────────▼───────────────── src-tauri/ (Rust) ──────────────┐
│ Phase 1 : fenêtre + `app_info`                                                     │
│ Phase 2 : scan (walkdir + en-têtes), SQLite (rusqlite + migrations)                │
│ Phase 3 : fournisseurs de métadonnées (reqwest), cache média, coffre Windows       │
│ Phase 4 : profils de lancement (std::process::Command, arguments séparés, jamais   │
│           de shell)                                                                │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Choix et écarts justifiés

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| Routage | Pile d'écrans (zustand) au lieu d'un routeur URL | Pas d'URL en desktop ; « Retour » manette trivial ; transitions orientées. |
| État | zustand | Léger, lisible hors React (sons, contrôleur d'entrées). |
| Modèles 3D | **Géométrie paramétrique** (`KeepCase` + `KeepCaseSpec`) plutôt que GLB en phase 1 | Un seul composant couvre GameCube/Wii/PS2 en changeant dimensions et matières ; textures dynamiques ; zéro asset binaire à maintenir. Un chargeur GLB pourra s'ajouter pour les formes complexes (Switch, cartouches). |
| Éclairage 3D | Lightformers Drei, pas de HDR | Pas de téléchargement : fonctionne hors ligne. |
| Tone mapping | `flat` (aucun) | ACES désaturait les pastels des jaquettes. |
| Jaquettes de démo | Peintes en Canvas 2D (`art/`) | Originales, sans droits, et servent ensuite de **remplacement élégant** quand un visuel manque (jamais de faux scan). |
| Polices | Fredoka + Nunito via Fontsource | Rondes, lisibles, embarquées (hors ligne). |
| Sons | Synthèse Web Audio originale | Aucun son officiel ; chaque cue est remplaçable par un fichier (`sound.registerSoundFile`). |
| Musique | `services/music.ts` (HTMLAudio en boucle, fondus) | Piste importée dans les réglages ; une console peut déclarer sa propre piste (`Platform.ambience`), avec fondu enchaîné. Démarre au premier clic si la lecture automatique est bloquée ; pause quand la fenêtre est réduite. |
| Mode sombre | Tokens `light-dark()` + `color-scheme` | Chaque couleur est déclarée une fois pour les deux thèmes ; les composants n'ont pas de logique de thème. `bg-white` = surface des cartes. Réglage Système / Clair / Sombre, barre de titre Windows synchronisée. |
| Formats de fichiers | `shared/platform-formats.json` | Table unique lue par TypeScript et par le scanner Rust. |
| Persistance des réglages | localStorage (phase 1) | Migrera vers SQLite en phase 2 via la même API de store. Les clés API iront dans le Gestionnaire d'identifiants Windows. |

## 2. Arborescence

```
ibox/
├─ index.html · vite.config.ts · tsconfig.json · package.json
├─ public/logo.svg                    logo provisoire (nid + 3 œufs)
├─ docs/ARCHITECTURE.md
├─ shared/platform-formats.json      formats reconnus (TS + Rust)
├─ src-tauri/                         cœur natif Rust (Tauri 2)
│  ├─ src/lib.rs · src/main.rs
│  ├─ src/db/                         SQLite, migrations (phase 2)
│  ├─ src/scanner/                    parcours, en-têtes, identification, rapprochement (phase 2)
│  ├─ src/library/                    dossiers, jeux, actualisation, commandes (phase 2)
│  ├─ src/metadata/                   sources, cache d'images, correspondances, clés (phase 3)
│  ├─ src/launcher/                   profils, émulateurs, lancement, sessions (phase 4)
│  ├─ tauri.conf.json · capabilities/ · icons/
└─ src/
   ├─ main.tsx
   ├─ app/          App (shell + transitions), navigation (pile), shellState (indications, ambiance)
   ├─ domain/       types, platforms (registre extensible), demoLibrary, text (+ tests)
   ├─ services/     library (LibrarySource), settings, sound, music, native (pont Tauri)
   ├─ input/        spatial (algorithme pur + tests), InputController (actions abstraites)
   ├─ art/          paint, motifs, assets (images réelles + palette), covers (faces), usePalette
   ├─ theme/        platformTheme (variables CSS + ressorts par console)
   ├─ styles/       tokens.css (design tokens), global.css (Tailwind 4 + focus, animations)
   ├─ components/
   │  ├─ ui/        Button, Segmented, Icon, ShelfRow, EmptyState
   │  ├─ shell/     TopBar, HintBar, Backdrop, BrandLogo
   │  ├─ game/      CoverImage, GameCard
   │  └─ platform/  PlatformCard, PlatformGlyph
   ├─ three/
   │  ├─ cases/     caseSpecs, KeepCase (boîtier réutilisable)
   │  ├─ scenes/    InspectViewer, ShelfView, StudioLights
   │  ├─ inspectController.ts · springs.ts · useCaseTextures.ts (+ tests)
   └─ screens/      HomeScreen, PlatformsScreen, LibraryScreen, GameScreen, SettingsScreen
```

## 3. Composants visuels principaux

- **TopBar** : logo, salutation selon l'heure, horloge, profil local, accueil, paramètres ; fil d'Ariane hors accueil.
- **HintBar** : indications de commandes par écran (clavier aujourd'hui, boutons manette en phase 5).
- **Backdrop** : fond crème + halos pastel qui dérivent et prennent la teinte de la console / du jeu.
- **HeroCard** : dernier jeu, jaquette inclinée flottante, ambiance floutée, actions.
- **PlatformCard** : grande carte pastel, pictogramme original, couleur propre (y compris l'anneau de focus).
- **GameCard / CoverImage** : jaquette dominante, chargement scintillant, reflet de pochette.
- **Segmented / Button / Toggle** : pilules focalisables, sons de retour.
- **KeepCase** : boîtier 3D paramétrique (plateau, parois, tranche, charnière animée, moyeu, disque troué irisé, manuel).
- **InspectViewer** : rotation avec inertie, tangage limité, zoom borné, vues Face/Dos/Tranche, ouverture, examen du disque.
- **ShelfView** : étagère, tranches alignées, sélection sortie de l'étagère et présentée de face.

## 4. Tokens graphiques (`src/styles/tokens.css`)

| Famille | Valeurs |
| --- | --- |
| Fonds | crème `#F8F7F3`, crème profond `#F1EFE8`, blanc |
| Pastels | ciel `#8CCDF1` / `#DDF1FC`, lavande `#B9A6E8` / `#EEE9FB`, menthe `#A9DFC8` / `#E6F6EF`, pêche `#F5C4AC` / `#FDEEE6` |
| Teintes profondes (texte sur pastel) | ciel `#2F7FB0`, lavande `#6A54B4`, menthe `#2F7D5E`, pêche `#B25D3A` |
| Texte | principal `#344459` (9,4:1), secondaire **`#637184`** (4,6:1, ajusté pour l'AA ; `#8794A3` réservé au décoratif) — nuit : `#E8ECF5`, `#A7B0C3` |
| Accent | `--accent-deep` = fond saturé (boutons) ; `--accent-text` = texte d'accent lisible dans les deux thèmes |
| Accent dynamique | `--accent`, `--accent-soft`, `--accent-deep`, `--accent-glow` (fixés par la console active) |
| Espacements | base 4 px : 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 (en rem) |
| Rayons | 12 · 20 · 28 · 36 px, pilule |
| Ombres | xs → lg, diffuses et teintées d'encre |
| Typo | Fredoka (titres), Nunito (texte) ; taille racine fluide `clamp(14px, 0.62vw + 7px, 24px)` pour PC et TV |
| Mouvement | `--ease-out-soft`, `--ease-bounce` ; 160 / 260 / 480 ms ; ressorts par personnalité de console (bouncy, airy, snappy, calm, floaty) |

Accessibilité : réglage *Animations* (Système / Complètes / Réduites) → `MotionConfig` + CSS + scène 3D sans animation.

## 5. Phase 1 — plan et état

| Étape | État |
| --- | --- |
| Socle Tauri 2 + React + Vite + Tailwind 4 | ✅ |
| Tokens, thème par console, registre de 13 consoles | ✅ |
| Accueil (héros, consoles, récents, favoris, collection) | ✅ |
| Écran Consoles | ✅ |
| Bibliothèque GameCube : grille, recherche, tri, favoris, filtre console | ✅ |
| Étagère 3D | ✅ |
| Fiche jeu + boîtier GameCube manipulable, ouverture/fermeture, disque | ✅ |
| Navigation souris / clavier (spatiale, mémoire du focus, Retour) | ✅ |
| Sons d'interface originaux | ✅ |
| Paramètres persistants (+ sections futures signalées) | ✅ |
| Tests (navigation spatiale, texte, registre, contrôleur 3D, ressorts) | ✅ 23 tests |

Ajouts après validation : musique de menu en boucle, mode sombre, préparation de la phase 2 (voir [PHASE2.md](PHASE2.md)).

Fonctions volontairement **indisponibles et signalées** : Jouer / Reprendre (phase 4), dossiers (phase 2), métadonnées et clés API (phase 3), manette (phase 5).
