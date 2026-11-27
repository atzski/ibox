/**
 * Replis de `color-mix()` (Chrome 111) et `light-dark()` (Chrome 123) pour les WebView Android
 * anciennes. Fonctions pures, partagées par le CSS construit (`src/build/cssFallbacks.ts`) et par
 * les couleurs calculées à l'exécution (`theme/cssCompat.ts`).
 */
type Rgba = [number, number, number, number];

const NAMED: Record<string, Rgba> = {
  white: [255, 255, 255, 1],
  black: [0, 0, 0, 1],
  transparent: [0, 0, 0, 0],
};

/** Couleur littérale (hexadécimale, `rgb()`, nom simple) ; `null` si elle dépend d'une variable. */
export function parseColor(text: string): Rgba | null {
  const t = text.trim().toLowerCase();
  if (t in NAMED) return NAMED[t];
  const hex = /^#([0-9a-f]{3,8})$/.exec(t);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const fn = /^rgba?\(([^()]*)\)$/.exec(t);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (p: string) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p));
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const out: Rgba = [channel(parts[0]), channel(parts[1]), channel(parts[2]), alpha];
    return out.every((v) => Number.isFinite(v)) ? out : null;
  }
  return null;
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
function formatColor([r, g, b, a]: Rgba): string {
  if (a <= 0) return "transparent";
  const c = [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))));
  return a >= 1 ? `rgb(${c.join(", ")})` : `rgba(${c.join(", ")}, ${fmt(a)})`;
}

// sRGB ↔ OKLab (Björn Ottosson), pour mélanger comme le navigateur quand il est demandé « in oklab/oklch »
const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
function toOklab([r, g, b]: Rgba): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, A, B]: [number, number, number]): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Morceaux séparés par `sep` au premier niveau de parenthèses. */
export function splitTop(text: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * « var(--tone) 12% » → couleur et part (`null` : non précisée ; part variable « var(--blend) » :
 * lue par `resolve` si elle est connue, sinon `NaN`).
 */
function term(text: string, resolve?: ColorResolver): { color: string; pct: number | null } {
  const parts = splitTop(text, " ");
  if (parts.length === 2) {
    const isPct = (p: string) => /^-?\d*\.?\d+%$/.test(p);
    const isVarPct = (p: string, other: string) => /^var\(/.test(p) && (/^var\(/.test(other) || parseColor(other) !== null || /^[a-z]+\(/i.test(other));
    if (isPct(parts[1])) return { color: parts[0], pct: parseFloat(parts[1]) };
    if (isPct(parts[0])) return { color: parts[1], pct: parseFloat(parts[0]) };
    // « #1e6fd9 var(--x) » ou « var(--deep) var(--blend) » : la seconde est une part variable
    if (isVarPct(parts[1], parts[0])) {
      const known = resolve?.(parts[1]);
      return { color: parts[0], pct: known && isPct(known) ? parseFloat(known) : Number.NaN };
    }
  }
  return { color: text, pct: null };
}

/** Couleur littérale d'une variable connue (`var(--ibox-ink)` → `#344459`), sinon `null`. */
export type ColorResolver = (text: string) => string | null;

/** Repli d'un seul `color-mix(...)` (contenu sans parenthèses extérieures). */
function mixOne(inner: string, resolve?: ColorResolver): string {
  const args = splitTop(inner);
  if (args.length !== 3 || !/^in\s/.test(args[0])) return args[1] ? term(args[1]).color : "transparent";
  const a = term(args[1], resolve);
  const b = term(args[2], resolve);
  // part variable : inconnue, comptée comme une moitié
  let pa = a.pct !== null && Number.isNaN(a.pct) ? 50 : a.pct;
  let pb = b.pct !== null && Number.isNaN(b.pct) ? 50 : b.pct;
  if (pa === null && pb === null) pa = pb = 50;
  else if (pa === null) pa = 100 - pb!;
  else if (pb === null) pb = 100 - pa;
  const total = pa + pb!;
  if (total <= 0) return "transparent";
  const known = (c: string) => parseColor(c) ?? parseColor(resolve?.(c) ?? "");
  const ca = known(a.color);
  const cb = known(b.color);
  if (ca && cb) {
    // mélange en sRGB, alpha prémultiplié (assez proche des espaces oklab/oklch demandés pour un repli)
    const wa = pa / total;
    const wb = pb! / total;
    const alpha = ca[3] * wa + cb[3] * wb;
    const out = alpha * Math.min(1, total / 100);
    const space = /^in\s+(oklab|oklch)\b/.exec(args[0])?.[1];
    if (space && alpha > 0) {
      // espaces perceptifs, comme le navigateur : les teintes gardent leur éclat
      const la = toOklab(ca);
      const lb = toOklab(cb);
      const pa = ca[3] * wa;
      const pb = cb[3] * wb;
      let mix: [number, number, number];
      if (space === "oklab") {
        mix = [0, 1, 2].map((i) => (la[i] * pa + lb[i] * pb) / alpha) as [number, number, number];
      } else {
        // oklch : clarté et chroma moyennées, teinte sur l'arc le plus court
        const lch = (v: [number, number, number]) => [v[0], Math.hypot(v[1], v[2]), Math.atan2(v[2], v[1])] as const;
        const [l1, c1, h1raw] = lch(la);
        const [l2, c2, h2raw] = lch(lb);
        // couleur sans teinte (gris, blanc) : elle prend celle de l'autre
        const h1 = c1 < 1e-4 ? h2raw : h1raw;
        const h2 = c2 < 1e-4 ? h1raw : h2raw;
        let dh = h2 - h1;
        if (dh > Math.PI) dh -= 2 * Math.PI;
        else if (dh < -Math.PI) dh += 2 * Math.PI;
        const L = (l1 * pa + l2 * pb) / alpha;
        const C = (c1 * pa + c2 * pb) / alpha;
        const H = h1 + dh * (pb / alpha);
        mix = [L, C * Math.cos(H), C * Math.sin(H)];
      }
      return formatColor([...fromOklab(mix), out]);
    }
    const ch = (i: number) => (alpha > 0 ? (ca[i] * ca[3] * wa + cb[i] * cb[3] * wb) / alpha : 0);
    return formatColor([ch(0), ch(1), ch(2), out]);
  }
  // une variable : la couleur qui domine le mélange (à égalité, la première)
  return pa >= pb! ? a.color : b.color;
}

/** Remplace chaque appel `name(...)` d'une valeur, du plus intérieur au plus extérieur. */
function replaceCalls(value: string, name: string, fn: (inner: string) => string): string {
  let out = value;
  for (let guard = 0; guard < 64; guard++) {
    const start = out.toLowerCase().lastIndexOf(`${name}(`);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = start + name.length; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) break;
    out = out.slice(0, start) + fn(out.slice(start + name.length + 1, end)) + out.slice(end + 1);
  }
  return out;
}

/** Remplace chaque `color-mix()` d'une valeur par son repli. */
export const mixFallback = (value: string, resolve?: ColorResolver): string => replaceCalls(value, "color-mix", (inner) => mixOne(inner, resolve));

/** Remplace chaque `light-dark(clair, sombre)` par la couleur du thème courant. */
export const lightDarkFallback = (value: string, dark: boolean): string =>
  replaceCalls(value, "light-dark", (inner) => {
    const [light, night] = splitTop(inner);
    return (dark ? night : light) ?? light ?? "";
  });
