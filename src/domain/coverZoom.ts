/**
 * Recul de la grille de jaquettes : logique pure (sans DOM), testée à part.
 *
 * La grille a plusieurs niveaux, du niveau 0 (l'affichage d'origine, inchangé) à une vue
 * très dense où des centaines de jaquettes tiennent à l'écran. Chaque niveau fixe la taille
 * des jaquettes, leurs écarts et ce qu'on montre encore autour d'elles. La grille n'affiche
 * que les rangées visibles : tout ce qui suit calcule des positions à partir d'une largeur,
 * jamais en lisant l'écran.
 */

/** Ce qu'une carte montre : tout, le titre seul, la jaquette et son repère de favori, la jaquette nue. */
export type CoverDetail = "full" | "title" | "cover" | "bare";

export interface ZoomLevel {
  /** Taille des jaquettes par rapport au niveau 0. */
  scale: number;
  /** Écarts horizontal et vertical (rem). */
  gapX: number;
  gapY: number;
  detail: CoverDetail;
}

export const ZOOM_LEVELS: readonly ZoomLevel[] = [
  { scale: 1, gapX: 1.5, gapY: 1.75, detail: "full" },
  { scale: 0.72, gapX: 1.1, gapY: 1.2, detail: "title" },
  { scale: 0.5, gapX: 0.7, gapY: 0.7, detail: "cover" },
  { scale: 0.34, gapX: 0.4, gapY: 0.4, detail: "bare" },
  { scale: 0.22, gapX: 0.25, gapY: 0.25, detail: "bare" },
];

export const MAX_ZOOM = ZOOM_LEVELS.length - 1;

/** Marges de la grille (rem) : celles de l'affichage d'origine, pour l'anneau de focus. */
const PAD = { x: 0.75, top: 1.25, bottom: 2 };

/** Niveau valide le plus proche (réglage absent, ancien ou abîmé : niveau 0). */
export function clampZoom(level: unknown): number {
  const n = typeof level === "number" && Number.isFinite(level) ? Math.round(level) : 0;
  return Math.max(0, Math.min(MAX_ZOOM, n));
}

/** Recule (`+1`) ou avance (`-1`) d'un niveau, sans dépasser les extrémités. */
export function stepZoom(level: number, delta: number): number {
  return clampZoom(clampZoom(level) + delta);
}

/**
 * Hauteur du texte sous la jaquette (rem). Niveau 0 : marge, titre et ligne d'infos, tels
 * que le navigateur les mesurait avant la virtualisation (interligne 1,5).
 */
export function metaHeight(detail: CoverDetail, pc = false): number {
  if (detail === "full") return pc ? 0.75 + 1.5 + 0.25 + 1.125 : 0.75 + 1.5 + 0.82 * 1.5;
  if (detail === "title") return 0.45 + 0.84 * 1.5;
  return 0;
}

/** Nombre de colonnes d'un `repeat(auto-fill, minmax(min, 1fr))` : même règle que le CSS. */
export function columnsFor(width: number, minCell: number, gap: number): number {
  if (!(width > 0) || !(minCell > 0)) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCell + gap)));
}

export interface GridLayout {
  level: number;
  detail: CoverDetail;
  count: number;
  cols: number;
  rows: number;
  /** Largeur d'une jaquette (px). */
  cellW: number;
  gapX: number;
  gapY: number;
  padX: number;
  padTop: number;
  /** Hauteur du texte sous la jaquette (px). */
  metaH: number;
  /** Haut de chaque rangée (px, depuis le haut du contenu) ; `rows + 1` valeurs. */
  rowTop: number[];
  /** Hauteur de chaque rangée, texte compris, sans l'écart. */
  rowH: number[];
  /** Rapport largeur / hauteur de chaque jaquette. */
  aspects: ArrayLike<number>;
  /** Hauteur totale du contenu. */
  height: number;
}

export interface LayoutInput {
  /** Largeur intérieure de la zone qui défile (px). */
  width: number;
  /** Taille d'un rem (px). */
  rem: number;
  /** Largeur de jaquette au niveau 0 (rem), densité des Paramètres comprise. */
  cardRem: number;
  level: number;
  /** Rapport largeur / hauteur de chaque jaquette, dans l'ordre d'affichage. */
  aspects: ArrayLike<number>;
  pc?: boolean;
}

/**
 * Place toutes les rangées. Une rangée a la hauteur de sa jaquette la plus haute (comme la
 * grille CSS d'origine) : la collection complète mélange des boîtiers de formats différents.
 */
