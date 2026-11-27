import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { SRGBColorSpace, Texture } from "three";
import type { Game } from "@/domain/types";
import { artKey, forgetArtCanvas, paintCaseFaces, type ArtDims, type ArtFace } from "@/art/covers";
import { useGraphics } from "@/services/budget";
import type { CaseSpec } from "./cases/caseSpecs";

type CaseFace = "front" | "back" | "spine" | "disc" | "label";
export type CaseTextures = Record<CaseFace, Texture>;

type CachedTextures = { pending: Promise<CaseTextures>; ready?: CaseTextures; users: number; forget: () => void };
/** Ordre d'insertion = ordre d'usage (une entrée relue est replacée à la fin). */
const cache = new Map<string, CachedTextures>();

/**
 * Jeux de textures gardés hors de l'écran (boîtiers démontés), au-delà desquels les plus anciens
 * sont libérés : ~11 Mo de mémoire graphique par boîtier (~6 Mo au palier allégé). Sans plafond,
 * parcourir 120 boîtiers gardait 1,5 Go (docs/HANDHELD.md).
 */
export const KEEP_UNUSED = 32;
/** Palier allégé (Steam Deck, mémoire partagée avec le jeu) : 12 jeux gardés hors de l'écran. */
export const KEEP_UNUSED_LITE = 12;
let keepUnused = KEEP_UNUSED;

/** Libère les jeux de textures inutilisés les plus anciens au-delà de `keep`. Renvoie le nombre libéré. */
export function pruneCaseTextures(keep = keepUnused): number {
  let unused = 0;
  for (const e of cache.values()) if (e.users === 0 && e.ready) unused++;
  let freed = 0;
  for (const [key, e] of cache) {
    if (unused <= keep) break;
    if (e.users > 0 || !e.ready) continue;
    Object.values(e.ready).forEach(disposeTexture);
    e.forget();
    cache.delete(key);
    unused--;
    freed++;
  }
  return freed;
}

/** Libère une texture et, peinte par le worker, son image (`ImageBitmap`, mémoire hors du tas). */
function disposeTexture(t: Texture) {
  t.dispose();
  const image = t.image as { close?: () => void } | null;
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
}

/** Jeux de textures en cache (mesures, tests). */
export const caseTextureStats = () => ({ entries: cache.size, inUse: [...cache.values()].filter((e) => e.users > 0).length });

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
  // palier allégé (Steam Deck) : faces de 560 px au lieu de 800 sur l'étagère, ×1,1 au lieu de ×1,6 en fiche
  const graphics = useGraphics();
  const k = detail === "inspect" ? graphics.inspectTextures : graphics.textures;
  keepUnused = graphics.textures < 1 ? KEEP_UNUSED_LITE : KEEP_UNUSED;
  const key = `${artKey(game)}|${spec.kind}|${spec.width}x${spec.height}|${detail}|${k}`;
  const [, setResolved] = useState<CaseTextures>();

  useEffect(() => {
    let alive = true;
    let entry = cache.get(key);
    if (!entry) {
      const anisotropy = Math.min(detail === "inspect" ? 16 : 8, gl.capabilities.getMaxAnisotropy());
      const dims = faceDims(spec, k);
      const faces: CaseFace[] = ["front", "back", "spine", "disc", "label"];
      // carte de jeu : étiquette autocollante dédiée ; cartouche : étiquette classique
      // PC : face avant habillée en boîtier DVD-ROM (la vignette de la bibliothèque reste nue)
      const art = (f: CaseFace): ArtFace =>
        f === "label" && spec.model === "keep" && spec.media.type === "card" ? "cardLabel"
          : f === "front" && spec.kind === "pc" ? "caseFront"
          : (f as ArtFace);
      // peintes hors du fil principal quand c'est possible (art/paintWorker.ts) : images déjà
      // retournées pour WebGL ; sinon canevas du fil principal, comme une CanvasTexture
      const pending = paintCaseFaces(game, faces.map((f) => ({ face: art(f), dims: dims[f] }))).then(({ flipped, images }) => {
        const out = {} as CaseTextures;
        images.forEach((image, i) => {
          const t = new Texture(image);
          t.flipY = !flipped;
          t.colorSpace = SRGBColorSpace;
          t.anisotropy = anisotropy;
          t.needsUpdate = true;
          out[faces[i]] = t;
        });
        return out;
      });
      // les canevas de ces dimensions ne servent qu'à ces textures : libérés avec elles
      const forget = () => faces.forEach((f) => forgetArtCanvas(game, art(f), dims[f]));
      const created: CachedTextures = { pending, users: 0, forget };
      cache.set(key, created);
      void pending.then((textures) => { created.ready = textures; }, () => { cache.delete(key); });
      entry = created;
    } else {
      // relu : redevient le plus récent
      cache.delete(key);
      cache.set(key, entry);
    }
    const held = entry;
    held.users++;
    if (!held.ready) void held.pending.then((t) => { if (alive) setResolved(t); }, () => undefined);
    return () => {
      alive = false;
      held.users--;
      if (held.users === 0) pruneCaseTextures();
    };
  }, [game, gl, spec, detail, key, k]);

  return cache.get(key)?.ready ?? null;
}
