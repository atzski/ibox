/**
 * Image adoucie sans filtre CSS (mode performance, `services/performance.ts`).
 *
 * Un `filter: blur()` posé sur une image qui bouge (lent mouvement de caméra des fonds) est
 * recalculé à chaque image par la carte graphique : sur un Steam Deck, un flou de 60 px en plein
 * écran coûte plus cher que tout le reste de l'interface. Ici l'image est réduite une fois pour
 * toutes à quelques dizaines de pixels ; ré-étirée par le navigateur, elle a la même douceur, et
 * l'afficher ne coûte plus rien. La saturation est appliquée aux pixels au même moment.
 */
import { useEffect, useState } from "react";

const cache = new Map<string, Promise<string | null>>();
const CACHE_MAX = 16;

/** Largeur du bitmap adouci : un pixel couvre à peu près le rayon du flou à l'écran. */
export function softenedWidth(blur: number, displayWidth: number, naturalWidth: number): number {
  const wanted = Math.round(displayWidth / Math.max(1, blur));
  return Math.max(12, Math.min(naturalWidth, wanted));
}

/** Matrice de `saturate(s)` (même formule que le filtre CSS), appliquée sur place. */
export function saturatePixels(data: Uint8ClampedArray, s: number): void {
  if (s === 1) return;
  const a = 0.213 + 0.787 * s, b = 0.715 - 0.715 * s, c = 0.072 - 0.072 * s;
  const d = 0.213 - 0.213 * s, e = 0.715 + 0.285 * s, f = 0.072 - 0.072 * s;
  const g = 0.213 - 0.213 * s, h = 0.715 - 0.715 * s, i = 0.072 + 0.928 * s;
  for (let p = 0; p < data.length; p += 4) {
    const r = data[p], gr = data[p + 1], bl = data[p + 2];
    data[p] = a * r + b * gr + c * bl;
    data[p + 1] = d * r + e * gr + f * bl;
    data[p + 2] = g * r + h * gr + i * bl;
  }
}

/** Agrandissement du bitmap réduit, une fois pour toutes (voir `smoothed`). */
export const SMOOTH_SCALE = 4;

/**
 * Le bitmap réduit, ré-étiré par le navigateur d'un facteur 10 à 20, laisse voir ses pixels en
 * carrés baveux dès que l'image a des bords nets (icône d'une application Android, logo) : le
 * filtrage bilinéaire ne lisse qu'entre deux pixels voisins. On l'agrandit donc ici, avec un vrai
 * flou d'à peu près un pixel d'origine (filtre de canevas, calculé une seule fois) ; le navigateur
 * n'a plus qu'un facteur 3 à 5 à étirer, sans marches visibles. Sans filtre de canevas (moteurs
 * anciens), l'agrandissement lissé seul garde l'essentiel du gain.
 */
function smoothed(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w * SMOOTH_SCALE;
  c.height = h * SMOOTH_SCALE;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if ("filter" in ctx) ctx.filter = `blur(${SMOOTH_SCALE * 0.75}px)`;
  // marge d'un pixel d'origine : le flou ne fond pas les bords vers la transparence
  const m = SMOOTH_SCALE;
  ctx.drawImage(src, -m, -m, c.width + 2 * m, c.height + 2 * m);
  return c;
}

async function soften(src: string, blur: number, saturation: number, displayWidth: number): Promise<string | null> {
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    await img.decode();
    const w = softenedWidth(blur, displayWidth, img.naturalWidth);
    const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
    // réduction par moitiés successives : pas de moirage, même quand le moteur filtre mal
    let from: CanvasImageSource = img;
    let cw = img.naturalWidth;
    let ch = img.naturalHeight;
    const step = (tw: number, th: number) => {
      const c = document.createElement("canvas");
      c.width = tw;
      c.height = th;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(from, 0, 0, cw, ch, 0, 0, tw, th);
      from = c;
      cw = tw;
      ch = th;
      return c;
    };
    while (cw / 2 > w) step(Math.ceil(cw / 2), Math.max(1, Math.ceil(ch / 2)));
    const out = step(w, h);
    const ctx = out.getContext("2d")!;
    const pixels = ctx.getImageData(0, 0, w, h);
    saturatePixels(pixels.data, saturation);
    ctx.putImageData(pixels, 0, 0);
    return smoothed(out, w, h).toDataURL("image/png");
  } catch {
    // image d'une autre origine (canevas verrouillé) ou illisible : l'appelant garde le filtre CSS
    return null;
  }
}

/**
 * Version adoucie de `src` pour un flou de `blur` pixels. `undefined` : en préparation ;
 * `null` : impossible (garder le filtre CSS) ; sinon l'adresse du bitmap. `src` nul : rien à faire.
 * `displayWidth` : largeur d'affichage de l'image en pixels (par défaut, celle de la fenêtre).
 */
export function useSoftenedImage(src: string | null, blur: number, saturation = 1, displayWidth?: number): string | null | undefined {
  const width = displayWidth ?? (typeof window === "undefined" ? 1280 : window.innerWidth);
  const key = src ? `${src}|${blur}|${saturation}|${width}` : null;
  const [done, setDone] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!src || !key) return;
    let alive = true;
    let p = cache.get(key);
    if (!p) {
      p = soften(src, blur, saturation, width);
      cache.set(key, p);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    }
    void p.then((url) => alive && setDone({ key, url }));
    return () => {
      alive = false;
    };
  }, [src, key, blur, saturation, width]);
  if (!key) return null;
  return done?.key === key ? done.url : undefined;
}
