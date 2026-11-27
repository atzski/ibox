import type { WebGLRenderer } from "three";

/**
 * Réglages communs des rendus 3D. En production, Three.js ne relit pas le
 * journal de compilation de chaque shader : cette lecture forçait le
 * navigateur à finir la compilation sur-le-champ (≈ 140 ms de gel à
 * l'ouverture d'une fiche) au lieu de la mener en parallèle.
 */
export function tuneRenderer(gl: WebGLRenderer): void {
  gl.debug.checkShaderErrors = import.meta.env.DEV;
  watchContextLoss(gl.domElement);
}

/**
 * Contexte WebGL perdu (pilote réinitialisé, mémoire graphique reprise par le système, onglet
 * GPU tué) : Three.js ne sait pas tout recharger, la scène est remontée ou laisse sa place à la
 * vue 2D (`services/render3d.ts`). Chaque canevas 3D d'iBox passe par `tuneRenderer`.
 */
export function watchContextLoss(canvas: HTMLCanvasElement): void {
  if (canvas.dataset.lossWatch) return;
  canvas.dataset.lossWatch = "1";
  canvas.addEventListener(
    "webglcontextlost",
    (e) => {
      // sans `preventDefault`, le navigateur ne rendrait jamais le contexte
      e.preventDefault();
      void import("@/services/render3d").then((m) => m.reportContextLost());
    },
    { once: true },
  );
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
