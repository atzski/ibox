/**
 * iBox Platforms — la console comme objet de collection.
 *
 * Complète le registre `platforms.ts` (bibliothèque, scan, boîtiers) par ce qui
 * relève de la découverte : photographie, histoire, caractéristiques techniques,
 * ambiance, et émulateur recommandé (identifiants du catalogue natif
 * `src-tauri/src/emulators/catalog.rs`). Textes originaux d'iBox, en français et
 * en anglais. Caractéristiques : fiches des constructeurs et encyclopédies de
 * référence, vérifiées le 2026-11-17 ; une valeur incertaine est omise plutôt
 * qu'approximée. Photographies : voir `public/platforms/CREDITS.md`.
 */

export type ConsoleKind = "home" | "handheld" | "hybrid" | "arcade";

/** full : bibliothèque + lancement ; discovery : fiche et émulateur, sans bibliothèque. */
export type SupportLevel = "full" | "discovery";

export interface Bilingual {
  fr: string;
  en: string;
}

export interface ConsoleSpec {
  /** Libellé (traduit par le dictionnaire de l'interface). */
  label: "Processeur" | "Graphismes" | "Mémoire" | "Résolution" | "Support" | "Particularité";
  /** Valeur technique (unités françaises : Mo, Ko ; converties en anglais à l'affichage). */
  value: string;
}

export interface ConsoleInfo {
  id: string;
  name: string;
  manufacturer: string;
  year: number;
  generation: number | null;
  kind: ConsoleKind;
  support: SupportLevel;
  /** Photographie détourée (public/platforms). */
  photo: string;
  /** Ambiance : halo principal, halo secondaire, teinte du sol. */
  ambience: { glow: string; accent: string; floor: string };
  history: Bilingual;
  specs: ConsoleSpec[];
  /** Paquet recommandé (catalogue natif), puis alternatives. */
  recommended: string | null;
  alternatives: string[];
}

const c = (x: ConsoleInfo) => x;

