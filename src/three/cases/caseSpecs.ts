import type { CaseKind, Platform } from "@/domain/types";

/**
 * Spécifications physiques des boîtiers (1 unité = 10 cm).
 *
 * Deux modèles paramétriques couvrent toutes les consoles :
 *  - `KeepCase` : boîtier plastique à charnière (disques, mini-disques, cartes) ;
 *  - `RetroBox` : boîte en carton dont un plateau coulisse avec la cartouche.
 * Seules les dimensions, les matières et le support changent : aucun modèle
 * n'est propre à un jeu. Proportions crédibles, sans viser le photoréalisme.
 */
export interface DiscMedia {
  type: "disc";
  radius: number;
  holeRadius: number;
  thickness: number;
  /** Centre dans le plateau (depuis le centre du boîtier). */
  offset: [number, number];
}

export interface CardMedia {
  type: "card";
  width: number;
  height: number;
  thickness: number;
  offset: [number, number];
  color: string;
}

export type CaseMedia = DiscMedia | CardMedia;

export interface KeepCaseSpec {
  model: "keep";
  kind: CaseKind;
  width: number;
  height: number;
  depth: number;
  /** Épaisseur des parois. */
  shell: number;
  radius: number;
  plastic: string;
  plasticInner: string;
  /** Angle d'ouverture maximal de la face avant (radians). */
  openAngle: number;
  media: CaseMedia;
  /**
   * Modèle physique Blender (GLB, 3d-assets/) utilisé à la place du boîtier
   * procédural. Absent : boîtier procédural. En cas d'échec de chargement, on
   * revient aussi au procédural.
   */
  glb?: string;
}

export type CartridgeShape = "n64" | "snes" | "gb" | "gba";

export interface CartridgeSpec {
  shape: CartridgeShape;
  width: number;
  height: number;
  depth: number;
  color: string;
  /** Zone de l'étiquette en fraction de la face : [gauche, haut, largeur, hauteur]. */
  label: [number, number, number, number];
}

export interface BoxSpec {
  model: "box";
  kind: CaseKind;
  width: number;
  height: number;
  depth: number;
  cardboard: string;
  tray: string;
  cartridge: CartridgeSpec;
}

export type CaseSpec = KeepCaseSpec | BoxSpec;

const keep = (s: Omit<KeepCaseSpec, "model" | "shell" | "radius" | "openAngle"> & Partial<KeepCaseSpec>): KeepCaseSpec => ({
  model: "keep",
  shell: 0.016,
  radius: 0.012,
  openAngle: Math.PI * 0.86,
  ...s,
});

export const GAMECUBE_CASE: KeepCaseSpec = keep({
  kind: "gamecube",
  width: 1.36,
  height: 1.91,
  depth: 0.14,
  plastic: "#202329",
  plasticInner: "#2b2f37",
  // mini-disque optique de 8 cm
  media: { type: "disc", radius: 0.4, holeRadius: 0.075, thickness: 0.012, offset: [0.13, 0.12] },
});

const DVD_DISC: DiscMedia = { type: "disc", radius: 0.6, holeRadius: 0.075, thickness: 0.012, offset: [0.03, 0.08] };

const SPECS: Record<string, CaseSpec> = {
  gamecube: GAMECUBE_CASE,
  wii: keep({ kind: "wii", width: 1.36, height: 1.91, depth: 0.14, plastic: "#f2f3f5", plasticInner: "#e1e4e9", media: DVD_DISC }),
  // boîtier bleu translucide de la Wii U
  wiiu: keep({ kind: "wiiu", width: 1.35, height: 1.91, depth: 0.14, plastic: "#2a9fd8", plasticInner: "#1f86bb", media: DVD_DISC }),
  ps2: keep({ kind: "ps2", width: 1.35, height: 1.9, depth: 0.14, plastic: "#15171b", plasticInner: "#20242a", media: DVD_DISC }),
  // boîtier « cristal » : plus large que haut, plus fin
  ps1: keep({
    kind: "ps1",
    width: 1.42,
    height: 1.25,
    depth: 0.1,
    shell: 0.012,
    plastic: "#1b1d22",
    plasticInner: "#25282e",
    openAngle: Math.PI * 0.8,
    media: { type: "disc", radius: 0.58, holeRadius: 0.075, thickness: 0.012, offset: [0.06, 0] },
  }),
  psp: keep({
    kind: "psp",
    width: 1.04,
    height: 1.8,
    depth: 0.14,
    plastic: "#17191d",
    plasticInner: "#22252b",
    // disque UMD (6 cm)
    media: { type: "disc", radius: 0.3, holeRadius: 0.05, thickness: 0.02, offset: [0.06, 0.38] },
  }),
  ds: keep({
    kind: "ds",
    // boîtier plus large que haut (jaquettes ≈ 137 × 125 mm)
    width: 1.37,
    height: 1.25,
    depth: 0.14,
    plastic: "#e6e9ed",
    plasticInner: "#d6dae0",
    media: { type: "card", width: 0.35, height: 0.33, thickness: 0.038, offset: [0.24, 0.24], color: "#3a3d44" },
  }),
  "3ds": keep({
    kind: "3ds",
    // boîtier plus large que haut (jaquettes ≈ 137 × 125 mm)
    width: 1.37,
    height: 1.25,
    depth: 0.14,
    plastic: "#f3f4f6",
    plasticInner: "#e3e6ea",
    media: { type: "card", width: 0.35, height: 0.33, thickness: 0.038, offset: [0.24, 0.24], color: "#2f3238" },
  }),
  switch: keep({
    kind: "switch",
    width: 1.05,
    height: 1.7,
    depth: 0.11,
    shell: 0.013,
    plastic: "#d3d7dd",
    plasticInner: "#c3c8cf",
    openAngle: Math.PI * 0.97,
    media: { type: "card", width: 0.21, height: 0.31, thickness: 0.03, offset: [0.1, 0.42], color: "#2a2d33" },
    glb: "/models/cases/switch.glb",
  }),
  // PC : boîtier DVD (sur l'étagère « toutes les consoles » seulement)
  pc: keep({
    kind: "pc",
    width: 1.35,
    height: 1.9,
    depth: 0.14,
    plastic: "#e9f4f6",
    plasticInner: "#d6e7ea",
    media: DVD_DISC,
  }),
  // même format de boîtier ; carte de jeu rouge
  switch2: keep({
    kind: "switch",
    width: 1.05,
    height: 1.7,
    depth: 0.11,
    shell: 0.013,
    plastic: "#c9cdd4",
    plasticInner: "#b9bec6",
    openAngle: Math.PI * 0.97,
    media: { type: "card", width: 0.21, height: 0.31, thickness: 0.03, offset: [0.1, 0.42], color: "#b8323c" },
    glb: "/models/cases/switch2.glb",
  }),
};

