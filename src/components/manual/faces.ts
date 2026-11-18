/**
 * Pages affichées par le carnet, dans l'ordre d'un vrai livret :
 * couverture seule à droite, puis les doubles pages, puis le dos.
 *
 * Les scans posent deux pièges :
 * - une page PDF en paysage est une double page scannée d'un bloc : elle est
 *   coupée en deux moitiés, la gauche toujours sur une page de gauche ;
 * - une première page en paysage est souvent la couverture dépliée (dos à
 *   gauche, couverture à droite) : la couverture ouvre le carnet et le dos le
 *   referme, au lieu d'apparaître côte à côte dès l'ouverture.
 */
export interface Face {
  /** Page du PDF (à partir de 1). */
  page: number;
  /** Moitié d'une double page scannée, sinon page entière. */
  half?: "left" | "right";
  /** Proportions (largeur / hauteur) de la face affichée. */
  ratio: number;
  /** Page blanche ajoutée pour garder les doubles pages en face l'une de l'autre. */
  blank?: boolean;
}

const SPREAD = 1.1;

export function buildFaces(ratios: number[]): Face[] {
  if (!ratios.length) return [];
  const portrait = ratios.filter((r) => r <= SPREAD);
  // proportions d'une page simple : celles des pages en portrait, sinon une demi-double page
  const single = portrait.length ? median(portrait) : median(ratios) / 2;
  const blank = (): Face => ({ page: 0, ratio: single, blank: true });
  const out: Face[] = [];
  let backCover: Face | null = null;

  ratios.forEach((r, i) => {
    const page = i + 1;
    const wide = r > SPREAD;
    if (i === 0 && wide && ratios.length > 1) {
      // couverture dépliée : la moitié droite ouvre le carnet, la gauche (le dos) le ferme
      out.push({ page, half: "right", ratio: r / 2 });
      backCover = { page, half: "left", ratio: r / 2 };
      return;
    }
    if (wide) {
      // les faces d'indice impair sont à gauche (la couverture, seule, est à droite)
      if (out.length % 2 === 0) out.push(blank());
      out.push({ page, half: "left", ratio: r / 2 }, { page, half: "right", ratio: r / 2 });
    } else {
      out.push({ page, ratio: r || single });
    }
  });

  if (backCover) {
    // le dos se lit sur une page de gauche, une fois le carnet entièrement tourné
    if (out.length % 2 === 0) out.push(blank());
    out.push(backCover);
  }
  return out;
}

/** Faces visibles (gauche, droite) quand `cur` feuilles sont tournées. */
export function spreadOf(cur: number): [number, number] {
  return [cur * 2 - 1, cur * 2];
}

function median(list: number[]): number {
  if (!list.length) return 0.7;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
