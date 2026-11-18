/**
 * Pages affichées par le carnet. Une page PDF en paysage est une double page
 * scannée d'un bloc : elle est coupée en deux moitiés, pour que chaque feuille
 * du carnet ait la forme d'une vraie page.
 */
export interface Face {
  /** Page du PDF (à partir de 1). */
  page: number;
  /** Moitié d'une double page scannée, sinon page entière. */
  half?: "left" | "right";
  /** Proportions (largeur / hauteur) de la face affichée. */
  ratio: number;
  /** Page blanche ajoutée pour qu'une double page scannée tombe à gauche puis à droite. */
  blank?: boolean;
}

const SPREAD = 1.1;

export function buildFaces(ratios: number[]): Face[] {
  const out: Face[] = [];
  // proportions d'une page simple : celles des pages en portrait, sinon une demi-double page
  const portrait = ratios.filter((r) => r <= SPREAD);
  const single = portrait.length ? median(portrait) : median(ratios) / 2;
  ratios.forEach((r, i) => {
    const page = i + 1;
    // la couverture reste entière, même si elle est large (jaquette dépliée : on ne montre que la face)
    if (r > SPREAD && !(i === 0 && portrait.length === 0 && ratios.length === 1)) {
      // les faces d'indice impair sont à gauche (la couverture, seule, est à droite)
      if (out.length % 2 === 0) out.push({ page: 0, ratio: single, blank: true });
      out.push({ page, half: "left", ratio: r / 2 }, { page, half: "right", ratio: r / 2 });
    } else {
      out.push({ page, ratio: r || single });
    }
  });
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
