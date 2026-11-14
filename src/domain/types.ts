/**
 * Types métier partagés. Aucune dépendance à React, Three.js ou Tauri :
 * ces types décrivent la collection et sont réutilisés par toutes les couches.
 */

/** Identifiant de console. Volontairement `string` : de nouvelles consoles s'ajoutent par simple déclaration. */
export type PlatformId = string;

/** Modèles physiques réutilisables (un modèle 3D par type, jamais par jeu). */
export type CaseKind =
  | "gamecube"
  | "wii"
  | "wiiu"
  | "ds"
  | "3ds"
  | "ps1"
  | "ps2"
  | "psp"
  | "switch"
  | "pc"
  | "retro-box"
  | "cartridge";

export type MediaKind = "disc" | "mini-disc" | "cartridge" | "card" | "umd";

/** Style de mouvement propre à l'identité d'une console. */
export type MotionPersonality = "bouncy" | "airy" | "snappy" | "calm" | "floaty";

export interface PlatformTheme {
  /** Couleur principale (cartes, anneau de focus). */
  primary: string;
  /** Teinte très claire pour les fonds. */
  soft: string;
  /** Teinte profonde, lisible en texte sur fond clair. */
  deep: string;
  /** Dégradé d'ambiance de la bibliothèque. */
  gradient: [string, string];
  /** Ambiance claire ou sombre de la bibliothèque. */
  mood: "light" | "dark";
  motion: MotionPersonality;
}

export type GlyphId =
  | "cube"
  | "slim-tower"
  | "dual-screen"
  | "dual-screen-3d"
  | "cartridge-wide"
  | "handheld-portrait"
  | "handheld-wide"
  | "hybrid"
  | "disc-square"
  | "tower-stripes"
  | "handheld-oval"
  | "computer";

export interface PlatformLayout {
  /** Rapport largeur/hauteur des jaquettes de cette console. */
  coverAspect: number;
  /** Largeur cible d'une carte dans la grille (rem). */
  gridCardWidth: number;
}

export interface Platform {
  id: PlatformId;
  name: string;
  shortName: string;
  manufacturer: "Nintendo" | "Sony" | string;
  /** Famille partagée (ex. Game Boy / Color / Advance). */
  family?: string;
  year: number;
  theme: PlatformTheme;
  glyph: GlyphId;
  caseKind: CaseKind;
  media: MediaKind;
  /** Extensions reconnues (en minuscules, avec le point). Une extension peut être partagée : voir docs. */
  extensions: string[];
  /** Identifiants d'émulateurs suggérés (profils de lancement — phase 4). */
  emulatorHints: string[];
  layout: PlatformLayout;
  /** Musique d'ambiance propre à la console (ex. "/sounds/gamecube.mp3"). Sinon : musique de menu. */
  ambience?: string;
}

/** Description d'un habillage procédural (démo ou remplacement élégant). */
export type CoverMotif =
  | "grove"
  | "racers"
  | "tidepool"
  | "bakery"
  | "mountain"
  | "placeholder";

export interface CoverArtSpec {
  motif: CoverMotif;
  /** Palette : [ciel/fond haut, fond bas, accent, accent secondaire, encre]. */
  palette: [string, string, string, string, string];
  tagline?: string;
}

/** Installation (ou version) d'un jeu PC chez une source : Steam, GOG, ajout manuel… */
export interface PcInstall {
  id: number;
  source: string;
  externalId: string;
  launchKind: "exe" | "protocol" | "none";
  launchTarget: string | null;
  installDir: string | null;
  installed: boolean;
  preferred: boolean;
  /** Masqué par l'utilisateur (outil, logiciel qui n'est pas un jeu). */
  hidden?: boolean;
  /** Temps de jeu enregistré par la boutique (minutes). */
  playtimeMinutes?: number | null;
  /** Jeu de la Famille Steam (possédé par un autre membre). */
  family?: boolean;
}

export interface Game {
  id: string;
  platformId: PlatformId;
  title: string;
  /** Titre normalisé pour le tri (sans article, minuscules). */
  sortTitle: string;
  year?: number;
  publisher?: string;
  developer?: string;
  genre?: string;
  players?: string;
  region?: "PAL" | "NTSC-U" | "NTSC-J";
  description?: string;
  filePath: string;
  /** ISO 8601 */
  addedAt: string;
  lastPlayedAt?: string;
  /** Jeu de démonstration (phase 1) — affiché comme tel dans l'interface. */
  isDemo?: boolean;

  // — Collection réelle (phase 2) —
  /** Identifiant en base (absent pour les jeux de démonstration). */
  dbId?: number;
  /** Favori enregistré en base (les favoris de démo restent dans les réglages). */
  favorite?: boolean;
  /** Fichier introuvable lors de la dernière actualisation (disque débranché…). */
  missing?: boolean;
  /** Identification incertaine : l'utilisateur doit confirmer la console. */
  needsReview?: boolean;
  /** Un autre fichier présent a exactement le même contenu. */
  duplicate?: boolean;
  /** Consoles alternatives proposées en cas d'ambiguïté. */
  alternatives?: string[];
  serial?: string;
  idMethod?: "header" | "folder" | "filename" | "database" | "manual";
  fileSize?: number;
  discCount?: number;
  /** Jeux PC : installations connues (une par source). */
  pcInstalls?: PcInstall[];
  /** Images en cache (phase 3). */
  media?: import("@/services/metadata").MediaRef[];
  /** Recherche de jaquette : trouvée, à choisir, ou rien trouvé. */
  mediaStatus?: "found" | "ambiguous" | "none" | null;
  /** Origine des informations textuelles. */
  metaSource?: "gametdb" | "libretro-db" | null;
  /** Émulateur choisi pour ce jeu (sinon celui de sa console). */
  emulatorId?: number | null;
  playCount?: number;
  playSeconds?: number;
  art: CoverArtSpec;
}