export const CONSOLES: ConsoleInfo[] = [
  // ——— Nintendo ———
  c({
    id: "nes", name: "Nintendo Entertainment System", manufacturer: "Nintendo", year: 1983, generation: 3, kind: "home", support: "full",
    photo: "/platforms/nes.webp",
    ambience: { glow: "#C8414B", accent: "#9AA0A8", floor: "#2B2D33" },
    history: {
      fr: "Née Famicom au Japon, elle relance un marché américain sinistré après 1983 grâce à un sceau de qualité et à des séries devenues des piliers : Mario, Zelda, Metroid.",
      en: "Born as the Famicom in Japan, it revived a collapsed American market after 1983 with a seal of quality and series that became pillars: Mario, Zelda, Metroid.",
    },
    specs: [
      { label: "Processeur", value: "Ricoh 2A03 (cœur 6502), 1,79 MHz" },
      { label: "Graphismes", value: "Ricoh 2C02 (PPU)" },
      { label: "Mémoire", value: "2 Ko + 2 Ko de mémoire vidéo" },
      { label: "Résolution", value: "256 × 240" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "mesen", alternatives: ["retroarch"],
  }),
  c({
    id: "snes", name: "Super Nintendo", manufacturer: "Nintendo", year: 1990, generation: 4, kind: "home", support: "full",
    photo: "/platforms/snes.webp",
    ambience: { glow: "#7B6FBF", accent: "#C7C0DC", floor: "#2A2836" },
    history: {
      fr: "La seize bits de Nintendo fait tourner des plans entiers grâce au Mode 7 et accueille des puces dans ses cartouches, comme le Super FX de Star Fox.",
      en: "Nintendo's 16-bit machine spun entire playfields with Mode 7 and hosted extra chips inside its cartridges, like Star Fox's Super FX.",
    },
    specs: [
      { label: "Processeur", value: "Ricoh 5A22 (65C816), jusqu'à 3,58 MHz" },
      { label: "Graphismes", value: "S-PPU1 et S-PPU2" },
      { label: "Mémoire", value: "128 Ko + 64 Ko de mémoire vidéo" },
      { label: "Résolution", value: "256 × 224 (jusqu'à 512 × 448)" },
      { label: "Support", value: "Cartouche" },
      { label: "Particularité", value: "Mode 7, puces d'appoint dans les cartouches" },
    ],
    recommended: "mesen", alternatives: ["retroarch"],
  }),
  c({
    id: "n64", name: "Nintendo 64", manufacturer: "Nintendo", year: 1996, generation: 5, kind: "home", support: "full",
    photo: "/platforms/n64.webp",
    ambience: { glow: "#2F9E6E", accent: "#E8483E", floor: "#232A27" },
    history: {
      fr: "Elle popularise le stick analogique et la vibration, et fait de quatre ports manettes une invitation permanente aux parties entre amis.",
      en: "It popularised the analogue stick and rumble, and its four controller ports were a standing invitation to play with friends.",
    },
    specs: [
      { label: "Processeur", value: "NEC VR4300, 93,75 MHz" },
      { label: "Graphismes", value: "Reality Coprocessor (RCP), 62,5 MHz" },
      { label: "Mémoire", value: "4 Mo RDRAM (8 Mo avec l'Expansion Pak)" },
      { label: "Résolution", value: "320 × 240 à 640 × 480" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "rmg", alternatives: ["retroarch"],
  }),
  c({
    id: "gamecube", name: "Nintendo GameCube", manufacturer: "Nintendo", year: 2001, generation: 6, kind: "home", support: "full",
    photo: "/platforms/gamecube.webp",
    ambience: { glow: "#6A54B4", accent: "#B9A6E8", floor: "#221E33" },
    history: {
      fr: "Un cube à poignée, des mini-disques de 8 cm et une manette pensée pour les mains : la GameCube a vu naître Pikmin et Animal Crossing en Occident.",
      en: "A cube with a handle, 8 cm mini-discs and a controller shaped for hands: the GameCube brought Pikmin and, in the West, Animal Crossing.",
    },
    specs: [
      { label: "Processeur", value: "IBM PowerPC « Gekko », 486 MHz" },
      { label: "Graphismes", value: "ATI « Flipper », 162 MHz" },
      { label: "Mémoire", value: "24 Mo 1T-SRAM + 16 Mo A-RAM" },
      { label: "Résolution", value: "Jusqu'à 640 × 480 (480p)" },
      { label: "Support", value: "Mini-disque optique de 8 cm" },
    ],
    recommended: "dolphin", alternatives: [],
  }),
  c({
    id: "wii", name: "Nintendo Wii", manufacturer: "Nintendo", year: 2006, generation: 7, kind: "home", support: "full",
    photo: "/platforms/wii.webp",
    ambience: { glow: "#5FB8EC", accent: "#F2F3F5", floor: "#22313A" },
    history: {
      fr: "Avec sa télécommande à détection de mouvement, la Wii a mis des familles entières debout devant la télévision, bien au-delà du public habituel des consoles.",
      en: "With its motion-sensing remote, the Wii got whole families on their feet in front of the TV, far beyond the usual console audience.",
    },
    specs: [
      { label: "Processeur", value: "IBM PowerPC « Broadway », 729 MHz" },
      { label: "Graphismes", value: "ATI « Hollywood », 243 MHz" },
      { label: "Mémoire", value: "24 Mo 1T-SRAM + 64 Mo GDDR3" },
      { label: "Résolution", value: "Jusqu'à 480p" },
      { label: "Support", value: "Disque optique de 12 cm" },
      { label: "Particularité", value: "Rétrocompatible GameCube" },
    ],
    recommended: "dolphin", alternatives: [],
  }),
  c({
    id: "wiiu", name: "Nintendo Wii U", manufacturer: "Nintendo", year: 2012, generation: 8, kind: "home", support: "full",
    photo: "/platforms/wiiu.webp",
    ambience: { glow: "#0A9FDB", accent: "#E3F5FD", floor: "#1B2B35" },
    history: {
      fr: "Sa tablette GamePad ajoute un second écran au salon. Peu vendue, la Wii U a pourtant posé les bases de nombreux jeux repris ensuite sur Switch.",
      en: "Its GamePad tablet added a second screen to the living room. It sold modestly, yet laid the groundwork for many games later brought to Switch.",
    },
    specs: [
      { label: "Processeur", value: "IBM « Espresso », 3 cœurs, 1,24 GHz" },
      { label: "Graphismes", value: "AMD « Latte », 550 MHz" },
      { label: "Mémoire", value: "2 Go DDR3" },
      { label: "Résolution", value: "Jusqu'à 1080p" },
      { label: "Support", value: "Disque optique de 25 Go" },
    ],
    recommended: "cemu", alternatives: [],
  }),
  c({
    id: "switch", name: "Nintendo Switch", manufacturer: "Nintendo", year: 2017, generation: 8, kind: "hybrid", support: "full",
    photo: "/platforms/switch.webp",
    ambience: { glow: "#E60012", accent: "#00C3E3", floor: "#2B2224" },
    history: {
      fr: "Console de salon et portable à la fois : on la sort du dock, on détache les Joy-Con et la partie continue n'importe où.",
      en: "A home console and a handheld at once: lift it from the dock, slide off the Joy-Con and the game carries on anywhere.",
    },
    specs: [
      { label: "Processeur", value: "NVIDIA Tegra X1 (4 × ARM Cortex-A57)" },
      { label: "Graphismes", value: "NVIDIA Maxwell, 256 cœurs" },
      { label: "Mémoire", value: "4 Go LPDDR4" },
      { label: "Résolution", value: "720p en portable, 1080p sur la télévision" },
      { label: "Support", value: "Carte de jeu" },
    ],
    recommended: "lichii", alternatives: [],
  }),
  c({
    id: "switch2", name: "Nintendo Switch 2", manufacturer: "Nintendo", year: 2025, generation: 9, kind: "hybrid", support: "full",
    photo: "/platforms/switch2.webp",
    ambience: { glow: "#3BB6C8", accent: "#E8455A", floor: "#1F2427" },
    history: {
      fr: "La suite de la Switch garde l'idée hybride, avec un écran plus grand, des Joy-Con aimantés et une puissance nettement supérieure.",
      en: "The Switch's successor keeps the hybrid idea, with a larger screen, magnetic Joy-Con and far more power.",
    },
    specs: [
      { label: "Mémoire", value: "12 Go LPDDR5X" },
      { label: "Résolution", value: "1080p en portable, jusqu'à 4K sur la télévision" },
      { label: "Support", value: "Carte de jeu" },
    ],
    // Fritchii : version de Lichii pour Ocarina of Time, aussi proposée sur la fiche de ce jeu
    recommended: "lichii", alternatives: ["fritchii"],
  }),
  c({
    id: "gb", name: "Game Boy", manufacturer: "Nintendo", year: 1989, generation: 4, kind: "handheld", support: "full",
    photo: "/platforms/gb.webp",
    ambience: { glow: "#8BAC0F", accent: "#E8E2CF", floor: "#2A2E22" },
    history: {
      fr: "Écran vert, quatre piles et Tetris dans la boîte : le Game Boy a fait de la console portable un objet du quotidien.",
      en: "A green screen, four batteries and Tetris in the box: the Game Boy made the handheld an everyday object.",
    },
    specs: [
      { label: "Processeur", value: "Sharp LR35902, 4,19 MHz" },
      { label: "Mémoire", value: "8 Ko + 8 Ko de mémoire vidéo" },
      { label: "Résolution", value: "160 × 144, 4 nuances" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "sameboy", alternatives: ["mgba", "retroarch"],
  }),
  c({
    id: "gbc", name: "Game Boy Color", manufacturer: "Nintendo", year: 1998, generation: 5, kind: "handheld", support: "full",
    photo: "/platforms/gbc.webp",
    ambience: { glow: "#8E5CC4", accent: "#8FD6CF", floor: "#272433" },
    history: {
      fr: "Le Game Boy passe à la couleur sans perdre sa ludothèque : il reste compatible avec les cartouches d'origine et accueille les premiers Pokémon en couleurs.",
      en: "The Game Boy goes colour without losing its library: it plays the original cartridges and hosted the first Pokémon games in colour.",
    },
    specs: [
      { label: "Processeur", value: "Sharp LR35902, jusqu'à 8,39 MHz" },
      { label: "Mémoire", value: "32 Ko + 16 Ko de mémoire vidéo" },
      { label: "Résolution", value: "160 × 144, 56 couleurs simultanées" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "sameboy", alternatives: ["mgba", "retroarch"],
  }),
  c({
    id: "gba", name: "Game Boy Advance", manufacturer: "Nintendo", year: 2001, generation: 6, kind: "handheld", support: "full",
    photo: "/platforms/gba.webp",
    ambience: { glow: "#5A4FCF", accent: "#A9AAF0", floor: "#23223A" },
    history: {
      fr: "Un format à l'horizontale, un processeur ARM et une ludothèque de pixel art parmi les plus soignées de l'histoire.",
      en: "A landscape design, an ARM processor and one of the most polished pixel-art libraries in history.",
    },
    specs: [
      { label: "Processeur", value: "ARM7TDMI, 16,78 MHz" },
      { label: "Mémoire", value: "32 Ko + 256 Ko + 96 Ko de mémoire vidéo" },
      { label: "Résolution", value: "240 × 160" },
      { label: "Support", value: "Cartouche" },
      { label: "Particularité", value: "Rétrocompatible Game Boy et Game Boy Color" },
    ],
    recommended: "mgba", alternatives: ["retroarch"],
  }),
  c({
    id: "ds", name: "Nintendo DS", manufacturer: "Nintendo", year: 2004, generation: 7, kind: "handheld", support: "full",
    photo: "/platforms/ds.webp",
    ambience: { glow: "#2F6FE0", accent: "#9DBEF0", floor: "#1E2536" },
    history: {
      fr: "Deux écrans dont un tactile, un micro et un stylet : la DS a inventé des jeux qu'aucune autre machine ne permettait.",
      en: "Two screens, one of them touch-sensitive, a microphone and a stylus: the DS invented games no other machine could host.",
    },
    specs: [
      { label: "Processeur", value: "ARM946E-S 67 MHz + ARM7TDMI 33 MHz" },
      { label: "Mémoire", value: "4 Mo" },
      { label: "Résolution", value: "2 écrans de 256 × 192" },
      { label: "Support", value: "Carte de jeu" },
    ],
    recommended: "melonds", alternatives: ["retroarch"],
  }),
  c({
    id: "3ds", name: "Nintendo 3DS", manufacturer: "Nintendo", year: 2011, generation: 8, kind: "handheld", support: "full",
    photo: "/platforms/3ds.webp",
    ambience: { glow: "#22A6C9", accent: "#F2A9BA", floor: "#1E2C32" },
    history: {
      fr: "Le relief sans lunettes sur l'écran du haut, la StreetPass entre joueurs croisés dans la rue, et la compatibilité avec toute la ludothèque DS.",
      en: "Glasses-free 3D on the top screen, StreetPass between players crossing paths, and compatibility with the whole DS library.",
    },
    specs: [
      { label: "Processeur", value: "ARM11 MPCore double cœur, 268 MHz" },
      { label: "Graphismes", value: "DMP PICA200" },
      { label: "Mémoire", value: "128 Mo FCRAM" },
      { label: "Résolution", value: "800 × 240 (relief) et 320 × 240" },
      { label: "Support", value: "Carte de jeu" },
    ],
    recommended: "azahar", alternatives: [],
  }),

  // ——— Sony ———
  c({
    id: "ps1", name: "PlayStation", manufacturer: "Sony", year: 1994, generation: 5, kind: "home", support: "full",
    photo: "/platforms/ps1.webp",
    ambience: { glow: "#8C96A8", accent: "#D7DCE3", floor: "#26292F" },
    history: {
      fr: "Le premier pas de Sony : des jeux sur CD, de la 3D texturée et des univers qui ont fait grandir le jeu vidéo avec son public.",
      en: "Sony's first step: games on CD, textured 3D and worlds that let video games grow up alongside their players.",
    },
    specs: [
      { label: "Processeur", value: "MIPS R3000A, 33,87 MHz" },
      { label: "Mémoire", value: "2 Mo + 1 Mo de mémoire vidéo" },
      { label: "Résolution", value: "256 × 224 à 640 × 480" },
      { label: "Support", value: "CD-ROM" },
    ],
    recommended: "core-pcsx-rearmed", alternatives: ["duckstation"],
  }),
  c({
    id: "ps2", name: "PlayStation 2", manufacturer: "Sony", year: 2000, generation: 6, kind: "home", support: "full",
    photo: "/platforms/ps2.webp",
    ambience: { glow: "#2C4FD8", accent: "#7E8FC4", floor: "#151B33" },
    history: {
      fr: "La console la plus vendue de l'histoire, qui servait aussi de lecteur DVD et a réuni une ludothèque d'une ampleur jamais revue.",
      en: "The best-selling console ever, which doubled as a DVD player and gathered a library of a scale never seen again.",
    },
    specs: [
      { label: "Processeur", value: "Emotion Engine (MIPS R5900), 294,9 MHz" },
      { label: "Graphismes", value: "Graphics Synthesizer, 147,5 MHz" },
      { label: "Mémoire", value: "32 Mo RDRAM + 4 Mo de mémoire vidéo" },
      { label: "Support", value: "DVD-ROM et CD-ROM" },
      { label: "Particularité", value: "Rétrocompatible PlayStation" },
    ],
    recommended: "core-play", alternatives: ["pcsx2"],
  }),
  c({
    id: "ps3", name: "PlayStation 3", manufacturer: "Sony", year: 2006, generation: 7, kind: "home", support: "full",
    photo: "/platforms/ps3.webp",
    ambience: { glow: "#3A4A6B", accent: "#C0C6D0", floor: "#191B22" },
    history: {
      fr: "Son processeur Cell, réputé difficile à maîtriser, et son lecteur Blu-ray en ont fait l'une des machines les plus singulières jamais conçues.",
      en: "Its notoriously demanding Cell processor and its Blu-ray drive made it one of the most singular machines ever designed.",
    },
    specs: [
      { label: "Processeur", value: "Cell Broadband Engine, 3,2 GHz" },
      { label: "Graphismes", value: "NVIDIA RSX, 500 MHz" },
      { label: "Mémoire", value: "256 Mo XDR + 256 Mo GDDR3" },
      { label: "Résolution", value: "Jusqu'à 1080p" },
      { label: "Support", value: "Blu-ray" },
    ],
    recommended: "rpcs3", alternatives: [],
  }),
  c({
    id: "ps4", name: "PlayStation 4", manufacturer: "Sony", year: 2013, generation: 8, kind: "home", support: "discovery",
    photo: "/platforms/ps4.webp",
    ambience: { glow: "#1F5FD1", accent: "#9FB4D8", floor: "#151A26" },
    history: {
      fr: "Une architecture proche du PC, un bouton Share et le jeu en ligne au cœur de l'expérience : la PS4 a dominé sa génération.",
      en: "A PC-like architecture, a Share button and online play at the heart of the experience: the PS4 led its generation.",
    },
    specs: [
      { label: "Processeur", value: "AMD Jaguar, 8 cœurs, 1,6 GHz" },
      { label: "Graphismes", value: "AMD GCN, 18 unités de calcul, 800 MHz" },
      { label: "Mémoire", value: "8 Go GDDR5" },
      { label: "Résolution", value: "Jusqu'à 1080p" },
      { label: "Support", value: "Blu-ray" },
    ],
    recommended: "shadps4", alternatives: [],
  }),
  c({
    id: "psp", name: "PlayStation Portable", manufacturer: "Sony", year: 2004, generation: 7, kind: "handheld", support: "full",
    photo: "/platforms/psp.webp",
    ambience: { glow: "#5C6E86", accent: "#D9E0EA", floor: "#1B1E24" },
    history: {
      fr: "Un grand écran 16:9, des disques UMD et des jeux d'envergure console dans la poche : la PSP a aussi servi de lecteur multimédia à toute une génération.",
      en: "A wide 16:9 screen, UMD discs and console-scale games in your pocket: the PSP was also a generation's media player.",
    },
    specs: [
      { label: "Processeur", value: "MIPS « Allegrex », jusqu'à 333 MHz" },
      { label: "Mémoire", value: "32 Mo (PSP-1000)" },
      { label: "Résolution", value: "480 × 272" },
      { label: "Support", value: "UMD" },
    ],
    recommended: "ppsspp", alternatives: ["retroarch"],
  }),
  c({
    id: "vita", name: "PlayStation Vita", manufacturer: "Sony", year: 2011, generation: 8, kind: "handheld", support: "discovery",
    photo: "/platforms/vita.webp",
    ambience: { glow: "#2D6FD6", accent: "#BFC8D6", floor: "#161A22" },
    history: {
      fr: "Écran OLED, deux sticks, façade tactile et pavé tactile arrière : une portable ambitieuse devenue la terre d'accueil de nombreux jeux indépendants.",
      en: "An OLED screen, twin sticks, a touch front and a rear touch pad: an ambitious handheld that became a home for many indie games.",
    },
    specs: [
      { label: "Processeur", value: "ARM Cortex-A9 MPCore, 4 cœurs" },
      { label: "Graphismes", value: "PowerVR SGX543MP4+" },
      { label: "Mémoire", value: "512 Mo + 128 Mo de mémoire vidéo" },
      { label: "Résolution", value: "960 × 544" },
      { label: "Support", value: "Carte PlayStation Vita" },
    ],
    recommended: "vita3k", alternatives: [],
  }),

  // ——— Microsoft ———
  c({
    id: "xbox", name: "Xbox", manufacturer: "Microsoft", year: 2001, generation: 6, kind: "home", support: "full",
    photo: "/platforms/xbox.webp",
    ambience: { glow: "#3DAA3D", accent: "#9AD15A", floor: "#171D17" },
    history: {
      fr: "Microsoft entre dans l'arène avec une machine pensée comme un PC : disque dur intégré, port Ethernet et Halo pour tout emporter.",
      en: "Microsoft entered the arena with a machine designed like a PC: built-in hard drive, Ethernet port, and Halo to win everyone over.",
    },
    specs: [
      { label: "Processeur", value: "Intel Pentium III (variante), 733 MHz" },
      { label: "Graphismes", value: "NVIDIA NV2A, 233 MHz" },
      { label: "Mémoire", value: "64 Mo DDR" },
      { label: "Support", value: "DVD-ROM" },
      { label: "Particularité", value: "Disque dur intégré de 8 Go" },
    ],
    recommended: "xemu", alternatives: [],
  }),
  c({
    id: "xbox360", name: "Xbox 360", manufacturer: "Microsoft", year: 2005, generation: 7, kind: "home", support: "full",
    photo: "/platforms/xbox360.webp",
    ambience: { glow: "#5DC21E", accent: "#F2F4F2", floor: "#1A2117" },
    history: {
      fr: "Le Xbox Live, les succès et le Xbox Live Arcade ont fait de la 360 la console qui a installé le jeu en ligne dans les salons.",
      en: "Xbox Live, achievements and Xbox Live Arcade made the 360 the console that brought online play into living rooms.",
    },
    specs: [
      { label: "Processeur", value: "IBM « Xenon », 3 cœurs, 3,2 GHz" },
      { label: "Graphismes", value: "ATI « Xenos », 500 MHz, 10 Mo eDRAM" },
      { label: "Mémoire", value: "512 Mo GDDR3" },
      { label: "Résolution", value: "Jusqu'à 1080p" },
      { label: "Support", value: "DVD" },
    ],
    recommended: "xenia", alternatives: [],
  }),

  // ——— Sega ———
  c({
    id: "mastersystem", name: "Master System", manufacturer: "Sega", year: 1985, generation: 3, kind: "home", support: "full",
    photo: "/platforms/mastersystem.webp",
    ambience: { glow: "#D1343C", accent: "#2E3036", floor: "#221A1C" },
    history: {
      fr: "Discrète aux États-Unis, la Master System a connu un vrai succès en Europe et au Brésil, où elle a longtemps été produite.",
      en: "Overlooked in the United States, the Master System thrived in Europe and in Brazil, where it stayed in production for years.",
    },
    specs: [
      { label: "Processeur", value: "Zilog Z80, 3,58 MHz" },
      { label: "Mémoire", value: "8 Ko + 16 Ko de mémoire vidéo" },
      { label: "Résolution", value: "256 × 192" },
      { label: "Support", value: "Cartouche et Sega Card" },
    ],
    recommended: "core-genesis-plus-gx", alternatives: [],
  }),
  c({
    id: "megadrive", name: "Mega Drive", manufacturer: "Sega", year: 1988, generation: 4, kind: "home", support: "full",
    photo: "/platforms/megadrive.webp",
    ambience: { glow: "#2F6BD6", accent: "#D33A3A", floor: "#16181F" },
    history: {
      fr: "Appelée Genesis en Amérique du Nord, elle a porté la rivalité avec Nintendo à son sommet, avec Sonic en figure de proue.",
      en: "Called Genesis in North America, it took the rivalry with Nintendo to its peak, with Sonic as its figurehead.",
    },
    specs: [
      { label: "Processeur", value: "Motorola 68000 7,67 MHz + Zilog Z80" },
      { label: "Graphismes", value: "VDP Sega 315-5313" },
      { label: "Mémoire", value: "64 Ko + 64 Ko de mémoire vidéo" },
      { label: "Résolution", value: "320 × 224" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "core-genesis-plus-gx", alternatives: [],
  }),
  c({
    id: "gamegear", name: "Game Gear", manufacturer: "Sega", year: 1990, generation: 4, kind: "handheld", support: "full",
    photo: "/platforms/gamegear.webp",
    ambience: { glow: "#2E86DE", accent: "#3A3D44", floor: "#191B21" },
    history: {
      fr: "Une Master System dans la poche, avec un écran couleur rétroéclairé face au Game Boy… et un solide appétit pour les piles.",
      en: "A pocket-sized Master System with a backlit colour screen to rival the Game Boy… and a hearty appetite for batteries.",
    },
    specs: [
      { label: "Processeur", value: "Zilog Z80, 3,58 MHz" },
      { label: "Mémoire", value: "8 Ko + 16 Ko de mémoire vidéo" },
      { label: "Résolution", value: "160 × 144, palette de 4 096 couleurs" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "core-genesis-plus-gx", alternatives: [],
  }),
  c({
    id: "saturn", name: "Sega Saturn", manufacturer: "Sega", year: 1994, generation: 5, kind: "home", support: "full",
    photo: "/platforms/saturn.webp",
    ambience: { glow: "#4A5BA8", accent: "#8E96B8", floor: "#181A24" },
    history: {
      fr: "Deux processeurs, une architecture exigeante et des adaptations d'arcade remarquables : la Saturn a surtout brillé au Japon.",
      en: "Twin processors, a demanding architecture and remarkable arcade conversions: the Saturn shone brightest in Japan.",
    },
    specs: [
      { label: "Processeur", value: "2 × Hitachi SH-2, 28,6 MHz" },
      { label: "Graphismes", value: "VDP1 et VDP2" },
      { label: "Mémoire", value: "2 Mo + 1,5 Mo de mémoire vidéo" },
      { label: "Support", value: "CD-ROM" },
    ],
    recommended: "core-yabause", alternatives: ["core-beetle-saturn"],
  }),
  c({
    id: "dreamcast", name: "Dreamcast", manufacturer: "Sega", year: 1998, generation: 6, kind: "home", support: "full",
    photo: "/platforms/dreamcast.webp",
    ambience: { glow: "#E86A1C", accent: "#F4F1EA", floor: "#29211C" },
    history: {
      fr: "Modem intégré, VMU à écran glissée dans la manette, idées en avance sur leur temps : la dernière console de Sega a gardé des admirateurs fidèles.",
      en: "A built-in modem, a VMU with its own screen inside the controller, ideas ahead of their time: Sega's last console kept a devoted following.",
    },
    specs: [
      { label: "Processeur", value: "Hitachi SH-4, 200 MHz" },
      { label: "Graphismes", value: "NEC PowerVR2, 100 MHz" },
      { label: "Mémoire", value: "16 Mo + 8 Mo de mémoire vidéo" },
      { label: "Résolution", value: "640 × 480" },
      { label: "Support", value: "GD-ROM (1 Go)" },
    ],
    recommended: "flycast", alternatives: [],
  }),

  // ——— Atari ———
  c({
    id: "atari2600", name: "Atari 2600", manufacturer: "Atari", year: 1977, generation: 2, kind: "home", support: "full",
    photo: "/platforms/atari2600.webp",
    ambience: { glow: "#C8742E", accent: "#6B4A2F", floor: "#221C17" },
    history: {
      fr: "Sa façade imitation bois et son joystick à un bouton ont fait entrer le jeu vidéo à cartouches dans des millions de foyers.",
      en: "Its woodgrain front and one-button joystick brought cartridge gaming into millions of homes.",
    },
    specs: [
      { label: "Processeur", value: "MOS 6507, 1,19 MHz" },
      { label: "Graphismes", value: "TIA (Television Interface Adaptor)" },
      { label: "Mémoire", value: "128 octets" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "stella", alternatives: [],
  }),
  c({
    id: "jaguar", name: "Atari Jaguar", manufacturer: "Atari", year: 1993, generation: 5, kind: "home", support: "full",
    photo: "/platforms/jaguar.webp",
    ambience: { glow: "#C0262D", accent: "#3A3A3E", floor: "#1C1718" },
    history: {
      fr: "Présentée comme la première console 64 bits, la Jaguar fut la dernière console de salon d'Atari, avec une manette à pavé numérique restée célèbre.",
      en: "Billed as the first 64-bit console, the Jaguar was Atari's last home console, with a famous numeric-keypad controller.",
    },
    specs: [
      { label: "Processeur", value: "« Tom » et « Jerry » + Motorola 68000" },
      { label: "Mémoire", value: "2 Mo" },
      { label: "Support", value: "Cartouche" },
    ],
    recommended: "bigpemu", alternatives: [],
  }),

  // ——— Arcade ———
  c({
    id: "arcade", name: "Arcade", manufacturer: "Bornes d'arcade", year: 1971, generation: null, kind: "arcade", support: "discovery",
    photo: "/platforms/arcade.webp",
    ambience: { glow: "#E2452C", accent: "#F2B33D", floor: "#1E1715" },
    history: {
      fr: "Avant les consoles, il y avait les salles d'arcade : chaque borne est une machine différente, et les émulateurs reproduisent des milliers de cartes électroniques.",
      en: "Before consoles came the arcades: every cabinet is a different machine, and emulators reproduce thousands of circuit boards.",
    },
    specs: [{ label: "Particularité", value: "Matériel propre à chaque borne" }],
    recommended: "core-fbneo", alternatives: ["mame"],
  }),
];

const BY_ID = new Map(CONSOLES.map((x) => [x.id, x]));

export function consoleInfo(id: string): ConsoleInfo | undefined {
  return BY_ID.get(id);
}

/** Valeur technique dans la langue de l'interface (unités). */
export function localizeSpec(value: string, lang: "fr" | "en"): string {
  if (lang === "fr") return value;
  return value
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/ Mo\b/g, " MB")
    .replace(/ Ko\b/g, " KB")
    .replace(/ Go\b/g, " GB")
    .replace(/ octets\b/g, " bytes")
    .replace(/de mémoire vidéo/g, "video memory")
    .replace(/jusqu'à /gi, "up to ")
    .replace(/Jusqu'à /g, "Up to ")
    .replace(/ et /g, " and ")
    .replace(/ cœurs/g, " cores")
    .replace(/double cœur/g, "dual-core")
    .replace(/cœur /g, "core ")
    .replace(/en portable/g, "handheld")
    .replace(/sur la télévision/g, "on TV")
    .replace(/nuances/g, "shades")
    .replace(/couleurs simultanées/g, "colours on screen")
    .replace(/palette de/g, "palette of")
    .replace(/couleurs/g, "colours")
    .replace(/unités de calcul/g, "compute units")
    .replace(/2 écrans de/g, "2 screens of")
    .replace(/\(relief\)/g, "(3D)")
    .replace(/Cartouche/g, "Cartridge")
    .replace(/Carte de jeu/g, "Game card")
    .replace(/Carte PlayStation Vita/g, "PlayStation Vita card")
    .replace(/Mini-disque optique de 8 cm/g, "8 cm optical mini-disc")
    .replace(/Disque optique de (\d+) (cm|Go|GB)/g, (_m, n, u) => `${n} ${u === "cm" ? "cm" : "GB"} optical disc`)
    .replace(/Disque dur intégré de (\d+) GB/g, "Built-in $1 GB hard drive")
    .replace(/Rétrocompatible/g, "Backward compatible with")
    .replace(/puces d'appoint dans les cartouches/g, "extra chips inside cartridges")
    .replace(/avec l'Expansion Pak/g, "with the Expansion Pak")
    .replace(/Matériel propre à chaque borne/g, "Hardware specific to each cabinet")
    .replace(/variante/g, "variant");
}
