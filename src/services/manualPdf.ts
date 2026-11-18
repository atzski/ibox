import type { PDFDocumentProxy } from "pdfjs-dist";
import { manualsApi } from "./manuals";

/**
 * Rendu des manuels PDF (pdf.js, chargé à la demande) : documents ouverts,
 * pages rendues en images (cache limité), couverture pour le carnet 3D.
 */
type Pdfjs = typeof import("pdfjs-dist");
let lib: Promise<Pdfjs> | null = null;

function pdfjs(): Promise<Pdfjs> {
  lib ??= import("pdfjs-dist").then((m) => {
    // Fil de pdf.js empaqueté par Vite (fichier .js de l'application) : servi avec
    // le bon type par Tauri, sans dépendre d'une adresse calculée à l'exécution.
    m.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return m;
  });
  return lib;
}

const asset = (dir: string) => new URL(`/pdfjs/${dir}/`, window.location.href).href;

/* ——— documents ——— */
const docs = new Map<string, Promise<PDFDocumentProxy>>();
/** Chargements en cours ou terminés : c'est eux qui libèrent le document (et son fil). */
const tasks = new Map<string, { destroy(): Promise<void> }>();
const DOC_LIMIT = 2;

export function openManual(gameId: number, revision: string): Promise<PDFDocumentProxy> {
  const key = `${gameId}|${revision}`;
  let p = docs.get(key);
  if (p) {
    // récemment utilisé : remis en fin de file
    docs.delete(key);
    docs.set(key, p);
    return p;
  }
  p = Promise.all([pdfjs(), manualsApi.read(gameId)]).then(([m, data]) => {
    const task = m.getDocument({
      data: new Uint8Array(data),
      cMapUrl: asset("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: asset("standard_fonts"),
      wasmUrl: asset("wasm"),
      iccUrl: asset("iccs"),
      enableXfa: false,
    });
    tasks.set(key, task);
    return task.promise;
  });
  docs.set(key, p);
  p.catch(() => docs.delete(key));
  while (docs.size > DOC_LIMIT) {
    const [oldKey, old] = docs.entries().next().value as [string, Promise<PDFDocumentProxy>];
    docs.delete(oldKey);
    forgetPages(oldKey);
    void old.catch(() => undefined);
    void tasks.get(oldKey)?.destroy().catch(() => undefined);
    tasks.delete(oldKey);
  }
  return p;
}

/* ——— pages rendues ——— */
export interface RenderedPage {
  url: string;
  /** Image elle-même : relire `url` par fetch est interdit par la CSP de l'application. */
  blob: Blob;
  width: number;
  height: number;
}

const pages = new Map<string, Promise<RenderedPage>>();
const PAGE_LIMIT = 48;

function forgetPages(docKey: string): void {
  for (const [k, p] of pages) {
    if (k.startsWith(`${docKey}|`)) {
      pages.delete(k);
      void p.then((r) => URL.revokeObjectURL(r.url)).catch(() => undefined);
    }
  }
}

/** Largeur rendue arrondie par paliers : un redimensionnement léger réutilise le cache. */
export function widthBucket(px: number): number {
  const steps = [160, 320, 640, 960, 1280, 1600, 2000, 2600];
  return steps.find((s) => s >= px) ?? steps[steps.length - 1];
}

/**
 * File de rendu : pdf.js ne rend qu'une page à la fois dans son fil. Les pages
 * visibles passent devant les vignettes et le préchauffage, sinon la couverture
 * attendrait derrière une vingtaine de miniatures.
 */
type Priority = "high" | "low";
const queue: { run: () => Promise<void>; priority: Priority }[] = [];
let active = 0;
const CONCURRENCY = 2;

function schedule<T>(priority: Priority, job: () => Promise<T>): Promise<T> {
  return new Promise<T>((ok, ko) => {
    const entry = { priority, run: () => job().then(ok, ko) };
    if (priority === "high") {
      const firstLow = queue.findIndex((q) => q.priority === "low");
      queue.splice(firstLow < 0 ? queue.length : firstLow, 0, entry);
    } else queue.push(entry);
    pump();
  });
}

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const next = queue.shift()!;
    active++;
    void next.run().finally(() => {
      active--;
      pump();
    });
  }
}

/** Page `n` (à partir de 1) rendue en image d'au moins `minWidth` pixels de large. */
export function renderPage(gameId: number, revision: string, n: number, minWidth: number, priority: Priority = "high"): Promise<RenderedPage> {
  const width = widthBucket(minWidth);
  const docKey = `${gameId}|${revision}`;
  const key = `${docKey}|${n}|${width}`;
  const hit = pages.get(key);
  if (hit) {
    pages.delete(key);
    pages.set(key, hit);
    return hit;
  }
  const p = (async (): Promise<RenderedPage> => {
    // 1. déjà rendue lors d'une ouverture précédente : lue sur le disque, sans ouvrir le PDF
    const cached = await manualsApi.page(gameId, n, width).catch(() => null);
    if (cached && cached.byteLength > 0) {
      const blob = new Blob([cached], { type: "image/jpeg" });
      return { url: URL.createObjectURL(blob), blob, width, height: 0 };
    }
    // 2. sinon rendue par pdf.js (à son tour dans la file), puis gardée pour la prochaine fois
    const doc = await openManual(gameId, revision);
    // filet de sécurité : un rendu bloqué (fenêtre masquée, page piégée) libère sa place dans la file
    return schedule(priority, () =>
      Promise.race([
        draw(doc, gameId, n, width),
        new Promise<never>((_, ko) => window.setTimeout(() => ko(new Error("rendu trop long")), 20_000)),
      ]),
    );
  })();
  pages.set(key, p);
  p.catch(() => pages.delete(key));
  while (pages.size > PAGE_LIMIT) {
    const [oldKey, old] = pages.entries().next().value as [string, Promise<RenderedPage>];
    pages.delete(oldKey);
    void old.then((r) => URL.revokeObjectURL(r.url)).catch(() => undefined);
  }
  return p;
}

