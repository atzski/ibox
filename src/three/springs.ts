/** Ressorts et amortissements indépendants du framerate (purs, testés). */

export interface SpringState {
  x: number;
  v: number;
}

/**
 * Intègre un ressort amorti vers `target`. Sous-pas fixes pour rester stable
 * même si une frame dure longtemps. damping < 2·√stiffness ⇒ léger rebond.
 */
export function stepSpring(s: SpringState, target: number, dt: number, stiffness = 120, damping = 16): void {
  // le nombre de sous-pas suit la durée plafonnée : une image au `dt` aberrant (R3F donne
  // timestamp en ms − secondes à l'image qui suit une mise en pause, ~10⁵ s) faisait des
  // dizaines de millions de tours et figeait l'interface
  const span = Math.min(Math.max(dt, 0), 0.1);
  const steps = Math.max(1, Math.ceil(span / (1 / 120)));
  const h = span / steps;
  for (let i = 0; i < steps; i++) {
    const a = stiffness * (target - s.x) - damping * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

/** Amortissement exponentiel (sans rebond). */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}
