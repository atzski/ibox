import type { Game } from "@/domain/types";
import { metadataApi, type MediaKind } from "@/services/metadata";
import { isTauri } from "@/services/native";
import { basePalette, fullScanSplit } from "./painters";

export type Palette = [string, string, string, string, string];

/** Images réelles d'un jeu (chargées depuis le cache natif) et palette dérivée. */
export interface ArtAssets {
  front?: ImageBitmap;
  back?: ImageBitmap;
  spine?: ImageBitmap;
  full?: ImageBitmap;
  disc?: ImageBitmap;
  title?: ImageBitmap;
  screenshot?: ImageBitmap;
  /** Logo du jeu (SteamGridDB), utilisé au dos. */
  logo?: ImageBitmap;
  /** Bannière paysage (jeux PC et applications Android : dos et disque du boîtier DVD). */
  hero?: ImageBitmap;
  /** Icône d'une application Android (logo, emplacement 1) : sa face quand il n'y a pas de jaquette. */
  icon?: ImageBitmap;
  /** Couleurs de la vraie jaquette, sinon celles de l'habillage. */
  palette: Palette;
  /** Une vraie jaquette avant est disponible (téléchargée, importée ou scan complet). */
  hasCover: boolean;
}

export { fullScanSplit, basePalette };

/** Signature des images d'un jeu : change à chaque ajout ou remplacement. */
export function mediaSignature(game: Game): string {
  return (game.media ?? []).map((m) => `${m.kind}${m.slot}@${m.addedAt}`).join(",");
}

async function loadBitmap(game: Game, kind: MediaKind, resizeWidth?: number, slot = 0): Promise<ImageBitmap | undefined> {
  if (game.dbId === undefined || !isTauri()) return undefined;
  if (!(game.media ?? []).some((m) => m.kind === kind && m.slot === slot)) return undefined;
  try {
    const bytes = await metadataApi.read(game.dbId, kind, slot);
    return await createImageBitmap(new Blob([bytes]), resizeWidth ? { resizeWidth, resizeQuality: "medium" } : undefined);
  } catch {
    return undefined; // fichier manquant ou illisible : habillage généré
  }
}

/** Emplacement de l'icône d'une application Android parmi les logos (`android_apps::ICON_SLOT`). */
const ANDROID_ICON_SLOT = 1;

function loadIcon(game: Game): Promise<ImageBitmap | undefined> {
  return game.platformId === "android" ? loadBitmap(game, "logo", undefined, ANDROID_ICON_SLOT) : Promise.resolve(undefined);
}

/**
 * Bannière Android TV d'une application (`android_apps::BANNER_SLOT`) : dos et disque du boîtier,
 * à défaut d'un vrai « Fond ». Jamais en emplacement 0, où elle servirait de fond d'écran étiré.
 */
const ANDROID_BANNER_SLOT = 1;

function loadBanner(game: Game): Promise<ImageBitmap | undefined> {
  return game.platformId === "android" ? loadBitmap(game, "hero", undefined, ANDROID_BANNER_SLOT) : Promise.resolve(undefined);
}

const cache = new Map<string, Promise<ArtAssets>>();

export function loadAssets(game: Game): Promise<ArtAssets> {
  const key = `${game.id}|${game.platformId}|${mediaSignature(game)}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const kinds: MediaKind[] = ["front", "back", "spine", "full", "disc", "title", "screenshot", "logo"];
      if (game.platformId === "pc" || game.platformId === "android") kinds.push("hero");
      const [bitmaps, icon, banner] = await Promise.all([Promise.all(kinds.map((k) => loadBitmap(game, k))), loadIcon(game), loadBanner(game)]);
      const a: Partial<ArtAssets> = {};
      kinds.forEach((k, i) => {
        if (bitmaps[i]) (a as Record<string, ImageBitmap>)[k] = bitmaps[i]!;
      });
      if (icon) a.icon = icon;
      if (banner && !a.hero) a.hero = banner;
      const coverSource = a.front ?? a.full;
      const palette = coverSource ? extractPalette(coverSource, a.front ? 0 : fullScanSplit(game.platformId, a.full).frontStart) : icon ? extractPalette(icon) : basePalette(game);
      return { ...a, palette, hasCover: !!coverSource } as ArtAssets;
    })();
    cache.set(key, p);
  }
  return p;
}

/**
 * Ressources allégées d'une vignette (vue reculée de la bibliothèque) : la face avant seule,
 * décodée à taille réduite et jamais gardée en mémoire. Si les images complètes du jeu sont
 * déjà chargées, elles servent telles quelles.
 */
export async function loadThumbAssets(game: Game, width: number): Promise<ArtAssets> {
  const loaded = cache.get(`${game.id}|${game.platformId}|${mediaSignature(game)}`);
  if (loaded) return loaded;
  const front = await loadBitmap(game, "front", width);
  // scan complet (dos | tranche | face) : la face n'en est que la moitié droite
  const full = front ? undefined : await loadBitmap(game, "full", Math.round(width * 2.2));
  const coverSource = front ?? full;
  const icon = coverSource ? undefined : await loadIcon(game);
  const palette = coverSource ? extractPalette(coverSource, front ? 0 : fullScanSplit(game.platformId, full).frontStart) : icon ? extractPalette(icon) : basePalette(game);
  return { front, full, icon, palette, hasCover: !!coverSource };
}

// ——— Palette ———

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  h /= 6;
  return [h, s, l];
}

/**
 * Palette d'une jaquette : haut, bas, couleur la plus vive, seconde couleur vive
 * (teinte différente) et encre (la plus sombre). `fromX` ignore la partie
 * gauche d'un scan complet (dos et tranche).
 */
export function extractPalette(img: CanvasImageSource & { width: number; height: number }, fromX = 0): Palette {
  const W = 24;
  const H = 32;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return ["#dddddd", "#bbbbbb", "#8ccdf1", "#b9a6e8", "#344459"];
  const sx = img.width * fromX;
  ctx.drawImage(img, sx, 0, img.width - sx, img.height, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;

  const avg = (y0: number, y1: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    return toHex(r / n, g / n, b / n);
  };

  const pixels: { rgb: [number, number, number]; h: number; s: number; l: number }[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const rgb: [number, number, number] = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = hsl(...rgb);
    pixels.push({ rgb, h, s, l });
  }
  const vivid = [...pixels].sort((a, b) => b.s * (1 - Math.abs(b.l - 0.5)) - a.s * (1 - Math.abs(a.l - 0.5)));
  const accent = vivid[0];
  const accent2 = vivid.find((p) => Math.min(Math.abs(p.h - accent.h), 1 - Math.abs(p.h - accent.h)) > 0.12) ?? vivid[1] ?? accent;
  const darkest = [...pixels].sort((a, b) => a.l - b.l)[0];
  const ink = darkest.l < 0.3 ? toHex(...darkest.rgb) : "#22283a";
  return [avg(0, 10), avg(22, 32), toHex(...accent.rgb), toHex(...accent2.rgb), ink];
}
