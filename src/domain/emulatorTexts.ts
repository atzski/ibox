/**
 * Textes d'iBox Platforms sur les émulateurs et les prérequis (français ;
 * l'anglais passe par le dictionnaire `i18n/en.ts`). Les identifiants sont
 * ceux du catalogue natif (`emulators/catalog.rs`) et de `requirements.rs`.
 */

export const EMULATOR_TEXT: Record<string, { about: string; why: string }> = {
  ppsspp: { about: "Émulateur PSP rapide et soigné, disponible depuis plus de dix ans.", why: "Il fait tourner la quasi-totalité de la ludothèque PSP, en haute définition, même sur un PC modeste." },
  duckstation: { about: "Émulateur PlayStation axé sur la précision et le confort.", why: "Très fidèle et rapide, mais il exige le BIOS de votre console (voir les prérequis)." },
  pcsx2: { about: "L'émulateur PlayStation 2 de référence, développé depuis 2002.", why: "Le plus compatible pour la PS2, mais il exige le BIOS de votre console (voir les prérequis)." },
  dolphin: { about: "Émulateur GameCube et Wii, l'un des projets d'émulation les plus aboutis.", why: "Une seule installation pour la GameCube et la Wii, avec une compatibilité excellente." },
  cemu: { about: "Émulateur Wii U, devenu libre en 2022.", why: "Le seul émulateur Wii U mûr ; la plupart des grands jeux y sont jouables." },
  melonds: { about: "Émulateur Nintendo DS précis, avec jeu en réseau local.", why: "Très fidèle au matériel, rapide, et pensé pour Windows." },
  azahar: { about: "Émulateur Nintendo 3DS, successeur de Citra et Lime3DS.", why: "Le projet 3DS activement maintenu, issu des deux émulateurs de référence." },
  mgba: { about: "Émulateur Game Boy Advance précis et léger.", why: "Excellent sur Game Boy Advance, il lit aussi les jeux Game Boy et Game Boy Color." },
  sameboy: { about: "Émulateur Game Boy et Game Boy Color d'une grande précision.", why: "Parmi les plus fidèles au matériel d'origine, minuscule et rapide." },
  mesen: { about: "Émulateur multisystème centré sur la précision (NES, Super Nintendo…).", why: "Très précis sur NES et Super Nintendo ; nécessite le runtime .NET 8 de Microsoft." },
  rmg: { about: "Interface moderne autour du cœur mupen64plus.", why: "Une version portable officielle, simple à configurer, pour la Nintendo 64." },
  rpcs3: { about: "L'émulateur PlayStation 3, libre et très actif.", why: "Le seul émulateur PS3 capable de faire tourner une grande partie de la ludothèque." },
  xemu: { about: "Émulateur Xbox d'origine, fidèle au matériel.", why: "Le projet Xbox le plus avancé ; il demande des fichiers de la console (voir les prérequis)." },
  xenia: { about: "Émulateur Xbox 360, branche « Canary » plus avancée.", why: "Le seul émulateur Xbox 360 utilisable aujourd'hui, mais encore expérimental." },
  vita3k: { about: "Émulateur PlayStation Vita en développement.", why: "Le seul émulateur Vita ; les jeux s'installent et se lancent depuis son interface." },
  shadps4: { about: "Émulateur PlayStation 4 très récent.", why: "Le projet PS4 le plus actif, mais encore expérimental : peu de jeux sont jouables." },
  flycast: { about: "Émulateur Dreamcast, Naomi et Atomiswave.", why: "Rapide, compatible, et il fonctionne même sans BIOS de la console." },
  stella: { about: "Émulateur Atari 2600 développé depuis 1995.", why: "La référence pour l'Atari 2600, avec une compatibilité quasi totale." },
  retroarch: { about: "Interface commune à des dizaines de cœurs d'émulation libretro.", why: "Nécessaire pour les cœurs recommandés ci-dessous ; iBox l'installe à part, sans toucher à vos autres émulateurs." },
  "core-genesis-plus-gx": { about: "Cœur libretro Mega Drive, Master System et Game Gear.", why: "Très précis sur les trois consoles 8 et 16 bits de Sega ; il s'utilise avec RetroArch." },
  "core-beetle-saturn": { about: "Cœur libretro Saturn issu de Mednafen.", why: "L'émulation Saturn la plus fidèle sous RetroArch, mais un BIOS de la console est nécessaire." },
  "core-play": { about: "Émulateur PlayStation 2 libre, sous forme de cœur RetroArch.", why: "Aucun BIOS à extraire : il recrée le système de la PS2 lui-même. Moins compatible que PCSX2, mais prêt en un clic." },
  "core-pcsx-rearmed": { about: "Cœur libretro PlayStation rapide et éprouvé.", why: "Il fonctionne sans BIOS grâce à son système intégré, et fait tourner la grande majorité des jeux PlayStation." },
  "core-yabause": { about: "Cœur libretro Saturn issu du projet Yabause.", why: "Il démarre sans BIOS de la console ; moins précis que Beetle Saturn, mais rien à installer en plus." },
  "core-fbneo": { about: "Cœur libretro arcade (Neo Geo, CPS1, CPS2…).", why: "Rapide et fiable pour les grands classiques d'arcade 2D ; il attend des jeux au format FBNeo." },
  bigpemu: { about: "Émulateur Atari Jaguar gratuit et très compatible.", why: "La meilleure compatibilité Jaguar, mais il n'est distribué que sur le site de son auteur." },
  mame: { about: "Le projet de préservation de l'arcade, des milliers de bornes reproduites.", why: "La couverture la plus large ; ses jeux doivent correspondre exactement à sa version." },
};

