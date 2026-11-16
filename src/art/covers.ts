import type { Game, Platform } from "@/domain/types";
import { requirePlatform } from "@/domain/platforms";
import { MOTIFS } from "./motifs";
import { fullScanSplit, basePalette, loadAssets, mediaSignature, type ArtAssets, type Palette } from "./assets";
import { alpha, fitTitle, hashString, luminance, mixHex, mulberry32, shade, vGradient, wrapText, type Ctx } from "./paint";
import { artApi, usePlatformArtStore, type PlatformSlot } from "@/services/platformArt";

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
/** Logo large de la console (bandeaux), sinon son icône. */
function platformLogo(platformId: string): ImageBitmap | null {
  return readyPlatform.get(platformStamp(platformId, "platform_logo")) ?? readyPlatform.get(platformStamp(platformId, "platform_icon")) ?? null;
}
function platformIcon(platformId: string): ImageBitmap | null {
  return readyPlatform.get(platformStamp(platformId, "platform_icon")) ?? null;
}

/**
 * Faces imprimées d'un boîtier : avant, dos, tranche, étiquette du disque.
 *
 * Pour chaque face, dans l'ordre :
 *  1. image importée par l'utilisateur pour cette face ;
 *  2. découpe d'un scan complet importé (dos | tranche | face) ;
 *  3. (face avant) jaquette téléchargée ;
 *  4. habillage généré — construit autour de la vraie jaquette quand elle
 *     existe (ses couleurs, ses vraies captures, son vrai synopsis), sinon
 *     motif original (démo) ou aux couleurs de la console. Jamais de faux scan.
 */
/** `caseFront` : face avant posée sur un boîtier 3D (PC : avec le bandeau DVD-ROM). */
export type ArtFace = "front" | "boxFront" | "caseFront" | "back" | "spine" | "disc" | "label" | "cardLabel";

/** Taille demandée pour une face (textures 3D aux proportions de chaque boîtier). */
export type ArtDims = { w: number; h: number };

/** Résolution des textures (rapport des boîtiers GameCube : 136 × 191 × 14 mm). */
export const ART_SIZE = {
  front: { w: 800, h: 1124 },
  back: { w: 800, h: 1124 },
  spine: { w: 96, h: 1124 },
  disc: { w: 1024, h: 1024 },
} as const;

const DISPLAY = '"Fredoka Variable", "Nunito Variable", sans-serif';
const BODY = '"Nunito Variable", sans-serif';

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  fontsReady ??= Promise.all([
    document.fonts.load(`700 64px "Fredoka Variable"`),
    document.fonts.load(`600 24px "Nunito Variable"`),
    document.fonts.load(`800 24px "Nunito Variable"`),
  ])
    .then(() => undefined)
    .catch(() => undefined);
  return fontsReady;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D indisponible");
  return [c, ctx];
}

/** Palette de l'habillage (sans images réelles). */
export const paletteOf = basePalette;

/** Clé de cache : change avec le titre, la console ou les images du jeu. */
export function artKey(game: Game): string {
  return `${game.id}|${game.platformId}|${game.title}|${mediaSignature(game)}|${platformStamp(game.platformId, "platform_logo")}|${platformStamp(game.platformId, "platform_icon")}`;
}

type Source = CanvasImageSource & { width: number; height: number };

/** Dessine `src` (ou une zone de `src`) en remplissant le cadre, recadré au besoin. */
function drawCover(ctx: Ctx, src: Source, x: number, y: number, w: number, h: number, region?: [number, number], focusY = 0.5) {
  const [fx0, fx1] = region ?? [0, 1];
  const sw0 = src.width * (fx1 - fx0);
  const sh0 = src.height;
  const scale = Math.max(w / sw0, h / sh0);
  const sw = w / scale;
  const sh = h / scale;
  const sx = src.width * fx0 + (sw0 - sw) / 2;
  const sy = (sh0 - sh) * focusY;
  ctx.drawImage(src, sx, sy, sw, sh, x, y, w, h);
}

/**
 * Comme `drawCover`, mais sans jamais couper une vraie jaquette dont le format
 * diffère trop de la face (ex. jaquette SteamGridDB 2:3 sur un boîtier DS
 * presque carré) : l'image entière est posée au centre, sur un fond fait
 * d'elle-même, agrandie et floutée. Formats proches : simple remplissage.
 */
function drawFit(ctx: Ctx, src: Source, x: number, y: number, w: number, h: number, region?: [number, number]) {
  const [fx0, fx1] = region ?? [0, 1];
  const sw0 = src.width * (fx1 - fx0);
  const sh0 = src.height;
  const mismatch = Math.abs(Math.log(sw0 / sh0 / (w / h)));
  if (mismatch <= 0.12) {
    drawCover(ctx, src, x, y, w, h, region);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // fond : la même image, agrandie, floutée et légèrement assombrie
  ctx.filter = `blur(${Math.round(Math.max(w, h) * 0.03)}px) saturate(1.15) brightness(0.82)`;
  const bleed = Math.max(w, h) * 0.08;
  drawCover(ctx, src, x - bleed, y - bleed, w + bleed * 2, h + bleed * 2, region);
  ctx.filter = "none";
  // l'image entière, centrée, avec une ombre douce sur les bords
  const scale = Math.min(w / sw0, h / sh0);
  const dw = sw0 * scale;
  const dh = sh0 * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.round(Math.max(w, h) * 0.02);
  ctx.drawImage(src, src.width * fx0, 0, sw0, sh0, dx, dy, dw, dh);
  ctx.restore();
}

function placeholderLook(game: Game, a: ArtAssets) {
  return game.art.motif === "placeholder" && !a.hasCover;
}

/** Illustration de base : vraie jaquette si disponible, sinon motif généré. */
const sceneCache = new Map<string, HTMLCanvasElement>();
function scene(game: Game, a: ArtAssets, w: number = ART_SIZE.front.w, h: number = ART_SIZE.front.h): HTMLCanvasElement {
  const key = `${artKey(game)}|${w}x${h}`;
  const cached = sceneCache.get(key);
  if (cached) return cached;
  const [canvas, ctx] = makeCanvas(w, h);
  if (a.front) drawFit(ctx, a.front, 0, 0, w, h);
  else if (a.full) drawCover(ctx, a.full, 0, 0, w, h, [fullScanSplit(game.platformId, a.full).frontStart, 1]);
  else MOTIFS[game.art.motif](ctx, w, h, a.palette, mulberry32(hashString(game.id)));
  sceneCache.set(key, canvas);
  return canvas;
}

function drawPlatformMark(ctx: Ctx, platform: Platform, x: number, y: number, s: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (platform.glyph === "cube") {
    const r = s / 2;
    const pts = (ang: number) => [Math.cos(ang) * r, Math.sin(ang) * r] as const;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const [px, py] = pts(Math.PI / 6 + (i * Math.PI) / 3);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = alpha("#000000", 0.18);
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, r);
    ctx.moveTo(0, 0);
    ctx.lineTo(...pts(-Math.PI / 6 - (2 * Math.PI) / 3));
    ctx.moveTo(0, 0);
    ctx.lineTo(...pts(-Math.PI / 6));
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.roundRect(-s / 2, -s / 2, s, s, s * 0.28);
    ctx.fill();
  }
  ctx.restore();
}

