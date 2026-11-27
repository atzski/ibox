# iBox sur consoles portables PC

Steam Deck (SteamOS, Mode Jeu sous gamescope, AppImage) et portables Windows (ROG Ally / Ally X,
ROG Xbox Ally, Lenovo Legion Go / Go S / Go 2, MSI Claw). Audit du parcours complet d'un joueur,
détection des appareils, paliers de performance, mesures avant / après, et fiche de test pour les
bêta-testeurs. Aucun appareil n'était disponible : définitions, densités et puissance sont
simulées (voir « Mesures »). Ce qui n'a pu être vérifié que sur le vrai matériel est dit à chaque
fois.

Voir aussi `docs/STEAMDECK.md` (portage Linux, Mode Jeu, Remote Play), `docs/STEAMDECK-TESTS.md`
(essais détaillés sur Deck) et `docs/STEAMDECK-INSTALL.md` (installation).

## 1. Appareils visés

| Appareil | Écran | Mise à l'échelle Windows usuelle | Points CSS | APU | Palier d'office |
| --- | --- | --- | --- | --- | --- |
| Steam Deck LCD / OLED | 1280×800, 7 / 7,4 po | (SteamOS) | 1280×800 | Van Gogh, 4 cœurs Zen 2, ~1,6 TFLOPS | allégé |
| ROG Ally (Z1) | 1920×1080, 7 po, 120 Hz | 150 % | 1280×720 | Z1, ~2,8 TFLOPS | allégé |
| ROG Ally (Z1 Extreme), Ally X | 1920×1080, 7 po, 120 Hz | 150 % | 1280×720 | Z1 Extreme, ~8,6 TFLOPS | console |
| ROG Xbox Ally / Xbox Ally X | 1920×1080, 7 po, 120 Hz | 150 % | 1280×720 | Z2 A / Z2 Extreme | allégé / console |
| Legion Go | 2560×1600, 8,8 po, 144 Hz | 200 % | 1280×800 | Z1 Extreme | console |
| Legion Go S | 1920×1200, 8 po, 120 Hz | 150 % | 1280×800 | Z2 Go / Z1 Extreme | allégé / console |
| Legion Go 2 | 1920×1200, 8,8 po, 144 Hz | 150 % | 1280×800 | Z2 / Z2 Extreme | console |
| MSI Claw / Claw 7 / Claw 8 AI+ | 1920×1080 ou 1920×1200, 7–8 po, 120 Hz | 150 % | 1280×720–800 | Intel Core Ultra (Arc) | console |
| Autres (AYANEO, GPD Win, OneXPlayer, Zotac Zone) | inconnu | — | — | selon le processeur | selon le processeur |

## 2. Audit du parcours

Gravité : **haute** (gêne tout le monde sur l'appareil, ou risque de plantage), **moyenne** (une
étape exige souris, clavier ou patience ; batterie gaspillée), **basse** (finition). État :
corrigé (commit sur la branche), reste (section 5), à vérifier (seulement sur le matériel).

### 2.1 Installation et premier démarrage

| Constat | Gravité | État |
| --- | --- | --- |
| Deck : script d'installation, entrée Steam, illustrations (`docs/STEAMDECK-INSTALL.md`) | — | déjà en place |
| Windows : installateur NSIS par utilisateur, plein écran d'office (`fullscreen: true`) | — | déjà en place |
| Installateur non signé : SmartScreen et certains antivirus demandent « Exécuter quand même » ; au doigt, c'est faisable | basse | reste (signature de code) |
| Taille minimale de la fenêtre 1100×700 points : plus grande que l'écran d'une Ally réglée à 175 % (1097×617) ou 200 % (960×540) ; la fenêtre plein écran déborde | moyenne | corrigé : contrainte levée quand l'écran est plus petit (`platform::fit_small_screen`) |
| Assistant de première configuration navigable à la manette ; le nom du profil se tape au clavier virtuel | — | déjà en place |
| **Ajout des jeux** : seul le sélecteur de dossier du système permet d'ajouter un dossier. Il ne se pilote pas à la manette (fenêtre GTK en Mode Jeu, boîte Windows ailleurs) | moyenne | corrigé : les emplacements usuels trouvés (EmuDeck `Emulation/roms`, RetroDECK `retrodeck/roms`, carte SD, `ROMs` à la racine d'un disque ou du dossier personnel) sont proposés d'un bouton, dans l'assistant comme dans Paramètres › Bibliothèque |
| Jeux PC (Steam, Heroic, Lutris…) trouvés sans rien faire | — | déjà en place |

