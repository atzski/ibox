/**
 * Worker de peinture des faces de boîtiers (étagère 3D) : les mêmes peintres que le fil
 * principal (`painters.ts`) sur des `OffscreenCanvas`, rendus en `ImageBitmap` transférés
 * (retournés, prêts pour une texture `flipY = false`). Le fil principal ne fait plus que
 * l'envoi à la carte graphique. Faces de l'interface 2D (`encode`) : encodées ici en WebP
 * (`convertToBlob`), le fil principal n'en fait plus qu'une URL. Protocole : `covers.ts`
 * (`PaintRequest` / `PaintReply`).
 */
import type { ArtAssets } from "./assets";
import { PAINT_FONTS, paintFace, type ArtDims, type ArtFace, type PaintCanvas } from "./painters";
import type { Game } from "@/domain/types";

/** Police déclarée par la feuille de style de l'application (`@font-face`), à recharger ici. */
export interface WorkerFont {
  family: string;
  url: string;
  descriptors: FontFaceDescriptors;
}

export type PaintRequest =
  | { type: "init"; fonts: WorkerFont[] }
  | {
      type: "paint";
      id: number;
      game: Game;
      /** `artKey(game)` : clé des images et des illustrations de base gardées ici. */
      key: string;
      /** Absent quand le worker est censé les avoir déjà (sinon il répond `need`). */
      assets?: { a: ArtAssets; logo: ImageBitmap | null; icon: ImageBitmap | null };
      faces: { face: ArtFace; dims?: ArtDims }[];
      /** Interface 2D : images WebP (`Blob`) au lieu d'`ImageBitmap` pour WebGL. */
      encode?: boolean;
    };

export type PaintReply =
  | { type: "ready"; ok: boolean }
  | { type: "done"; id: number; bitmaps: ImageBitmap[] }
  | { type: "encoded"; id: number; blobs: Blob[] }
  | { type: "need"; id: number }
  | { type: "error"; id: number; message: string };

type Scope = {
  onmessage: ((e: MessageEvent<PaintRequest>) => void) | null;
  postMessage(message: PaintReply, transfer?: Transferable[]): void;
  fonts?: FontFaceSet;
};
const scope = self as unknown as Scope;

/** Images des derniers jeux peints (le même boîtier repasse souvent en parcourant). */
const ASSETS_KEPT = 12;
const assets = new Map<string, NonNullable<Extract<PaintRequest, { type: "paint" }>["assets"]>>();

function supported(): boolean {
  try {
    return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d") && !!scope.fonts && typeof FontFace !== "undefined";
  } catch {
    return false;
  }
}

async function init(fonts: WorkerFont[]): Promise<boolean> {
  if (!supported()) return false;
  const set = scope.fonts!;
  // toutes les tranches Unicode déclarées : le texte ne retombe jamais sur une police de secours
  const faces = fonts.map((f) => {
    const face = new FontFace(f.family, `url("${f.url}")`, f.descriptors);
    set.add(face);
    return face.load().catch(() => null);
  });
  await Promise.all(faces);
  // comme sur le fil principal (`ensureFonts`) : les graisses utilisées sont prêtes
  await Promise.all(PAINT_FONTS.map((f) => set.load(f).catch(() => [])));
  return fonts.length > 0 && PAINT_FONTS.every((f) => set.check(f));
}

/** Rendu d'un canevas en image prête pour WebGL : retournée et non prémultipliée, comme `CanvasTexture`. */
const toBitmap = (c: PaintCanvas) => createImageBitmap(c, { imageOrientation: "flipY", premultiplyAlpha: "none" });

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "init") {
    void init(msg.fonts).then((ok) => scope.postMessage({ type: "ready", ok }), () => scope.postMessage({ type: "ready", ok: false }));
    return;
  }
  if (msg.assets) {
    assets.delete(msg.key);
    assets.set(msg.key, msg.assets);
    while (assets.size > ASSETS_KEPT) assets.delete(assets.keys().next().value!);
  }
  const held = assets.get(msg.key);
  if (!held) {
    scope.postMessage({ type: "need", id: msg.id });
    return;
  }
  assets.delete(msg.key);
  assets.set(msg.key, held);
  if (msg.encode) {
    // interface 2D : même qualité que `canvas.toBlob` du fil principal (`getArtUrl`)
    void Promise.all(msg.faces.map(({ face, dims }) => (paintFace(msg.game, face, held.a, dims, { key: msg.key, logo: held.logo, icon: held.icon }) as OffscreenCanvas).convertToBlob({ type: "image/webp", quality: 0.92 }))).then(
      (blobs) => scope.postMessage({ type: "encoded", id: msg.id, blobs }),
      (error: unknown) => scope.postMessage({ type: "error", id: msg.id, message: String(error) }),
    );
    return;
  }
  void (async () => {
    const bitmaps: ImageBitmap[] = [];
    for (const { face, dims } of msg.faces) {
      const canvas = paintFace(msg.game, face, held.a, dims, { key: msg.key, logo: held.logo, icon: held.icon });
      bitmaps.push(await toBitmap(canvas));
    }
    return bitmaps;
  })().then(
    (bitmaps) => scope.postMessage({ type: "done", id: msg.id, bitmaps }, bitmaps),
    (error: unknown) => scope.postMessage({ type: "error", id: msg.id, message: String(error) }),
  );
};
