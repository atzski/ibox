import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { CanvasTexture, SRGBColorSpace, type Texture } from "three";
import type { Game } from "@/domain/types";
import { artKey, getArtCanvas, type ArtDims, type ArtFace } from "@/art/covers";
import type { CaseSpec } from "./cases/caseSpecs";

type CaseFace = "front" | "back" | "spine" | "disc" | "label";
export type CaseTextures = Record<CaseFace, Texture>;

type CachedTextures = { pending: Promise<CaseTextures>; ready?: CaseTextures };
const cache = new Map<string, CachedTextures>();

/** Dimensions des textures d'après les proportions réelles du boîtier. */
function faceDims(spec: CaseSpec, k: number): Record<CaseFace, ArtDims | undefined> {
  const { width: W, height: H, depth: D } = spec;
  const landscape = W > H;
  const fw = Math.round((landscape ? 1024 : 800) * k);
  const front: ArtDims = { w: fw, h: Math.round((fw * H) / W) };
  const sh = Math.round(1124 * k);
  const spine: ArtDims = { w: Math.max(64, Math.min(768, Math.round((sh * D) / H))), h: sh };
  let label: ArtDims | undefined;
  if (spec.model === "box") {
    const c = spec.cartridge;
    const lw = c.label[2] * c.width;
    const lh = c.label[3] * c.height;
    const w = Math.round(512 * k);
    label = { w, h: Math.round((w * lh) / lw) };
  } else if (spec.media.type === "card") {
    const w = Math.round(512 * k);
    label = { w, h: Math.round((w * spec.media.height * 0.7) / (spec.media.width * 0.86)) };
  }
  return { front, back: front, spine, disc: undefined, label };
}

/**
 * Textures d'un boîtier, générées une seule fois par jeu, par modèle et par
 * niveau de détail. L'inspection (un seul boîtier, vu de près, souvent en plein
 * écran) utilise des textures 1,6 fois plus fines que l'étagère (des dizaines
 * de boîtiers vus de loin). `null` tant qu'elles se préparent.
 */
export type TextureDetail = "shelf" | "inspect";

export function useCaseTextures(game: Game, spec: CaseSpec, detail: TextureDetail = "shelf"): CaseTextures | null {
  const gl = useThree((s) => s.gl);
  const key = `${artKey(game)}|${spec.kind}|${spec.width}x${spec.height}|${detail}`;
  const [, setResolved] = useState<CaseTextures>();

  useEffect(() => {
    let alive = true;
    let entry = cache.get(key);
    if (!entry) {
      const anisotropy = Math.min(detail === "inspect" ? 16 : 8, gl.capabilities.getMaxAnisotropy());
      const dims = faceDims(spec, detail === "inspect" ? 1.6 : 1);
      const faces: CaseFace[] = ["front", "back", "spine", "disc", "label"];
      // carte de jeu : étiquette autocollante dédiée ; cartouche : étiquette classique
      // PC : face avant habillée en boîtier DVD-ROM (la vignette de la bibliothèque reste nue)
      const art = (f: CaseFace): ArtFace =>
        f === "label" && spec.model === "keep" && spec.media.type === "card" ? "cardLabel"
          : f === "front" && spec.kind === "pc" ? "caseFront"
          : (f as ArtFace);
      const pending = Promise.all(faces.map((f) => getArtCanvas(game, art(f), dims[f]))).then((canvases) => {
        const out = {} as CaseTextures;
        canvases.forEach((c, i) => {
          const t = new CanvasTexture(c);
          t.colorSpace = SRGBColorSpace;
          t.anisotropy = anisotropy;
          out[faces[i]] = t;
        });
        return out;
      });
      const created: CachedTextures = { pending };
      cache.set(key, created);
      void pending.then((textures) => { created.ready = textures; }, () => { cache.delete(key); });
      entry = created;
    }
    if (!entry.ready) void entry.pending.then((t) => { if (alive) setResolved(t); }, () => undefined);
    return () => {
      alive = false;
    };
  }, [game, gl, spec, detail, key]);

  return cache.get(key)?.ready ?? null;
}
