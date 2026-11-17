# iBox Platforms

Espace de découverte des consoles (galerie, fiches) et installation des
émulateurs depuis leurs sources officielles. Introduit en 0.1.61.

## Carte du code

| Rôle | Fichiers |
|---|---|
| Galerie (frise chronologique, filtres, recherche) | `src/screens/PlatformsScreen.tsx` |
| Fiche d'une console | `src/screens/PlatformSheet.tsx` |
| Console exposée, halo d'ambiance | `src/components/platforms/ConsoleStage.tsx` |
| Émulateur recommandé, installation, prérequis | `src/components/platforms/EmulatorPanel.tsx` |
| État d'une console (prête, à installer, BIOS manquant…) | `src/components/platforms/status.ts` |
| Données des consoles (histoire FR/EN, matériel, ambiance, émulateurs) | `src/domain/platformCatalog.ts` |
| Textes des émulateurs et prérequis | `src/domain/emulatorTexts.ts` |
| Service (état, progression en direct, enchaînement RetroArch → cœur) | `src/services/emulators.ts` |
| Catalogue natif des paquets (source de vérité des téléchargements) | `src-tauri/src/emulators/catalog.rs` |
| Résolution des versions, téléchargement | `src-tauri/src/emulators/download.rs` |
| Extraction sûre (.zip, .7z) | `src-tauri/src/emulators/archive.rs` |
| Installation transactionnelle, mise à jour, restauration, désinstallation | `src-tauri/src/emulators/install.rs` |
| BIOS, micrologiciels, composants Windows | `src-tauri/src/emulators/requirements.rs` |
| Commandes Tauri, événements | `src-tauri/src/emulators/commands.rs` |
| Provenance des émulateurs (`origin`, `package_id`, `version`) | `src-tauri/src/db/migrations/014_emulator_origin.sql`, `launcher/repo.rs` |
| Photographies et crédits | `public/platforms/*.webp`, `public/platforms/CREDITS.md` |

Aucun état parallèle : la fiche lit les associations du lanceur
(`platform_emulators`), la table `emulators` et les manifestes d'installation ;
une installation se termine par `repo::register_managed` (ou `register_core`)
puis l'événement `emulators://changed`, qui recharge lanceur et bibliothèque.

## Sources de téléchargement (vérifiées le 2026-11-17)

Le frontend ne transmet qu'un identifiant de paquet. Versions, adresses,
fichiers attendus et exécutables sont déterminés côté Rust.

| Paquet | Source | Fichier | Empreinte |
|---|---|---|---|
| PPSSPP | GitHub `hrydgard/ppsspp`, dernière release stable | `PPSSPP-*-Windows-x64.zip` | SHA-256 publiée par GitHub |
| DuckStation | GitHub `stenzek/duckstation` | `duckstation-windows-x64-release.zip` | idem |
| PCSX2 | GitHub `PCSX2/pcsx2` (stables seulement) | `pcsx2-*-windows-x64-Qt.7z` | idem |
| Dolphin | API officielle `dolphin-emu.org/update/latest/beta/` | `dl.dolphin-emu.org/…/dolphin-*-x64.7z` | non publiée (HTTPS seul) |
| Cemu | GitHub `cemu-project/Cemu` | `cemu-*-windows-x64.zip` | selon la release |
| melonDS | GitHub `melonDS-emu/melonDS` | `melonDS-*-windows-x86_64.zip` | SHA-256 GitHub |
| Azahar | GitHub `azahar-emu/azahar` | `azahar-windows-msvc-*.zip` | SHA-256 GitHub |
| mGBA | GitHub `mgba-emu/mgba` | `mGBA-*-win64.7z` | selon la release |
| SameBoy | GitHub `LIJI32/SameBoy` | `sameboy_winsdl_*.zip` | SHA-256 GitHub |
| Mesen | GitHub `SourMesen/Mesen2` | `Mesen_*_Windows.zip` | SHA-256 GitHub |
| RMG | GitHub `Rosalie241/RMG` | `RMG-Portable-Windows64-*.zip` | SHA-256 GitHub |
| RPCS3 | GitHub `RPCS3/rpcs3-binaries-win` | `rpcs3-*_win64_msvc.7z` | SHA-256 GitHub |
| xemu | GitHub `xemu-project/xemu` | `xemu-win-x86_64-release.zip` | SHA-256 GitHub |
| Xenia Canary | GitHub `xenia-canary/xenia-canary-releases` | `xenia_canary_windows*.zip` | SHA-256 GitHub |
| Vita3K | GitHub `Vita3K/Vita3K` (`continuous`) | `windows-latest.zip` | SHA-256 GitHub |
| shadPS4 | GitHub `shadps4-emu/shadPS4` | `shadps4-win64-sdl-*.zip` | SHA-256 GitHub |
| Flycast | GitHub `flyinghead/flycast` | `flycast-win64-*.zip` | SHA-256 GitHub |
| Stella | GitHub `stella-emu/stella` | `Stella-*-windows.zip` | selon la release |
| RetroArch | `buildbot.libretro.com/stable/<dernière>/windows/x86_64/RetroArch.7z` | | non publiée |
| Cœurs libretro | `buildbot.libretro.com/nightly/windows/x86_64/latest/<cœur>.dll.zip` | | non publiée |
| Cœurs sans BIOS (0.1.72) | Play! (`play_libretro`, PS2), PCSX ReARMed (`pcsx_rearmed_libretro`, PS1), Yabause (`yabause_libretro`, Saturn) : même serveur | | non publiée |
| BigPEmu, MAME | parcours assisté (site officiel), pas de téléchargement automatique | | |