// Modèles physiques des autres boîtiers (3d-assets/source/keep-cases, un seul générateur)
for (const id of ["gamecube", "wii", "ps2", "pc", "ps1", "psp", "ds", "3ds"]) {
  const s = SPECS[id];
  if (s?.model === "keep" && !s.glb) s.glb = `/models/cases/${id}.glb`;
}

/** Tous les modèles GLB de boîtiers (préchargement). */
export const CASE_MODELS: string[] = Object.values(SPECS).flatMap((s) => (s.model === "keep" && s.glb ? [s.glb] : []));

const BOXES: Record<string, BoxSpec> = {
  n64: {
    model: "box",
    kind: "retro-box",
    width: 1.8,
    height: 1.3,
    depth: 0.37,
    cardboard: "#e9e4da",
    tray: "#f4f1ea",
    cartridge: { shape: "n64", width: 1.16, height: 0.75, depth: 0.2, color: "#5d6168", label: [0.1, 0.06, 0.8, 0.6] },
  },
  snes: {
    model: "box",
    kind: "retro-box",
    width: 1.8,
    height: 1.3,
    depth: 0.37,
    cardboard: "#ece8df",
    tray: "#f4f1ea",
    cartridge: { shape: "snes", width: 1.2, height: 0.9, depth: 0.2, color: "#9aa0a8", label: [0.15, 0.08, 0.7, 0.58] },
  },
  gb: {
    model: "box",
    kind: "cartridge",
    // boîte presque carrée, comme les vraies (jaquettes ~ 1:1)
    width: 1.27,
    height: 1.29,
    depth: 0.28,
    cardboard: "#ece8df",
    tray: "#f4f1ea",
    cartridge: { shape: "gb", width: 0.57, height: 0.65, depth: 0.08, color: "#b9bdc4", label: [0.1, 0.16, 0.8, 0.56] },
  },
  gbc: {
    model: "box",
    kind: "cartridge",
    // boîte presque carrée, comme les vraies (jaquettes ~ 1:1)
    width: 1.27,
    height: 1.29,
    depth: 0.28,
    cardboard: "#ece8df",
    tray: "#f4f1ea",
    cartridge: { shape: "gb", width: 0.57, height: 0.65, depth: 0.08, color: "#3d4149", label: [0.1, 0.16, 0.8, 0.56] },
  },
  gba: {
    model: "box",
    kind: "cartridge",
    width: 1.12,
    height: 1.3,
    depth: 0.28,
    cardboard: "#ece8df",
    tray: "#f4f1ea",
    cartridge: { shape: "gba", width: 0.57, height: 0.35, depth: 0.08, color: "#8d929a", label: [0.08, 0.12, 0.84, 0.72] },
  },
};

/** Modèle 3D d'une console (repli : boîtier GameCube générique). */
export function caseFor(platform: Platform | string): CaseSpec {
  const id = typeof platform === "string" ? platform : platform.id;
  return SPECS[id] ?? BOXES[id] ?? GAMECUBE_CASE;
}

/** Nom du support pour l'interface. */
export function mediaLabel(spec: CaseSpec): { noun: string; out: string; putBack: string } {
  if (spec.model === "box") return { noun: "Cartouche", out: "Ranger", putBack: "Ranger la cartouche" };
  return spec.media.type === "card"
    ? { noun: "Carte", out: "Ranger", putBack: "Ranger la carte" }
    : { noun: "Disque", out: "Ranger", putBack: "Ranger le disque" };
}

/** Taille apparente (pour cadrer la caméra). */
export function caseExtent(spec: CaseSpec): number {
  return Math.max(spec.height, spec.width * 0.92);
}