export const MATURITY_LABEL: Record<string, string> = {
  mature: "Émulation mûre",
  good: "Bonne compatibilité",
  experimental: "Expérimental",
};

export const REQUIREMENT_TEXT: Record<string, { title: string; body: string }> = {
  "ps1-bios": { title: "BIOS de la PlayStation", body: "Facultatif : seulement pour DuckStation. L'émulateur recommandé par iBox (PCSX ReARMed) n'en a pas besoin." },
  "ps2-bios": { title: "BIOS de la PlayStation 2", body: "Facultatif : seulement pour PCSX2. L'émulateur recommandé par iBox (Play!) n'en a pas besoin." },
  "saturn-bios": { title: "BIOS de la Saturn", body: "Facultatif : seulement pour Beetle Saturn (sega_101.bin ou mpr-17933.bin). L'émulateur recommandé par iBox (Yabause) n'en a pas besoin." },
  "ps3-firmware": { title: "Micrologiciel de la PS3", body: "RPCS3 installe le micrologiciel officiel de Sony (fichier PS3UPDAT.PUP) depuis son menu Fichier, au premier démarrage." },
  "vita-firmware": { title: "Micrologiciel de la Vita", body: "Vita3K demande le micrologiciel officiel de Sony au premier démarrage ; son guide explique où le télécharger." },
  "ps4-modules": { title: "Modules du système PS4", body: "Certains jeux exigent des bibliothèques extraites de votre console, à placer dans le dossier de shadPS4." },
  "xbox-files": { title: "Fichiers de la Xbox", body: "xemu a besoin de la ROM de démarrage MCPX, du BIOS et d'un disque dur virtuel, tirés de votre console." },
  "wiiu-keys": { title: "Clés de la Wii U", body: "Les jeux chiffrés demandent les clés de votre console ; le guide de Cemu détaille la procédure." },
  "3ds-decrypted": { title: "Jeux 3DS déchiffrés", body: "Azahar lit les jeux extraits de votre console sous forme déchiffrée." },
  "dreamcast-bios": { title: "BIOS de la Dreamcast (facultatif)", body: "Flycast démarre sans BIOS ; celui de votre console améliore seulement la compatibilité de quelques jeux." },
  "vc-runtime": { title: "Visual C++ (Microsoft)", body: "Composant Windows gratuit de Microsoft nécessaire à cet émulateur." },
  dotnet8: { title: "Runtime .NET 8 (Microsoft)", body: "Mesen a besoin du « .NET Desktop Runtime 8 » de Microsoft, gratuit." },
  "arcade-romsets": { title: "Jeux au bon format", body: "Chaque émulateur d'arcade attend des archives correspondant exactement à sa version." },
};

/** Libellé d'état d'une console dans la galerie et sur la fiche. */
export const STATUS_LABEL: Record<string, string> = {
  ready: "Prête à jouer",
  setup: "À configurer",
  "missing-bios": "BIOS manquant",
  "missing-prereq": "Prérequis manquant",
  "not-installed": "Émulateur à installer",
  installing: "Installation en cours",
  error: "Émulateur introuvable",
  discovery: "À découvrir",
  manual: "Installation manuelle",
};
