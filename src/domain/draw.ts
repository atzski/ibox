/**
 * Tirage au hasard sur l'étagère (pur, testé) : quel jeu, et par quel chemin
 * la rangée défile jusqu'à lui.
 */

export interface DrawSlot {
  /** Rangée (console) et place du jeu dans la rangée. */
  row: number;
  index: number;
}

/**
 * Tire un jeu parmi les rangées, jamais celui déjà choisi, jamais un jeu qu'on
 * ne peut pas lancer tant qu'il en reste d'autres. `random` ∈ [0, 1[.
 */
export function pickDraw<T>(rows: readonly (readonly T[])[], current: DrawSlot | null, playable: (item: T) => boolean, random: () => number = Math.random): DrawSlot | null {
  const all: (DrawSlot & { ok: boolean })[] = [];
  rows.forEach((row, r) =>
    row.forEach((item, i) => {
      if (current && current.row === r && current.index === i) return;
      all.push({ row: r, index: i, ok: playable(item) });
    }),
  );
  const pool = all.some((s) => s.ok) ? all.filter((s) => s.ok) : all;
  if (pool.length === 0) return null;
  const { row, index } = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  return { row, index };
}

/** Trajet minimal pour que le défilement se voie, quand la rangée le permet. */
const MIN_TRAVEL = 12;
/** Élan pris à l'opposé (ou au-delà) quand le jeu tiré est trop proche. */
const SWING = 8;
/** Nombre d'arrêts au plus : la fin ralentit place par place. */
const MAX_STEPS = 18;

export interface DrawStep {
  index: number;
  /** Attente avant ce pas (ms) : de plus en plus longue, la rangée ralentit. */
  delay: number;
}

/**
 * Chemin de `from` à `to` dans une rangée de `length` jeux : des pas d'abord
 * larges et rapides, puis de plus en plus courts et lents, comme une roue qui
 * s'arrête. Un jeu trop proche est rejoint après un élan dans l'autre sens.
 * Le dernier pas est toujours `to`.
 */
export function drawPath(from: number, to: number, length: number): DrawStep[] {
  const last = Math.max(0, length - 1);
  const a = clamp(from, 0, last);
  const b = clamp(to, 0, last);
  if (a === b) return [];
  let via: number | null = null;
  if (Math.abs(b - a) < MIN_TRAVEL) {
    const low = Math.max(0, Math.min(a, b) - SWING);
    const high = Math.min(last, Math.max(a, b) + SWING);
    const viaLow = Math.abs(a - low) + Math.abs(low - b);
    const viaHigh = Math.abs(a - high) + Math.abs(high - b);
    const best = viaHigh > viaLow ? high : low;
    // un détour n'a de sens que s'il allonge vraiment le trajet
    if (Math.max(viaLow, viaHigh) > Math.abs(b - a)) via = best;
  }
  // toutes les places traversées, une à une
  const walk: number[] = [];
  const stride = (x: number, y: number) => {
    const s = Math.sign(y - x);
    for (let i = x + s; s !== 0 && i !== y + s; i += s) walk.push(i);
  };
  if (via !== null && via !== a && via !== b) {
    stride(a, via);
    stride(via, b);
  } else stride(a, b);

  const count = Math.min(MAX_STEPS, walk.length);
  const steps: DrawStep[] = [];
  let previous = a;
  for (let k = 1; k <= count; k++) {
    const t = k / count;
    // ease-out : beaucoup de chemin au début, place par place à la fin
    const index = walk[Math.round((1 - Math.pow(1 - t, 1.8)) * (walk.length - 1))];
    // deux arrêts au même endroit n'en font qu'un (le dernier échantillon est toujours `to`)
    if (index === previous) continue;
    previous = index;
    steps.push({ index, delay: Math.round(46 + 210 * t * t) });
  }
  return steps;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
