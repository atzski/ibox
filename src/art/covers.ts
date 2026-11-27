import type { Game } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { basePalette, loadAssets, loadThumbAssets, mediaSignature, type ArtAssets, type Palette } from "./assets";
import { ART_SIZE, PAINT_FAMILIES, PAINT_FONTS, frontSize, makeCanvas, paintFace, scenes, withPaintScale, type ArtDims, type ArtFace, type PaintMarks } from "./painters";
import type { PaintReply, PaintRequest, WorkerFont } from "./paintWorker";
import { artApi, usePlatformArtStore, type PlatformSlot } from "@/services/platformArt";

/**
 * Faces imprimées d'un boîtier (la peinture elle-même : `painters.ts`). Ce module charge ce qu'il
 * faut (polices, images du jeu, logo de la console), garde les canevas de l'interface 2D et, pour
 * l'étagère 3D, fait peindre les faces hors du fil principal (`paintCaseFaces`).
 */
export { ART_SIZE, type ArtDims, type ArtFace };

/** Logo / icône choisis pour une console (Paramètres → Consoles), prêts à peindre. */
const platformBitmaps = new Map<string, Promise<ImageBitmap | null>>();
const readyPlatform = new Map<string, ImageBitmap | null>();
function platformStamp(platformId: string, slot: PlatformSlot) {
  const row = usePlatformArtStore.getState().rows.find((r) => r.platformId === platformId && r.slot === slot);
  return row ? `${platformId}|${slot}|${row.addedAt}` : "";
}
function loadPlatformBitmap(platformId: string, slot: PlatformSlot): Promise<ImageBitmap | null> {
  const key = platformStamp(platformId, slot);
  if (!key) return Promise.resolve(null);
  let p = platformBitmaps.get(key);
  if (!p) {
    p = artApi.read(platformId, slot).then((b) => createImageBitmap(new Blob([b]))).catch(() => null)
      .then((bmp) => { readyPlatform.set(key, bmp); return bmp; });
    platformBitmaps.set(key, p);
  }
  return p;
}
const loadPlatformBitmaps = (platformId: string) =>
  Promise.all([loadPlatformBitmap(platformId, "platform_logo"), loadPlatformBitmap(platformId, "platform_icon")]);

/** Clé du jeu, logo et icône de sa console : ce que la peinture reçoit en plus des images. */
function marksOf(game: Game): PaintMarks {
  return {
    key: artKey(game),
    logo: readyPlatform.get(platformStamp(game.platformId, "platform_logo")) ?? null,
    icon: readyPlatform.get(platformStamp(game.platformId, "platform_icon")) ?? null,
  };
}

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  fontsReady ??= Promise.all(PAINT_FONTS.map((f) => document.fonts.load(f)))
    .then(() => undefined)
    .catch(() => undefined);
  return fontsReady;
}

/** Palette de l'habillage (sans images réelles). */
export const paletteOf = basePalette;

/** Clé de cache : change avec le titre, la console ou les images du jeu. */
export function artKey(game: Game): string {
  return `${game.id}|${game.platformId}|${game.title}|${mediaSignature(game)}|${platformStamp(game.platformId, "platform_logo")}|${platformStamp(game.platformId, "platform_icon")}`;
}

const paintHere = (game: Game, face: ArtFace, a: ArtAssets, dims?: ArtDims) => paintFace(game, face, a, dims, marksOf(game)) as HTMLCanvasElement;

/**
 * Créneau de peinture sur le fil principal (repli sans worker) : une face par image affichée,
 * juste après elle, au lieu des cinq faces d'un boîtier d'un seul trait.
 */
let lastSlot: Promise<void> = Promise.resolve();
function frameSlot(): Promise<void> {
  const next = lastSlot.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));
  lastSlot = next;
  return next;
}

const canvasCache = new Map<string, Promise<HTMLCanvasElement>>();
const urlCache = new Map<string, Promise<string>>();
const readyUrls = new Map<string, string>();