async function draw(doc: PDFDocumentProxy, gameId: number, n: number, width: number): Promise<RenderedPage> {
  {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    // pas de page.cleanup() : une autre taille de la même page peut être en cours de rendu
    const blob = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("rendu impossible"))), "image/jpeg", 0.9));
    canvas.width = canvas.height = 0;
    void blobToBase64(blob)
      .then((b64) => manualsApi.savePage(gameId, n, width, b64))
      .catch(() => undefined);
    return { url: URL.createObjectURL(blob), blob, width: viewport.width, height: viewport.height };
  }
}

/**
 * Proportions (largeur / hauteur) de chaque page, sans les rendre. Calculées
 * une seule fois (toutes les pages en parallèle), puis relues sur le disque.
 */
const ratiosCache = new Map<string, Promise<number[]>>();
export function pageRatios(gameId: number, revision: string): Promise<number[]> {
  const key = `${gameId}|${revision}`;
  let p = ratiosCache.get(key);
  if (p) return p;
  p = (async () => {
    const saved = await manualsApi.layout(gameId).catch(() => null);
    if (saved) {
      const list = JSON.parse(saved) as unknown;
      if (Array.isArray(list) && list.length && list.every((x) => typeof x === "number" && x > 0)) return list as number[];
    }
    const doc = await openManual(gameId, revision);
    const out = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) =>
        doc.getPage(i + 1).then((pg) => {
          const v = pg.getViewport({ scale: 1 });
          return Math.round((v.width / v.height) * 10000) / 10000;
        }),
      ),
    );
    void manualsApi.saveLayout(gameId, JSON.stringify(out)).catch(() => undefined);
    return out;
  })();
  ratiosCache.set(key, p);
  p.catch(() => ratiosCache.delete(key));
  return p;
}

/**
 * Prépare l'ouverture du carnet pendant qu'on regarde la boîte : mise en page,
 * puis la couverture et la première double page à la taille du lecteur.
 * Tout est mis en cache : le clic sur le carnet devient immédiat.
 */
const warmed = new Set<string>();
export async function prewarmManual(gameId: number, revision: string, faceWidths: (ratios: number[]) => { page: number; px: number }[]): Promise<void> {
  const key = `${gameId}|${revision}`;
  if (warmed.has(key)) return;
  warmed.add(key);
  try {
    const ratios = await pageRatios(gameId, revision);
    // une page à la fois : la fiche du jeu reste fluide
    for (const f of faceWidths(ratios)) await renderPage(gameId, revision, f.page, f.px, "low").catch(() => undefined);
  } catch {
    warmed.delete(key);
  }
}

/* ——— couverture du carnet 3D ——— */
const covers = new Map<string, Promise<Blob | null>>();

/**
 * Couverture (première page) en JPEG : relue sur le disque si le lecteur l'a
 * déjà produite, sinon rendue ici puis enregistrée avec le nombre de pages.
 */
export function manualCover(gameId: number, revision: string): Promise<Blob | null> {
  const key = `${gameId}|${revision}`;
  let p = covers.get(key);
  if (p) return p;
  p = (async () => {
    const saved = await manualsApi.cover(gameId).catch(() => null);
    if (saved && saved.byteLength > 0) return new Blob([saved], { type: "image/jpeg" });
    const doc = await openManual(gameId, revision);
    // couverture dépliée scannée (dos + face) : seule la moitié droite est la couverture
    const first = (await doc.getPage(1)).getViewport({ scale: 1 });
    const unfolded = first.width / first.height > 1.1 && doc.numPages > 1;
    const page = await renderPage(gameId, revision, 1, unfolded ? 1920 : 960);
    const blob = unfolded ? await rightHalf(page.blob) : page.blob;
    const b64 = await blobToBase64(blob);
    void manualsApi.saveCover(gameId, b64, doc.numPages).catch(() => undefined);
    return blob;
  })().catch((e) => {
    console.warn("iBox : couverture du manuel indisponible", e);
    covers.delete(key);
    return null;
  });
  covers.set(key, p);
  return p;
}

/** Moitié droite d'une image (JPEG). */
async function rightHalf(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(bmp.width / 2);
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, bmp.width - canvas.width, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("recadrage impossible"))), "image/jpeg", 0.9));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => ko(r.error);
    r.readAsDataURL(blob);
  });
}
