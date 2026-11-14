/** Petites primitives de dessin 2D partagées par les habillages procéduraux. */

export type Ctx = CanvasRenderingContext2D;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mélange une couleur vers le blanc (amount > 0) ou le noir (amount < 0). */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const t = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const mix = (c: number) => Math.round(c + (t - c) * k);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Luminance relative (0 = noir, 1 = blanc). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parseHex(a);
  const [r2, g2, b2] = parseHex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${m(r1, r2)}, ${m(g1, g2)}, ${m(b1, b2)})`;
}

export function vGradient(ctx: Ctx, h: number, stops: [number, string][], y0 = 0): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

export function glow(ctx: Ctx, x: number, y: number, r: number, color: string, strength = 1): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, 0.9 * strength));
  g.addColorStop(0.35, alpha(color, 0.35 * strength));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Nuage / feuillage : grappe de cercles. */
export function blob(ctx: Ctx, x: number, y: number, size: number, rand: () => number, lumps = 5): void {
  ctx.beginPath();
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rand() * 0.6;
    const r = size * (0.45 + rand() * 0.25);
    const cx = x + Math.cos(a) * size * 0.45;
    const cy = y + Math.sin(a) * size * 0.3;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
  ctx.moveTo(x + size * 0.6, y);
  ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
  ctx.fill();
}

export function sparkle(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

/** Découpe un texte en lignes tenant dans `maxWidth`. */
export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Ajuste la taille de police pour que le titre tienne en au plus `maxLines` lignes. */
export function fitTitle(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  start: number,
  min: number,
  maxLines: number,
  family: string,
): { size: number; lines: string[] } {
  for (let size = start; size >= min; size -= 4) {
    ctx.font = `700 ${size}px ${family}`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { size, lines };
  }
  ctx.font = `700 ${min}px ${family}`;
  return { size: min, lines: wrapText(ctx, text, maxWidth) };
}