### 2.2 Navigation à la manette

| Constat | Gravité | État |
| --- | --- | --- |
| Toute l'interface se parcourt à la croix et au stick (navigation spatiale), avec barre d'aide aux bonnes icônes (famille Xbox pour Steam Input et les manettes XInput des portables Windows) | — | déjà en place |
| Champs de texte : valider ouvre le clavier virtuel `PadKeyboard` partout (écouteur global sur les champs) | — | déjà en place |
| Clavier virtuel en AZERTY même quand l'interface est en anglais | basse | corrigé : QWERTY en anglais |
| Organiser les collections de l'accueil : glisser à la souris, mais aussi boutons ‹ › sous chaque carte, atteignables à la manette | — | déjà en place |
| Bouton central (Guide) : pris par Steam en Mode Jeu, absent ou réservé à Armoury Crate / Legion Space sur les portables Windows. « Accueil » reste atteignable par Retour et le menu rapide (Start) | basse | rien à faire |
| **Mode Jeu, retour d'une partie** : la manette n'est lue que si la fenêtre a le focus. Si gamescope ne rend pas le focus à WebKitGTK au retour d'un jeu, la manette reste morte jusqu'au premier toucher | moyenne | corrigé (non vérifié) : en Mode Jeu, sans partie en cours, iBox est la seule fenêtre à l'écran et sa manette compte même sans focus annoncé |

### 2.3 Lisibilité (7–8,8 pouces)

| Constat | Gravité | État |
| --- | --- | --- |
| La base du texte suit la largeur : ~15 px à 1280 points. Sur un écran de 7 pouces à 1280 points (Deck LCD, Ally à 150 %), un rem fait 1,8 mm ; les plus petits textes (0,62–0,72 rem, soit 9–11 px, plus de 150 emplois) tombent sous ce que Valve recommande pour le Deck | **haute** | corrigé : texte agrandi d'office selon l'écran de l'appareil reconnu, jusqu'à ~2 mm par rem et ×1,15 au plus (Deck LCD ×1,14, Deck OLED ×1,08, Ally et Claw à 150 % ×1,11, Ally à 125 % ×1,15 ; Legion Go à 200 % et Go S à 150 % déjà au-dessus : inchangé). S'ajoute au réglage Taille de l'interface |
| Mise en page vérifiée à ×1,14 en 1280×800 et à ×1,11 en 1280×720 : accueil, étagère, fiche de jeu, Paramètres, clavier virtuel | — | vérifié (aperçu navigateur) |
| Barre d'aide et en-tête tiennent à 1280×720 | — | vérifié |

### 2.4 Tactile

