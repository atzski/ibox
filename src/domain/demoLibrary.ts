import type { Game } from "./types";
import { sortKey } from "./text";

/**
 * Bibliothèque de démonstration (phase 1).
 *
 * Cinq jeux GameCube entièrement fictifs, avec des habillages procéduraux
 * originaux. Ils sont signalés comme « Démo » dans l'interface et seront
 * remplacés par les jeux détectés lors du scan (phase 2).
 */
const raw: Omit<Game, "sortTitle">[] = [
  {
    id: "demo-lumen-grove",
    platformId: "gamecube",
    title: "Lumen Grove",
    year: 2003,
    publisher: "Petit Phare",
    developer: "Studio Hibou",
    genre: "Aventure",
    players: "1 joueur",
    region: "PAL",
    description:
      "Quand la nuit tombe sur la forêt de Lumen, les lucioles s'éteignent une à une. Guidez Pip, un jeune hibou porteur de lanterne, à travers des clairières oubliées pour rallumer le grand arbre avant l'aube.",
    filePath: "D:/Emulation/GameCube/Lumen Grove (Europe).rvz",
    addedAt: "2026-09-02T18:20:00Z",
    lastPlayedAt: "2026-11-10T20:45:00Z",
    isDemo: true,
    art: {
      motif: "grove",
      palette: ["#2E3F6E", "#7C6BC4", "#FFE7A3", "#9FE3C8", "#FFFFFF"],
      tagline: "Rallumez la forêt",
    },
  },
  {
    id: "demo-breezeway-racers",
    platformId: "gamecube",
    title: "Breezeway Racers",
    year: 2002,
    publisher: "Ondine Interactive",
    developer: "Ondine Interactive",
    genre: "Course",
    players: "1 à 4 joueurs",
    region: "PAL",
    description:
      "Des cerfs-volants géants, des routes côtières et un vent capricieux. Choisissez votre planeur, profitez des courants ascendants et filez vers la ligne d'arrivée au coucher du soleil.",
    filePath: "D:/Emulation/GameCube/Breezeway Racers (Europe).iso",
    addedAt: "2026-10-21T09:10:00Z",
    lastPlayedAt: "2026-11-04T17:30:00Z",
    isDemo: true,
    art: {
      motif: "racers",
      palette: ["#FFB59A", "#FFE1B8", "#4C7FD6", "#FF7C8F", "#2D3550"],
      tagline: "Suivez le vent",
    },
  },
  {
    id: "demo-tidepool-detectives",
    platformId: "gamecube",
    title: "Tidepool Detectives",
    year: 2004,
    publisher: "Petit Phare",
    developer: "Marée Basse",
    genre: "Réflexion",
    players: "1 à 2 joueurs",
    region: "PAL",
    description:
      "Un coquillage a disparu du récif ! Menez l'enquête avec Coral et Bulle, interrogez les habitants des bassins et résolvez des énigmes de courants et de reflets.",
    filePath: "D:/Emulation/GameCube/Tidepool Detectives (Europe).rvz",
    addedAt: "2026-11-08T14:00:00Z",
    isDemo: true,
    art: {
      motif: "tidepool",
      palette: ["#8FDCD3", "#3C8FB7", "#FFD47E", "#FF9C86", "#FFFFFF"],
      tagline: "L'énigme du récif",
    },
  },
  {
    id: "demo-starfall-bakery",
    platformId: "gamecube",
    title: "Starfall Bakery",
    year: 2005,
    publisher: "Moelleux Games",
    developer: "Moelleux Games",
    genre: "Simulation",
    players: "1 joueur",
    region: "PAL",
    description:
      "Chaque nuit, des étoiles filantes tombent sur le village. Ramassez-les, pétrissez, enfournez : votre petite boulangerie céleste a des clients venus de toute la galaxie.",
    filePath: "D:/Emulation/GameCube/Starfall Bakery (Europe).gcz",
    addedAt: "2026-11-11T21:15:00Z",
    isDemo: true,
    art: {
      motif: "bakery",
      palette: ["#3B3270", "#B79BE6", "#FFD98A", "#F7A9C4", "#FFFFFF"],
      tagline: "Pâtisseries d'étoiles",
    },
  },
  {
    id: "demo-mossback-mountain",
    platformId: "gamecube",
    title: "Mossback Mountain",
    year: 2003,
    publisher: "Ondine Interactive",
    developer: "Colline Verte",
    genre: "Plateforme",
    players: "1 joueur",
    region: "PAL",
    description:
      "Une montagne qui dort depuis mille ans, et une petite tortue décidée à atteindre son sommet. Sautez de mousse en mousse, planez au-dessus des cascades et réveillez le géant en douceur.",
    filePath: "D:/Emulation/GameCube/Mossback Mountain (Europe).iso",
    addedAt: "2026-07-14T11:00:00Z",
    lastPlayedAt: "2026-10-28T19:05:00Z",
    isDemo: true,
    art: {
      motif: "mountain",
      palette: ["#BDE8F6", "#E9F7EF", "#5DBB8E", "#F6C48C", "#24443A"],
      tagline: "Jusqu'au sommet",
    },
  },
];

export const DEMO_GAMES: Game[] = raw.map((g) => ({ ...g, sortTitle: sortKey(g.title) }));
