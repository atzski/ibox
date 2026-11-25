/**
 * Activité des scènes 3D rendues à la demande (mode performance, `services/graphics.ts`).
 *
 * L'étagère n'a aucun mouvement perpétuel : tout y est un trajet vers une pose (ressorts, fondus).
 * Elle peut donc cesser de se redessiner une fois posée, et reprendre au moindre signe de vie :
 * geste de l'utilisateur, changement d'état d'un composant de la scène, texture qui arrive.
 * `wakeScenes()` note ce signe de vie ; `FrameCap` dessine pendant `SETTLE_MS` après le dernier.
 */

/** Durée de dessin après le dernier signe de vie : couvre l'arrivée en vague et l'amorti de caméra. */
export const SETTLE_MS = 3000;

let last = typeof performance === "undefined" ? 0 : performance.now();
const listeners = new Set<() => void>();
let attached = 0;

/** Quelque chose bouge (ou va bouger) dans une scène : on dessine de nouveau. */
export function wakeScenes(): void {
  last = performance.now();
  listeners.forEach((fn) => fn());
}

/** La scène est-elle encore en mouvement à l'instant `now` ? */
export const scenesActive = (now: number, lastActivity = last): boolean => now - lastActivity < SETTLE_MS;

const GESTURES = ["pointermove", "pointerdown", "wheel", "keydown", "resize", "ibox:analog", "focus"] as const;

/** Appelle `fn` à chaque signe de vie ; écoute les gestes tant qu'au moins une scène est abonnée. */
export function onSceneActivity(fn: () => void): () => void {
  listeners.add(fn);
  if (attached++ === 0) GESTURES.forEach((g) => window.addEventListener(g, wakeScenes, { capture: true, passive: true }));
  return () => {
    listeners.delete(fn);
    if (--attached === 0) GESTURES.forEach((g) => window.removeEventListener(g, wakeScenes, { capture: true }));
  };
}