function titleOnTop(game: Game) {
  return game.art.motif === "racers" || game.art.motif === "mountain";
}

/** Taille de la jaquette 2D : largeur fixe, hauteur selon le format de la console. */
function frontSize(game: Game): { w: number; h: number } {
  const aspect = requirePlatform(game.platformId).layout.coverAspect;
  return { w: 800, h: Math.round(800 / aspect) };
}

// ——— Détails d'impression ———

/** Hauteur du bandeau de console (comme le haut d'une vraie jaquette). */
function bannerHeight(w: number, h: number): number {
  return Math.round(Math.min(h * 0.072, w * 0.105));
}

/** Bandeau aux couleurs de la console, avec sa marque et son nom (aucun logo officiel). */
function drawBanner(ctx: Ctx, platform: Platform, w: number, h: number): number {
  const bh = bannerHeight(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, shade(platform.theme.deep, 0.12));
  g.addColorStop(1, platform.theme.deep);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, bh);
  const line = Math.max(2, Math.round(bh * 0.05));
  ctx.fillStyle = alpha("#ffffff", 0.28);
  ctx.fillRect(0, bh - line, w, line);
  const s = bh * 0.48;
  drawPlatformMark(ctx, platform, bh * 0.6, bh / 2, s, "#ffffff");
  ctx.save();
  ctx.font = `800 ${Math.round(bh * 0.38)}px ${BODY}`;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = `${Math.round(bh * 0.07)}px`;
  ctx.fillText(platform.shortName.toUpperCase(), bh * 0.6 + s * 0.95, bh / 2 + 1);
  ctx.restore();
  return bh;
}

let grain: HTMLCanvasElement | null = null;

/** Grain d'impression très léger : la jaquette ressemble à du papier imprimé. */
function drawGrain(ctx: Ctx, w: number, h: number, strength = 0.06) {
  if (!grain) {
    const [g, gc] = makeCanvas(160, 160);
    const img = gc.createImageData(160, 160);
    const rnd = mulberry32(0x1b0c);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + rnd() * 145;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gc.putImageData(img, 0, 0);
    grain = g;
  }
  const pattern = ctx.createPattern(grain, "repeat");
  if (!pattern) return;
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Code-barres décoratif, propre à chaque jeu (dérivé de sa référence ou de son titre). */
function drawBarcode(ctx: Ctx, seed: string, x: number, y: number, w: number, h: number, ink: string) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h * 0.12);
  ctx.fill();
  const rnd = mulberry32(hashString(seed));
  const pad = h * 0.14;
  let cx = x + pad;
  ctx.fillStyle = ink;
  while (cx < x + w - pad) {
    const bw = (1 + Math.floor(rnd() * 3)) * (w / 110);
    if (rnd() > 0.38) ctx.fillRect(cx, y + pad, bw, h - pad * 2.4);
    cx += bw + w / 110;
  }
  ctx.restore();
}

/** Image « contenue » dans un cadre (logo), sans déformation. */
function drawContain(ctx: Ctx, src: ImageBitmap, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / src.width, h / src.height);
  ctx.drawImage(src, x, y + (h - src.height * k) / 2, src.width * k, src.height * k);
}

// ——— Face avant ———