/** Already decoded artwork can be shown synchronously on return to the library. */
export function peekArtUrl(game: Game, face: ArtFace): string | undefined {
  return readyUrls.get(`${artKey(game)}:${face}`);
}

/**
 * Canvas d'une face (mis en cache), peint sur le fil principal. `spread` : attend un créneau
 * (`frameSlot`) pour ne pas peindre plusieurs grandes faces dans la même image.
 */
export function getArtCanvas(game: Game, face: ArtFace, dims?: ArtDims, spread = false): Promise<HTMLCanvasElement> {
  const key = `${artKey(game)}:${face}${dims ? `@${dims.w}x${dims.h}` : ""}`;
  let p = canvasCache.get(key);
  if (!p) {
    p = ensureFonts()
      .then(() => loadPlatformBitmaps(game.platformId))
      .then(() => loadAssets(game))
      .then(async (a) => {
        if (spread) await frameSlot();
        return paintHere(game, face, a, dims);
      });
    canvasCache.set(key, p);
  }
  return p;
}

/**
 * Oublie le canevas d'une face peinte à des dimensions précises (textures 3D libérées,
 * `three/useCaseTextures.ts`). Sans dimensions, la face est partagée avec l'interface 2D : gardée.
 */
export function forgetArtCanvas(game: Game, face: ArtFace, dims?: ArtDims): void {
  if (dims) canvasCache.delete(`${artKey(game)}:${face}@${dims.w}x${dims.h}`);
}

// ——— Faces de l'étagère 3D, peintes dans un worker ———

/**
 * Images des faces d'un boîtier, dans l'ordre demandé. `flipped` : déjà retournées pour WebGL
 * (`ImageBitmap` du worker : texture `flipY = false`, à fermer avec la texture) ; sinon
 * canevas du fil principal (repli), gardés dans `canvasCache` jusqu'à `forgetArtCanvas`.
 */
export type CaseImages = { flipped: true; images: ImageBitmap[] } | { flipped: false; images: HTMLCanvasElement[] };
export type FaceRequest = { face: ArtFace; dims?: ArtDims };

/** `?paint=main` (développement, build de mesure) : peinture sur le fil principal, étalée. */
const forceMain =
  (import.meta.env.DEV || import.meta.env.VITE_IBOX_BENCH === "1") &&
  typeof location !== "undefined" && new URLSearchParams(location.search).get("paint") === "main";

