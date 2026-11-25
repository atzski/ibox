// Morceaux d'essai de la page d'écoute des fondus : entièrement calculés ici, échantillon par
// échantillon (aucun fichier, aucun extrait de musique existante). Chacun a son tempo, son
// registre et son timbre, et garde le même niveau jusqu'à sa dernière seconde : on entend
// nettement la sortie de l'un et l'entrée du suivant.

export interface Song {
  id: string;
  title: string;
  artist: string;
  /** Durée en secondes. */
  dur: number;
  /** Couleurs de la pochette (dessinée en SVG). */
  tint: [string, string];
  /** Ce qu'on doit y entendre, pour s'y retrouver. */
  hint: string;
}

export const SONGS: Song[] = [
  { id: "essai-braise", title: "Braise", artist: "Essai iBox", dur: 36, tint: ["#ff8a5c", "#7a2f4f"], hint: "92 à la noire, grave, basse chaude et nappe" },
  { id: "essai-verre", title: "Verre", artist: "Essai iBox", dur: 42, tint: ["#8fe3ff", "#3a6fd8"], hint: "128 à la noire, aigu, arpèges de cloches" },
  { id: "essai-eclair", title: "Éclair", artist: "Essai iBox", dur: 8, tint: ["#ffe36b", "#f08a24"], hint: "8 secondes seulement : le cas du titre très court" },
  { id: "essai-maree", title: "Marée", artist: "Essai iBox", dur: 32, tint: ["#9df0c8", "#2f8f8a"], hint: "70 à la noire, accords tenus, sans percussion" },
  { id: "essai-neon", title: "Néon", artist: "Essai iBox", dur: 40, tint: ["#e79bff", "#5b3fd1"], hint: "148 à la noire, basse carrée et batterie" },
];