« Empreinte : selon la release » : GitHub ne publie l'empreinte que pour les
fichiers récents ; sans elle, le manifeste enregistre `verified: false` et
l'interface dit « téléchargée depuis la source officielle », jamais « vérifiée ».

Essai réel de toutes les sources (zip et 7z, chemin avec espaces et accents) :
`cd src-tauri && IBOX_PKGS=ppsspp,dolphin,… IBOX_EMU_ROOT=<dossier> cargo test --lib emulators::install::tests::vrai -- --ignored --nocapture`.

## Consoles sans BIOS (0.1.72)

Recommandés par défaut parce qu'ils n'exigent rien d'extrait d'une console
(BIOS réimplémenté librement, « HLE ») : PS2 → Play!, PS1 → PCSX ReARMed,
Saturn → Yabause, tous via RetroArch. PCSX2, DuckStation et Beetle Saturn
restent en alternatives ; leur BIOS est un prérequis `required: false`
(« Facultatif »). Analyse des autres consoles :

| Console | Exigence | Alternative sans fichier de console |
|---|---|---|
| PS3 (RPCS3) | micrologiciel officiel de Sony, téléchargeable | inutile (simple installation) |
| Vita (Vita3K) | micrologiciel officiel de Sony, téléchargeable | inutile |
| Xbox (xemu) | ROM MCPX + BIOS + disque dur tirés d'une Xbox | aucune : Cxbx-Reloaded ne lit pas les ISO (dossiers .xbe seulement) et n'a que des préversions |
| PS4 (shadPS4) | modules système pour certains jeux | aucun autre émulateur PS4 |
| Wii U (Cemu) | clés pour les jeux chiffrés | aucun autre émulateur Wii U |
| 3DS (Azahar) | jeux déchiffrés | aucun autre émulateur 3DS maintenu |
| Dreamcast (Flycast) | BIOS facultatif | déjà sans BIOS |
| NES/SNES (Mesen) | runtime .NET 8 de Microsoft | inutile (composant gratuit) |

## Sécurité

- Hôtes autorisés codés en dur (`catalog::ALLOWED_HOSTS`), HTTPS obligatoire,
  chaque redirection revalidée ; taille plafonnée par paquet ; taille annoncée
  et taille reçue comparées ; SHA-256 calculée au fil de l'eau et comparée à
  celle de la source quand elle existe.
- Extraction dans `_staging` : chemins absolus, `..`, lecteurs, noms réservés,
  liens symboliques et points de réanalyse refusés ; 4 Go et 60 000 fichiers au plus.
- Exécutable reconnu par son nom exact et son en-tête `MZ`.
- Aucun installeur exécuté, aucun droit administrateur, aucune désactivation de
  protection Windows. Les liens ouverts depuis l'interface doivent figurer dans
  le catalogue (`emulators_open_url`).
- BIOS, micrologiciels et clés ne sont jamais téléchargés : l'utilisateur importe
  son fichier (taille contrôlée, jamais d'écrasement).

## Installations

Dossier par défaut `%USERPROFILE%\iBox\Emulators` (modifiable dans Paramètres ›
Émulateurs ; les anciens dossiers restent lus). Chaque installation porte un
`ibox-install.json` (paquet, version, source, empreinte, fichiers livrés).

- Mise à jour : la version active part dans `_backups`, la nouvelle prend sa
  place, et les fichiers créés par l'utilisateur à côté du programme (réglages,
  sauvegardes de RPCS3 ou RetroArch…) y sont reportés.
- Restauration : échange avec la sauvegarde la plus récente.
- Désinstallation : déplacement dans `_backups` (récupérable), purge sur demande.
- PPSSPP reçoit `installed.txt` pour ranger ses données dans `Documents\PPSSPP`.
- Une installation externe n'est jamais modifiée ; un dossier homonyme non géré
  donne `<Nom> (iBox)`. Une association console → émulateur choisie par
  l'utilisateur n'est jamais remplacée (seules les consoles sans émulateur sont associées).

## Ajouter une console

1. `shared/platform-formats.json` : extensions et noms de dossiers.
2. `src/domain/platforms.ts` : entrée du registre (thème, boîtier, jaquettes).
3. `src/domain/platformCatalog.ts` : photo, histoire FR/EN, matériel vérifié, ambiance, paquet recommandé.
4. `src/domain/platformBlurbs.ts` (phrase de la bibliothèque) ; `metadata/mod.rs::libretro_system` (jaquettes).
5. `src/three/cases/caseSpecs.ts` si un boîtier dédié est utile.
6. Photo : Wikimedia Commons, licence vérifiée, détourée, WebP ≤ 1 200 px, ligne dans `CREDITS.md`.

## Ajouter un émulateur

1. `launcher/profiles.rs` : profil (préfixes d'exécutable, arguments vérifiés dans le code source).
2. `emulators/catalog.rs` : paquet (source, fichier attendu, exécutable, taille max, licence, maturité).
3. Tests : `noms_de_fichiers_des_releases_reelles`, puis l'essai réel ci-dessus.
4. `src/domain/emulatorTexts.ts` et `src/i18n/en.ts`.

## Limites connues

- Les consoles « découverte » (PS4, PS Vita, arcade) n'ont pas de bibliothèque :
  leurs jeux se lancent depuis l'émulateur.
- Les mises à jour d'un cœur libretro reprennent la version « nightly » du serveur.
- La compatibilité des jeux dépend de chaque émulateur, pas de son installation.