export function computeLayout({ width, rem, cardRem, level, aspects, pc = false }: LayoutInput): GridLayout {
  const lv = clampZoom(level);
  const z = ZOOM_LEVELS[lv];
  const padX = PAD.x * rem;
  const padTop = PAD.top * rem;
  const gapX = z.gapX * rem;
  const gapY = z.gapY * rem;
  const inner = Math.max(0, width - 2 * padX);
  const cols = columnsFor(inner, cardRem * z.scale * rem, gapX);
  const cellW = Math.max(1, (inner - (cols - 1) * gapX) / cols);
  const metaH = metaHeight(z.detail, pc) * rem;
  const count = aspects.length;
  const rows = Math.ceil(count / cols);
  const rowTop = new Array<number>(rows + 1);
  const rowH = new Array<number>(rows);
  let y = padTop;
  for (let r = 0; r < rows; r++) {
    let narrowest = Infinity;
    const end = Math.min(count, (r + 1) * cols);
    for (let i = r * cols; i < end; i++) narrowest = Math.min(narrowest, aspects[i] > 0 ? aspects[i] : 1);
    rowTop[r] = y;
    rowH[r] = cellW / narrowest + metaH;
    y += rowH[r] + gapY;
  }
  rowTop[rows] = y;
  const height = (rows ? y - gapY : padTop) + PAD.bottom * rem;
  return { level: lv, detail: z.detail, count, cols, rows, cellW, gapX, gapY, padX, padTop, metaH, rowTop, rowH, aspects, height };
}

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Case d'un jeu dans le contenu (sa rangée entière en hauteur). */
export function cellRect(layout: GridLayout, index: number): CellRect {
  const i = Math.max(0, Math.min(layout.count - 1, index));
  const row = Math.floor(i / layout.cols);
  const col = i % layout.cols;
  return {
    x: layout.padX + col * (layout.cellW + layout.gapX),
    y: layout.rowTop[row] ?? layout.padTop,
    w: layout.cellW,
    h: layout.rowH[row] ?? 0,
  };
}

/**
 * Jaquette d'un jeu dans le contenu, à son propre format. Avec le texte dessous, elle est
 * posée en haut de sa rangée (comme la grille d'origine) ; sans texte, elle est centrée dans
 * la hauteur de la rangée, pour que des boîtiers de formats différents restent alignés.
 */
export function coverRect(layout: GridLayout, index: number): CellRect {
  const i = Math.max(0, Math.min(layout.count - 1, index));
  const r = cellRect(layout, i);
  const aspect = layout.aspects[i] > 0 ? layout.aspects[i] : 1;
  const h = layout.cellW / aspect;
  const centered = layout.detail === "cover" || layout.detail === "bare";
  return { x: r.x, y: centered ? r.y + (r.h - layout.metaH - h) / 2 : r.y, w: r.w, h };
}