/** `@font-face` des polices des habillages, lues dans les feuilles de style chargées. */
function collectFonts(): WorkerFont[] {
  const out: WorkerFont[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // feuille d'une autre origine
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const s = rule.style;
      const get = (p: string) => s.getPropertyValue(p).trim();
      const family = get("font-family").replace(/^["']|["']$/g, "");
      if (!PAINT_FAMILIES.includes(family)) continue;
      const src = /url\(\s*(["']?)([^"')]+)\1\s*\)/.exec(get("src"));
      if (!src) continue;
      const descriptors: FontFaceDescriptors = {};
      if (get("font-weight")) descriptors.weight = get("font-weight");
      if (get("font-style")) descriptors.style = get("font-style");
      if (get("font-stretch")) descriptors.stretch = get("font-stretch");
      if (get("unicode-range")) descriptors.unicodeRange = get("unicode-range");
      out.push({ family, url: new URL(src[2], sheet.href ?? document.baseURI).href, descriptors });
    }
  }
  return out;
}

type Waiting = { resolve: (b: ImageBitmap[] | Blob[]) => void; reject: (e: unknown) => void; request: Extract<PaintRequest, { type: "paint" }>; assets: ArtAssets };
const waiting = new Map<number, Waiting>();
/** Jeux dont les images ont déjà été envoyées au worker (il répond `need` s'il les a oubliées). */
const sentAssets = new Set<string>();
let nextId = 1;
let worker: Promise<Worker | null> | null = null;
let path: "worker" | "main" | null = null;

/** Chemin de peinture des boîtiers 3D, pour le rapport de problème (`null` : pas encore d'étagère). */
export const casePaintPath = () => path === "worker" ? "worker" : path === "main" ? "fil principal, étalée" : "pas encore utilisée";

function onReply(w: Worker, r: PaintReply) {
  if (r.type === "ready") return;
  const job = waiting.get(r.id);
  if (!job) return;
  if (r.type === "need") {
    const m = marksOf(job.request.game);
    job.request.assets = { a: job.assets, logo: m.logo, icon: m.icon };
    post(w, job.request, job);
    return;
  }
  waiting.delete(r.id);
  if (r.type === "done") job.resolve(r.bitmaps);
  else if (r.type === "encoded") job.resolve(r.blobs);
  else job.reject(new Error(r.message));
}

function post(w: Worker, request: Extract<PaintRequest, { type: "paint" }>, job: Waiting) {
  try {
    w.postMessage(request);
    if (request.assets) sentAssets.add(request.key);
  } catch (error) {
    // donnée non transmissible : ce boîtier se peint sur le fil principal
    waiting.delete(request.id);
    job.reject(error);
  }
}

/** Worker de peinture prêt (polices chargées), ou `null` : `OffscreenCanvas` ou polices de worker absentes. */
function paintWorker(): Promise<Worker | null> {
  worker ??= new Promise<Worker | null>((resolve) => {
    const none = () => {
      path = "main";
      resolve(null);
    };
    if (forceMain || typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return none();
    let w: Worker;
    try {
      w = new Worker(new URL("./paintWorker.ts", import.meta.url), { type: "module" });
    } catch {
      return none();
    }
    let ready = false;
    const fail = () => {
      path = "main";
      w.terminate();
      worker = Promise.resolve(null);
      resolve(null);
      for (const [id, job] of waiting) {
        waiting.delete(id);
        job.reject(new Error("Worker de peinture arrêté"));
      }
    };
    const timer = setTimeout(() => { if (!ready) fail(); }, 8000);
    w.onerror = fail;
    w.onmessage = (e: MessageEvent<PaintReply>) => {
      if (e.data.type === "ready") {
        clearTimeout(timer);
        ready = e.data.ok;
        if (ready) {
          path = "worker";
          resolve(w);
        }
        else fail();
      } else onReply(w, e.data);
    };
    w.postMessage({ type: "init", fonts: collectFonts() } satisfies PaintRequest);
  });
  return worker;
}

function paintOnMain(game: Game, faces: FaceRequest[]): Promise<CaseImages> {
  return Promise.all(faces.map((f) => getArtCanvas(game, f.face, f.dims, true))).then((images) => ({ flipped: false, images }));
}

/**
 * Faces d'un boîtier de l'étagère 3D. Dans un worker (`OffscreenCanvas`) quand le moteur le
 * permet : le fil principal ne fait qu'envoyer les images à la carte graphique. Sinon sur le fil
 * principal, une face par image affichée. Même rendu dans les deux cas (mêmes peintres, mêmes polices).
 */
export async function paintCaseFaces(game: Game, faces: FaceRequest[]): Promise<CaseImages> {
  const w = await paintWorker();
  if (!w) return paintOnMain(game, faces);
  const [, a] = await Promise.all([loadPlatformBitmaps(game.platformId), loadAssets(game)]);
  const key = artKey(game);
  const m = marksOf(game);
  const request: Extract<PaintRequest, { type: "paint" }> = {
    type: "paint", id: nextId++, game, key, faces,
    assets: sentAssets.has(key) ? undefined : { a, logo: m.logo, icon: m.icon },
  };
  try {
    const images = await new Promise<ImageBitmap[]>((resolve, reject) => {
      const job: Waiting = { resolve: (b) => resolve(b as ImageBitmap[]), reject, request, assets: a };
      waiting.set(request.id, job);
      post(w, request, job);
    });
    return { flipped: true, images };
  } catch {
    return paintOnMain(game, faces);
  }
}

// ——— Interface 2D ———

/**
 * Face peinte et encodée en WebP dans le worker (démarrage : les jaquettes de l'accueil ne
 * passent plus par le fil principal). `null` : pas de worker, ou il a échoué.
 */
async function paintFaceBlob(game: Game, face: ArtFace): Promise<Blob | null> {
  const w = await paintWorker();
  if (!w) return null;
  try {
    const [, a] = await Promise.all([loadPlatformBitmaps(game.platformId), loadAssets(game)]);
    const key = artKey(game);
    const m = marksOf(game);
    const request: Extract<PaintRequest, { type: "paint" }> = {
      type: "paint", id: nextId++, game, key, faces: [{ face }], encode: true,
      assets: sentAssets.has(key) ? undefined : { a, logo: m.logo, icon: m.icon },
    };
    const [blob] = await new Promise<Blob[]>((resolve, reject) => {
      const job: Waiting = { resolve: (b) => resolve(b as Blob[]), reject, request, assets: a };
      waiting.set(request.id, job);
      post(w, request, job);
    });
    return blob ?? null;
  } catch {
    return null;
  }
}

/** Repli : peinture et encodage sur le fil principal. */
const blobOnMain = (game: Game, face: ArtFace): Promise<Blob> =>
  getArtCanvas(game, face).then(
    (canvas) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encodage impossible"))), "image/webp", 0.92)),
  );

/** URL blob d'une face (pour les <img> de l'interface 2D). */
export function getArtUrl(game: Game, face: ArtFace): Promise<string> {
  const key = `${artKey(game)}:${face}`;
  let p = urlCache.get(key);
  if (!p) {
    p = paintFaceBlob(game, face)
      .then((blob) => blob ?? blobOnMain(game, face))
      .then((blob) => URL.createObjectURL(blob));
    p = p.then(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      readyUrls.set(key, url);
      return url;
    }).catch((error) => {
      urlCache.delete(key);
      throw error;
    });
    urlCache.set(key, p);
  }
  return p;
}

/**
 * Vignette de la face avant, peinte directement à `width` px de large (vue reculée de la
 * bibliothèque). Rien n'est gardé : ni les images du jeu, ni le canevas (voir `art/thumbs.ts`,
 * qui étale ces peintures et ne garde que leurs URL).
 *
 * En deux temps : la préparation attend ce qu'il faut (polices, images du jeu) ; la fonction
 * rendue peint d'un seul trait, pour que l'appelant choisisse le moment de cette peinture.
 */
export async function prepareThumb(game: Game, width: number): Promise<() => HTMLCanvasElement> {
  const dims = { w: width, h: Math.round(width / requirePlatform(game.platformId).layout.coverAspect) };
  const shrink = (full: HTMLCanvasElement) => {
    const [c, ctx] = makeCanvas(dims.w, dims.h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(full, 0, 0, dims.w, dims.h);
    return c as HTMLCanvasElement;
  };
  // jaquette complète déjà peinte (jeu vu au niveau d'origine) : on la réduit
  const painted = canvasCache.get(`${artKey(game)}:front`);
  if (painted) {
    const full = await painted;
    return () => shrink(full);
  }
  await ensureFonts();
  await loadPlatformBitmaps(game.platformId);
  const assets = await loadThumbAssets(game, width);
  if (assets.hasCover) {
    // vraie jaquette : dessinée directement à la taille de la vignette
    return () => {
      const canvas = paintHere(game, "boxFront", assets, dims);
      scenes.forget(`${artKey(game)}|${dims.w}x${dims.h}`);
      return canvas;
    };
  }
  // habillage généré : dessiné avec ses cotes de grande jaquette, sur un canevas à l'échelle
  // de la vignette (rien du grand format n'est peint ni gardé)
  return () => {
    const size = frontSize(game);
    const sceneKey = `${artKey(game)}|${size.w}x${size.h}`;
    const hadScene = scenes.has(sceneKey);
    try {
      return withPaintScale(width / size.w, () => paintHere(game, "boxFront", assets, size));
    } finally {
      // l'illustration réduite ne doit pas passer pour la grande
      if (!hadScene) scenes.forget(sceneKey);
    }
  };
}

/** Palette effective d'un jeu (vraie jaquette si disponible). */
export async function getPalette(game: Game): Promise<Palette> {
  return (await loadAssets(game)).palette;
}
