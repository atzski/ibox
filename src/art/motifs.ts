import type { CoverMotif } from "@/domain/types";
import { alpha, blob, glow, mixHex, shade, sparkle, vGradient, type Ctx } from "./paint";

type Palette = [string, string, string, string, string];
type Painter = (ctx: Ctx, w: number, h: number, p: Palette, rand: () => number) => void;

/**
 * Illustrations originales, entièrement procédurales.
 * Chaque motif peint une scène plein cadre dans un rectangle w × h.
 */

const grove: Painter = (ctx, w, h, p, rand) => {
  ctx.fillStyle = vGradient(ctx, h, [
    [0, p[0]],
    [0.6, p[1]],
    [1, shade(p[1], 0.25)],
  ]);
  ctx.fillRect(0, 0, w, h);

  // étoiles
  ctx.fillStyle = alpha("#ffffff", 0.8);
  for (let i = 0; i < 60; i++) {
    const r = rand() * 2.2 + 0.6;
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h * 0.55, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // lune
  glow(ctx, w * 0.74, h * 0.2, w * 0.32, p[2], 0.55);
  ctx.fillStyle = shade(p[2], 0.4);
  ctx.beginPath();
  ctx.arc(w * 0.74, h * 0.2, w * 0.11, 0, Math.PI * 2);
  ctx.fill();

  // trois plans d'arbres ronds
  const layers = [
    { y: 0.62, size: 0.2, color: mixHex(p[0], p[1], 0.55), n: 7 },
    { y: 0.74, size: 0.24, color: shade(p[0], -0.05), n: 6 },
    { y: 0.88, size: 0.3, color: shade(p[0], -0.35), n: 5 },
  ];
  for (const L of layers) {
    ctx.fillStyle = L.color;
    for (let i = 0; i < L.n; i++) {
      const x = (i / (L.n - 1)) * w + (rand() - 0.5) * w * 0.1;
      const s = w * L.size * (0.8 + rand() * 0.4);
      ctx.fillRect(x - s * 0.06, h * L.y, s * 0.12, h);
      blob(ctx, x, h * L.y - s * 0.2, s * 0.75, rand, 6);
    }
    ctx.fillRect(0, h * (L.y + 0.08), w, h);
  }

  // lanterne centrale + lucioles
  glow(ctx, w * 0.5, h * 0.66, w * 0.36, p[2], 0.8);
  for (let i = 0; i < 38; i++) {
    const x = rand() * w;
    const y = h * (0.35 + rand() * 0.6);
    const r = w * (0.012 + rand() * 0.02);
    glow(ctx, x, y, r * 3.5, rand() > 0.4 ? p[2] : p[3], 0.9);
    ctx.fillStyle = "#fffbe8";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }
};

const racers: Painter = (ctx, w, h, p, rand) => {
  ctx.fillStyle = vGradient(ctx, h, [
    [0, shade(p[0], -0.05)],
    [0.45, p[1]],
    [0.62, shade(p[1], 0.3)],
  ]);
  ctx.fillRect(0, 0, w, h);

  // soleil couchant
  glow(ctx, w * 0.5, h * 0.5, w * 0.7, "#fff1c9", 0.6);
  ctx.fillStyle = "#fff4d6";
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.52, w * 0.2, Math.PI, 0);
  ctx.fill();

  // nuages
  ctx.fillStyle = alpha("#ffffff", 0.75);
  for (let i = 0; i < 5; i++) blob(ctx, rand() * w, h * (0.1 + rand() * 0.25), w * (0.08 + rand() * 0.06), rand, 5);

  // mer
  ctx.fillStyle = vGradient(ctx, h * 0.5, [
    [0, shade(p[2], 0.25)],
    [1, shade(p[2], -0.2)],
  ], h * 0.52);
  ctx.fillRect(0, h * 0.52, w, h);
  ctx.strokeStyle = alpha("#ffffff", 0.4);
  ctx.lineWidth = 3;
  for (let i = 0; i < 9; i++) {
    const y = h * (0.56 + i * 0.03);
    ctx.beginPath();
    ctx.moveTo(rand() * w * 0.4, y);
    ctx.lineTo(rand() * w * 0.4 + w * 0.15, y);
    ctx.stroke();
  }

  // route côtière en perspective
  ctx.fillStyle = shade(p[4], 0.15);
  ctx.beginPath();
  ctx.moveTo(w * 0.47, h * 0.52);
  ctx.lineTo(w * 0.53, h * 0.52);
  ctx.lineTo(w * 1.05, h);
  ctx.lineTo(-w * 0.05, h);
  ctx.fill();
  ctx.fillStyle = "#fff4d6";
  for (let i = 0; i < 8; i++) {
    const t0 = i / 8;
    const t1 = t0 + 0.05;
    const y0 = h * 0.52 + (h * 0.48) * t0 * t0;
    const y1 = h * 0.52 + (h * 0.48) * t1 * t1;
    const w0 = 2 + t0 * 18;
    const w1 = 2 + t1 * 18;
    ctx.beginPath();
    ctx.moveTo(w * 0.5 - w0 / 2, y0);
    ctx.lineTo(w * 0.5 + w0 / 2, y0);
    ctx.lineTo(w * 0.5 + w1 / 2, y1);
    ctx.lineTo(w * 0.5 - w1 / 2, y1);
    ctx.fill();
  }

  // cerfs-volants
  const kites = [
    { x: 0.24, y: 0.3, s: 0.12, c: p[3] },
    { x: 0.76, y: 0.22, s: 0.09, c: p[2] },
    { x: 0.62, y: 0.4, s: 0.06, c: "#ffffff" },
  ];
  for (const k of kites) {
    const x = w * k.x;
    const y = h * k.y;
    const s = w * k.s;
    ctx.strokeStyle = alpha("#ffffff", 0.8);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 1.2);
    ctx.bezierCurveTo(x - s, y + s * 2.2, x + s, y + s * 2.8, x - s * 0.4, y + s * 3.6);
    ctx.stroke();
    ctx.fillStyle = k.c;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.75, y);
    ctx.lineTo(x, y + s * 1.25);
    ctx.lineTo(x - s * 0.75, y);
    ctx.fill();
    ctx.fillStyle = alpha("#ffffff", 0.35);
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.75, y);
    ctx.lineTo(x, y);
    ctx.fill();
  }

  // lignes de vitesse
  ctx.strokeStyle = alpha("#ffffff", 0.55);
  ctx.lineCap = "round";
  for (let i = 0; i < 10; i++) {
    const y = h * (0.12 + rand() * 0.35);
    const x = rand() * w;
    ctx.lineWidth = 2 + rand() * 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * (0.08 + rand() * 0.12), y);
    ctx.stroke();
  }
};