function paintFront(game: Game, a: ArtAssets, dims: { w: number; h: number }, onCase = false): HTMLCanvasElement {
  const { w, h } = dims;
  const [c, ctx] = makeCanvas(w, h);

  const platform = requirePlatform(game.platformId);

  // Jeu PC : vraie illustration habillée comme une boîte PC (bandeau, infos, reflet)
  if (a.hasCover && platform.id === "pc") return paintPcFront(game, a, platform, c, ctx, w, h, onCase);

  // Vraie jaquette : affichée telle quelle (elle a souvent déjà son propre bandeau)
  if (a.hasCover) {
    ctx.fillStyle = a.palette[1];
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(scene(game, a, w, h), 0, 0);
    return c;
  }

  const top = titleOnTop(game);
  const placeholder = placeholderLook(game, a);
  ctx.drawImage(scene(game, a, w, h), 0, 0);

  if (!placeholder) {
    const veil = ctx.createLinearGradient(0, top ? 0 : h, 0, top ? h * 0.5 : h * 0.45);
    veil.addColorStop(0, alpha("#161b36", 0.5));
    veil.addColorStop(1, alpha("#161b36", 0));
    ctx.fillStyle = veil;
    ctx.fillRect(0, 0, w, h);
  }

  // bandeau de la console, comme sur une vraie jaquette
  drawBanner(ctx, platform, w, h);

  // titre
  const { size, lines } = fitTitle(ctx, game.title, w - 120, 112, 56, 3, DISPLAY);
  const lineH = size * 1.02;
  const titleY = top ? 190 : h - 150 - lines.length * lineH;
  if (game.art.tagline) {
    ctx.font = `800 24px ${BODY}`;
    ctx.fillStyle = placeholder ? platform.theme.deep : alpha("#ffffff", 0.9);
    ctx.textAlign = "center";
    ctx.save();
    ctx.letterSpacing = "6px";
    ctx.fillText(game.art.tagline.toUpperCase(), w / 2, titleY - 26);
    ctx.restore();
  }
  ctx.font = `700 ${size}px ${DISPLAY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (!placeholder) {
    ctx.shadowColor = alpha("#10142a", 0.45);
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
  }
  ctx.fillStyle = placeholder ? platform.theme.deep : "#ffffff";
  lines.forEach((l, i) => ctx.fillText(l, w / 2, titleY + i * lineH));
  ctx.shadowColor = "transparent";

  if (game.publisher) {
    ctx.font = `700 24px ${BODY}`;
    ctx.fillStyle = placeholder ? platform.theme.deep : alpha("#ffffff", 0.85);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(game.publisher, w / 2, h - 48);
  }
  drawGrain(ctx, w, h);
  return c;
}

/** Face d'une boîte PC : bandeau « PC », illustration, bande d'informations réelles, reflet. */
function paintPcFront(game: Game, a: ArtAssets, _platform: Platform, c: HTMLCanvasElement, ctx: Ctx, w: number, h: number, onCase = false): HTMLCanvasElement {
  ctx.fillStyle = a.palette[1];
  ctx.fillRect(0, 0, w, h);
  if (onCase) {
    // sur le boîtier 3D : bandeau noir « PC DVD-ROM », l'illustration dessous
    const band = drawPcBand(ctx, game, w, h);
    ctx.drawImage(scene(game, a, w, h - band), 0, band);
  } else {
    // vignette de la bibliothèque : l'illustration occupe toute la face
    ctx.drawImage(scene(game, a, w, h), 0, 0);
  }
  // bande du bas : éditeur / développeur et année (seulement les infos connues)
  const left = game.publisher ?? game.developer;
  const right = game.year ? String(game.year) : undefined;
  if (left || right) {
    const sh = Math.round(h * 0.085);
    const g = ctx.createLinearGradient(0, h - sh * 2.2, 0, h);
    g.addColorStop(0, alpha("#0b0f1d", 0));
    g.addColorStop(1, alpha("#0b0f1d", 0.78));
    ctx.fillStyle = g;
    ctx.fillRect(0, h - sh * 2.2, w, sh * 2.2);
    ctx.save();
    ctx.font = `800 ${Math.round(sh * 0.34)}px ${BODY}`;
    ctx.fillStyle = alpha("#ffffff", 0.92);
    ctx.textBaseline = "middle";
    ctx.letterSpacing = `${Math.round(sh * 0.04)}px`;
    if (left) { ctx.textAlign = "left"; ctx.fillText(left.toUpperCase().slice(0, 30), sh * 0.45, h - sh * 0.55); }
    if (right) {
      ctx.textAlign = "right";
      const tw = ctx.measureText(right).width;
      ctx.fillStyle = alpha("#ffffff", 0.16);
      ctx.beginPath();
      ctx.roundRect(w - sh * 0.45 - tw - sh * 0.5, h - sh * 0.95, tw + sh * 0.5, sh * 0.8, sh * 0.4);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(right, w - sh * 0.45 - sh * 0.25, h - sh * 0.55);
    }
    ctx.restore();
  }
  // liseré et reflet de boîtier plastique
  ctx.strokeStyle = alpha("#ffffff", 0.22);
  ctx.lineWidth = Math.max(2, w * 0.006);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  const gloss = ctx.createLinearGradient(0, 0, w, h * 0.75);
  gloss.addColorStop(0, alpha("#ffffff", 0.16));
  gloss.addColorStop(0.35, alpha("#ffffff", 0.04));
  gloss.addColorStop(0.36, alpha("#ffffff", 0));
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, w, h);
  drawGrain(ctx, w, h, 0.05);
  return c;
}

// ——— Dos ———

function paintBack(game: Game, a: ArtAssets, dims: { w: number; h: number } = ART_SIZE.back): HTMLCanvasElement {
  const { w, h } = dims;
  const [c, ctx] = makeCanvas(w, h);
  if (a.back) {
    drawFit(ctx, a.back, 0, 0, w, h);
    return c;
  }
  if (a.full) {
    drawCover(ctx, a.full, 0, 0, w, h, [0, fullScanSplit(game.platformId, a.full).backEnd]);
    return c;
  }
  if (game.platformId === "pc" && w <= h) return paintPcBack(game, a, w, h);

  const platform = requirePlatform(game.platformId);
  const p = a.palette;
  const ink = "#344459";
  const deep = a.hasCover ? shade(p[2], -0.35) : platform.theme.deep;
  const deepHex = deep.startsWith("#") ? deep : "#344459";
  const landscape = w > h * 1.05;
  // échelle typographique : 1 pour un dos portrait de 800 px de large
  const s = Math.min(w, landscape ? h * 1.25 : w) / 800;
  const pad = Math.round(60 * s);

  ctx.fillStyle = vGradient(ctx, h, [
    [0, mixHex(p[1], "#ffffff", 0.82)],
    [1, mixHex(p[0], "#ffffff", 0.78)],
  ]);
  ctx.fillRect(0, 0, w, h);

  const sceneImg = scene(game, a);
  const big: Source = a.title ?? a.screenshot ?? sceneImg;
  const vignette = (img: Source, x: number, y: number, vw: number, vh: number, focus: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, vw, vh, 24 * s);
    ctx.clip();
    drawCover(ctx, img, x, y, vw, vh, undefined, img === sceneImg ? focus : 0.5);
    ctx.restore();
  };

  // Zone texte : en haut (portrait) ou dans la colonne de droite (paysage)
  const textX = landscape ? Math.round(w * 0.5) + pad / 2 : pad;
  const textW = landscape ? w - textX - pad : w - pad * 2;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const t = fitTitle(ctx, game.title, textW, 60 * s, 34 * s, 1, DISPLAY);
  // logo du jeu (SteamGridDB) à la place du titre en texte, plus haut que le texte
  const titleH = a.logo ? Math.round(130 * s) : t.size;
  if (a.logo) {
    drawContain(ctx, a.logo, textX, pad - 4 * s, textW * 0.62, titleH);
  } else {
    ctx.fillStyle = ink;
    ctx.fillText(t.lines[0], textX, pad);
  }
  ctx.font = `800 ${20 * s}px ${BODY}`;
  ctx.fillStyle = deep;
  ctx.save();
  ctx.letterSpacing = `${4 * s}px`;
  ctx.fillText((game.art.tagline ?? platform.name).toUpperCase(), textX + 2 * s, pad + titleH + 10 * s);
  ctx.restore();

  const footerH = 96 * s;
  const footerY = h - pad - footerH;
  let cursor = pad + titleH + 52 * s;

  if (landscape) {
    vignette(big, pad, pad, w * 0.5 - pad, h - pad * 2, 0.45);
  } else {
    // sans résumé, la grande image occupe la place libérée
    const vh = Math.round(h * (game.description ? 0.29 : 0.4));
    vignette(big, pad, cursor, w - pad * 2, vh, 0.45);
    cursor += vh + 40 * s;
  }

  // synopsis, autant de lignes que la place le permet
  ctx.font = `600 ${25 * s}px ${BODY}`;
  ctx.fillStyle = ink;
  const lineH = 36 * s;
  const smallH = landscape ? 0 : 170 * s;
  const room = footerY - cursor - (smallH ? smallH + 34 * s : 20 * s);
  const lines = wrapText(ctx, game.description ?? "", textW).slice(0, Math.max(0, Math.floor(room / lineH)));
  lines.forEach((l, i) => ctx.fillText(l, textX, cursor + i * lineH));
  cursor += lines.length * lineH + 34 * s;

  // deux petites vignettes (portrait), une seule en paysage si la place le permet
  const smalls: Source[] = [a.screenshot ?? sceneImg, a.title && a.screenshot ? a.title : sceneImg];
  if (!landscape) {
    const sw = (w - pad * 2 - 24 * s) / 2;
    smalls.forEach((img, i) => vignette(img, pad + i * (sw + 24 * s), cursor, sw, smallH, 0.2 + i * 0.5));
  } else if (footerY - cursor > 120 * s) {
    vignette(smalls[0], textX, cursor, textW, Math.min(footerY - cursor - 24 * s, textW * 0.56), 0.3);
  }

  ctx.fillStyle = alpha(deepHex, 0.12);
  ctx.beginPath();
  ctx.roundRect(textX, footerY, textW, footerH, 24 * s);
  ctx.fill();
  ctx.fillStyle = deep;
  ctx.font = `800 ${22 * s}px ${BODY}`;
  const info = [game.genre, game.players, game.year?.toString()].filter(Boolean).join("  ·  ");
  const barW = 150 * s;
  const textRoom = textW - 28 * s - barW - 110 * s;
  ctx.fillText(info, textX + 28 * s, footerY + 18 * s, textRoom);
  drawBarcode(ctx, game.serial ?? game.title, textX + textW - 92 * s - barW, footerY + 16 * s, barW, footerH - 32 * s, ink);
  ctx.font = `600 ${20 * s}px ${BODY}`;
  ctx.fillStyle = alpha(ink, 0.75);
  ctx.fillText(
    game.isDemo
      ? "Jaquette de démonstration originale — iBox"
      : [game.publisher, game.serial ? `Réf. ${game.serial}` : null].filter(Boolean).join("  ·  ") || "Dos généré par iBox",
    textX + 28 * s,
    footerY + 54 * s,
    textRoom,
  );
  drawPlatformMark(ctx, platform, textX + textW - 44 * s, footerY + footerH / 2, 40 * s, deep);
  drawGrain(ctx, w, h, 0.045);
  return c;
}

// ——— Tranche ———

function paintSpine(game: Game, a: ArtAssets, dims: { w: number; h: number } = ART_SIZE.spine): HTMLCanvasElement {
  const { w, h } = dims;
  const [c, ctx] = makeCanvas(w, h);
  if (a.spine) {
    drawCover(ctx, a.spine, 0, 0, w, h);
    return c;
  }
  if (a.full) {
    const cut = fullScanSplit(game.platformId, a.full);
    drawCover(ctx, a.full, 0, 0, w, h, [cut.backEnd, cut.frontStart]);
    return c;
  }

  const platform = requirePlatform(game.platformId);
  const p = a.palette;
  const placeholder = placeholderLook(game, a);
  const band = Math.round(Math.min(Math.max(120, w * 1.1), h * 0.17));

  // fond : l'illustration du jeu étirée le long de la tranche, teintée
  ctx.fillStyle = vGradient(ctx, h, [[0, p[0]], [1, p[1]]]);
  ctx.fillRect(0, 0, w, h);
  if (!placeholder) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(scene(game, a, h, w), 0, 0, h, w);
    ctx.restore();
    ctx.fillStyle = vGradient(ctx, h, [[0, alpha(p[0], 0.55)], [0.5, alpha(p[1], 0.35)], [1, alpha(shade(p[1], -0.35), 0.8)]]);
    ctx.fillRect(0, 0, w, h);
  }

  // bandeau de la console : logo choisi, sinon la marque
  const bandG = ctx.createLinearGradient(0, 0, w, 0);
  bandG.addColorStop(0, shade(platform.theme.deep, 0.1));
  bandG.addColorStop(1, platform.theme.deep);
  ctx.fillStyle = bandG;
  ctx.fillRect(0, 0, w, band);
  ctx.fillStyle = alpha("#ffffff", 0.3);
  ctx.fillRect(0, band - 4, w, 4);
  const icon = platformIcon(platform.id) ?? platformLogo(platform.id);
  if (icon) drawContain(ctx, icon, w * 0.14, band * 0.12, w * 0.72, band * 0.76);
  else drawPlatformMark(ctx, platform, w / 2, band / 2, Math.min(46, w * 0.48), "#ffffff");

  // liserés latéraux aux couleurs du jeu
  const edge = Math.max(3, Math.round(w * 0.05));
  ctx.fillStyle = alpha(p[2], 0.9);
  ctx.fillRect(0, band, edge, h - band);
  ctx.fillRect(w - edge, band, edge, h - band);

  // titre : logo du jeu couché le long de la tranche, sinon le nom
  const lightBg = placeholder || (luminance(p[0]) + luminance(p[1])) / 2 > 0.62;
  const darkInk = luminance(p[4]) < 0.2 ? p[4] : shade(p[2], -0.5);
  const footer = Math.round(Math.min(150, h * 0.17));
  const room = h - band - footer - 60;
  ctx.save();
  ctx.translate(w / 2, band + 30);
  ctx.rotate(Math.PI / 2);
  if (a.logo) {
    const k = Math.min(room / a.logo.width, (w * 0.7) / a.logo.height);
    ctx.shadowColor = alpha("#10142a", 0.45);
    ctx.shadowBlur = 10;
    ctx.drawImage(a.logo, 0, -(a.logo.height * k) / 2, a.logo.width * k, a.logo.height * k);
  } else {
    const t = fitTitle(ctx, game.title, room, Math.min(54 * Math.max(1, w / 96), w * 0.56), 24, 1, DISPLAY);
    ctx.font = `700 ${t.size}px ${DISPLAY}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = placeholder ? platform.theme.deep : lightBg ? darkInk : "#ffffff";
    if (!lightBg) { ctx.shadowColor = alpha("#10142a", 0.45); ctx.shadowBlur = 10; }
    ctx.fillText(t.lines[0], 0, 2);
  }
  ctx.restore();

  // pied : année, puis pastille de l'éditeur
  const r = Math.min(30, w * 0.32);
  if (game.year) {
    ctx.font = `800 ${Math.round(Math.min(26, w * 0.26))}px ${BODY}`;
    ctx.fillStyle = lightBg ? alpha(darkInk, 0.8) : alpha("#ffffff", 0.85);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(game.year), w / 2, h - r * 2 - 58);
  }
  ctx.fillStyle = alpha("#ffffff", 0.92);
  ctx.beginPath();
  ctx.arc(w / 2, h - r - 34, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = alpha(platform.theme.deep, 0.35);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = platform.theme.deep;
  ctx.font = `800 ${Math.round(r * 0.73)}px ${BODY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const initials = (game.publisher ?? game.title).split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase();
  ctx.fillText(initials, w / 2, h - r - 33);

  // reflet du plastique
  const gloss = ctx.createLinearGradient(0, 0, w, 0);
  gloss.addColorStop(0, alpha("#ffffff", 0));
  gloss.addColorStop(0.3, alpha("#ffffff", 0.18));
  gloss.addColorStop(0.5, alpha("#ffffff", 0));
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, w, h);
  drawGrain(ctx, w, h, 0.05);
  return c;
}

// ——— Étiquette de cartouche / carte de jeu ———

/** Vraie jaquette avant (image seule ou partie avant d'un scan complet), si elle existe. */
function realFront(game: Game, a: ArtAssets): { src: Source; region?: [number, number] } | null {
  if (a.front) return { src: a.front };
  if (a.full) return { src: a.full, region: [fullScanSplit(game.platformId, a.full).frontStart, 1] };
  return null;
}

function paintLabel(game: Game, a: ArtAssets, dims: { w: number; h: number }): HTMLCanvasElement {
  const { w, h } = dims;
  const [c, ctx] = makeCanvas(w, h);
  const platform = requirePlatform(game.platformId);
  // vraie illustration : elle porte déjà son design (titre, logo) ; posée entière, sans rien ajouter
  const real = realFront(game, a);
  if (real) {
    drawFit(ctx, real.src, 0, 0, w, h, real.region);
    return c;
  }
  const p = a.palette;
  drawCover(ctx, scene(game, a), 0, 0, w, h, undefined, 0.3);
  // bandeau du titre
  const bandH = Math.round(h * 0.24);
  ctx.fillStyle = alpha("#ffffff", 0.92);
  ctx.fillRect(0, h - bandH, w, bandH);
  const t = fitTitle(ctx, game.title, w * 0.86, bandH * 0.5, 14, 1, DISPLAY);
  ctx.fillStyle = luminance(p[4]) < 0.25 ? p[4] : shade(p[0], -0.5);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(t.lines[0], w / 2, h - bandH / 2);
  drawPlatformMark(ctx, platform, h * 0.09 + 6, h * 0.09 + 6, h * 0.13, alpha("#ffffff", 0.9));
  return c;
}

/**
 * Étiquette autocollante d'une carte de jeu : coins arrondis (transparents),
 * liseré blanc, bandeau de la console, illustration du jeu et reflet brillant.
 */
function paintCardLabel(game: Game, a: ArtAssets, dims: { w: number; h: number }): HTMLCanvasElement {
  const { w, h } = dims;
  const [c, ctx] = makeCanvas(w, h);
  const platform = requirePlatform(game.platformId);
  const r = Math.min(w, h) * 0.07;

  // papier de l'étiquette
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.clip();
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, w, h);

  // illustration, avec un fin liseré blanc
  const m = Math.round(Math.min(w, h) * 0.035);
  const real = realFront(game, a);
  // vraie illustration : pas de bandeau ajouté, elle occupe toute l'étiquette
  const band = real ? 0 : Math.round(h * 0.17);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(m, m, w - m * 2, h - m * 2, r * 0.6);
  ctx.clip();
  if (real) drawFit(ctx, real.src, m, m, w - m * 2, h - m * 2, real.region);
  else drawCover(ctx, scene(game, a), m, m + band, w - m * 2, h - m * 2 - band, undefined, 0.32);

  // bandeau de la console (habillage généré seulement)
  if (!real) {
    const g = ctx.createLinearGradient(0, m, 0, m + band);
    g.addColorStop(0, shade(platform.theme.deep, 0.1));
    g.addColorStop(1, platform.theme.deep);
    ctx.fillStyle = g;
    ctx.fillRect(m, m, w - m * 2, band);
    const mark = band * 0.5;
    drawPlatformMark(ctx, platform, m + band * 0.55, m + band / 2, mark, "#ffffff");
    ctx.font = `800 ${Math.round(band * 0.42)}px ${BODY}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.save();
    ctx.letterSpacing = `${Math.round(band * 0.06)}px`;
    ctx.fillText(platform.shortName.toUpperCase(), m + band * 0.55 + mark * 0.95, m + band / 2 + 1);
    ctx.restore();
  }

  // titre sur l'illustration quand elle ne le porte pas déjà (habillage généré)
  if (!a.hasCover) {
    const veil = ctx.createLinearGradient(0, h, 0, h * 0.55);
    veil.addColorStop(0, alpha("#10142a", 0.6));
    veil.addColorStop(1, alpha("#10142a", 0));
    ctx.fillStyle = veil;
    ctx.fillRect(m, h * 0.55, w - m * 2, h * 0.45 - m);
    const t = fitTitle(ctx, game.title, w * 0.84, h * 0.17, 12, 2, DISPLAY);
    ctx.font = `700 ${t.size}px ${DISPLAY}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    t.lines.forEach((l, i) => ctx.fillText(l, w / 2, h - m * 2.2 - (t.lines.length - 1 - i) * t.size * 1.02));
  }
  ctx.restore();

  // reflet brillant de l'autocollant
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, alpha("#ffffff", 0.22));
  sheen.addColorStop(0.35, alpha("#ffffff", 0));
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  drawGrain(ctx, w, h, 0.04);
  return c;
}

// ——— Disque ———


function paintDisc(game: Game, a: ArtAssets): HTMLCanvasElement {
  const { w } = ART_SIZE.disc;
  const [c, ctx] = makeCanvas(w, w);
  const p = a.palette;
  const r = w / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.clip();

  if (a.disc) {
    drawCover(ctx, a.disc, 0, 0, w, w);
    ctx.restore();
    return c;
  }
  if (game.platformId === "pc") {
    ctx.restore();
    return paintPcDisc(game, a, c, ctx, w);
  }

  const src = scene(game, a);
  drawCover(ctx, src, 0, 0, w, w, undefined, 0.25);
  ctx.fillStyle = alpha("#ffffff", 0.12);
  ctx.fillRect(0, 0, w, w);

  // le visuel de la jaquette suffit : le titre n'est imprimé que sur un disque sans image
  const designed = !!(a.front || a.full);
  if (designed) {
    // reflet irisé d'un vrai disque
    const shine = ctx.createConicGradient(Math.PI / 5, r, r);
    shine.addColorStop(0, alpha("#ffffff", 0));
    shine.addColorStop(0.12, alpha("#ffffff", 0.22));
    shine.addColorStop(0.25, alpha("#ffffff", 0));
    shine.addColorStop(0.62, alpha("#ffffff", 0));
    shine.addColorStop(0.74, alpha("#ffffff", 0.16));
    shine.addColorStop(0.86, alpha("#ffffff", 0));
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, w, w);
  } else {
    ctx.fillStyle = alpha("#ffffff", 0.9);
    ctx.fillRect(0, r + r * 0.38, w, r * 0.3);
    const t = fitTitle(ctx, game.title, w * 0.62, 76, 40, 1, DISPLAY);
    ctx.fillStyle = luminance(p[4]) < 0.25 ? p[4] : shade(p[0], -0.45);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(t.lines[0], r, r + r * 0.53);
  }

  // anneau central argenté (zone transparente d'un vrai disque)
  const hub = ctx.createRadialGradient(r, r, r * 0.19, r, r, r * 0.42);
  hub.addColorStop(0, "#f4f6fa");
  hub.addColorStop(0.5, "#d4dae4");
  hub.addColorStop(1, "#eef1f6");
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = alpha("#8794a3", 0.5);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(r, r, r * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = alpha("#ffffff", 0.8);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(r, r, r - 5, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

// ——— Jeux PC : boîtier DVD-ROM ———

/** Boutique du jeu PC (version préférée), en capitales pour le bandeau. */
const PC_STORE_NAMES: Record<string, string> = {
  steam: "Steam", "steam-family": "Steam", epic: "Epic Games", gog: "GOG", ubisoft: "Ubisoft Connect", ea: "EA app",
  xbox: "Xbox", battlenet: "Battle.net", rockstar: "Rockstar", riot: "Riot Games", rsi: "RSI", itch: "itch.io",
};
function pcStores(game: Game): string[] {
  const list = [...(game.pcInstalls ?? [])].sort((a, b) => Number(b.preferred) - Number(a.preferred));
  return [...new Set(list.map((i) => PC_STORE_NAMES[i.source]).filter((n): n is string => !!n))];
}

/** Bandeau noir « PC DVD-ROM » d'un boîtier PC ; renvoie sa hauteur. */
function drawPcBand(ctx: Ctx, game: Game, w: number, h: number): number {
  const bh = Math.round(Math.min(h * 0.062, w * 0.09));
  const g = ctx.createLinearGradient(0, 0, 0, bh);
  g.addColorStop(0, "#1d222d");
  g.addColorStop(1, "#0c0f16");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, bh);
  ctx.fillStyle = alpha("#ffffff", 0.18);
  ctx.fillRect(0, bh - Math.max(1, bh * 0.04), w, Math.max(1, bh * 0.04));
  const pad = bh * 0.32;
  // pastille « PC »
  ctx.save();
  ctx.font = `900 ${Math.round(bh * 0.5)}px ${DISPLAY}`;
  ctx.textBaseline = "middle";
  const pw = ctx.measureText("PC").width + bh * 0.5;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(pad, bh * 0.2, pw, bh * 0.6, bh * 0.12);
  ctx.fill();
  ctx.fillStyle = "#0c0f16";
  ctx.textAlign = "center";
  ctx.fillText("PC", pad + pw / 2, bh * 0.52);
  // « DVD-ROM »
  ctx.textAlign = "left";
  ctx.font = `800 ${Math.round(bh * 0.3)}px ${BODY}`;
  ctx.letterSpacing = `${Math.round(bh * 0.06)}px`;
  ctx.fillStyle = alpha("#ffffff", 0.9);
  ctx.fillText("DVD-ROM", pad + pw + bh * 0.28, bh * 0.52);
  // boutique, à droite
  const store = pcStores(game)[0];
  if (store) {
    ctx.textAlign = "right";
    ctx.fillStyle = alpha("#ffffff", 0.62);
    ctx.font = `800 ${Math.round(bh * 0.26)}px ${BODY}`;
    ctx.fillText(store.toUpperCase(), w - pad, bh * 0.52, w * 0.4);
  }
  ctx.restore();
  return bh;
}

/** Dos d'un boîtier PC sans vrai scan : sombre, bannière du jeu, résumé, captures. */
function paintPcBack(game: Game, a: ArtAssets, w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, h);
  const p = a.palette;
  const s = w / 800;
  const pad = Math.round(54 * s);
  const deep = shade(p[2], -0.55);
  ctx.fillStyle = vGradient(ctx, h, [[0, shade(p[1], -0.62)], [0.55, "#11141c"], [1, "#0a0c12"]]);
  ctx.fillRect(0, 0, w, h);

  const band = drawPcBand(ctx, game, w, h);
  let y = band;

  // bannière du jeu en tête, fondue dans le fond
  const banner: Source | undefined = a.hero ?? a.screenshot ?? a.title;
  const bannerH = Math.round(h * 0.3);
  if (banner) {
    drawCover(ctx, banner, 0, y, w, bannerH, undefined, 0.4);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawCover(ctx, scene(game, a), 0, y, w, bannerH, undefined, 0.3);
    ctx.restore();
  }
  const fade = ctx.createLinearGradient(0, y + bannerH * 0.35, 0, y + bannerH);
  fade.addColorStop(0, alpha("#0d1018", 0));
  fade.addColorStop(1, "#11141c");
  ctx.fillStyle = fade;
  ctx.fillRect(0, y, w, bannerH);

  // logo (ou titre) posé sur la bannière
  const logoH = Math.round(118 * s);
  const logoY = y + bannerH - logoH * 0.85;
  if (a.logo) {
    ctx.save();
    ctx.shadowColor = alpha("#000000", 0.6);
    ctx.shadowBlur = 18 * s;
    drawContain(ctx, a.logo, pad, logoY, w * 0.6, logoH);
    ctx.restore();
  } else {
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    const t = fitTitle(ctx, game.title, w - pad * 2, 64 * s, 34 * s, 2, DISPLAY);
    ctx.font = `700 ${t.size}px ${DISPLAY}`;
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = alpha("#000000", 0.6);
    ctx.shadowBlur = 14 * s;
    t.lines.forEach((l, i) => ctx.fillText(l, pad, logoY + logoH - (t.lines.length - 1 - i) * t.size * 1.05));
    ctx.shadowBlur = 0;
  }
  y += bannerH + 30 * s;

  // accroche : genre · joueurs · année
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const facts = [game.genre, game.players, game.year?.toString()].filter(Boolean).join("  ·  ");
  if (facts) {
    ctx.save();
    ctx.font = `800 ${20 * s}px ${BODY}`;
    ctx.letterSpacing = `${3 * s}px`;
    ctx.fillStyle = mixHex(p[2], "#ffffff", 0.45);
    ctx.fillText(facts.toUpperCase(), pad, y, w - pad * 2);
    ctx.restore();
    y += 46 * s;
  }

  const footerH = Math.round(118 * s);
  const footerY = h - pad - footerH;
  const shotsH = Math.round(150 * s);
  const shots: Source[] = [a.screenshot, a.title, a.hero].filter((v): v is ImageBitmap => !!v);

  // résumé : autant de lignes que la place le permet
  ctx.font = `600 ${24 * s}px ${BODY}`;
  ctx.fillStyle = alpha("#ffffff", 0.84);
  const lineH = 35 * s;
  const room = footerY - y - (shots.length ? shotsH + 36 * s : 20 * s);
  const lines = wrapText(ctx, game.description ?? "", w - pad * 2).slice(0, Math.max(0, Math.floor(room / lineH)));
  lines.forEach((l, i) => ctx.fillText(l, pad, y + i * lineH));

  // captures d'écran
  if (shots.length) {
    const n = Math.min(3, Math.max(2, shots.length));
    const gap = 18 * s;
    const sw = (w - pad * 2 - gap * (n - 1)) / n;
    const sy = footerY - 30 * s - shotsH;
    for (let i = 0; i < n; i++) {
      const img = shots[i % shots.length];
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(pad + i * (sw + gap), sy, sw, shotsH, 14 * s);
      ctx.clip();
      drawCover(ctx, img, pad + i * (sw + gap), sy, sw, shotsH, undefined, 0.25 + i * 0.25);
      ctx.restore();
      ctx.strokeStyle = alpha("#ffffff", 0.22);
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.roundRect(pad + i * (sw + gap), sy, sw, shotsH, 14 * s);
      ctx.stroke();
    }
  }

  // pied blanc : éditeur, boutiques, code-barres
  ctx.fillStyle = alpha("#ffffff", 0.94);
  ctx.beginPath();
  ctx.roundRect(pad, footerY, w - pad * 2, footerH, 18 * s);
  ctx.fill();
  const barW = 150 * s;
  const textRoom = w - pad * 2 - barW - 70 * s;
  ctx.fillStyle = "#11141c";
  ctx.font = `900 ${26 * s}px ${DISPLAY}`;
  ctx.fillText("PC DVD-ROM", pad + 26 * s, footerY + 18 * s, textRoom);
  ctx.font = `700 ${18 * s}px ${BODY}`;
  ctx.fillStyle = alpha("#11141c", 0.72);
  const studio = [game.developer, game.publisher].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" · ");
  if (studio) ctx.fillText(studio, pad + 26 * s, footerY + 52 * s, textRoom);
  const stores = pcStores(game);
  ctx.fillStyle = deep;
  ctx.font = `800 ${16 * s}px ${BODY}`;
  ctx.fillText(stores.length ? `Disponible sur ${stores.join(" · ")}` : "Windows", pad + 26 * s, footerY + 80 * s, textRoom);
  drawBarcode(ctx, game.title, w - pad - 24 * s - barW, footerY + 16 * s, barW, footerH - 32 * s, "#11141c");
  drawGrain(ctx, w, h, 0.04);
  return c;
}

/** Disque PC imprimé : illustration du jeu, logo, mention DVD-ROM. */
function paintPcDisc(game: Game, a: ArtAssets, c: HTMLCanvasElement, ctx: Ctx, w: number): HTMLCanvasElement {
  const r = w / 2;
  const p = a.palette;
  ctx.save();
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.clip();
  // fond : la bannière (paysage) couvre mieux un disque que la jaquette
  const art: Source = a.hero ?? a.screenshot ?? scene(game, a);
  drawCover(ctx, art, 0, 0, w, w, undefined, 0.4);
  const veil = ctx.createRadialGradient(r, r, r * 0.3, r, r, r);
  veil.addColorStop(0, alpha("#0b0e15", 0.05));
  veil.addColorStop(1, alpha("#0b0e15", 0.5));
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, w);

  // logo du jeu au-dessus du moyeu, sinon le titre
  if (a.logo) {
    ctx.save();
    ctx.shadowColor = alpha("#000000", 0.55);
    ctx.shadowBlur = 16;
    drawContain(ctx, a.logo, r * 0.42, r * 0.2, r * 1.16, r * 0.42);
    ctx.restore();
  } else {
    const t = fitTitle(ctx, game.title, r * 1.2, 72, 34, 2, DISPLAY);
    ctx.font = `700 ${t.size}px ${DISPLAY}`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = alpha("#000000", 0.55);
    ctx.shadowBlur = 12;
    t.lines.forEach((l, i) => ctx.fillText(l, r, r * 0.4 + (i - (t.lines.length - 1) / 2) * t.size * 1.05));
    ctx.shadowBlur = 0;
  }

  // bande du bas : « PC DVD-ROM » et l'éditeur
  ctx.fillStyle = alpha("#0b0e15", 0.72);
  ctx.fillRect(0, r * 1.5, w, r * 0.5);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.font = `900 ${Math.round(r * 0.1)}px ${DISPLAY}`;
  ctx.save();
  ctx.letterSpacing = `${Math.round(r * 0.012)}px`;
  ctx.fillText("PC DVD-ROM", r, r * 1.62);
  ctx.restore();
  const studio = game.publisher ?? game.developer;
  if (studio) {
    ctx.font = `700 ${Math.round(r * 0.06)}px ${BODY}`;
    ctx.fillStyle = alpha("#ffffff", 0.72);
    ctx.fillText(studio.toUpperCase().slice(0, 34), r, r * 1.76);
  }
  // liseré aux couleurs du jeu
  ctx.strokeStyle = alpha(mixHex(p[2], "#ffffff", 0.3), 0.85);
  ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.93, 0, Math.PI * 2);
  ctx.stroke();

  // reflet irisé
  const shine = ctx.createConicGradient(Math.PI / 5, r, r);
  shine.addColorStop(0, alpha("#ffffff", 0));
  shine.addColorStop(0.12, alpha("#ffffff", 0.2));
  shine.addColorStop(0.25, alpha("#ffffff", 0));
  shine.addColorStop(0.62, alpha("#ffffff", 0));
  shine.addColorStop(0.74, alpha("#ffffff", 0.14));
  shine.addColorStop(0.86, alpha("#ffffff", 0));
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, w, w);

  // moyeu transparent argenté
  const hub = ctx.createRadialGradient(r, r, r * 0.19, r, r, r * 0.4);
  hub.addColorStop(0, "#f4f6fa");
  hub.addColorStop(0.5, "#cfd6e1");
  hub.addColorStop(1, "#eef1f6");
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(r, r, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = alpha("#8794a3", 0.5);
  ctx.lineWidth = 3;
  for (const k of [0.4, 0.3, 0.24]) {
    ctx.beginPath();
    ctx.arc(r, r, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = alpha("#ffffff", 0.8);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(r, r, r - 5, 0, Math.PI * 2);
  ctx.stroke();
  return c;
}

const PAINTERS: Record<ArtFace, (g: Game, a: ArtAssets, d?: ArtDims) => HTMLCanvasElement> = {
  front: (g, a, d) => paintFront(g, a, d ?? frontSize(g)),
  boxFront: (g, a, d) => paintFront(g, a, d ?? ART_SIZE.front),
  caseFront: (g, a, d) => paintFront(g, a, d ?? ART_SIZE.front, true),
  back: (g, a, d) => paintBack(g, a, d),
  spine: (g, a, d) => paintSpine(g, a, d),
  disc: (g, a) => paintDisc(g, a),
  label: (g, a, d) => paintLabel(g, a, d ?? { w: 512, h: 512 }),
  cardLabel: (g, a, d) => paintCardLabel(g, a, d ?? { w: 512, h: 400 }),
};

const canvasCache = new Map<string, Promise<HTMLCanvasElement>>();
const urlCache = new Map<string, Promise<string>>();
const readyUrls = new Map<string, string>();

/** Already decoded artwork can be shown synchronously on return to the library. */
export function peekArtUrl(game: Game, face: ArtFace): string | undefined {
  return readyUrls.get(`${artKey(game)}:${face}`);
}

/** Canvas d'une face (mis en cache, utilisé tel quel comme texture 3D). */
export function getArtCanvas(game: Game, face: ArtFace, dims?: ArtDims): Promise<HTMLCanvasElement> {
  const key = `${artKey(game)}:${face}${dims ? `@${dims.w}x${dims.h}` : ""}`;
  let p = canvasCache.get(key);
  if (!p) {
    p = ensureFonts()
      .then(() => Promise.all([loadPlatformBitmap(game.platformId, "platform_logo"), loadPlatformBitmap(game.platformId, "platform_icon")]))
      .then(() => loadAssets(game))
      .then((a) => PAINTERS[face](game, a, dims));
    canvasCache.set(key, p);
  }
  return p;
}

/** URL blob d'une face (pour les <img> de l'interface 2D). */
export function getArtUrl(game: Game, face: ArtFace): Promise<string> {
  const key = `${artKey(game)}:${face}`;
  let p = urlCache.get(key);
  if (!p) {
    p = getArtCanvas(game, face).then(
      (canvas) =>
        new Promise<string>((resolve, reject) =>
          canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("Encodage impossible"))), "image/webp", 0.92),
        ),
    );
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

/** Palette effective d'un jeu (vraie jaquette si disponible). */
export async function getPalette(game: Game): Promise<Palette> {
  return (await loadAssets(game)).palette;
}