/** Rangée qui contient l'ordonnée `y` (la plus proche si `y` tombe dans un écart ou dehors). */
export function rowAt(layout: GridLayout, y: number): number {
  let lo = 0;
  let hi = layout.rows - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.rowTop[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Première et dernière rangées à afficher entre deux ordonnées du contenu (bornes incluses). */
export function rowRange(layout: GridLayout, top: number, bottom: number): [number, number] {
  if (layout.rows === 0) return [0, -1];
  return [rowAt(layout, top), rowAt(layout, Math.max(top, bottom))];
}

/** Jeu le plus proche d'un point du contenu. */
export function indexAt(layout: GridLayout, x: number, y: number): number {
  if (layout.count === 0) return -1;
  const row = rowAt(layout, y);
  const pitch = layout.cellW + layout.gapX;
  const col = Math.max(0, Math.min(layout.cols - 1, Math.floor((x - layout.padX + layout.gapX / 2) / pitch)));
  return Math.min(layout.count - 1, row * layout.cols + col);
}

/** Défilement maximal pour une hauteur de zone visible. */
export function maxScroll(layout: GridLayout, viewportH: number): number {
  return Math.max(0, layout.height - viewportH);
}

/**
 * Jeu qui sert de repère pendant un changement de niveau : le jeu sélectionné s'il est à
 * l'écran, sinon celui du centre de la vue.
 */
export function pickAnchor(layout: GridLayout, scrollTop: number, viewportH: number, focusIndex = -1): number {
  if (layout.count === 0) return -1;
  if (focusIndex >= 0 && focusIndex < layout.count) {
    const r = cellRect(layout, focusIndex);
    if (r.y + r.h > scrollTop && r.y < scrollTop + viewportH) return focusIndex;
  }
  return indexAt(layout, layout.padX + (layout.cols * (layout.cellW + layout.gapX)) / 2, scrollTop + viewportH / 2);
}

/**
 * Défilement qui remet le centre du jeu repère à la même hauteur de l'écran (`viewportY`,
 * depuis le haut de la zone visible) dans une nouvelle disposition.
 */
export function anchoredScroll(layout: GridLayout, index: number, viewportY: number, viewportH: number): number {
  if (index < 0 || layout.count === 0) return 0;
  const r = cellRect(layout, index);
  return Math.max(0, Math.min(maxScroll(layout, viewportH), r.y + r.h / 2 - viewportY));
}

/** Défilement le plus court qui montre un jeu en entier (avec une marge pour l'anneau de focus). */
export function revealScroll(layout: GridLayout, index: number, scrollTop: number, viewportH: number, margin = 0): number {
  const r = cellRect(layout, index);
  const limit = maxScroll(layout, viewportH);
  if (r.y - margin < scrollTop) return Math.max(0, Math.min(limit, r.y - margin));
  if (r.y + r.h + margin > scrollTop + viewportH) return Math.max(0, Math.min(limit, r.y + r.h + margin - viewportH));
  return scrollTop;
}

export type GridDirection = "up" | "down" | "left" | "right";

/**
 * Déplacement d'une case. `null` : on sort de la grille par le haut (la barre d'outils prend
 * le relais). Les bords gauche et droit ne bouclent pas ; en bas, une dernière rangée
 * incomplète envoie sur son dernier jeu.
 */
export function moveIndex(index: number, dir: GridDirection, cols: number, count: number): number | null {
  if (count <= 0) return null;
  const i = Math.max(0, Math.min(count - 1, index));
  const col = i % cols;
  switch (dir) {
    case "left":
      return col > 0 ? i - 1 : i;
    case "right":
      return col < cols - 1 && i + 1 < count ? i + 1 : i;
    case "up":
      return i >= cols ? i - cols : null;
    case "down": {
      if (i + cols < count) return i + cols;
      const lastRow = Math.floor((count - 1) / cols);
      return Math.floor(i / cols) < lastRow ? count - 1 : i;
    }
  }
}

/** Saut d'une page (gâchettes, Page préc. / suiv.) : même colonne, au moins une rangée. */
export function pageIndex(layout: GridLayout, index: number, sign: -1 | 1, viewportH: number): number {
  if (layout.count === 0) return -1;
  const i = Math.max(0, Math.min(layout.count - 1, index));
  const row = Math.floor(i / layout.cols);
  const col = i % layout.cols;
  let target = rowAt(layout, layout.rowTop[row] + sign * Math.max(1, viewportH * 0.8));
  if (target === row) target = row + sign;
  target = Math.max(0, Math.min(layout.rows - 1, target));
  return Math.min(layout.count - 1, target * layout.cols + col);
}

/**
 * Largeur (px) de la vignette à charger pour une jaquette affichée sur `cellW` px, ou `0`
 * pour l'image complète. Paliers fixes : un même jeu ne produit que quelques vignettes.
 */
export function thumbWidth(cellW: number, pixelRatio = 1): number {
  const needed = cellW * Math.max(1, Math.min(2, pixelRatio));
  for (const step of [96, 192, 320]) if (needed <= step) return step;
  return 0;
}

/** Transformation du contenu pendant l'animation : `origine + (p - origine) × scale + (x, y)`. */
export interface GridTransform {
  x: number;
  y: number;
  scale: number;
  originX: number;
  originY: number;
}

export const IDENTITY: GridTransform = { x: 0, y: 0, scale: 1, originX: 0, originY: 0 };

export interface ZoomTransition {
  /** Jeu repère. */
  index: number;
  /** Défilement de la nouvelle disposition. */
  scrollTop: number;
  /** Transformation de départ : le jeu repère y est exactement là où on le voyait, à sa taille d'avant. */
  from: GridTransform;
}

/**
 * Passage d'une disposition à une autre (changement de niveau, ou de nombre de colonnes).
 * Le jeu repère garde sa place : le défilement le remet à la même hauteur, puis la
 * transformation de départ comble ce qui reste (colonne différente, taille différente,
 * butée en haut ou en bas de la liste). L'animation n'a plus qu'à la ramener à zéro.
 * `current` : transformation en cours si une animation précédente n'est pas finie.
 */
export function zoomTransition(
  prev: GridLayout,
  next: GridLayout,
  opts: { scrollTop: number; viewportH: number; focusIndex?: number; anchorIndex?: number; current?: GridTransform },
): ZoomTransition | null {
  if (next.count === 0 || prev.count !== next.count) return null;
  const { scrollTop, viewportH, current = IDENTITY } = opts;
  const anchor = opts.anchorIndex ?? -1;
  const index = anchor >= 0 && anchor < prev.count ? anchor : pickAnchor(prev, scrollTop, viewportH, opts.focusIndex);
  if (index < 0) return null;
  const a = coverRect(prev, index);
  // où l'on voit le jeu en ce moment (contenu transformé, puis défilement)
  const seenW = a.w * current.scale;
  const seenX = current.originX + (a.x + a.w / 2 - current.originX) * current.scale + current.x;
  const seenY = current.originY + (a.y + a.h / 2 - current.originY) * current.scale + current.y - scrollTop;
  const b = coverRect(next, index);
  const top = Math.max(0, Math.min(maxScroll(next, viewportH), b.y + b.h / 2 - seenY));
  const originX = b.x + b.w / 2;
  const originY = b.y + b.h / 2;
  return {
    index,
    scrollTop: top,
    from: { x: seenX - originX, y: seenY - (originY - top), scale: seenW / b.w, originX, originY },
  };
}
