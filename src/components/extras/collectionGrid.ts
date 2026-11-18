/**
 * Grille de l'accueil pour les collections : des cases carrées sur toute la largeur.
 * Une carte carrée (icône de licence, décoration) prend 1 case, une carte large 2 cases
 * côte à côte. Une position (« slot ») est l'indice de la case en haut à gauche,
 * lu de gauche à droite, ligne après ligne.
 */
export interface GridItem {
  id: number;
  span: 1 | 2;
  /** Case choisie par le joueur, si elle existe encore. */
  slot?: number;
}

const cellsOf = (slot: number, span: number) => Array.from({ length: span }, (_, k) => slot + k);

function fits(taken: Set<number>, slot: number, span: number, cols: number) {
  if (slot < 0 || (slot % cols) + span > cols) return false;
  return cellsOf(slot, span).every((c) => !taken.has(c));
}

function firstFit(taken: Set<number>, span: number, cols: number, from = 0) {
  for (let s = Math.max(0, from); ; s++) if (fits(taken, s, span, cols)) return s;
}

/** Case de chaque carte : celle choisie si elle tient, sinon la première place libre. */
export function layoutGrid(items: GridItem[], cols: number) {
  const taken = new Set<number>();
  const at = new Map<number, number>();
  for (const it of items) {
    if (it.slot === undefined || !fits(taken, it.slot, it.span, cols)) continue;
    cellsOf(it.slot, it.span).forEach((c) => taken.add(c));
    at.set(it.id, it.slot);
  }
  for (const it of items) {
    if (at.has(it.id)) continue;
    const s = firstFit(taken, it.span, cols);
    cellsOf(s, it.span).forEach((c) => taken.add(c));
    at.set(it.id, s);
  }
  return at;
}

/** Une carte large lâchée sur la dernière colonne se cale à gauche pour tenir. */
export function anchorFor(cell: number, span: number, cols: number) {
  const over = (cell % cols) + span - cols;
  return over > 0 ? cell - over : cell;
}

/**
 * Pose la carte `id` sur la case `target`. Les cartes qu'elle recouvre prennent son
 * ancienne place si elles y tiennent (échange), sinon la place libre la plus proche.
 */
export function moveInGrid(items: GridItem[], cols: number, at: Map<number, number>, id: number, target: number) {
  const span = items.find((i) => i.id === id)?.span ?? 1;
  const from = at.get(id);
  const anchor = anchorFor(target, span, cols);
  if (from === undefined || anchor === from) return at;
  const spanOf = new Map(items.map((i) => [i.id, i.span]));
  const covered = new Set(cellsOf(anchor, span));
  const displaced = items.filter((i) => i.id !== id && cellsOf(at.get(i.id)!, i.span).some((c) => covered.has(c)));
  const next = new Map<number, number>();
  const taken = new Set<number>(covered);
  next.set(id, anchor);
  for (const it of items) {
    if (it.id === id || displaced.includes(it)) continue;
    const s = at.get(it.id)!;
    next.set(it.id, s);
    cellsOf(s, it.span).forEach((c) => taken.add(c));
  }
  for (const it of displaced) {
    const sp = spanOf.get(it.id)!;
    const s = fits(taken, from, sp, cols) ? from : firstFit(taken, sp, cols, from) ;
    next.set(it.id, s);
    cellsOf(s, sp).forEach((c) => taken.add(c));
  }
  // aucune ligne entièrement vide en tête
  const shift = Math.floor(Math.min(...next.values()) / cols) * cols;
  if (shift) for (const [k, s] of next) next.set(k, s - shift);
  return next;
}

/** Cases occupées (pour dessiner les cases libres pendant le rangement). */
export function occupiedCells(items: GridItem[], at: Map<number, number>) {
  const set = new Set<number>();
  for (const it of items) cellsOf(at.get(it.id)!, it.span).forEach((c) => set.add(c));
  return set;
}