| Constat | Gravité | État |
| --- | --- | --- |
| Défilement au doigt des listes et des Paramètres, toucher = clic | — | déjà en place |
| Étagère 3D : aucun geste au doigt, seulement toucher un boîtier | moyenne | corrigé : glisser à gauche ou à droite parcourt les jeux (un boîtier par 140 points), vers le haut ou le bas change de console |
| Visionneuse 3D des fiches : le navigateur prend le glissé pour un défilement et l'interrompt (`pointercancel`), le boîtier ne tourne pas au doigt | moyenne | corrigé (`touch-action: none`) |
| Toucher un champ de texte sous Linux : le Mode Jeu n'ouvre aucun clavier (il faut Steam + X) | moyenne | corrigé : le clavier virtuel d'iBox s'ouvre. Sous Windows, le clavier tactile du système s'ouvre de lui-même |
| Actions révélées au survol (réglages d'une collection) : aussi révélées au focus | — | déjà en place |

### 2.5 Lancement, partie, retour

| Constat | Gravité | État |
| --- | --- | --- |
| Windows : fenêtre masquée au lancement, ramenée au premier plan à la fin (`shell::game_ended` → `set_focus`) | — | déjà en place, à vérifier (verrou de premier plan de Windows après une longue partie) |
| Veille de l'interface pendant la partie : animations CSS et scènes 3D arrêtées | — | déjà en place |
| **La boucle de lecture des manettes tournait à chaque image pendant toute la partie** : en Mode Jeu la fenêtre d'iBox reste « visible » derrière le jeu, la boucle `requestAnimationFrame` continuait (lecture de toutes les manettes, copie de leurs états) | moyenne | corrigé : boucle arrêtée en veille, relancée au réveil |
| Relecture des manifestes Steam toutes les 4 s (12 s sur batterie), partie en cours comprise | basse | corrigé : rien pendant la partie |
| Réseau pendant la partie : pouls iNetbox (10 s, 30 s sur batterie), amis et groupes (10 et 15 s) | basse | pouls corrigé : 45 s en partie sur batterie (le serveur efface une présence après 90 s : deux pouls par fenêtre). Reste : relecture des groupes (15 s) et du jeu PC détecté (10 s) dans l'interface, même en partie |

### 2.6 Steam Deck, Mode Jeu

| Constat | Gravité | État |
| --- | --- | --- |
| Une seule fenêtre : notifications et bandeaux dans la fenêtre principale ; pas de zone de notification, pas de démarrage avec le système ; iBox ne se masque jamais | — | déjà en place (`platform::SINGLE_WINDOW`, `shell::hide_main`) |
| Écran noir connu de WebKitGTK sous gamescope : `WEBKIT_DISABLE_DMABUF_RENDERER=1` posé d'office | — | déjà en place |
| Steam Input : profil « Manette » conseillé (le profil « Bureau » transforme la manette en souris) | — | documenté (`STEAMDECK-TESTS.md`) |

### 2.7 Portables Windows et logiciels des fabricants

| Constat | Gravité | État |
| --- | --- | --- |
| **Aucune détection** : sous Windows, une Ally ou une Legion Go étaient vues comme un PC de bureau (pas de mode performance, 3D au rythme de l'écran, texte non agrandi) | **haute** | corrigé : `platform::identify` (fabricant, produit, famille, processeur), profil exposé à l'interface |
| La Legion Go ne se nomme que « 83E1 » (`SystemProductName`) : SmartConfig ne la reconnaissait pas comme console portable | moyenne | corrigé : la famille (« Legion Go 8APU1 ») est lue, SmartConfig suit la même fiche |
| Écrans à 120 et 144 Hz : l'étagère était redessinée 120 à 144 fois par seconde, même immobile | moyenne | corrigé : palier console, 60 im/s et rendu à la demande |
| Boutons dédiés (Armoury Crate, Command Center, Legion L / R, MSI Center M) : gérés par les logiciels du fabricant, ils n'arrivent pas par XInput ; iBox ne les voit pas et ne les gêne pas | — | rien à faire |
| Surcouches (Command Center, Legion Space, Xbox Game Bar) : elles prennent le focus, iBox ignore alors la manette (pas de navigation fantôme derrière) et reprend quand la surcouche se ferme | — | déjà en place, à vérifier |
| Manette en mode « bureau » (Ally, Legion « FPS ») : elle devient souris et clavier ; iBox reste utilisable aux flèches et à Entrée | basse | à vérifier |

### 2.8 Performances (mesurées, section 4)

| Constat | Gravité | État |
| --- | --- | --- |
| **Mémoire graphique sans plafond** : chaque boîtier parcouru gardait ses textures (≈ 11 Mo) et ses canevas jusqu'à la fermeture de l'étagère : 1,56 Go après 120 boîtiers, sur un Deck dont la mémoire est partagée avec le jeu | **haute** | corrigé : textures comptées par utilisateur, 32 jeux gardés hors écran (12 au palier allégé), canevas libérés avec elles |
| Textures des jaquettes de 800 px pour des boîtiers de 300 px de haut à l'écran du Deck | moyenne | corrigé : ×0,7 au palier allégé (×1,1 au lieu de ×1,6 dans la visionneuse) |
| Visionneuse : carte d'ombre de 2048 px et pénombre à 12 échantillons | moyenne | corrigé : 1024 px et 6 échantillons au palier allégé |
| Parcourir l'étagère : la peinture des faces d'un boîtier (canevas 2D de 800 px) se fait sur le fil principal et donne des images de plus de 33 ms sur un processeur bridé ×4 | moyenne | corrigé : faces peintes dans un worker (`OffscreenCanvas`), repli étalé une face par image ; images > 33 ms divisées par 2 à 2,4 (section 4) |

## 3. Détection et paliers

**Détection** (`src-tauri/src/platform.rs`, `identify`, testé) : fabricant, produit, famille et
version du micrologiciel (Windows : registre `HARDWARE\DESCRIPTION\System\BIOS` ; Linux :
`/sys/class/dmi/id`), plus le nom du processeur. Jamais de numéro de série. Résultat dans
`platform_info.device` : identifiant (`steam-deck-oled`, `rog-ally-x`, `legion-go`…), nom, écran
(définition native, diagonale) et classe de GPU (`low` : Steam Deck, Ryzen Z1, Z2 A, Z2 Go ;
`mid` : Z1 / Z2 Extreme, Z2, Intel Arc). Une console SteamOS sans fiche reste reconnue par
`SteamDeck=1`.

**Paliers** (`src/services/device.ts`, `performance.ts`, `graphics.ts`) :

| | PC (`full`) | Console (`handheld`) | Allégé (`lite`) |
| --- | --- | --- | --- |
| Appareils | ordinateurs | Ally Z1 Extreme, Ally X, Legion Go, Claw… | Steam Deck, Ally Z1, Xbox Ally, Go S Z2 Go, SteamOS inconnu |
| Flous, ombres, anneau de focus | complets | complets | allégés (`styles/performance.css`) |
| Étagère 3D | ×1,5, rythme de l'écran | ×1,5, 60 im/s, rendu à la demande | définition de l'écran, 60 im/s, rendu à la demande |
| Sur batterie (profil Automatique) | 30 im/s | 30 im/s | 30 im/s |
| Textures des jaquettes (étagère / fiche) | ×1 / ×1,6 | ×1 / ×1,6 | ×0,7 / ×1,1 |
| Ombre de la visionneuse | 2048 px, 12 échantillons | 2048 px, 12 échantillons | 1024 px, 6 échantillons |
| Jeux de textures gardés hors écran | 32 | 32 | 12 |
| Texte | réglage | réglage × agrandissement selon l'écran | réglage × agrandissement selon l'écran |

Paramètres › Apparence › Mode performance : Automatique (palier de l'appareil), Activé (allégé),
Désactivé (PC, sans bridage). La note sous le réglage dit quel palier a été choisi.

**Simuler un appareil** (aperçu `npm run dev` ou build de mesure) : `?device=deck`, `ally`,
`ally-z1`, `legion-go`, `legion-go-s`, `claw`. Le rapport pixels / point du navigateur est celui
de l'écran du PC : l'agrandissement du texte n'y est pas celui de l'appareil (le forcer avec
`--ui-scale` pour vérifier une mise en page).

## 4. Mesures

**Méthode** (`scripts/bench-handheld.mjs`, mode d'emploi en tête du fichier) : build de production instrumentable
(`VITE_IBOX_BENCH=1 npx vite build`, qui expose seulement `window.__ibox`), servi en local et
piloté par Chrome sans fenêtre (protocole DevTools) : écran émulé, processeur bridé
(`Emulation.setCPUThrottlingRate`), enregistreur `requestAnimationFrame` + `longtask`, compteurs
WebGL (images dessinées, appels de dessin, mémoire des textures d'après `texImage2D` /
`texStorage2D` / `deleteTexture`), `Performance.getMetrics` (temps du fil principal). Scénarios :
accueil immobile (4 s), étagère immobile (4 s), étagère parcourue (une flèche toutes les 160 ms
pendant 5 s), puis 120 boîtiers parcourus avec 155 jeux de synthèse. Profils : « PC » (1280×800,
processeur ×4), « Deck » (1280×800, processeur ×4, `?platform=deck` avant, `?device=deck` après),
« Legion Go » (1280×800 à ×2, processeur ×2 ; non reconnue avant, `?device=legion-go` après).

Limites : Chromium sur la carte graphique du PC (RTX 5080), pas WebKitGTK sur la puce du Deck ;
le GPU ne se bride pas par le protocole. Le rendu logiciel (SwiftShader, processeur ×4) a été
essayé : 1,6 image par seconde dans l'étagère, avant comme après, il ne représente rien.
Chrome sans fenêtre suit un écran à 240 Hz : comparer les images WebGL par seconde et les coûts,
pas le rythme d'affichage.

Deux passes alternées avant / après, machine au repos (une première série lancée pendant une
compilation Rust était faussée et a été jetée). « Avant » = branche de départ (a28b1e5) avec le
seul crochet de mesure ; « après » = cette branche.

**PC, processeur ×4** (moyenne de 2 / 2 passes)

| Mesure | Avant | Après |
| --- | --- | --- |
| Accueil immobile : fil principal occupé (%) | 91 | 92 |
| Étagère immobile : images WebGL dessinées par seconde | 76 | 112 |
| Étagère immobile : fil principal occupé (%) | 98 | 97 |
| Étagère immobile : temps de script (%) | 70 | 67 |
| Étagère parcourue : images WebGL par seconde | 32 | 30 |
| Étagère parcourue : images > 33 ms (sur 5 s) | 28 | 31 |
| Étagère parcourue : pire image (ms) | 150 | 265 |
| Étagère parcourue : temps de script (%) | 61 | 63 |
| Après 120 boîtiers : mémoire des textures (Mo) | 1528 | 580 |
| Après 120 boîtiers : tas JavaScript (Mo) | 32,0 | 28,3 |
| Démarrage à froid : interface prête (ms) | 1021 | 996 |
| Démarrage : tâches longues des 8 premières secondes (ms) | 3481 | 2857 |
| Palier, taille de base du texte | aucun, 14.936px | aucun, 14.936px |

**Steam Deck simulé, processeur ×4** (moyenne de 2 / 2 passes)

| Mesure | Avant | Après |
| --- | --- | --- |
| Accueil immobile : fil principal occupé (%) | 96 | 97 |
| Étagère immobile : images WebGL dessinées par seconde | 14 | 16 |
| Étagère immobile : fil principal occupé (%) | 48 | 49 |
| Étagère immobile : temps de script (%) | 11 | 13 |
| Étagère parcourue : images WebGL par seconde | 32 | 35 |
| Étagère parcourue : images > 33 ms (sur 5 s) | 30 | 23 |
| Étagère parcourue : pire image (ms) | 123 | 138 |
| Étagère parcourue : temps de script (%) | 55 | 61 |
| Après 120 boîtiers : mémoire des textures (Mo) | 1538 | 228 |
| Après 120 boîtiers : tas JavaScript (Mo) | 32,3 | 27,6 |
| Démarrage à froid : interface prête (ms) | 1652 | 2842 |
| Démarrage : tâches longues des 8 premières secondes (ms) | 2130 | 2436 |
| Palier, taille de base du texte | lite, 14.936px | lite, 16.1309px |

**Legion Go simulée (×2), processeur ×2** (moyenne de 2 / 2 passes)

| Mesure | Avant | Après |
| --- | --- | --- |
| Accueil immobile : fil principal occupé (%) | 47 | 53 |
| Étagère immobile : images WebGL dessinées par seconde | 227 | 6 |
| Étagère immobile : fil principal occupé (%) | 73 | 22 |
| Étagère immobile : temps de script (%) | 51 | 2 |
| Étagère parcourue : images WebGL par seconde | 119 | 46 |
| Étagère parcourue : images > 33 ms (sur 5 s) | 21 | 21 |
| Étagère parcourue : pire image (ms) | 94 | 156 |
| Étagère parcourue : temps de script (%) | 55 | 40 |
| Après 120 boîtiers : mémoire des textures (Mo) | 1564 | 578 |
| Après 120 boîtiers : tas JavaScript (Mo) | 32,6 | 28,6 |
| Démarrage à froid : interface prête (ms) | 527 | 423 |
| Démarrage : tâches longues des 8 premières secondes (ms) | 2172 | 2275 |
| Palier, taille de base du texte | aucun, 14.936px | aucun, 14.936px |

**Lecture**

- **Mémoire** : c'est le gain net. Après 120 boîtiers parcourus, la mémoire des textures passe de
  1,5 Go à 580 Mo (PC, Legion Go : 21 boîtiers montés + 32 gardés) et à 228 Mo au palier allégé
  (Steam Deck : textures ×0,7, 12 gardés). Elle ne grandit plus avec la longueur de la promenade.
- **Legion Go et consoles puissantes** : non reconnues avant, l'étagère immobile était redessinée
  au rythme de l'écran (227 images WebGL par seconde ici, 144 sur l'appareil) ; reconnue, elle se
  pose (6 images par seconde sur la fenêtre de mesure, le temps de finir l'arrivée) et le fil
  principal passe de 73 % à 22 % d'occupation. Parcourue, elle est plafonnée à 60 im/s.
- **Steam Deck, parcourir l'étagère** : peu de changement mesurable ici (images de plus de 33 ms :
  30 → 23 sur 5 s, pire image du même ordre). Le coût était la peinture des faces sur le fil
  principal (réglée ensuite, ci-dessous), pas le GPU du PC ; les textures plus petites aident surtout le GPU et la
  mémoire du vrai Deck, que ce banc ne mesure pas.
- **Démarrage à froid** : pas de différence significative ; l'écart entre deux passes du même code
  (686 à 2 617 ms pour « avant Deck ») dépasse l'écart avant / après.
- **Accueil immobile** : inchangé (l'occupation élevée vient du rythme de 240 Hz du Chrome sans
  fenêtre et du processeur bridé, pas d'iBox).
- **PC** : comportement inchangé voulu (palier `full`) ; les écarts de cadence entre passes sont du
  bruit (rythme d'écran libre, processeur bridé).

### 4.1 Peinture des faces hors du fil principal

**Avant** : à son arrivée dans l'étagère, un boîtier faisait peindre ses cinq faces (avant, dos,
tranche, disque, étiquette : canevas 2D de 560 à 1024 px, polices, motifs, grain) d'un seul trait
sur le fil principal (`art/covers.ts`), soit jusqu'à 160 ms de tâches longues sur 5 s de parcours (processeur ×4).

**Après** : la peinture est séparée de l'application (`art/painters.ts`, sans DOM ni état) et
tourne dans un worker (`art/paintWorker.ts`) sur des `OffscreenCanvas`. Les polices y sont
rechargées par `FontFace` d'après les `@font-face` de la feuille de style (toutes les tranches
Unicode), les images du jeu et le logo de la console y sont copiés une fois par jeu (12 jeux
gardés ; le worker les redemande s'il les a oubliés). Chaque face revient en `ImageBitmap`
transféré, déjà retourné et non prémultiplié (`createImageBitmap`, `imageOrientation: "flipY"`,
`premultiplyAlpha: "none"`) : texture `flipY = false`, même envoi au GPU qu'une `CanvasTexture`.
L'image est fermée avec sa texture (plafond de `useCaseTextures.ts` inchangé). Sans
`OffscreenCanvas` 2D ou sans polices de worker, ou si le worker échoue, repli sur le fil
principal, **étalé** : une face par image affichée (`frameSlot`) au lieu des cinq d'un coup.
`?paint=main` force ce repli (développement, build de mesure).

**Même rendu** : faces comparées pixel à pixel dans un même onglet (`__ibox.art`, 105 faces :
5 jeux de démonstration en GameCube, PC et DS, 7 faces chacun). Écart nul ou de 1/255 (arrondi du
passage non prémultiplié, bords du disque), sauf le texte pivoté des tranches (jusqu'à 16/255) :
le fil principal lui-même varie d'autant entre deux peintures de la même tranche (jusqu'à 15/255).
Captures de l'étagère posée (1280×800, 25 jeux, zone des boîtiers) : avant / après, écart maximal
2/255, alors que deux captures « avant » diffèrent jusqu'à 7/255 (13/255 au palier Deck, où
avant / après reste à 2/255) ; repli `?paint=main` : 3/255.

**Mesures** (étagère parcourue, une flèche toutes les 160 ms pendant 5 s, processeur ×4, machine
au repos, 2 passes alternées ; « avant » = branche des paliers, 6363b93)

| Mesure | Avant | Worker | Repli étalé |
| --- | --- | --- | --- |
| PC : images > 33 ms (sur 5 s) | 26,5 | **13,5** | 28,5 |
| PC : pire image (ms) | 94 | **52** | 55 |
| PC : 95ᵉ centile (ms) | 56 | **31** | 41 |
| PC : tâches longues (ms) | 30 | **0** | 0 |
| PC : images WebGL par seconde | 71 | **85** | 50 |
| Deck simulé : images > 33 ms (sur 5 s) | 24 | **10** | 5,5 |
| Deck simulé : pire image (ms) | 90 | **52** | 46 |
| Deck simulé : 95ᵉ centile (ms) | 25 | **19** | 21 |
| Deck simulé : tâches longues (ms) | 109 | **0** | 0 |
| Deck simulé : images WebGL par seconde | 46 | **55** | 55 |
| Après 120 boîtiers : mémoire des textures, PC / Deck (Mo) | 582 / 229 | 583 / 229 | 582 / 225 |

**Lecture** : les images longues du parcours sont divisées par 2 (PC) à 2,4 (Deck), la pire image
passe de 90 à 52 ms et il ne reste aucune tâche longue. Le fil principal du PC est plus occupé
(86 → 98 %) parce qu'il dessine plus d'images (71 → 85 par seconde sur un écran à 240 Hz), pas
parce qu'il peint. Au palier allégé (faces ×0,7), le repli étalé fait aussi bien que le worker
dans ce banc ; au palier complet il ne réduit que la pire image : le worker reste le chemin
normal. Ce qui reste des images longues vient de l'envoi des textures au GPU et du montage des
boîtiers, à mesurer sur le matériel.

**À vérifier sur le Deck** : WebKitGTK doit offrir `OffscreenCanvas` 2D et `FontFace` dans les
workers (WebKit les a depuis Safari 16.4) ; sinon le repli étalé s'applique sans rien changer au
rendu. Le rapport de problème dit lequel des deux chemins est pris (ligne « Appareil » :
« peinture des boîtiers worker » ou « fil principal, étalée »).

## 5. Ce qui reste

**Fait le 27/11/2026 (après le bilan)** : capacité `systemTouchKeyboard` (plus de double clavier
sur Android, plus de `isLinux()` pour dire « Steam Deck ») ; un seul réglage Performances
(`services/budget.ts` : Automatique, Qualité, Équilibré, Allégé, Économie) ; texte agrandi
seulement sur l'écran intégré (rien sur TV) ; signaux d'attention réunis (`services/attention.ts`) ;
décor de l'accueil immobile en mode allégé (20 → 2 animations continues) ; pas d'anticrénelage de
l'étagère au palier allégé ; portables Windows hors table reconnus à leur forme ; relectures en pause
pendant la partie. Classes de GPU et fiche Android : faites par la session android-perfs.

Démarrage à froid : les jaquettes 2D de l'accueil sont peintes et encodées dans le worker
(`convertToBlob`), identiques au pixel près ; tâches longues des premières secondes 1 063 → 846 ms
en moyenne (processeur ×4, Deck simulé, 3 passes). Ce qui reste au démarrage est surtout le travail
du navigateur (style, mise en page) et les mesures de mise en page des animations de l'accueil
(~170 ms). Ligne Performances vérifiée à 1280×720 avec le texte agrandi de l'Ally.

**Reste** : vérifier sur le Deck l'étagère sans anticrénelage ; mesures de mise en page des
animations de l'accueil au démarrage.

- **Chemin de peinture sur le Deck** (à vérifier) : worker ou repli étalé selon WebKitGTK (§4.1).
- **Signature de code** de l'installateur Windows (basse) : SmartScreen et faux positifs.
- **Relectures de l'interface pendant la partie** (basse) : groupes (15 s) et jeu PC détecté
  (10 s), `components/shell/FriendsButton.tsx` ; à suspendre pendant la veille de l'interface.
- **Mise à l'échelle sous gamescope** (à vérifier) : un facteur d'échelle Xwayland supérieur à 1
  fausserait l'agrandissement du texte (calculé avec `devicePixelRatio`).
- **Tout ce qui est marqué « à vérifier »** : seulement sur le matériel, voir la fiche ci-dessous.

## 6. Fiche de test pour les bêta-testeurs

Merci d'essayer iBox sur votre console. Prévoyez 20 minutes, la console chargée à plus de 50 %,
et quelques jeux ou émulateurs déjà installés.

**À noter avant de commencer** : modèle exact (par exemple « ROG Ally Z1 Extreme », « Steam Deck
OLED »), système (SteamOS ou Windows, version), mise à l'échelle de Windows (Paramètres ›
Affichage), version d'iBox (Paramètres › Système). Puis Paramètres › Système › Diagnostic ›
**Rapport de problème** : joignez le fichier créé à votre message (il dit quel appareil iBox a
reconnu, son palier de performance et la taille du texte ; ni clé ni mot de passe).

1. **Reconnaissance** : Paramètres › Apparence › Mode performance. La note dit-elle « activé…
   sur cette console portable » ou « cette console portable a assez de puissance » ? Elle ne doit
   pas dire « Il s'active tout seul sur un Steam Deck ».
2. **Lisibilité** : à bout de bras, lisez-vous sans effort les petits textes (dates sous l'heure,
   notes des Paramètres, barre d'aide en bas) ? Quelque chose déborde-t-il ou est-il coupé ?
3. **Ajout des jeux** : Paramètres › Bibliothèque. Si vous avez EmuDeck, RetroDECK ou un dossier
   `ROMs`, apparaît-il sous « Dossiers de jeux trouvés sur cet appareil » ? L'ajouter d'un bouton
   trouve-t-il vos jeux ?
4. **Manette seule** : de l'accueil, ouvrez une console, parcourez l'étagère, ouvrez une fiche,
   tournez le boîtier (stick droit), revenez, cherchez un jeu (Select puis clavier virtuel).
   Un écran vous a-t-il obligé à toucher l'écran ou à prendre la souris ?
5. **Tactile** : glissez sur l'étagère (gauche, droite, haut, bas), faites tourner un boîtier au
   doigt dans une fiche, touchez le champ de recherche (Steam Deck : le clavier d'iBox doit
   s'ouvrir).
6. **Fluidité** : Paramètres › Système › Diagnostic › Afficher les performances. Notez les images
   par seconde en parcourant vite l'étagère, et immobile. Des saccades ?
7. **Une partie** : lancez un jeu, jouez 5 minutes, quittez-le. iBox revient-il au premier plan
   tout seul ? La manette marche-t-elle tout de suite, sans toucher l'écran ? (Steam Deck en Mode
   Jeu : essentiel.)
8. **Logiciel du fabricant** (Windows) : ouvrez la surcouche (Armoury Crate / Command Center,
   Legion Space, MSI Center M) par-dessus iBox, refermez-la : la manette répond-elle encore dans
   iBox ? Basculez la manette en mode bureau ou souris puis revenez.
9. **Batterie** (facultatif) : laissez iBox immobile 10 minutes sur l'accueil, puis 10 minutes
   sur l'étagère ; notez le pourcentage perdu et, si votre logiciel l'affiche, la consommation en
   watts.
10. **Longue promenade** : parcourez une étagère de plus de 100 jeux d'un bout à l'autre, deux
    fois. iBox ralentit-il ou se ferme-t-il ?

**À renvoyer** (Discord, salon des bêta-testeurs) : le rapport de problème, vos réponses numérotées,
une capture de chaque écran qui déborde ou se lit mal, et si possible une courte vidéo d'une
saccade.
