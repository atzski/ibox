# iBox SmartConfig

> Less configuration. More gaming.

SmartConfig recommande puis applique, jeu par jeu, des réglages d'émulateur adaptés au matériel de l'utilisateur, sans jamais lui retirer le contrôle : aperçu exact, sauvegarde, restauration.

**État (2026-11-17, branche `feat/ibox-smartconfig`)**

| Phase | État | Contenu réel |
|---|---|---|
| 1 — Fondations | **faite** | modèle, détection matérielle, multifournisseur, stockage SQLite (migration 015), validation, sauvegardes/journal/reprise |
| 2 — Recommandations externes | **faite** | client EmuReady (testé en réel), correspondance des jeux, normalisation, moteur, cache, quotas, hors ligne |
| 3 — Application réelle | **faite** | adaptateurs **Dolphin**, **PCSX2** (CRC de l'ELF calculé depuis l'image), **DuckStation**, **PPSSPP**, **RPCS3**, **Azahar** (identifiant lu dans l'en-tête NCCH), **RetroArch** (surcharges par jeu, cœurs vérifiés) : aperçu, application par jeu, vérification, restauration. Émulateurs sans adaptateur et pourquoi : §6.8 |
| 4 — Interface | à faire | commandes Tauri prêtes, aucun écran |
| 5 — Communauté | **faite localement, non déployée** | serveur iNetbox (migration v14, `smartconfig.ts`, tests), fournisseur `community`, commandes de contribution, service TS ; aucun écran ; profils sous CC0 (§13) |
| 6 — Extension | **faite (préparation)** | détection Linux/SteamOS/Steam Deck (analyseurs testés), point d'extension `locate_unix`, Android documenté (§16) ; profils « Vérifié par iBox » (fichier embarqué, vide, §17) ; retours locaux exploités par le moteur (§5) ; fondations d'AutoTune sans collecte (§18) |

Aucun réglage n'a encore été validé **en jeu** : seuls les tests automatisés et la lecture du code source de chaque émulateur garantissent le format (liste des points à vérifier : §10).

---

## 1. Audit de l'existant (ce que SmartConfig réutilise)

| Besoin | Système existant réutilisé |
|---|---|
| Identification du jeu | `games.serial` (ID disque GameCube/Wii lu dans l'en-tête, ex. `GMSE01`), `region`, `id_method`, `id_confidence` (`scanner/`) |
| Émulateur du jeu | `games.emulator_id`, sinon `platform_emulators` ; `emulators.profile_id` (`dolphin`…), `version`, `origin` (`launcher/`, `emulators/`) |
| Émulateur ouvert ? | `emulators::install::running_inside` |
| Jeu en cours ? | `launcher::commands::launch_status` |
| Dossier Documents | `emulators::requirements::documents` (rendu `pub(crate)`) |
| HTTP | `metadata::http::USER_AGENT`, `encode_segment` |
| Base | `db/` (migrations `PRAGMA user_version`), `LibraryState::with` |
| Horodatage | `library::now_iso` |
| Empreintes | `sha2` (déjà présent) |

Contraintes relevées : les installations iBox de Dolphin, PCSX2 et DuckStation ne posent **pas** de marqueur portable (catalogue `markers: &[]`) ; PPSSPP reçoit `installed.txt` (carte mémoire dans `Documents\PPSSPP`). Numéros de série : PS1/PS2 `AAAA-NNNNN` (SYSTEM.CNF), PSP `DISC_ID` de PARAM.SFO. Fichier principal du jeu : `game_files` (rôle `main`, présent). La configuration de Dolphin est donc souvent dans `%APPDATA%\Dolphin Emulator` ; aucune fenêtre Tauri n'est créée par SmartConfig ; tout ce qui est lent tourne dans `spawn_blocking`.

## 2. Architecture

```
src-tauri/src/smartconfig/
  model.rs        format interne commun (Profile, Setting typé, Mode, MatchKind)
  hardware/       détection locale (win.rs ; linux.rs préparé) + classification explicable (mod.rs)
  platform.rs     système hôte : localisation Windows / Linux (XDG, Flatpak) préparée
  providers/      trait Provider + Cache ; emuready.rs ; community.rs (iNetbox) ; verified.rs (profils vérifiés iBox)
  verified/       profiles.json : profils « Vérifié par iBox » embarqués (vide)
  autotune.rs     fondations d'AutoTune : types de mesures, trait de collecteur (aucune collecte)
  contribute.rs   contribution à la communauté (aperçu exact, publication, votes, signalements)
  validation.rs   liste blanche, types, plages, contrôles matériels
  recommend.rs    moteur déterministe
  adapters/       trait Adapter ; common.rs (trait Doc, INI, bases YAML) ; dolphin.rs, pcsx2.rs, duckstation.rs,
                  ppsspp.rs, rpcs3.rs, azahar.rs, retroarch.rs
  disc.rs         lecture seule d'une image PS2 (SYSTEM.CNF, ELF, CRC) pour PCSX2
  ini.rs          édition ciblée des INI (séparateur `clé=valeur` conservé, style QSettings)
  yaml.rs         édition ciblée du YAML à deux niveaux de RPCS3 (formes inattendues refusées)
  cfg.rs          édition ciblée des `.cfg` de RetroArch (clés en double refusées)
  backup.rs       garde-fous de chemin, écriture atomique, sauvegardes, journal, reprise
  storage.rs      contexte du jeu, cache, retours d'expérience (SQLite)
  commands.rs     commandes Tauri
  fixtures/       réponses EmuReady réelles nettoyées (aucune donnée de contributeur)
```

Le cœur (`model`, `validation`, `recommend`, `ini`, `backup`) n'utilise rien de propre à Windows. Ce qui l'est : `hardware/win.rs` (DXGI, Direct3D, GDI, registre en lecture) et la localisation des dossiers dans chaque adaptateur. Linux/SteamOS : `hardware/linux.rs` est écrit, `platform::locate` appelle `Adapter::locate_unix` (refus par défaut) ; Android : voir §16.2.

### Flux

```
fiche du jeu → smartconfig_status (local, instantané)
            → smartconfig_recommend (à la demande) : fournisseurs → profils normalisés → validation → classement
            → smartconfig_preview : aperçu exact (fichier, avant/après, paramètres écartés)
            → smartconfig_apply : revalidation → sauvegarde → journal « pending » → écriture atomique → relecture → « applied »
            → smartconfig_restore : vérif. empreintes → état d'origine (contenu ou absence)
```

## 3. Détection matérielle

Collectée localement, à la demande, mise en mémoire pour la session (`smartconfig_hardware`, `refresh` pour relancer) :

| Donnée | Source | Si indisponible |
|---|---|---|
| Processeur (nom, constructeur), cœurs, fils | sysinfo | `None` |
| RAM | sysinfo | `None` |
| Système, architecture | sysinfo, `std::env::consts::ARCH` | — |
| GPU (tous), constructeur (ID PCI), VRAM dédiée, logiciel ou non | DXGI `EnumAdapters1` | liste vide |
| Version du pilote | DXGI `CheckInterfaceSupport` | `None` |
| Intégré / dédié | nom + constructeur (la VRAM d'un iGPU est une réservation BIOS) | `None` |
| D3D11, D3D12 | création réelle d'un périphérique sur le GPU principal | `None` |
| Vulkan | présence du chargeur `vulkan-1.dll` (nécessaire, pas suffisant) | `None` |
| OpenGL | **non vérifié** (opengl32.dll ne dit rien du pilote) | toujours `None` |
| Écran principal, fréquence | `EnumDisplaySettingsW` | — |
| Type d'appareil | modèle BIOS (consoles portables connues) puis batterie | `Unknown` |
| Plusieurs GPU | DXGI | — |

Jamais collectés : numéros de série, adresses MAC, identifiants uniques. `PublicSummary` (système, architecture, CPU, GPU principal, RAM arrondie au Go, type d'appareil) est la seule vue prévue pour un partage, après aperçu.

**Classification** (`classify`) : paliers `Entry/Mid/High/Unknown` séparés pour CPU et GPU, chacun avec ses raisons lisibles. Elle croise fils d'exécution, type de GPU (intégré/dédié), VRAM *seulement pour un GPU dédié*, type d'appareil. Une donnée manquante donne `Unknown`, jamais une supposition. Ces paliers ne servent qu'à pondérer (ex. pénalité du mode Qualité sur un GPU modeste).

## 4. Fournisseurs

Interface commune (`providers::Provider`) : `supports(emulateur, console)`, `fetch(jeu, émulateur, cache) → Fetched { profiles, matched, stale }`. Chaque fournisseur peut être désactivé : la commande `smartconfig_recommend` reçoit la liste des sources activées.

Champs conservés pour chaque profil : source, identifiant d'origine, lien public, nature (`configuration` ou `report`), émulateur, version, fork, jeu tel que nommé par la source, matériel de référence, performance rapportée (échelle de la source), réglages normalisés, champs écartés avec raison, notes (500 car. max), votes, vérification développeur, dates.

### 4.1 EmuReady

Vérifié le 2026-11-17 (spécification OpenAPI + appels réels) :

- base `https://www.emuready.com/api/mobile/trpc/`, requêtes **GET** `procédure?input=` + `{"json":{…}}` encodé ; réponse `{"result":{"data":{"json":…}}}` ; erreur `{"error":{"json":{message,…}}}` ;
- **sans compte ni clé** pour la lecture ; une clé `x-api-key` existe pour l'attribution/quotas (non utilisée, aucune clé dans iBox) ;
- quota annoncé : `x-ratelimit-limit: 100` par fenêtre de 180 s ; `Cache-Control: private, no-store` ;
- `games.searchGames` → `listings.byGame` (rapports « appareil », surtout Android, **sans réglages**) → `listings.byId` (réglages dans `customFieldValues`) ; `pcListings.get` (rapports PC : performance, CPU/GPU, **aucun réglage**) ;
- `listings.getEmulatorConfig` ne couvre qu'Azahar/Eden/GameNative (Android) : inutile pour Windows ;
- champs Dolphin réels : `graphics_backend`, `internal_resolution`, `enable_dual_core`, `dsp_emulator`, `shader_compilation`, `anti_aliasing`, `anisotropic_filtering`, `vsync`, `skip_efb_access`, `ignore_format_changes` (+ version, fork, pilote, FPS moyen) ;
- définitions des champs de PCSX2, DuckStation et PPSSPP relevées par `customFieldDefinitions.getByEmulator` (libellés exacts des options, voir ci-dessous).

Comportement d'iBox :

| Règle | Mise en œuvre |
|---|---|
| À la demande uniquement | aucun appel au démarrage ni en tâche de fond |
| Données envoyées | le titre du jeu (sans mentions de région), puis des identifiants EmuReady ; jamais la bibliothèque, ni chemin, ni matériel |
| Correspondance | même système + titre normalisé identique ; plusieurs fiches au même titre → abstention |
| Coût | ≤ 9 requêtes la première fois pour un jeu (1 recherche, 1 liste, 6 détails, 1 liste PC), 0 ensuite (cache) |
| Limitation | 30 requêtes / 180 s imposées localement ; une seule recherche à la fois (déduplication par le cache) |
| Délais | connexion 8 s, total 15 s ; corps ≤ 2 Mo |
| Erreurs | réseau/5xx : 3 essais, attente exponentielle (0,5 s, 1 s) ; 4xx : arrêt ; **429 : arrêt immédiat, `Retry-After` respecté** (60 s par défaut) |
| Cache | SQLite `sc_cache`, **profils normalisés uniquement** ; jeu 7 j, profils 1 j, résultat partiel 10 min ; 2 000 entrées max ; vidable |
| Hors ligne | cache expiré servi et signalé (`stale`) ; sans cache : erreur claire, le jeu reste jouable |
| Contributeurs | auteurs, e-mails, avatars, scores de confiance **jamais conservés** |

Normalisation (libellé EmuReady exact → valeur typée ; toute chaîne inattendue, valeur décimale ou hors plage → écartée avec sa raison) :

- **Dolphin** : `OpenGL ES (Android)`, `Metal (macOS)` → écartés ; `anisotropic_filtering` → écarté (l'échelle EmuReady ne dit pas s'il s'agit du multiplicateur ou de l'exposant) ; `anti_aliasing = Other` → écarté.
- **PCSX2** : `renderer`, `internal_resolution` (1–8), `aspect_ratio`, `texture_filtering`, `anti_aliasing` (FXAA), `anti_blur`, `ee_cyclerate` (−3…3), `vu_cycle_stealing` (ancien nom de « EE Cycle Skipping », 0–3) ; `deinterlacing` : seul « Automatic » est transposé (`Weave`/`Bob`/`Blend` ne disent pas la trame, « Native Progressive Scan » n'a pas d'équivalent) ; `anisotropic_filtering` écarté (ambigu).
- **DuckStation** : `renderer`, `internal_resolution` (1–16), `texture_filtering`, `anti_aliasing` (`Nx MSAA`/`Nx SSAA` → échantillons + suréchantillonnage), `pgxp_geometry`, `pgxp_texture`, `widescreen_hack`, `cpu_overclock` (%), `cdrom_*_speedup` (1–6 ; 0 « maximum » écarté), `vsync`, `recompiler` (le nom du mode fait foi) ; `gpu_overclock` (sans équivalent), `audio_backend` (propre à l'ordinateur), `memory_card_type` (sauvegardes) → toujours écartés.
- **RPCS3** : `renderer`, `resolution_scale` (25–800 %), `anisotropic_filter` (« Automatic » → 0, sinon le multiplicateur, que RPCS3 stocke tel quel), `frame_limit` (Off/30/60/Auto), `spu_threads` (0–6), `spu_block_size` ; `vsync` : seul « faux » est transposé (« vrai » ne dit pas adaptatif ou complet) ; `anti_aliasing` (FXAA/SMAA, sans équivalent) écarté.
- **Azahar** (rapports surtout Android) : `graphics_api` (`OpenGLES` écarté), `internal_resolution` (`auto` → 0, `native` → 1, 2–10), `texture_filter`, `linear_filtering`, `accurate_multiplication`, `disk_shader_cache`, SPIR-V, compilation asynchrone, shaders matériels, `enable_vsync` ; `cpu_jit` et `delay_start_with_lle_modules` (réglages globaux, pas par jeu), `delay_game_render_thread` (unité non précisée), `stereoscopic_3d_mode` (dépend de l'écran) écartés.
- **RetroArch** : `video_driver`, `vsync`, `hard_gpu_sync`, `gpu_sync_frames` (0–3), `frame_delay` (0–15), `rewind` ; `run_ahead` (dépend du cœur ; le champ `core` du rapport est un texte libre, jamais comparé) et `video_scale` (fenêtre) écartés. EmuReady ne rattache RetroArch qu'à N64, DS, PSP, PS1 et Windows : seuls les jeux PS1 peuvent en recevoir.
- Champs relevés mais **sans adaptateur** : Cemu, melonDS, Flycast (voir §6.8). mGBA n'existe pas chez EmuReady.
- **PPSSPP** : `rendering_resolution` (0 = auto, 1–10), `software_rendering`, `msaa`, `vsync`, `texture_filtering`, `lower_resolution_effects`, `fast_memory` ; `texture_scaling` : « Off » → niveau 1, sinon seule la méthode (le niveau n'est pas précisé) ; `backend` (réglage global, pas par jeu), `frame_skipping` (sens dépendant d'un autre réglage), `anisotropic_filtering` (ambigu), `multithreaded` (retiré de PPSSPP) → écartés.

**Attribution** : la mention apparaîtra dans Paramètres › SmartConfig › Sources de données (`smartconfig_providers` : nom, site, docs, conditions, ce qui est reçu et envoyé). Aucun logo ni « Powered by ». Aucun partenariat n'est annoncé.

### 4.2 Fournisseurs prévus

`SourceId::Community` : iBox SmartConfig Community, voir §13. `SourceId::Verified` : profils « Vérifié par iBox » livrés avec l'application, voir §17. Réservé : `Official` (recommandations des émulateurs). Ajouter un fournisseur : §12.

## 5. Moteur de recommandation

Déterministe, sans IA, testé (`recommend.rs`). Pour chaque profil de type *configuration* :

1. **Barrières**, jamais compensées : autre émulateur, profil que **vous** avez appliqué puis jugé « ne fonctionne pas » avec cette version de l'émulateur (ou version inconnue), ou rapport d'échec (rang ≥ 5 : « Ingame », « Intro », « Loadable », « Nothing ») → `Incompatible` ; aucun paramètre valide → `Insufficient`.
2. **Catégorie** : fork non officiel, autre architecture/système, votes majoritairement négatifs (≥ 3 votes) ou échec que vous avez signalé avec une **autre** version de l'émulateur → `Experimental` ; ≥ 2 indices de proximité matérielle (même OS, même architecture, GPU du même constructeur) et jeu identifié par **numéro de série** → `Exact` ; ≥ 2 indices → `SimilarHardware` ; sinon `Generic`.
3. **Score** (ordre à catégorie égale), chaque point justifié dans `reasons` :

| Critère | Points |
|---|---|
| Performance rapportée Perfect / Great / Playable / Poor | 40 / 32 / 22 / 8 |
| Rapport ≤ 6 mois / ≤ 1 an | +10 / +5 |
| Même OS / même architecture / même constructeur de GPU | +10 / +8 / +5 |
| Autre type d'appareil | −10 |
| Votes nets (plafonnés) | −10 … +10 |
| Vérifié par un développeur de l'émulateur | +8 |
| Vérifié par iBox (§17) | +12 |
| Votre retour : échec avec une autre version / ralentissements ou défauts d'image / a bien fonctionné | −20 / −15 / +5 |
| Même version de l'émulateur / version inconnue | +6 / −2 |
| Fork non officiel / avis négatifs | −8 / −10 |
| Réglage à risque élevé / moyen | −10 / −3 |
| Paramètres écartés par la validation | −1 chacun (max −6) |
| Mode préféré | +6 |
| Mode Qualité sur GPU modeste | −8 |

**Modes** : déduits des réglages réels par l'adaptateur (Dolphin : résolution interne ≥ 3×, MSAA ≥ 4 ou SSAA → Qualité ; 1× sans anticrénelage → Performance ; sinon Équilibré. PCSX2 : ≥ 3× Qualité, 1× Performance. DuckStation : ≥ 4× ou MSAA ≥ 4 Qualité, 1× sans MSAA Performance. PPSSPP : ≥ 4× Qualité, 1–2× Performance, « auto » indéterminé). `best_by_mode` ne contient que les modes réellement disponibles : jamais trois profils artificiels. Mode `Manual` : aucune suggestion.

**Suggestion** : meilleure configuration utilisable (`Exact`/`SimilarHardware`/`Generic`) du mode préféré, sinon la meilleure utilisable ; aucune si seules des configurations expérimentales existent → « aucune recommandation suffisamment fiable », réglages actuels conservés.

**Retours locaux** (`storage::local_feedback`) : pour chaque profil appliqué à ce jeu par cet adaptateur (optimisation `applied` ou `restored`), le **dernier** retour avec au moins une réponse ; relié au profil par source et identifiant. La recommandation porte `local` (`failed`, `failedOtherVersion`, `issues`, `worked`), la raison s'affiche dans « Pourquoi ce classement » et une pastille sur la carte et le détail. Rien n'est envoyé.

**Application automatique** (désactivée par défaut, phase 4) : seulement `Exact`/`SimilarHardware`, jeu identifié **par numéro de série**, tous les paramètres à risque faible, performance Great ou Perfect, aucun retour négatif de votre part. EmuReady n'identifie les jeux que par titre : **ses profils ne sont donc jamais applicables automatiquement.**

Aucun FPS, pourcentage ou benchmark n'est produit par iBox. Les performances affichées sont celles rapportées par la source, avec son libellé.

## 6. Adaptateurs

Interface `adapters::Adapter` : `id`, `platforms`, `specs` (liste blanche), `locate` (dossier de configuration, portable ou non, version), `game_key` (identifiant tel que l'émulateur le calcule ; reçoit un `KeyContext` : installation, dossier localisé, fichier principal du jeu en **lecture seule**, jamais transmis à un fournisseur ; renvoie la raison en cas d'échec, affichée par `smartconfig_status`), `target` (racine autorisée, dossier écrivable, fichier), `read`, `builtin_overrides` (correctifs livrés à préserver), `render` (modification ciblée), `mode_of`. Les étapes communes (`plan`, `verify`) et les garde-fous (`backup`) sont partagés ; un émulateur sans adaptateur n'est pas pris en charge (pas d'écrivain générique).

### 6.1 Dolphin

Vérifié dans le code source de Dolphin : `MainSettings.cpp`, `GraphicsSettings.cpp`, `GameConfigLoader.cpp`, `UICommon::SetUserDirectory`.

- Dossier utilisateur : `portable.txt` à côté du programme → `<exe>\User` ; sinon registre `HKCU\Software\Dolphin Emulator` (`LocalUserConfig`, `UserConfigPath`, lecture seule) ; sinon `Documents\Dolphin Emulator` s'il existe ; sinon `%APPDATA%\Dolphin Emulator`. Dossier absent → « lancez Dolphin une fois ».
- Fichier : `<User>\GameSettings\<ID>.ini`, ID de 6 caractères (4 pour WiiWare), `[A-Z0-9]` uniquement. C'est la couche « réglages du jeu par l'utilisateur » : seules les clés présentes remplacent la configuration globale.
- Correctifs intégrés : si `Sys\GameSettings\<ID3>.ini` ou `<ID>.ini` fixe déjà une clé, SmartConfig ne la touche pas.

| Clé SmartConfig | Section / clé INI | Valeurs | Risque |
|---|---|---|---|
| `dolphin.gfx_backend` | `Core` / `GFXBackend` | `Vulkan`, `D3D`, `D3D12`, `OGL` (refusé si l'API n'est pas vérifiée présente) | élevé |
| `dolphin.cpu_thread` | `Core` / `CPUThread` | `True`/`False` | moyen |
| `dolphin.dsp_hle` | `Core` / `DSPHLE` | `True`/`False` | faible |
| `dolphin.internal_resolution` | `Video_Settings` / `InternalResolution` | 1–8 | faible |
| `dolphin.msaa` | `Video_Settings` / `MSAA` | 1, 2, 4, 8 | faible |
| `dolphin.ssaa` | `Video_Settings` / `SSAA` | `True`/`False` | faible |
| `dolphin.shader_compilation` | `Video_Settings` / `ShaderCompilationMode` | 0 spécialisé, 1 ubershaders exclusifs, 2 hybrides, 3 sans rendu | faible |
| `dolphin.vsync` | `Video_Hardware` / `VSync` | `True`/`False` | faible |
| `dolphin.efb_access_enable` | `Video_Hacks` / `EFBAccessEnable` | `True`/`False` | moyen |
| `dolphin.efb_emulate_format_changes` | `Video_Hacks` / `EFBEmulateFormatChanges` | `True`/`False` | moyen |

Jamais touchés : manettes, chemins (ISO, sauvegardes, NAND), cartes mémoire, codes (`$`, `+`, `*` sont ignorés à la lecture et conservés), fichiers globaux (`Dolphin.ini`, `GFX.ini`).

### 6.2 PCSX2

Vérifié dans le code source de PCSX2 (Qt, 2026-11-17) : `Pcsx2Config.cpp` (`EmuFolders::SetDataDirectory`, `GSOptions::LoadSave`, `SpeedhackOptions::LoadSave`), `VMManager.cpp` (`GetGameSettingsPath`, `UpdateGameSettingsLayer`), `CDVD/CDVD.cpp`, `CDVD/IsoReader.cpp`, `CDVD/InputIsoFile.cpp`, `Elfheader.cpp`, `GameDatabase.cpp`.

- Dossier de données : `portable.ini` ou `portable.txt` à côté du programme → dossier du programme (ou sous-dossier relatif écrit dans `portable.txt` ; chemin absolu refusé) ; sinon `Documents\PCSX2`. `inis\` absent → « lancez PCSX2 une fois ». `[Folders] GameSettings` personnalisé dans `inis\PCSX2.ini` → refusé.
- Fichier : `gamesettings\<SERIAL>_<CRC>.ini` ; si seul l'ancien `<CRC>.ini` existe, c'est lui (PCSX2 ne lit l'ancien nom que si le nouveau manque) ; numéro de série non conforme sur le disque → `<CRC>.ini`, comme PCSX2.
- **CRC** (`disc.rs`) : image non compressée (`.iso`, `.bin`, `.img`, géométries 2048/2336/2352/2448 et Nero) → ISO 9660 → `SYSTEM.CNF` → dernière ligne `BOOT2` → ELF (≤ 32 Mo) → OU exclusif des mots de 32 bits. Le numéro de série est aussi tiré de `BOOT2` (`SLUS_203.12` → `SLUS-20312`). CRC nul → pas de réglages par jeu (PCSX2 n'en charge pas).
- **Repli** (CHD, CSO, archive, fichier absent) : le seul fichier `gamesettings\<SERIAL>_XXXXXXXX.ini` déjà présent pour le numéro de série iBox ; aucun ou plusieurs → « identifiant introuvable », jamais deviné.
- Correctifs intégrés (`resources\GameIndex.yaml`) : `speedHacks: eeCycleRate` remplace le réglage utilisateur, `gsHWFixes: deinterlace` s'applique en mode automatique → `ee_cyclerate` et `deinterlacing` jamais écrits pour ces jeux.

| Clé SmartConfig | Section / clé INI | Valeurs | Risque |
|---|---|---|---|
| `pcsx2.renderer` | `EmuCore/GS` / `Renderer` | Vulkan 14, D3D11 3, D3D12 15, OpenGL 12, logiciel 13 (API vérifiée) | élevé |
| `pcsx2.upscale_multiplier` | `EmuCore/GS` / `upscale_multiplier` | 1–8 | faible |
| `pcsx2.aspect_ratio` | `EmuCore/GS` / `AspectRatio` | `Stretch`, `Auto 4:3/3:2`, `4:3`, `16:9` | faible |
| `pcsx2.texture_filtering` | `EmuCore/GS` / `filter` | 0 plus proche, 1 bilinéaire forcé, 2 bilinéaire PS2, 3 forcé sauf sprites | faible |
| `pcsx2.anisotropic_filtering` | `EmuCore/GS` / `MaxAnisotropy` | 0, 2, 4, 8, 16 | faible |
| `pcsx2.fxaa` | `EmuCore/GS` / `fxaa` | `true`/`false` | faible |
| `pcsx2.pcrtc_antiblur` | `EmuCore/GS` / `pcrtc_antiblur` | `true`/`false` | faible |
| `pcsx2.deinterlacing` | `EmuCore/GS` / `deinterlace_mode` | 0 auto … 9 (`GSInterlaceMode`) | faible |
| `pcsx2.ee_cyclerate` | `EmuCore/Speedhacks` / `EECycleRate` | −3…3 | moyen |
| `pcsx2.ee_cycleskip` | `EmuCore/Speedhacks` / `EECycleSkip` | 0–3 | moyen |

### 6.3 DuckStation

Vérifié dans le code source de DuckStation (2026-11-17) : `core/core.cpp`, `core/settings.cpp` (`Settings::Load/Save`, `EmuFolders::LoadConfig`), `core/system.cpp` (`GetGameSettingsPath`, `GetGameSettingsInterface`), `core/game_database.cpp` (`Entry::ApplySettings`, disc sets).

- Dossier : `portable.txt` ou `settings.ini` à côté du programme → dossier du programme ; sinon `Documents\DuckStation` s'il existe ; sinon `%LOCALAPPDATA%\DuckStation`. `settings.ini` absent → « lancez DuckStation une fois ». `[Folders] GameSettings` personnalisé → refusé.
- Fichier : `gamesettings\<SERIAL>.ini` (numéro de série iBox `AAAA-NNNNN` lu dans `SYSTEM.CNF`) ; jeu à plusieurs disques : fichier du **premier disque** (`resources\discsets.yaml`, illisible → refus), sauf `[Main] UseSeparateConfigForDiscSet = true` dans ce fichier.
- Correctifs intégrés (`resources\gamedb.yaml`) : traits `ForceInterpreter`, `ForceSoftwareRenderer`, `DisableUpscaling`, `DisableTextureFiltering`, `DisableWidescreen`, `DisablePGXP`, `DisablePGXPTextureCorrection`, `DisableCDROMReadSpeedup`, `DisableCDROMSeekSpeedup`, réglage `cpuOverclockPercent` → paramètres correspondants jamais écrits.

| Clé SmartConfig | Section / clé INI | Valeurs | Risque |
|---|---|---|---|
| `duckstation.renderer` | `GPU` / `Renderer` | `Vulkan`, `D3D11`, `D3D12`, `OpenGL`, `Software` (API vérifiée) | élevé |
| `duckstation.resolution_scale` | `GPU` / `ResolutionScale` | 1–16 | faible |
| `duckstation.texture_filter` | `GPU` / `TextureFilter` | `Nearest`, `Bilinear`, `BilinearBinAlpha`, `JINC2`, `JINC2BinAlpha`, `xBR`, `xBRBinAlpha` | faible |
| `duckstation.msaa` / `ssaa` | `GPU` / `Multisamples`, `PerSampleShading` | 1, 2, 4, 8, 16 / `true`/`false` | faible |
| `duckstation.pgxp` | `GPU` / `PGXPEnable` | `true`/`false` | moyen |
| `duckstation.pgxp_texture_correction` | `GPU` / `PGXPTextureCorrection` | `true`/`false` | faible |
| `duckstation.widescreen_hack` | `GPU` / `WidescreenHack` | `true`/`false` | moyen |
| `duckstation.cpu_execution_mode` | `CPU` / `ExecutionMode` | `Interpreter`, `CachedInterpreter`, `Recompiler` | moyen |
| `duckstation.cpu_overclock` | `CPU` / `OverclockEnable` + `OverclockNumerator` + `OverclockDenominator` | 10–1000 % (fraction réduite comme DuckStation ; 100 % → `OverclockEnable = false`) | élevé |
| `duckstation.cdrom_read_speedup` / `seek_speedup` | `CDROM` / `ReadSpeedup`, `SeekSpeedup` | 1–6 | moyen |
| `duckstation.vsync` | `Display` / `VSync` | `true`/`false` | faible |

### 6.4 PPSSPP

Vérifié dans le code source de PPSSPP (2026-11-17) : `Windows/main.cpp` (carte mémoire), `Core/Util/PathUtil.cpp` (`GetSysDirectory`, `GetGameConfigFilePath`), `Core/Config.cpp` (`LoadGameConfig`, `SaveGameConfig`, réglages `PER_GAME`), `Core/KeyMap.cpp` (`LoadFromIni`), `Core/PSPLoaders.cpp` (`DISC_ID`).

- Carte mémoire : `installed.txt` à côté du programme (installations iBox) → chemin de sa première ligne, ou `Documents\PPSSPP` si elle est vide ; sinon `<programme>\memstick`. `PSP\SYSTEM` absent → « lancez PPSSPP une fois ».
- Fichier : `<memstick>\PSP\SYSTEM\<DISC_ID>_ppsspp.ini`, `DISC_ID` de `PARAM.SFO` (`ULUS10041` ; `ULUS-10041` venu d'un nom de fichier est accepté).
- **Jamais de création** : `KeyMap::LoadFromIni` remet les commandes **par défaut** quand le fichier du jeu n'a pas de section `[ControlMapping]`. PPSSPP l'écrit lui-même lors de « Créer une configuration de jeu ». SmartConfig ne modifie donc qu'un fichier existant ; sinon l'aperçu explique comment le créer dans PPSSPP.
- `GraphicsBackend` n'est pas un réglage par jeu : jamais écrit. Pas de correctif intégré sur ces clés (`compat.ini` agit à part).

| Clé SmartConfig | Section / clé INI | Valeurs | Risque |
|---|---|---|---|
| `ppsspp.internal_resolution` | `Graphics` / `InternalResolution` | 0 auto, 1–10 | faible |
| `ppsspp.software_rendering` | `Graphics` / `SoftwareRenderer` | `True`/`False` | élevé |
| `ppsspp.msaa` | `Graphics` / `MultiSampleLevel` | 1, 2, 4, 8, 16 (écrit en exposant 0–4) | faible |
| `ppsspp.vsync` | `Graphics` / `VerticalSync` | `True`/`False` | faible |
| `ppsspp.texture_filtering` | `Graphics` / `TextureFiltering` | 1 auto, 2 plus proche, 3 linéaire, 4 auto qualité max | faible |
| `ppsspp.anisotropic_filtering` | `Graphics` / `AnisotropyLevel` | 0, 2, 4, 8, 16 (exposant) | faible |
| `ppsspp.texture_scaling_type` | `Graphics` / `TexScalingType` | 0 xBRZ, 1 hybride, 2 bicubique, 3 hybride + bicubique | faible |
| `ppsspp.texture_scaling_level` | `Graphics` / `TexScalingLevel` | 1 (désactivé) – 5 | faible |
| `ppsspp.lower_resolution_effects` | `Graphics` / `BloomHack` | 0–3 | faible |
| `ppsspp.fast_memory` | `CPU` / `FastMemoryAccess` | `True`/`False` | moyen |

### 6.5 RPCS3

Vérifié dans le code source de RPCS3 (2026-11-17) : `Utilities/File.cpp` (`fs::get_config_dir`), `Emu/system_utils.cpp` (`get_custom_config_path`), `Emu/System.cpp` (`Emulator::Load`, mode `custom`), `Utilities/Config.cpp` (`cfg::decode` non strict), `Emu/system_config.h`, `system_config_types.cpp`, `rpcs3qt/config_database.cpp`, `rpcs3qt/settings.cpp`.

- Dossier : `<programme>\portable\` s'il existe, sinon le dossier du programme (`RPCS3_CONFIG_DIR` défini → refusé). Réglages dans `config\` (`config.yml` absent → « lancez RPCS3 une fois »).
- Fichier : `config\custom_configs\config_<TITLE_ID>.yml`, YAML appliqué par-dessus la configuration globale (clé absente = valeur globale, clé inconnue ignorée). `TITLE_ID` = numéro de série iBox sans tiret (`BLUS-30443` → `BLUS30443`) : le scanner ne lit pas encore `PARAM.SFO` des images PS3, il vient donc du nom du fichier (`(BLUS-30443)`).
- **Base de configurations de RPCS3** (`GuiConfigs\config_database.dat`) : appliquée seulement s'il n'existe aucun fichier personnalisé. Si le jeu y figure et qu'aucun fichier n'existe, SmartConfig **refuse de créer** le fichier (il désactiverait ces correctifs) et explique comment créer la configuration dans RPCS3. Base illisible (trop grande) → refus ; JSON invalide → ignorée, comme par RPCS3.
- `<jeu>.yml` à côté du fichier du jeu : prioritaire pour RPCS3 → refus.
- Éditeur `yaml.rs` : ne modifie que des lignes `  Clé: valeur` du premier sous-niveau ; style « flux », tabulations, documents multiples, ancres, clés en double → refus. Valeurs écrites sans guillemets, alphabet restreint.

| Clé SmartConfig | Section / clé YAML | Valeurs | Risque |
|---|---|---|---|
| `rpcs3.renderer` | `Video` / `Renderer` | `Vulkan`, `OpenGL` (API vérifiée) | élevé |
| `rpcs3.resolution_scale` | `Video` / `Resolution Scale` | 25–800 (%) | faible |
| `rpcs3.anisotropic_filter` | `Video` / `Anisotropic Filter Override` | 0 (auto), 2, 4, 8, 16 | faible |
| `rpcs3.vsync` | `Video` / `VSync Mode` | `Disabled`, `Adaptive`, `Full` | faible |
| `rpcs3.frame_limit` | `Video` / `Frame limit` | `Off`, `30`, `50`, `60`, `Auto`, `PS3 Native` | moyen |
| `rpcs3.spu_block_size` | `Core` / `SPU Block Size` | `Safe`, `Mega`, `Giga` | moyen |
| `rpcs3.preferred_spu_threads` | `Core` / `Preferred SPU Threads` | 0 (auto) – 6 | moyen |

Mode : ≥ 200 % Qualité, ≤ 100 % Performance, sinon Équilibré.

### 6.6 Azahar

Vérifié dans le code source d'Azahar (2026-11-17) : `src/common/file_util.cpp` (`SetUserPath`), `common_paths.h`, `src/citra_qt/configuration/config.cpp` (`QtConfig`, `ReadGlobalSetting`, `WriteGlobalSetting`), `src/citra_qt/citra_qt.cpp` (`BootGame`), `src/common/settings.h`, `CMakeModules/GenerateSettingKeys.cmake`.

- Dossier : `<programme>\user` s'il existe (portable), sinon `%APPDATA%\Azahar` ; réglages dans `config\` (`qt-config.ini` absent → « lancez Azahar une fois »).
- Fichier : `config\custom\<ID>.ini`, `ID` = identifiant de programme sur 16 chiffres hexadécimaux. iBox ne le stocke pas (son numéro de série 3DS est le code produit `CTR-P-XXXX`) : il est lu **en local, en lecture seule**, dans l'en-tête du fichier du jeu (NCSD → NCCH de la partition 0, ou NCCH ; champ `program_id`), comme `ReadProgramId`. `.cia`, `.3dsx`, formats compressés `.z*` → non pris en charge.
- Format QSettings : `nom\use_global=false` + `nom=valeur` ; une valeur n'est considérée appliquée que si `use_global` vaut `false`. En mode par jeu, Azahar ne lit ni manettes, ni caméra, ni chemins : créer le fichier ne touche à rien d'autre. Séparateur `clé=valeur` du fichier conservé.

| Clé SmartConfig | Groupe / clé | Valeurs | Risque |
|---|---|---|---|
| `azahar.graphics_api` | `Renderer` / `graphics_api` | 0 logiciel, 1 OpenGL, 2 Vulkan (API vérifiée) | élevé |
| `azahar.resolution_factor` | `Renderer` / `resolution_factor` | 0 (fenêtre), 1–10 | faible |
| `azahar.texture_filter` | `Renderer` / `texture_filter` | 0 aucun, 1 Anime4K, 2 bicubique, 3 ScaleForce, 4 xBRZ, 5 MMPX | faible |
| `azahar.async_shader_compilation`, `disk_shader_cache`, `accurate_mul`, `vsync`, `spirv_shader_gen`, `disable_spirv_optimizer` | `Renderer` / `async_shader_compilation`, `use_disk_shader_cache`, `shaders_accurate_mul`, `use_vsync`, `spirv_shader_gen`, `disable_spirv_optimizer` | `true`/`false` | faible |
| `azahar.hw_shader` | `Renderer` / `use_hw_shader` | `true`/`false` | moyen |
| `azahar.linear_filtering` | `Layout` / `filter_mode` | `true`/`false` | faible |

Mode : ≥ 3× Qualité, 1× Performance, 2× Équilibré, 0 indéterminé.

### 6.7 RetroArch

Vérifié dans le code source de RetroArch v1.22.2 : `configuration.c` (`config_load_override`, chargement de `retroarch.cfg`, noms des clés), `file_path_special.c` (`APPLICATION_SPECIAL_DIRECTORY_CONFIG`), `config.def.h` (`MAXIMUM_HARD_SYNC_FRAMES`).

- `retroarch.cfg` : à côté du programme, sinon `%APPDATA%\RetroArch`. Dossier des surcharges : `rgui_config_directory` (`:\config` par défaut, `:` = dossier du programme) ou, s'il est vide, le dossier de `retroarch.cfg` ; chemin personnalisé absolu → refusé.
- Fichier : `<config>\<library_name>\<nom du contenu sans extension>.cfg`, la **surcharge de jeu**, chargée après celles du cœur et du dossier ; seules les clés présentes changent.
- `library_name` est déclaré par le cœur, pas par le nom de la DLL : seuls les cœurs vérifiés dans leur code sont pris en charge — `genesis_plus_gx` (« Genesis Plus GX »), `mednafen_saturn` (« Beetle Saturn »), `fbneo` (« FinalBurn Neo »), `play` (« Play! »), `pcsx_rearmed` (« PCSX-ReARMed »), `yabause` (« Yabause »). Le cœur est celui qu'iBox utilise pour la console du jeu (`emulators.cores`, nouveau champ `Install.core`).
- L'identifiant est le nom du fichier du jeu : il peut contenir espaces, parenthèses, accents ; caractères interdits par Windows, caractères de contrôle, `..`, point ou espace final → refus.
- Éditeur `cfg.rs` : `clé = "valeur"`, commentaires et `#include` conservés ; fichier avec une clé en double → refus.

| Clé SmartConfig | Clé `.cfg` | Valeurs | Risque |
|---|---|---|---|
| `retroarch.video_driver` | `video_driver` | `vulkan`, `gl`, `d3d11`, `d3d12` (API vérifiée) | élevé |
| `retroarch.vsync` | `video_vsync` | `true`/`false` | faible |
| `retroarch.hard_sync` / `hard_sync_frames` | `video_hard_sync`, `video_hard_sync_frames` | `true`/`false` / 0–3 | faible |
| `retroarch.frame_delay` | `video_frame_delay` | 0–15 | moyen |
| `retroarch.rewind` | `rewind_enable` | `true`/`false` | moyen |
| `retroarch.run_ahead` | `run_ahead_enabled` + `run_ahead_frames` | 0 (désactivée) – 6 | moyen |

Aucun mode (réglages de latence, pas de qualité d'image). Options des cœurs (`.opt`) jamais touchées : leurs clés changent d'une version de cœur à l'autre.

### 6.8 Émulateurs du catalogue sans adaptateur

Vérifié dans leur code source le 2026-11-17, sauf mention :

| Émulateur | Raison |
|---|---|
| **Cemu** | Le profil utilisateur `gameProfiles\<titleid>.ini` **remplace entièrement** le profil livré `gameProfiles\default\` (`GameProfile::Load`) : en créer un ferait perdre les correctifs. iBox ne connaît pas l'identifiant de titre Wii U (`.wua`/`.wud`/`.wux` compressés ou chiffrés, rien dans `games.serial`). Les champs EmuReady (VSync, cache GPU, filtre, compilation asynchrone) sont des réglages **globaux** (`settings.xml`). |
| **melonDS** | Aucun réglage par jeu : `melonDS.toml` n'a que des sections globales et par instance (`Config.cpp`). |
| **mGBA** | Les « overrides » par jeu se limitent au type de sauvegarde, au matériel de la cartouche et à la boucle d'attente (`gba/overrides.c`), dans le `config.ini` global : touchent aux sauvegardes, hors dossier par jeu. |
| **Flycast** | Réglages par jeu dans une section du fichier global `emu.cfg` (`cfg/option.h`, `gameId`) : écriture hors d'un dossier par jeu interdite ; identifiant Dreamcast non lu par iBox. |
| **RetroArch, autres cœurs** | `library_name` non vérifié (§6.7). |
| SameBoy, Mesen, RMG, xemu, Stella, BigPEmu | Aucun fichier de réglages par jeu officiel connu (non vérifié dans le code). |
| Xenia, Vita3K, shadPS4, MAME | Mécanisme par jeu existant (non vérifié dans le code), mais iBox ne lit aucun identifiant pour ces consoles (pas d'extension reconnue pour Vita, PS4 et arcade ; pas d'en-tête Xbox 360). |

Jamais touchés (tous adaptateurs) : manettes (`[Pad*]`, `[ControlMapping]`…), chemins, BIOS, cartes mémoire, sauvegardes, triches/patchs, fichiers globaux (`PCSX2.ini`, `settings.ini`, `ppsspp.ini`).

## 7. Sécurité

Toute donnée externe est non fiable.

- **Liste blanche** par adaptateur ; type, plage, option fermée ; contrôle matériel (API graphique) ; 64 paramètres maximum ; clé dupliquée → les deux valeurs refusées.
- **Valeurs typées** : aucune chaîne reçue n'est écrite ; l'adaptateur produit lui-même le texte INI (une valeur contenant `\r\n[Core]` est rejetée dès la normalisation).
- **Chemins** (`backup::guard_target`) : extension `.ini`, `.yml` ou `.cfg` seulement ; fichier directement dans le dossier par jeu ; dossier strictement sous la racine de l'émulateur (chemins canoniques comparés) ; aucun composant `..` ; aucun lien symbolique ni jonction à aucun niveau ; cible qui serait un dossier refusée ; taille ≤ 512 Ko.
- **Écriture atomique** : fichier temporaire voisin, `fsync`, renommage ; relecture et comparaison SHA-256 ; échec → état précédent rétabli.
- **Fichiers en cours d'utilisation** : refus si un jeu est lancé par iBox ou si un programme du dossier de l'émulateur tourne.
- **Interdits** : aucune exécution, aucun téléchargement de programme, aucun shell, aucune écriture de registre, aucune écriture hors du dossier par jeu, jamais de ROM, BIOS, firmware, sauvegarde de jeu, manette ou chemin personnel.

## 8. Sauvegarde et restauration

Table `sc_applications` (migration 015, additive) : jeu, adaptateur, version de l'émulateur, fichier, source + identifiant du profil, mode, profil appliqué (JSON), **liste exacte des changements** (clé, libellé, avant, après), empreintes avant/après, copie de sauvegarde, statut (`pending`, `applied`, `failed`, `restored`, `conflict`), dates.

- Avant écriture : sauvegarde de l'état d'origine dans `AppData\…\smartconfig\backups\<id>-<sha>.ini.bak` (ou « fichier absent »), entrée `pending`.
- Restauration : seulement la **dernière** optimisation active d'un fichier (pour remonter plus loin, annuler successivement) ; contenu restauré seulement si la sauvegarde a l'empreinte attendue ; fichier absent à l'origine → supprimé.
- **Modifications manuelles** : si le fichier ne correspond plus à ce qu'iBox a écrit, nouvelle application et restauration sont refusées (`ManualChanges`) jusqu'à confirmation explicite (`force`).
- **Reprise** au démarrage (`backup::recover`) : une entrée `pending` devient `applied` (écriture complète), `failed` (rien écrit) ou `conflict` (état inattendu, à signaler).
- Comparaison avant/après : `changes` de chaque entrée ; historique : `smartconfig_history`.

## 9. Commandes Tauri

| Commande | Rôle |
|---|---|
| `smartconfig_hardware(refresh?)` | matériel + classification |
| `smartconfig_providers()` | sources de données (Paramètres) |
| `smartconfig_status(gameId)` | état local pour la fiche : `unsupported` / `noEmulator` / `noGameId` (+ `reason`) / `ready`, optimisation active, émulateur mis à jour depuis, questionnaire à proposer |
| `smartconfig_recommend(gameId, mode, sources)` | recherche + classement |
| `smartconfig_preview(gameId, profile)` | aperçu exact, rien n'est écrit |
| `smartconfig_apply(gameId, profile, mode?, force)` | application sauvegardée |
| `smartconfig_restore(applicationId, force)` | annulation |
| `smartconfig_history(gameId?)` | historique |
| `smartconfig_cache_clear()` | vider le cache |
| `smartconfig_feedback(…)` | retour après session (local) |
| `smartconfig_community_preview(gameId, draft)` | aperçu exact d'une contribution (corps JSON + empreinte), rien n'est envoyé |
| `smartconfig_community_publish(gameId, draft, digest)` | publie si l'empreinte est celle de l'aperçu |
| `smartconfig_community_profile(profileId)` / `_player(accountId)` | lecture publique (versions, votes, badge) |
| `smartconfig_community_mine()` | mes profils, masqués compris |
| `smartconfig_community_vote(versionId, vote)` / `_unvote` | confirmation + notes 1–5, un vote par compte et par version |
| `smartconfig_community_report(profileId, reason, versionId?, comment?)` | signalement |
| `smartconfig_community_withdraw(profileId)` | retrait (effacement) |

Côté interface : `src/services/smartconfigCommunity.ts` (types et appels, aucun écran).

Le questionnaire après session : au plus une fois par optimisation et une fois par semaine et par jeu (`storage::should_ask_feedback`).

## 10. Limites connues et travail restant

- **PCSX2, images CHD/CSO/ZSO/GZ ou archives** : CRC non calculé (décompression non implémentée) ; seul le repli sur un fichier `gamesettings` existant fonctionne. Image `.cue` (CD PS2 multi-pistes) : idem.
- **DuckStation, jeux PBP (PS1 Classics)** : iBox lit `DISC_ID` sans tiret (`SLUS00594`) ; DuckStation peut nommer le fichier autrement → abstention (« numéro de série dans un format inattendu »).
- **PPSSPP** : nécessite une configuration de jeu créée au préalable dans PPSSPP (voir §6.4) ; homebrew sans `DISC_ID` (identifiant fictif généré par PPSSPP) → non pris en charge.
- **Non vérifié en jeu** (format confirmé par le code source seulement) : CRC PCSX2 sur une vraie image (à comparer au nom du fichier créé par PCSX2 pour le même jeu), prise en compte de `Renderer` par jeu dans PCSX2 et DuckStation, `upscale_multiplier` écrit en entier (`3` au lieu de `3.000000`), surcadençage DuckStation sur une valeur non ronde (ex. 150 % → 3/2), fichier PPSSPP modifié rechargé sans perte des commandes, jeux à plusieurs disques DuckStation.
- **Identification par titre** pour EmuReady (l'API n'expose pas les numéros de série) : jamais d'application automatique de ces profils.
- La majorité des rapports EmuReady avec réglages Dolphin viennent d'appareils Android (souvent des forks) : sur PC Windows, ils sortent généralement en `Experimental`. Les rapports PC n'ont pas de réglages. Il est donc probable que peu de jeux obtiennent une recommandation « fiable » tant que les profils communautaires/vérifiés iBox n'existent pas.
- `GFXBackend` par jeu : chargé par la couche de jeu de Dolphin d'après le code, **non vérifié en jeu**.
- `smartconfig_status` renvoie maintenant `reason` (pourquoi l'identifiant manque) et tourne hors du fil principal (PCSX2 peut lire l'image du jeu).
- **RPCS3** : identifiant seulement s'il figure dans le nom du fichier (`(BLUS-30443)`), le scanner ne lisant pas `PARAM.SFO` des images PS3 ; un jeu présent dans la base de configurations de RPCS3 exige que la configuration personnalisée soit d'abord créée dans RPCS3 ; chemin `m_path` de RPCS3 pour une image ISO non vérifié (seul `<fichier du jeu>.yml` est contrôlé).
- **Azahar** : `.cia`, `.3dsx` et formats compressés non pris en charge ; la plupart des rapports EmuReady viennent d'Android.
- **RetroArch** : six cœurs seulement ; contenu dans une archive : nom de l'archive sans extension (comportement de `path_set_basename`).
- **Non vérifié en jeu** (nouveaux adaptateurs) : prise en compte d'un `config_<ID>.yml` partiel par RPCS3, lecture par Azahar d'un fichier par jeu créé par iBox, surcharge RetroArch dans le dossier « Play! ».
- Détection OpenGL non faite ; Vulkan = chargeur présent seulement. Conséquence : OpenGL est refusé pour RPCS3, Azahar et RetroArch comme pour les autres.
- Pas encore d'interface (phase 4), ni notifications, ni intégration au lancement.

## 11. Ajouter un émulateur

1. Lire dans **son code source** le format et le mécanisme officiel de réglages par jeu ; noter les fichiers dans l'en-tête du module.
2. Créer `adapters/<id>.rs` implémentant `Adapter` (liste blanche avec risques, `locate` portable/classique, `game_key` strict, `valid_key` si l'identifiant sort de `[A-Za-z0-9_-]`, `target` limité au dossier par jeu, `builtin_overrides`, `preflight` pour un refus propre à l'émulateur, `render` ciblé via `common::render_doc` et un éditeur `Doc`, `mode_of`).
3. L'ajouter à `adapters::all()`.
4. Tests : installation portable dans un dossier temporaire, valeurs invalides, correctifs intégrés préservés, lecture/vérification, aucun changement inutile.
5. Si un fournisseur couvre cet émulateur, ajouter la normalisation de ses champs (ex. `dolphin_settings` dans `emuready.rs`).

## 12. Ajouter un fournisseur

1. Vérifier l'API réelle, ses conditions et ses quotas ; refuser toute intégration qui exigerait de contourner une authentification ou de livrer un secret.
2. Implémenter `Provider` (normaliser vers `Profile`, ne conserver aucune donnée personnelle de contributeur, cache via le trait `Cache`, erreurs `ProviderError`).
3. Ajouter un `SourceId` et une `ProviderInfo` (Paramètres › Sources de données).
4. Tests avec des fixtures réelles **nettoyées** (auteurs, e-mails, notes remplacées).

## 13. Communauté iBox SmartConfig (phase 5)

**État : code et tests faits localement (serveur PGlite), rien de déployé.** Conditions de contribution : `docs/SMARTCONFIG-CONTRIBUTIONS.md` (profils publiés sous **CC0 1.0**, décidé le 2026-11-17).

### 13.1 Serveur iNetbox (`services/inetbox/src/smartconfig.ts`, migration **v14** additive)

| Table | Contenu |
|---|---|
| `sc_profiles` | auteur (compte iNetbox), console, **numéro de série du jeu**, titre, émulateur, statut `published`/`hidden` (+ raison `reports`/`moderation`), version vérifiée, dates ; un profil par compte, jeu et émulateur |
| `sc_versions` | n° de version, version de l'émulateur, résumé matériel (OS, architecture, CPU/GPU en texte, RAM en Go, type d'appareil), mode, réglages (JSON canonique trié), performance (`perfect`…`unplayable`), stabilité, problèmes (500 car.), description (1 000 car.) |
| `sc_votes` | un vote par compte **et par version** (clé primaire) : fonctionne oui/non + notes 1–5 stabilité/qualité/performances ; renvoyer remplace |
| `sc_reports` | un signalement par compte et par profil, motif fermé, commentaire 300 car. |
| `sc_moderators` | comptes modérateurs, ajoutés **en SQL uniquement** (aucune route ne l'accorde) |
| `sc_moderation_log` | journal des actions de modération |

Routes (`/v1/smartconfig/…`) : `GET profiles?platform&serial[&emulator]`, `GET profiles/:id`, `GET players/:id/profiles` **sans compte** (60/min par adresse) ; avec compte : `GET mine`, `POST profiles`, `POST profiles/:id/versions` (auteur), `DELETE profiles/:id` (auteur, effacement physique), `PUT|DELETE versions/:id/vote` (pas sur son propre profil), `POST profiles/:id/report` ; modérateurs : `GET moderation/reports`, `GET moderation/profiles/:id`, `POST moderation/profiles/:id` (`hide`, `restore`, `verify`, `unverify`) — 404 pour les autres comptes.

Garde-fous :

- **Même liste blanche typée que les adaptateurs** : `smartconfigSettings.ts` est généré depuis `adapters::all()` (`community::server_whitelist_ts`) ; le test Rust `liste_blanche_serveur_a_jour` échoue s'il diverge (ajouter les clés PCSX2 = régénérer ce fichier). Une seule valeur hors liste, hors type, hors plage, en double ou d'un autre émulateur refuse **toute** la publication (`INVALID_SETTINGS`) ; console non couverte par l'émulateur → `UNSUPPORTED_EMULATOR`.
- **Aucune donnée identifiante** : tout texte (titre, CPU, GPU, problèmes, description, commentaire) contenant chemin, variable d'environnement, e-mail, lien, clé/jeton, JWT, longue suite aléatoire, clé de produit, « Serial: »/« S/N »/HWID, adresse MAC ou IP, UUID, balise HTML ou caractère de contrôle/bidirectionnel est refusé (`UNSAFE_TEXT`). Version d'émulateur : `[A-Za-z0-9 ._+-]`, 40 car.
- **Tailles bornées** : corps 8 Ko (limite globale du service), 64 réglages, textes bornés, RAM entière 1–1 024.
- **Limitation** : lecture publique 60/min/adresse ; écritures 30/min/compte/route (règle existante) ; signalements 10/min ; 20 publications par compte et par 24 h (`DAILY_LIMIT` + `Retry-After`) ; 100 profils par compte, 30 versions par profil.
- **Modération** : masquage automatique au 3ᵉ signalement ouvert (en attente d'examen) ; `hide` résout les signalements, `restore` les classe sans suite ; un profil masqué n'est ni lisible publiquement ni votable ; l'identité des signaleurs n'est jamais renvoyée.
- **Badge « Vérifié par iBox »** : seulement par l'action `verify` d'un modérateur, sur une version précise d'un profil publié ; jamais par les votes ; une nouvelle version ne l'hérite pas ; `hide` le retire.
- Suppression du compte → profils, votes et signalements effacés (cascade).

Tests : `services/inetbox/test/smartconfig.test.ts` (permissions, votes multiples, validation, contenus malveillants, modération, quotas, retrait).

### 13.2 Client

- **Fournisseur** `providers/community.rs` : lecture publique via `inetbox::smartconfig_call` (aucun jeton), seulement si le jeu a un **numéro de série** valide (sinon aucune requête). Cache `Cache` 1 h (profils normalisés), cache expiré servi hors ligne (`stale`). Ancien serveur sans la route → erreur claire, les autres sources continuent. `source_ref` = identifiant de **version**. Performance : échelle à 5 paliers, `unplayable` = rapport d'échec (barrière du moteur). Branché dans `providers::infos()` et `smartconfig_recommend` (source `community`).
- **Moteur** : un profil qui porte le numéro de série exact du jeu est relié par `GameMatch::Serial` (par profil, même si le contexte global est `Title` pour EmuReady) : il peut être `Exact` et, s'il remplit les autres conditions (§5), applicable automatiquement.
- **Contribution** (`contribute.rs`) : `build` produit le corps exact — `PublicSummary` (sans version d'OS, pilote, modèle de carte mère, VRAM), réglages **revalidés** par l'adaptateur et le matériel (les refusés sont listés), observations ; aperçu + empreinte SHA-256 ; la publication reconstruit le corps et refuse s'il diffère de l'aperçu. Erreurs serveur traduites en messages fixes (`inetbox.rs`).
- Le badge et les versions s'affichent via `smartconfig_community_profile` (le modèle `Profile` n'a pas de champ « vérifié par iBox » : `verified_by_developer` reste réservé aux développeurs d'émulateurs).

### 13.3 Ce qui exige un déploiement et l'accord du responsable

1. ~~Licence~~ : CC0 1.0 retenu le 2026-11-17 ; relire `SMARTCONFIG-CONTRIBUTIONS.md` avant l'ouverture.
2. Déployer iNetbox avec la **migration v14** sur Neon (additive, appliquée automatiquement au démarrage) et `smartconfig.ts` ; synchroniser le dépôt privé iNetbox.
3. Désigner les modérateurs (`INSERT INTO sc_moderators` en SQL).
4. Publier une version d'iBox contenant le fournisseur, les commandes et l'interface (phase 4), puis activer la source `community` par défaut ou non.
5. Surveiller le transfert Neon (lecture publique sans compte : limitée à 60/min/adresse, cache client 1 h).

Les profils EmuReady ne sont jamais republiés dans la base iBox. Aucune communauté n'est simulée : sans serveur, la source renvoie une erreur et rien d'autre.

## 14. Confidentialité

Aucune télémétrie. Détection matérielle locale. Profils vérifiés iBox : inclus dans l'application, aucun envoi. Retours après session : locaux, utilisés seulement pour classer. Seul le titre du jeu consulté part vers EmuReady, à la demande. Vers la communauté iBox, à la demande : console, numéro de série du jeu et émulateur (lecture, sans compte ni jeton). Retours d'expérience stockés localement. Aucune contribution publiée sans action explicite, après un aperçu exact du corps envoyé (empreinte vérifiée) ; seul `PublicSummary` du matériel part (jamais version d'OS, pilote, modèle de carte mère, numéros de série matériels, chemins). Votes publiés seulement en totaux ; signaleurs jamais exposés ; retrait = effacement.

## 15. Points à valider avant toute distribution publique

- **Communauté iBox** : licence CC0 retenue ; relecture des conditions de contribution (`SMARTCONFIG-CONTRIBUTIONS.md`) ; déploiement serveur (§13.3) ; choix des modérateurs ; liens `docs`/`terms` de `community::INFO` à confirmer (dépôt public).

- **Conditions EmuReady** : les conditions publiées (https://www.emuready.com/terms) ne mentionnent ni l'API, ni la licence des rapports, ni d'exigence d'attribution ; elles interdisent un usage commercial non autorisé (iBox n'est pas commercial). **Recommandé : prévenir l'équipe EmuReady (GitHub `Producdevity/EmuReady`) avant de publier l'intégration**, et demander une clé d'attribution si elle le souhaite.
- **Constat signalé** : la réponse publique de `pcListings.get` contient l'adresse e-mail des auteurs. iBox ne la lit ni ne la conserve ; il serait correct de le signaler à EmuReady.

## 16. Portages préparés (phase 6) — rien n'est encore porté

iBox reste une application Windows. La phase 6 prépare le terrain **sans développer les portages** : aucun chemin Linux ou Android d'émulateur n'est implémenté, aucune valeur n'est devinée.

### 16.1 Linux, SteamOS, Steam Deck

Fait :

- **Détection** `hardware/linux.rs` (`cfg(target_os = "linux")` pour `detect()`) : analyseurs **purs**, compilés aussi pour les tests sur Windows, et `detect_at(racine)` qui lit une arborescence (tests sur un faux Steam Deck dans un dossier temporaire).

| Donnée | Source | Si indisponible |
|---|---|---|
| Processeur, fils, cœurs physiques | `/proc/cpuinfo` (`model name`, `vendor_id`, entrées `processor`, paires `physical id`/`core id`) | `None` (ex. cœurs sur ARM) |
| RAM | `/proc/meminfo` `MemTotal` | `None` |
| GPU, constructeur | `/sys/class/drm/cardN/device/{vendor,device}` (ID PCI) ; nom = constructeur + ID (`AMD GPU [1002:1435]`), jamais de nom commercial deviné | liste vide |
| VRAM | `mem_info_vram_total` (amdgpu seulement) | `None` |
| Steam Deck | DMI `sys_vendor` = `Valve` et `product_name` = `Jupiter` (LCD) ou `Galileo` (OLED) → console portable, APU intégré | — |
| SteamOS | `/etc/os-release` `ID=steamos` ; `PRETTY_NAME` devient la version du système | `None` |
| Type d'appareil | modèle portable connu, sinon batterie (`/sys/class/power_supply/*/type`) — règle commune `hardware::device_type` | `Unknown` |
| Vulkan | `libvulkan.so.1` dans `/usr/lib`, `/usr/lib64`, `/usr/lib/<triplet>`, `/lib*` : trouvé → `Some(true)`, sinon **inconnu** (Flatpak, Nix…) | `None` |
| Direct3D, Metal | n'existent pas sous Linux | `Some(false)` : la validation refuse un moteur D3D reçu d'une source |
| OpenGL, pilote, écran | non collectés (il faudrait un contexte graphique) | `None` / vide |

- **Localisation** : `platform::locate` choisit selon le système ; sous Linux, il appelle `Adapter::locate_unix(install, &UnixDirs)` (dossiers XDG `$XDG_CONFIG_HOME`/`~/.config`, `$XDG_DATA_HOME`/`~/.local/share`, variables relatives ignorées comme l'exige la spécification ; Flatpak `~/.var/app`). Méthode **par défaut : refus** (« réglages par jeu pas encore pris en charge sous Linux »), donc `smartconfig_status` répond `noGameId` avec cette raison.
- `GpuVendor::from_name` (Adreno → Qualcomm, Mali/Immortalis → Arm, GeForce → NVIDIA…) sert déjà au moteur pour comparer le GPU d'un profil au nôtre.

Reste à faire pour un vrai portage (chaque point à vérifier dans le code source de l'émulateur, comme pour Windows) :

1. `locate_unix` par adaptateur : installation native, **Flatpak** (identifiant d'application et sous-dossiers `config`/`data` à relever), AppImage, portable. Sur Steam Deck, EmuDeck et RetroDECK déplacent ces dossiers : à détecter explicitement, jamais à supposer.
2. `builtin_overrides` : chemins des bases intégrées (`GameIndex.yaml`, `gamedb.yaml`, `Sys/GameSettings`) dans les paquets Linux.
3. `emulators::install::running_inside` et `launch_status` : équivalents Linux (processus Flatpak lancés via `bwrap`).
4. Garde-fous `backup::guard_target` : les liens symboliques sont courants sous Linux (dossiers déplacés sur carte SD du Steam Deck) ; la règle actuelle les refuse, à garder ou à assouplir de façon vérifiée.
5. Classification : le Steam Deck est classé « intermédiaire » (APU portable). Aucun réglage propre à SteamOS (Gamescope, limite de TDP) n'est lu ni modifié.

### 16.2 Android

Ce qui changerait — rien n'est codé au-delà des points d'extension cités :

- **Stockage** : les émulateurs Android rangent leur configuration dans leur propre espace ou dans un dossier choisi via le **Storage Access Framework** (URI `content://`, droits accordés par l'utilisateur). `Location`/`Adapter::target` manipulent des `PathBuf` et `backup` écrit avec `std::fs` : il faudrait une abstraction de cible (lecture/écriture par URI, sauvegarde et relecture par la même voie) et un adaptateur par émulateur Android (Dolphin Android, AetherSX2/NetherSX2, DuckStation, PPSSPP), avec ses propres clés et souvent un autre format.
- **Détection** : pas d'ID PCI. Le constructeur du GPU viendra du nom renvoyé par Vulkan/OpenGL ES (`GpuVendor::from_name`, `GpuVendor::Qualcomm`/`Arm` déjà présents ; `integrated_guess` les classe intégrés) ; modèle d'appareil via `Build.MODEL` ; RAM via `ActivityManager`. Aucun collecteur n'existe (`hardware::detect` renvoie seulement système et architecture).
- **Sources** : les rapports EmuReady « appareil » sont surtout Android ; sur un appareil Android, ils deviendraient de même système et de même architecture (le moteur les classe déjà selon `os`/`arch`, sans changement). Les forks restent `Experimental`.
- **Moteur** : inchangé (déterministe, indépendant du système).

## 17. Profils « Vérifié par iBox » (phase 6)

Fournisseur `providers/verified.rs` (`SourceId::Verified`), fichier **embarqué** `src-tauri/src/smartconfig/verified/profiles.json` : aucun réseau, rien d'envoyé. Activé par défaut (`sources.verified`), désactivable dans Paramètres › SmartConfig › Sources de données. **Le fichier livré est vide** : aucun profil n'a encore suivi la procédure ci-dessous, et aucun n'est inventé.

### 17.1 Procédure de validation (obligatoire pour chaque profil)

1. **Essai en jeu** sur le matériel indiqué, avec la version exacte de l'émulateur, réglages appliqués **par SmartConfig** (aperçu puis application), au moins **30 minutes** de jeu réel (`MIN_MINUTES_PLAYED`), en notant ce qui a été observé (scènes exigeantes, effets, son, cinématiques, sauvegarde/chargement).
2. **Relevé honnête** : performance selon l'échelle `perfect` / `great` / `playable` ressentie et observée (aucun FPS inventé ; un jeu qui ne fonctionne pas ne donne pas de profil).
3. **Relecture** par une seconde personne (date de relecture ≥ date d'essai) : vérifie que les réglages sont dans la liste blanche, que le matériel et la version sont exacts, que les notes ne contiennent aucune donnée personnelle.
4. Ajout au fichier, `cargo test --lib verified` (le test `fichier_livre_valide` refuse un fichier invalide), puis adaptation du test qui exige un fichier vide.
5. Retirer un profil dès qu'une nouvelle version de l'émulateur le contredit ; un nouvel essai = une nouvelle entrée (`id` nouveau).

### 17.2 Format

```json
{
  "format": 1,
  "profiles": [
    {
      "id": "dolphin-gmse01-1",
      "platform": "gamecube",
      "serial": "GMSE01",
      "title": "Titre du jeu",
      "emulator": "dolphin",
      "emulatorVersion": "2509",
      "settings": [{ "key": "dolphin.internal_resolution", "value": { "type": "int", "value": 2 } }],
      "performance": "great",
      "hardware": { "os": "windows", "arch": "x86_64", "cpu": "…", "gpu": "…", "device": "desktop" },
      "verification": { "testedOn": "AAAA-MM-JJ", "minutesPlayed": 45, "checked": ["…"], "reviewedOn": "AAAA-MM-JJ" },
      "notes": "facultatif, 500 car."
    }
  ]
}
```

Validation au chargement, **tout ou rien** (une entrée invalide rend le fichier inutilisable et la source signale une erreur) : champs inconnus refusés ; `id` `[a-z0-9-]` ≤ 64, unique ; émulateur avec adaptateur et console couverte ; numéro de série au format de la communauté ; version `[A-Za-z0-9 ._+-]` ≤ 40 ; réglages non vides, **même liste blanche typée que les adaptateurs** (`validation::validate_format` : clé, type, plage, option ; les contrôles matériels sont refaits au moment de recommander) ; `performance` parmi trois valeurs ; système, architecture, CPU, GPU, type d'appareil renseignés ; dates `AAAA-MM-JJ`, relecture ≥ essai ; ≥ 30 min ; 1–10 points vérifiés.

Moteur : profil relié par **numéro de série** (`GameMatch::Serial`, donc `Exact` possible), +12 « Vérifié par iBox : essayé en jeu puis relu » ; les notes affichent la date et la durée de l'essai. Interface : pastille « Vérifié par iBox » sur la carte et dans le détail.

## 18. iBox AutoTune — feuille de route

Fondations (`smartconfig/autotune.rs`, phase 6) : **types seulement**, aucune collecte, aucune modification.

- `Metric` : vitesse d'émulation (% de la console), FPS, temps d'image (ms), charge CPU/GPU (%), températures CPU/GPU (°C), consommation (W).
- `Sample` : valeur, instant, **source** (`MetricSource` : émulateur, système, pilote GPU, capteur) et **fiabilité** (`Reliability` : `Measured`, `Approximate`, `Unreliable`).
- `Collector` : trait en lecture seule (`metrics`, `target_rate`, `poll`). **Aucun collecteur n'est branché.**
- `summarize` : médiane/min/max sur les seules mesures `Measured` finies ; `None` sinon (rien n'est extrapolé).
- `frame_rate_ratio` : rapport à la cadence visée **fournie par une source** (`TargetRate`) ; sans elle, aucun jugement. Il n'existe pas de « 60 FPS » implicite (jeux PAL à 50 Hz, jeux à 30 images/s, NTSC à 59,94 Hz).

Étapes suivantes, chacune soumise à vérification avant d'être activée :

1. **Sources fiables** : relever, dans le code de chaque émulateur, une interface de mesure officielle (journal de performances, fichier de statistiques, protocole de contrôle) ; côté système, compteurs de processus Windows (PDH) et capteurs exposés par le pilote. Chaque source documentée avec sa fiabilité ; une source non vérifiée reste `Unreliable`.
2. **Collecte opt-in** pendant une partie lancée par iBox, en lecture seule, hors du fil principal, arrêt immédiat à la fin du jeu ; rien ne sort de la machine.
3. **Diagnostic après session** : affichage des mesures fiables et de leur source ; aucune conclusion sans cadence visée connue.
4. **Proposition** (jamais en cours de jeu, jamais automatique) : un profil plus léger ou plus beau, passant par l'aperçu, la sauvegarde et la restauration de SmartConfig, appliqué seulement sur action de l'utilisateur.
5. Pas d'optimisation agressive : un seul palier à la fois, réglages à risque faible uniquement, retour arrière proposé à la session suivante.