/** Pochette : un dégradé et l'initiale, en SVG (rien à télécharger). */
export function artwork(song: Song): string {
  const [a, b] = song.tint;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="240" height="240" fill="url(#g)"/><circle cx="120" cy="120" r="58" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="10"/><text x="120" y="142" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="64" fill="#fff">${song.title[0]}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const RATE = 44100;
const TAU = Math.PI * 2;

type Wave = "sine" | "tri" | "saw" | "square" | "bell";
interface Env { a: number; d: number; s: number; r: number }

/** Deux pistes (gauche, droite) où l'on additionne les notes. */
class Mix {
  readonly l: Float32Array;
  readonly r: Float32Array;
  constructor(readonly seconds: number) {
    this.l = new Float32Array(Math.ceil(seconds * RATE));
    this.r = new Float32Array(this.l.length);
  }

  /** Une note : `wave` à `freq` Hz, de `t0` pendant `len` secondes, enveloppe `env`, placée à `pan` (-1 à 1). */
  note(t0: number, len: number, freq: number, amp: number, wave: Wave, env: Env, pan = 0) {
    const start = Math.floor(t0 * RATE);
    const total = Math.min(this.l.length - start, Math.ceil((len + env.r) * RATE));
    if (total <= 0 || start < 0) return;
    // harmoniques : assez pour le timbre, jamais au-delà de 9 kHz (pas de repliement)
    const parts: [number, number][] = [];
    const max = Math.max(1, Math.floor(9000 / freq));
    if (wave === "sine") parts.push([1, 1]);
    else if (wave === "tri") for (let n = 1, k = 0; n <= Math.min(max, 7); n += 2, k++) parts.push([n, (k % 2 ? -1 : 1) / (n * n)]);
    else if (wave === "saw") for (let n = 1; n <= Math.min(max, 14); n++) parts.push([n, 1 / n]);
    else if (wave === "square") for (let n = 1; n <= Math.min(max, 13); n += 2) parts.push([n, 1 / n]);
    else parts.push([1, 1], [2.76, 0.45], [5.4, 0.2]);
    const gl = amp * Math.cos(((pan + 1) / 4) * Math.PI), gr = amp * Math.sin(((pan + 1) / 4) * Math.PI);
    const w = (TAU * freq) / RATE;
    for (let i = 0; i < total; i++) {
      const t = i / RATE;
      const e = t < env.a ? t / env.a : t < env.a + env.d ? 1 - (1 - env.s) * ((t - env.a) / env.d) : t < len ? env.s : env.s * Math.max(0, 1 - (t - len) / env.r);
      let v = 0;
      // les partiels d'une cloche s'éteignent plus vite que sa fondamentale
      for (const [n, a] of parts) v += a * Math.sin(w * n * i) * (wave === "bell" && n > 1 ? Math.exp(-t * 9) : 1);
      this.l[start + i] += v * e * gl;
      this.r[start + i] += v * e * gr;
    }
  }

  /** Grosse caisse : un sinus qui descend vite. */
  kick(t0: number, amp: number) {
    const start = Math.floor(t0 * RATE), total = Math.min(this.l.length - start, Math.floor(0.22 * RATE));
    let phase = 0;
    for (let i = 0; i < total; i++) {
      const t = i / RATE;
      phase += (TAU * (46 + 110 * Math.exp(-t * 38))) / RATE;
      const v = Math.sin(phase) * Math.exp(-t * 16) * amp;
      this.l[start + i] += v;
      this.r[start + i] += v;
    }
  }

  /** Bruit bref : charleston (`bright`) ou caisse claire. */
  noise(t0: number, len: number, amp: number, bright: boolean, pan = 0) {
    const start = Math.floor(t0 * RATE), total = Math.min(this.l.length - start, Math.floor(len * RATE));
    let seed = (start * 2654435761) >>> 0, last = 0;
    const gl = amp * Math.cos(((pan + 1) / 4) * Math.PI), gr = amp * Math.sin(((pan + 1) / 4) * Math.PI);
    for (let i = 0; i < total; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = seed / 2147483648 - 1;
      // la différence de deux échantillons ne garde que l'aigu
      const v = (bright ? white - last : white * 0.6 + last * 0.4) * Math.exp((-i / RATE) * (bright ? 60 : 22));
      last = white;
      this.l[start + i] += v * gl;
      this.r[start + i] += v * gr;
    }
  }

  /** Niveau égal d'un morceau à l'autre, sans saturer ; quelques millisecondes pour finir sans clic. */
  finish(): [Float32Array, Float32Array] {
    let sum = 0, peak = 0;
    for (let i = 0; i < this.l.length; i++) {
      sum += this.l[i] * this.l[i] + this.r[i] * this.r[i];
      peak = Math.max(peak, Math.abs(this.l[i]), Math.abs(this.r[i]));
    }
    const rms = Math.sqrt(sum / (2 * this.l.length)) || 1;
    const k = Math.min(0.17 / rms, 0.92 / (peak || 1));
    const tail = Math.floor(0.012 * RATE);
    for (let i = 0; i < this.l.length; i++) {
      const edge = Math.min(1, (this.l.length - 1 - i) / tail, i / 64);
      this.l[i] *= k * edge;
      this.r[i] *= k * edge;
    }
    return [this.l, this.r];
  }
}

/** Fréquence d'une note MIDI. */
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const PLUCK: Env = { a: 0.004, d: 0.12, s: 0.35, r: 0.08 };
const PAD: Env = { a: 0.35, d: 0.3, s: 0.85, r: 0.5 };

// Braise : grave et chaud. Basse en dents de scie, nappe tenue, grosse caisse sur les temps.
function braise(m: Mix) {
  const beat = 60 / 92, bar = beat * 4;
  const roots = [45, 41, 36, 43]; // la, fa, do, sol
  const thirds = [3, 4, 4, 4];
  for (let b = 0; b * bar < m.seconds; b++) {
    const t = b * bar, root = roots[b % 4];
    for (const step of [0, thirds[b % 4], 7]) m.note(t, bar - 0.2, hz(root + 12 + step), 0.16, "tri", PAD, step === 0 ? -0.4 : step === 7 ? 0.4 : 0);
    [0, 0.75, 1.5, 2, 2.75, 3.5].forEach((at, i) => m.note(t + at * beat, beat * 0.42, hz(root - (i === 3 ? 0 : 12) + (i === 5 ? 7 : 0)), 0.34, "saw", PLUCK));
    for (let k = 0; k < 4; k++) m.kick(t + k * beat, 0.55);
    m.noise(t + beat, 0.16, 0.2, false);
    m.noise(t + 3 * beat, 0.16, 0.2, false);
  }
}

// Verre : aigu et vif. Arpèges de cloches en doubles croches, charleston, basse en sinus.
function verre(m: Mix) {
  const beat = 60 / 128, bar = beat * 4, step = beat / 4;
  const chords = [[74, 78, 81, 86], [71, 74, 78, 83], [67, 71, 74, 79], [69, 73, 76, 81]]; // ré, si mineur, sol, la
  const order = [0, 1, 2, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2];
  for (let b = 0; b * bar < m.seconds; b++) {
    const t = b * bar, chord = chords[b % 4];
    order.forEach((n, i) => m.note(t + i * step, step * 0.9, hz(chord[n] + (i % 8 === 7 ? 12 : 0)), 0.26, "bell", { a: 0.002, d: 0.16, s: 0.25, r: 0.25 }, i % 2 ? 0.55 : -0.55));
    m.note(t, bar - 0.05, hz(chord[0] - 36), 0.3, "sine", { a: 0.02, d: 0.2, s: 0.8, r: 0.1 });
    for (let k = 0; k < 8; k++) m.noise(t + k * beat * 0.5, 0.05, k % 2 ? 0.2 : 0.11, true, 0.3);
    m.kick(t, 0.4);
    m.kick(t + 2 * beat, 0.4);
  }
}

// Éclair : huit secondes, un motif carré nerveux et une caisse claire.
function eclair(m: Mix) {
  const beat = 60 / 160, step = beat / 2;
  const riff = [64, 67, 71, 67, 72, 71, 67, 62];
  for (let i = 0; i * step < m.seconds; i++) {
    m.note(i * step, step * 0.8, hz(riff[i % 8] + (Math.floor(i / 16) % 2 ? 5 : 0)), 0.2, "square", PLUCK, i % 2 ? 0.3 : -0.3);
    if (i % 4 === 2) m.noise(i * step, 0.14, 0.28, false);
    if (i % 4 === 0) m.kick(i * step, 0.5);
  }
}

// Marée : lent, accords tenus, une mélodie douce au milieu ; aucune percussion (un fondu sur un
// son tenu s'entend mieux que sur une attaque).
function maree(m: Mix) {
  const beat = 60 / 70, bar = beat * 4;
  const chords = [[53, 57, 60, 64], [50, 53, 57, 60], [58, 62, 65, 69], [48, 52, 55, 60]]; // fa, ré mineur, si bémol, do
  const tune = [72, 69, 67, 65, 69, 72, 74, 72, 70, 69, 67, 65, 64, 67, 72, 67];
  for (let b = 0; b * bar < m.seconds; b++) {
    const t = b * bar;
    chords[b % 4].forEach((n, i) => m.note(t, bar, hz(n), 0.17, i % 2 ? "sine" : "tri", { a: 0.6, d: 0.4, s: 0.9, r: 0.9 }, i / 1.5 - 1));
    for (let k = 0; k < 4; k++) m.note(t + k * beat, beat * 0.9, hz(tune[(b * 4 + k) % 16]), 0.2, "tri", { a: 0.06, d: 0.2, s: 0.7, r: 0.3 }, 0.15);
  }
}

// Néon : rapide. Basse carrée à l'octave, thème en dents de scie, batterie complète.
function neon(m: Mix) {
  const beat = 60 / 148, bar = beat * 4, step = beat / 2;
  const roots = [40, 40, 43, 38]; // mi, mi, sol, ré
  const lead = [76, 79, 83, 81, 79, 76, 74, 76];
  for (let b = 0; b * bar < m.seconds; b++) {
    const t = b * bar, root = roots[b % 4];
    for (let i = 0; i < 8; i++) {
      m.note(t + i * step, step * 0.7, hz(root + (i % 2 ? 12 : 0)), 0.26, "square", PLUCK, -0.2);
      m.note(t + i * step, step * 0.85, hz(lead[(i + b * 3) % 8] + (b % 4 === 3 ? -2 : 0)), 0.15, "saw", { a: 0.005, d: 0.08, s: 0.5, r: 0.06 }, 0.35);
      m.noise(t + i * step, 0.04, 0.13, true, 0.5);
    }
    for (let k = 0; k < 4; k++) m.kick(t + k * beat, 0.55);
    m.noise(t + beat, 0.15, 0.3, false);
    m.noise(t + 3 * beat, 0.15, 0.3, false);
  }
}

const WRITERS: Record<string, (m: Mix) => void> = { "essai-braise": braise, "essai-verre": verre, "essai-eclair": eclair, "essai-maree": maree, "essai-neon": neon };

/** Calcule le son d'un morceau (deux pistes, 44,1 kHz). Une demi-seconde de calcul environ. */
export function render(song: Song): [Float32Array, Float32Array] {
  const m = new Mix(song.dur);
  WRITERS[song.id](m);
  return m.finish();
}
