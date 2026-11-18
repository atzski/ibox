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

/** Page `n` (à partir de 1) rendue en image d'au moins `minWidth` pixels de large. */
export function renderPage(gameId: number, revision: string, n: number, minWidth: number): Promise<RenderedPage> {
  const width = widthBucket(minWidth);
  const docKey = `${gameId}|${revision}`;
  const key = `${docKey}|${n}|${width}`;
  const hit = pages.get(key);
  if (hit) {
    pages.delete(key);
    pages.set(key, hit);
    return hit;
  }
  const p = openManual(gameId, revision).then(async (doc) => {
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
    page.cleanup();
    const blob = await new Promise<Blob>((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error("rendu impossible"))), "image/jpeg", 0.9));
    canvas.width = canvas.height = 0;
    return { url: URL.createObjectURL(blob), blob, width: viewport.width, height: viewport.height };
  });
  pages.set(key, p);
  p.catch(() => pages.delete(key));
  while (pages.size > PAGE_LIMIT) {
    const [oldKey, old] = pages.entries().next().value as [string, Promise<RenderedPage>];
    pages.delete(oldKey);
    void old.then((r) => URL.revokeObjectURL(r.url)).catch(() => undefined);
  }
  return p;
}

/** Proportions (largeur / hauteur) de chaque page, sans les rendre. */
export async function pageRatios(gameId: number, revision: string): Promise<number[]> {
  const doc = await openManual(gameId, revision);
  const out: number[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const v = (await doc.getPage(i)).getViewport({ scale: 1 });
    out.push(v.width / v.height);
  }
  return out;
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
