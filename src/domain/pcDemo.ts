import type { Game, PcInstall } from "./types";
import { sortKey } from "./text";

/**
 * Jeux PC de démonstration : entièrement fictifs, habillages procéduraux
 * originaux, signalés « Démo ». Ils ne servent qu'à présenter la bibliothèque
 * PC tant qu'aucun vrai jeu PC n'y est ajouté ; ils ne se lancent pas.
 */
let next = -1;
const install = (source: string, installed: boolean, preferred = false): PcInstall => ({
  id: next--,
  source,
  externalId: `demo-${source}-${-next}`,
  launchKind: "none",
  launchTarget: null,
  installDir: null,
  installed,
  preferred,
});

const raw: Omit<Game, "sortTitle">[] = [
  {
    id: "demo-pc-lantern-keepers",
    platformId: "pc",
    title: "Lantern Keepers",
    year: 2021,
    publisher: "Petit Phare",
    developer: "Studio Hibou",
    genre: "Aventure",
    players: "1 joueur",
    description:
      "Gardien d'un archipel de phares éteints, vous rallumez les lanternes une à une pour guider les navires perdus. Puzzles lumineux, mers calmes et tempêtes soudaines.",
    filePath: "Démonstration",
    addedAt: "2026-10-30T10:00:00Z",
    lastPlayedAt: "2026-11-11T21:10:00Z",
    isDemo: true,
    // présent sur deux boutiques : une seule fiche, deux versions
    pcInstalls: [install("steam", true, true), install("gog", true)],
    art: { motif: "grove", palette: ["#21415E", "#3F8FA8", "#FFE3A0", "#9FE3D6", "#FFFFFF"], tagline: "Rallumez l'archipel" },
  },
  {
    id: "demo-pc-cloudline-rally",
    platformId: "pc",
    title: "Cloudline Rally",
    year: 2023,
    publisher: "Ondine Interactive",
    developer: "Ondine Interactive",
    genre: "Course",
    players: "1 à 8 joueurs",
    description:
      "Des routes suspendues entre les nuages, des virages en épingle au-dessus de la mer et des remorqueurs volants. Une course arcade pleine de lumière.",
    filePath: "Démonstration",
    addedAt: "2026-11-08T15:30:00Z",
    isDemo: true,
    pcInstalls: [install("epic", true, true)],
    art: { motif: "racers", palette: ["#9AD7F0", "#E8F7FF", "#2C6FB8", "#FF8A7A", "#24324A"], tagline: "Au-dessus des nuages" },
  },
  {
    id: "demo-pc-reef-archive",
    platformId: "pc",
    title: "The Reef Archive",
    year: 2019,
    publisher: "Marée Basse",
    developer: "Marée Basse",
    genre: "Réflexion",
    players: "1 joueur",
    description:
      "Une bibliothèque engloutie, des livres qui respirent et une archiviste-pieuvre très organisée. Rangez, déchiffrez, et remontez à la surface.",
    filePath: "Démonstration",
    addedAt: "2026-09-12T09:00:00Z",
    isDemo: true,
    pcInstalls: [install("gog", false, true)],
    art: { motif: "tidepool", palette: ["#0E5E6F", "#5FC4B8", "#F7E7B4", "#FF9B85", "#FFFFFF"], tagline: "Archives des profondeurs" },
  },
  {
    id: "demo-pc-sugarfield",
    platformId: "pc",
    title: "Sugarfield",
    year: 2024,
    publisher: "Moelleux Games",
    developer: "Moelleux Games",
    genre: "Simulation",
    players: "1 à 4 joueurs",
    description:
      "Cultivez des champs de cannes à sucre, ouvrez une pâtisserie de village et préparez la grande fête des récoltes avec vos voisins.",
    filePath: "Démonstration",
    addedAt: "2026-11-02T12:00:00Z",
    lastPlayedAt: "2026-11-09T18:00:00Z",
    isDemo: true,
    pcInstalls: [install("xbox", true, true)],
    art: { motif: "bakery", palette: ["#F7C6D9", "#FFF1E0", "#B5577A", "#9BD8C4", "#4A2F3A"], tagline: "La fête des récoltes" },
  },
  {
    id: "demo-pc-ridgeback",
    platformId: "pc",
    title: "Ridgeback Trails",
    year: 2022,
    publisher: "Colline Verte",
    developer: "Colline Verte",
    genre: "Exploration",
    players: "1 à 2 joueurs",
    description:
      "Randonnée paisible au sommet d'une chaîne de montagnes vivante. Carnet de croquis, refuges chaleureux et levers de soleil au-dessus des nuages.",
    filePath: "Démonstration",
    addedAt: "2026-08-20T08:00:00Z",
    isDemo: true,
    pcInstalls: [install("ubisoft", false, true)],
    art: { motif: "mountain", palette: ["#3E6B5A", "#A6D6B8", "#FFE2B0", "#7FB8D8", "#FFFFFF"], tagline: "Le chemin des crêtes" },
  },
  {
    id: "demo-pc-starbound-diner",
    platformId: "pc",
    title: "Starbound Diner",
    year: 2020,
    publisher: "Moelleux Games",
    developer: "Studio Comète",
    genre: "Gestion",
    players: "1 joueur",
    description:
      "Un petit restaurant au bord d'une route spatiale. Servez des voyageurs venus de toute la galaxie et découvrez leurs histoires entre deux crêpes.",
    filePath: "Démonstration",
    addedAt: "2026-10-05T19:00:00Z",
    isDemo: true,
    pcInstalls: [install("manual", true, true)],
    art: { motif: "bakery", palette: ["#2B2350", "#7462C9", "#FFD58A", "#FF9FB2", "#FFFFFF"], tagline: "Ouvert toute la nuit" },
  },
];

export const PC_DEMO_GAMES: Game[] = raw.map((g) => ({ ...g, sortTitle: sortKey(g.title) }));
