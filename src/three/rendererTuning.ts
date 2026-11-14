import type { WebGLRenderer } from "three";

/**
 * Réglages communs des rendus 3D. En production, Three.js ne relit pas le
 * journal de compilation de chaque shader : cette lecture forçait le
 * navigateur à finir la compilation sur-le-champ (≈ 140 ms de gel à
 * l'ouverture d'une fiche) au lieu de la mener en parallèle.
 */
export function tuneRenderer(gl: WebGLRenderer): void {
  gl.debug.checkShaderErrors = import.meta.env.DEV;
}

/**
 * Position d'un canevas à l'écran, relue au plus toutes les `every` images :
 * `getBoundingClientRect` à chaque image force un recalcul de mise en page.
 */
export function cachedRect(every = 8) {
  let rect: DOMRect | null = null;
  let n = 0;
  return (el: HTMLElement): DOMRect => {
    if (!rect || n++ % every === 0) rect = el.getBoundingClientRect();
    return rect;
  };
}
