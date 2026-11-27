/** Grille de la vue en jaquettes sans 3D (`components/library/FlatShelf.tsx`) : calculs purs, testés. */

/** Largeur visée d'une jaquette, en rem (avant d'ajuster au nombre de colonnes). */
const CELL_REM = 8.5;
const GAP_REM = 0.9;

export interface FlatGrid {
  cols: number;
  cellW: number;
  cellH: number;
  gap: number;
  rows: number;
}

/**
 * Disposition de la grille (pure, testée) : colonnes, taille des cases, rangées. `height` : hauteur
 * visible ; sur un écran bas (console Android en paysage), une rangée entière et le haut de la
 * suivante doivent tenir, quitte à prendre des jaquettes plus petites.
 */
export function flatGrid(width: number, rem: number, count: number, aspect: number, height = 0): FlatGrid {
  const gap = Math.round(GAP_REM * rem);
  const fit = height > 0 ? ((height - gap) / 1.3) * aspect : Infinity;
  const target = Math.max(4.5 * rem, Math.min(CELL_REM * rem, fit));
  const cols = Math.max(2, Math.floor((width + gap) / (target + gap)));
  const cellW = Math.max(1, (width - gap * (cols - 1)) / cols);
  const cellH = cellW / aspect;
  return { cols, cellW, cellH, gap, rows: Math.ceil(count / cols) };
}

/** Index après un déplacement dans la grille ; `null` : on sort par le bord (haut ou bas). */
export function flatMove(index: number, key: string, cols: number, count: number, pageRows = 3): number | null {
  const row = Math.floor(index / cols);
  const lastRow = Math.floor((count - 1) / cols);
  switch (key) {
    case "ArrowLeft":
      return Math.max(0, index - 1);
    case "ArrowRight":
      return Math.min(count - 1, index + 1);
    case "ArrowUp":
      return row === 0 ? null : index - cols;
    case "ArrowDown":
      return row >= lastRow ? null : Math.min(count - 1, index + cols);
    case "PageUp":
      return Math.max(0, index - cols * pageRows);
    case "PageDown":
      return Math.min(count - 1, index + cols * pageRows);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return index;
  }
}