const tidepool: Painter = (ctx, w, h, p, rand) => {
  ctx.fillStyle = vGradient(ctx, h, [
    [0, shade(p[0], 0.35)],
    [0.5, p[0]],
    [1, p[1]],
  ]);
  ctx.fillRect(0, 0, w, h);

  // rayons de lumière
  ctx.fillStyle = alpha("#ffffff", 0.12);
  for (let i = 0; i < 6; i++) {
    const x = rand() * w;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.03, 0);
    ctx.lineTo(x + w * 0.03, 0);
    ctx.lineTo(x + w * 0.2, h);
    ctx.lineTo(x - w * 0.05, h);
    ctx.fill();
  }

  // couches ondulées
  const waves = [0.7, 0.8, 0.9];
  waves.forEach((y0, i) => {
    ctx.fillStyle = mixHex(p[1], "#1d3a5a", 0.15 + i * 0.18);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) {
      ctx.lineTo(x, h * y0 + Math.sin(x / (w * 0.09) + i * 1.7) * h * 0.018);
    }
    ctx.lineTo(w, h);
    ctx.fill();
  });

  // algues
  ctx.strokeStyle = shade(p[0], -0.25);
  ctx.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    const x = rand() * w;
    ctx.lineWidth = 8 + rand() * 8;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.bezierCurveTo(x - 30, h * 0.85, x + 30, h * 0.78, x - 10, h * (0.62 + rand() * 0.1));
    ctx.stroke();
  }

  // étoile de mer
  const sx = w * 0.26;
  const sy = h * 0.82;
  ctx.fillStyle = p[3];
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? w * 0.08 : w * 0.035;
    ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();

  // loupe
  const mx = w * 0.62;
  const my = h * 0.46;
  const mr = w * 0.2;
  glow(ctx, mx, my, mr * 1.6, "#ffffff", 0.35);
  ctx.fillStyle = alpha("#ffffff", 0.18);
  ctx.beginPath();
  ctx.arc(mx, my, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = p[2];
  ctx.lineWidth = w * 0.03;
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.lineWidth = w * 0.045;
  ctx.beginPath();
  ctx.moveTo(mx + mr * 0.75, my + mr * 0.75);
  ctx.lineTo(mx + mr * 1.45, my + mr * 1.45);
  ctx.stroke();
  ctx.strokeStyle = alpha("#ffffff", 0.7);
  ctx.lineWidth = w * 0.012;
  ctx.beginPath();
  ctx.arc(mx, my, mr * 0.75, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();

  // bulles
  ctx.strokeStyle = alpha("#ffffff", 0.7);
  ctx.lineWidth = 3;
  for (let i = 0; i < 26; i++) {
    const r = w * (0.006 + rand() * 0.022);
    ctx.beginPath();
    ctx.arc(rand() * w, rand() * h * 0.8, r, 0, Math.PI * 2);
    ctx.stroke();
  }
};

const bakery: Painter = (ctx, w, h, p, rand) => {
  ctx.fillStyle = vGradient(ctx, h, [
    [0, p[0]],
    [0.7, p[1]],
    [1, shade(p[1], 0.3)],
  ]);
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = alpha("#ffffff", 0.9);
  for (let i = 0; i < 40; i++) sparkle(ctx, rand() * w, rand() * h * 0.6, 2 + rand() * 7);

  // étoiles filantes
  for (let i = 0; i < 4; i++) {
    const x = w * (0.1 + rand() * 0.7);
    const y = h * (0.06 + rand() * 0.3);
    const len = w * (0.2 + rand() * 0.15);
    const g = ctx.createLinearGradient(x - len, y - len * 0.5, x, y);
    g.addColorStop(0, alpha(p[2], 0));
    g.addColorStop(1, alpha(p[2], 0.95));
    ctx.strokeStyle = g;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - len, y - len * 0.5);
    ctx.lineTo(x, y);
    ctx.stroke();
    glow(ctx, x, y, 26, p[2], 1);
    ctx.fillStyle = "#fffbe6";
    sparkle(ctx, x, y, 14);
  }

  // colline
  ctx.fillStyle = shade(p[0], 0.15);
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 1.02, w * 0.85, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // boulangerie ronde
  const bx = w * 0.5;
  const by = h * 0.74;
  const bw = w * 0.42;
  const bh = h * 0.16;
  glow(ctx, bx, by, w * 0.5, p[2], 0.35);
  ctx.fillStyle = "#fff6ea";
  ctx.beginPath();
  ctx.roundRect(bx - bw / 2, by - bh / 2, bw, bh, 24);
  ctx.fill();
  ctx.fillStyle = p[3];
  ctx.beginPath();
  ctx.ellipse(bx, by - bh / 2, bw * 0.62, bh * 0.75, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = alpha("#ffffff", 0.35);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(bx - bw * 0.42 + i * bw * 0.21, by - bh / 2 - 4, bw * 0.06, bh * 0.5, 0, Math.PI, 0);
    ctx.fill();
  }
  // cheminée + fumée
  ctx.fillStyle = shade(p[3], -0.2);
  ctx.fillRect(bx + bw * 0.22, by - bh * 1.35, bw * 0.08, bh * 0.5);
  ctx.fillStyle = alpha("#ffffff", 0.75);
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(bx + bw * 0.26 + i * 16, by - bh * 1.5 - i * 26, 12 + i * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  // fenêtres chaudes
  for (const dx of [-0.26, 0.26]) {
    glow(ctx, bx + bw * dx, by, 60, p[2], 0.8);
    ctx.fillStyle = p[2];
    ctx.beginPath();
    ctx.roundRect(bx + bw * dx - 24, by - 22, 48, 44, 14);
    ctx.fill();
  }
  ctx.fillStyle = shade(p[0], 0.25);
  ctx.beginPath();
  ctx.roundRect(bx - 26, by - 10, 52, bh / 2 + 10, [26, 26, 0, 0]);
  ctx.fill();
};

const mountain: Painter = (ctx, w, h, p, rand) => {
  ctx.fillStyle = vGradient(ctx, h, [
    [0, p[0]],
    [0.75, p[1]],
  ]);
  ctx.fillRect(0, 0, w, h);

  glow(ctx, w * 0.78, h * 0.16, w * 0.35, p[3], 0.7);
  ctx.fillStyle = shade(p[3], 0.3);
  ctx.beginPath();
  ctx.arc(w * 0.78, h * 0.16, w * 0.09, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = alpha("#ffffff", 0.92);
  for (let i = 0; i < 4; i++) blob(ctx, rand() * w, h * (0.08 + rand() * 0.25), w * (0.07 + rand() * 0.05), rand, 5);

  const ridges = [
    { base: 0.5, amp: 0.26, color: mixHex(p[2], p[0], 0.55) },
    { base: 0.62, amp: 0.2, color: mixHex(p[2], p[0], 0.25) },
    { base: 0.76, amp: 0.14, color: p[2] },
    { base: 0.88, amp: 0.08, color: shade(p[2], -0.2) },
  ];
  ridges.forEach((r, i) => {
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const peaks = 2 + i;
    for (let x = 0; x <= w; x += 6) {
      const t = (x / w) * Math.PI * peaks + i * 1.3;
      // sommets arrondis, vallées douces
      const y = h * r.base - Math.pow(0.5 + 0.5 * Math.sin(t), 1.8) * h * r.amp;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.fill();
    // neige douce sur le premier plan lointain
    if (i === 0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = alpha("#ffffff", 0.55);
      ctx.fillRect(0, 0, w, h * (r.base - r.amp * 0.7));
      ctx.restore();
    }
  });

  // chemin pointillé vers le sommet
  ctx.fillStyle = alpha(p[3], 0.95);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = w * (0.2 + t * 0.35 + Math.sin(t * 9) * 0.06);
    const y = h * (0.95 - t * 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 7 - t * 4, 0, Math.PI * 2);
    ctx.fill();
  }
};

const placeholder: Painter = (ctx, w, h, p) => {
  ctx.fillStyle = vGradient(ctx, h, [
    [0, p[0]],
    [1, p[1]],
  ]);
  ctx.fillRect(0, 0, w, h);
  // motif de pastilles discrètes
  ctx.fillStyle = alpha("#ffffff", 0.22);
  const step = w / 7;
  for (let y = step / 2; y < h; y += step) {
    for (let x = step / 2; x < w; x += step) {
      ctx.beginPath();
      ctx.arc(x + ((y / step) % 2) * (step / 2), y, step * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  glow(ctx, w * 0.5, h * 0.42, w * 0.6, "#ffffff", 0.5);
};

export const MOTIFS: Record<CoverMotif, Painter> = { grove, racers, tidepool, bakery, mountain, placeholder };
