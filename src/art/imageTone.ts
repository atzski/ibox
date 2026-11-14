import { useEffect, useState, type CSSProperties } from "react";

/**
 * Analyse d'une image à fond transparent (logo) :
 * - tonalité : « light » si ses pixels visibles sont surtout clairs (logo blanc),
 *   « dark » sinon — sert à choisir le voile placé dessous ;
 * - zone utile : marges transparentes à ignorer (certains logos sont livrés dans
 *   un grand carré vide) — appliquée avec `object-view-box`, sans retoucher l'image.
 * Le logo n'est jamais recoloré ni déformé.
 */
export type Tone = "light" | "dark";

export interface ImageInfo {
  tone: Tone | null;
  /** `inset(…)` pour `object-view-box`, ou null si l'image n'a pas de marge vide. */
  viewBox: string | null;
}

const cache = new Map<string, Promise<ImageInfo>>();
const NONE: ImageInfo = { tone: null, viewBox: null };

function analyse(url: string): Promise<ImageInfo> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = 128;
        const h = Math.max(8, Math.round((128 * img.naturalHeight) / Math.max(1, img.naturalWidth)));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(NONE);
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        let sum = 0;
        let weight = 0;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const a = d[i + 3] / 255;
            if (a < 0.08) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (a < 0.2) continue;
            sum += ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255) * a;
            weight += a;
          }
        }
        const tone: Tone | null = weight < 1 ? null : sum / weight > 0.62 ? "light" : "dark";
        let viewBox: string | null = null;
        if (maxX >= minX && maxY >= minY) {
          const pct = (v: number, of: number) => `${Math.max(0, (v / of) * 100).toFixed(2)}%`;
          const top = minY - 1, left = minX - 1, bottom = h - maxY - 2, right = w - maxX - 2;
          // seulement si la marge vide est notable (plus de 6 % sur un côté)
          if ([top / h, bottom / h, left / w, right / w].some((m) => m > 0.06)) {
            viewBox = `inset(${pct(top, h)} ${pct(right, w)} ${pct(bottom, h)} ${pct(left, w)})`;
          }
        }
        resolve({ tone, viewBox });
      } catch {
        resolve(NONE);
      }
    };
    img.onerror = () => resolve(NONE);
    img.src = url;
  });
}

export function useImageInfo(url: string | null): ImageInfo {
  const [info, setInfo] = useState<ImageInfo>(NONE);
  useEffect(() => {
    if (!url) {
      setInfo(NONE);
      return;
    }
    let alive = true;
    let p = cache.get(url);
    if (!p) {
      p = analyse(url);
      cache.set(url, p);
    }
    void p.then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [url]);
  return info;
}

export const useImageTone = (url: string | null): Tone | null => useImageInfo(url).tone;

/** Style à poser sur un logo pour en retirer les marges vides. */
export const trimStyle = (info: ImageInfo): CSSProperties =>
  info.viewBox ? ({ objectViewBox: info.viewBox } as CSSProperties) : {};
