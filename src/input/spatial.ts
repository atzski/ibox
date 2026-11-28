/**
 * Navigation spatiale pure (sans DOM) : choisit l'élément le plus naturel
 * dans une direction donnée. Utilisée par le clavier et la manette, qui
 * produisent les mêmes `NavDirection`.
 */
export type NavDirection = "up" | "down" | "left" | "right";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 2;

/**
 * Renvoie l'index du meilleur candidat, ou -1.
 * Score = distance dans l'axe principal + pénalité forte sur l'axe orthogonal,
 * nulle si les éléments se chevauchent (même ligne / même colonne).
 */
export interface PickOptions {
  /**
   * Haut / bas : un élément qui recouvre la colonne de départ l'emporte sur une rangée plus
   * proche mais décalée. Sert en quittant un groupe : sous la rangée des consoles, on rejoint
   * les jeux en dessous, pas un petit bouton à l'autre bout de l'écran.
   */
  overlapFirst?: boolean;
}

export function pickNext(from: Rect, candidates: Rect[], dir: NavDirection, opts: PickOptions = {}): number {
  const horizontal = dir === "left" || dir === "right";
  const sign = dir === "right" || dir === "down" ? 1 : -1;

  const fromStart = horizontal ? from.x : from.y;
  const fromEnd = horizontal ? from.x + from.w : from.y + from.h;
  const fromCenter = (fromStart + fromEnd) / 2;
  const fromOStart = horizontal ? from.y : from.x;
  const fromOEnd = horizontal ? from.y + from.h : from.x + from.w;
  const fromOCenter = (fromOStart + fromOEnd) / 2;

  let best = -1;
  let bestScore = Infinity;

  // Doit se trouver nettement dans la direction demandée : la tolérance suit
  // la taille, car l'élément focalisé est agrandi et ses voisins de la même
  // rangée paraissent alors décalés de quelques pixels.
  const overlapOf = (c: Rect) => {
    const oStart = horizontal ? c.y : c.x;
    const oEnd = horizontal ? c.y + c.h : c.x + c.w;
    return Math.min(fromOEnd, oEnd) - Math.max(fromOStart, oStart);
  };
  const ahead = (c: Rect) => {
    const cStart = horizontal ? c.x : c.y;
    const cEnd = horizontal ? c.x + c.w : c.y + c.h;
    const cCenter = (cStart + cEnd) / 2;
    const smaller = Math.min(fromEnd - fromStart, cEnd - cStart);
    const tolerance = Math.max(EPS, smaller * 0.25);
    if (!(sign > 0 ? cCenter > fromCenter + tolerance : cCenter < fromCenter - tolerance)) return false;
    const overlap = overlapOf(c);
    // Gauche / droite : seulement sur la même rangée. En bout de rangée on s'arrête, on ne
    // part pas vers la barre du haut ou une autre rangée.
    if (horizontal) return overlap > 0;
    // Haut / bas : un voisin posé à côté (même hauteur, autre colonne) n'est ni au-dessus ni
    // en dessous, même si son centre est un peu plus haut ou plus bas.
    const along = Math.min(fromEnd, cEnd) - Math.max(fromStart, cStart);
    return !(overlap <= 0 && along > smaller * 0.5);
  };
  const gapOf = (c: Rect) => {
    const cStart = horizontal ? c.x : c.y;
    const cEnd = horizontal ? c.x + c.w : c.y + c.h;
    return Math.max(0, sign > 0 ? cStart - fromEnd : fromStart - cEnd);
  };
  // En montant ou en descendant, on vise d'abord la rangée la plus proche, même si
  // ses commandes sont loin sur le côté (réglage aligné à droite d'une ligne) :
  // sinon un élément aligné plus bas « sauterait » toute une rangée.
  const aligned = !horizontal && !!opts.overlapFirst && candidates.some((c) => ahead(c) && overlapOf(c) > 0);
  const eligible = (c: Rect) => ahead(c) && (!aligned || overlapOf(c) > 0);
  let band = Infinity;
  if (!horizontal) {
    let nearest = Infinity;
    candidates.forEach((c) => {
      if (eligible(c)) nearest = Math.min(nearest, gapOf(c));
    });
    band = nearest + Math.max(24, (fromEnd - fromStart) * 0.5);
  }

  candidates.forEach((c, i) => {
    if (!eligible(c)) return;
    const cStart = horizontal ? c.x : c.y;
    const cEnd = horizontal ? c.x + c.w : c.y + c.h;
    const cCenter = (cStart + cEnd) / 2;

    const gap = gapOf(c);
    if (gap > band) return;
    const centerGap = Math.abs(cCenter - fromCenter);

    const oStart = horizontal ? c.y : c.x;
    const oEnd = horizontal ? c.y + c.h : c.x + c.w;
    const overlap = Math.min(fromOEnd, oEnd) - Math.max(fromOStart, oStart);
    const oCenter = (oStart + oEnd) / 2;
    const orthogonal = overlap > 0 ? Math.abs(oCenter - fromOCenter) * 0.15 : Math.abs(oCenter - fromOCenter);

    const score = gap + centerGap * 0.1 + orthogonal * (overlap > 0 ? 1 : 2.5);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  });

  return best;
}

/** Plus petit angle équivalent à `target` depuis `current` (évite les tours complets). */
export function nearestAngle(current: number, target: number): number {
  const TAU = Math.PI * 2;
  let d = (target - current) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return current + d;
}
