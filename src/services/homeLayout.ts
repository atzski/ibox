/**
 * Accueil personnalisable : les sections s'affichent dans l'ordre choisi,
 * et chacune peut être masquée. Tout est enregistré dans les réglages.
 */

export type HomeBlockId = "hero" | "consoles" | "collections" | "recent" | "favorites";

export interface HomeBlock {
  id: HomeBlockId;
  visible: boolean;
}

export const BLOCK_INFO: Record<HomeBlockId, { label: string; note: string }> = {
  hero: { label: "Reprendre", note: "Votre dernière aventure et la collection" },
  consoles: { label: "Consoles", note: "Accès rapide à chaque console" },
  collections: { label: "Mes collections", note: "Vos rangements personnels, en étagère 3D" },
  recent: { label: "Ajoutés récemment", note: "Les derniers jeux trouvés" },
  favorites: { label: "Favoris", note: "Vos jeux préférés" },
};

export const DEFAULT_BLOCKS: HomeBlock[] = [
  { id: "hero", visible: true },
  { id: "consoles", visible: true },
  { id: "collections", visible: true },
  { id: "recent", visible: true },
  { id: "favorites", visible: true },
];

/** Complète une liste enregistrée avec les sections ajoutées depuis (sans doublons). */
export function normalizeBlocks(saved: HomeBlock[] | undefined): HomeBlock[] {
  const known = new Set<HomeBlockId>(DEFAULT_BLOCKS.map((b) => b.id));
  const out = (saved ?? []).filter((b, i, all) => known.has(b.id) && all.findIndex((x) => x.id === b.id) === i);
  // une section ajoutée depuis prend sa place par défaut (après celle qui la précède)
  DEFAULT_BLOCKS.forEach((b, i) => {
    if (out.some((x) => x.id === b.id)) return;
    const before = DEFAULT_BLOCKS[i - 1];
    const at = before ? out.findIndex((x) => x.id === before.id) + 1 : 0;
    out.splice(at, 0, { ...b });
  });
  return out;
}
