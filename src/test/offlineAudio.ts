/**
 * Rendu audio hors ligne pour les tests.
 *
 * Node n'a pas d'`OfflineAudioContext`. Ce fichier en réécrit la petite partie dont se sert
 * l'ambiance des menus (oscillateur sinus, modulation de sa fréquence par un autre nœud, gain,
 * panoramique, filtre biquad, retard avec réinjection, convolution, lecture d'un tampon,
 * automation des paramètres), en suivant les formules de la spécification Web Audio, pour
 * mesurer sous Vitest ce que le code programme vraiment : crête, niveau, claquements.
 * Les mêmes mesures ont été refaites dans Chromium avec le vrai `OfflineAudioContext`.
 *
 * Non couvert : compresseur, formes d'onde autres que le sinus, retards plus courts qu'un bloc
 * (128 échantillons), entrée audio sur un autre paramètre que la fréquence d'un oscillateur.
 */

const BLOCK = 128;

interface Block {
  l: Float32Array;
  r: Float32Array;
}

type Automation =
  | { type: "set" | "linear" | "exponential"; time: number; value: number }
  | { type: "target"; time: number; value: number; constant: number; from?: number };

/** Somme des blocs de plusieurs nœuds, ou `null` si tous sont muets. */
function mixNodes(inputs: readonly Node[], frame: number): Block | null {
  let out: Block | null = null;
  for (const input of inputs) {
    const b = input.pull(frame);
    if (!b) continue;
    if (!out) {
      // un signal mono garde un seul tableau pour ses deux canaux
      const l = Float32Array.from(b.l);
      out = { l, r: b.l === b.r ? l : Float32Array.from(b.r) };
    } else {
      if (out.l === out.r && b.l !== b.r) out.r = Float32Array.from(out.l);
      const stereo = out.l !== out.r;
      for (let i = 0; i < BLOCK; i++) {
        out.l[i] += b.l[i];
        if (stereo) out.r[i] += b.r[i];
      }
    }
  }
  return out;
}

class Param {
  /** Nœuds branchés sur le paramètre (modulation de fréquence). */
  readonly inputs: Node[] = [];
  private events: Automation[] = [];
  private cursor = 0;

  constructor(public value: number) {}

  private add(e: Automation): this {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
    return this;
  }

  setValueAtTime(value: number, time: number): this { return this.add({ type: "set", time, value }); }
  linearRampToValueAtTime(value: number, time: number): this { return this.add({ type: "linear", time, value }); }
  exponentialRampToValueAtTime(value: number, time: number): this { return this.add({ type: "exponential", time, value }); }
  setTargetAtTime(value: number, time: number, constant: number): this { return this.add({ type: "target", time, value, constant }); }
  cancelScheduledValues(time: number): this {
    this.events = this.events.filter((e) => e.time < time);
    this.cursor = 0;
    return this;
  }

  get automated(): boolean {
    return this.events.length > 0;
  }

  /** Valeur produite par l'événement `i` à l'instant `t` (au-delà de son instant de départ). */
  private settled(i: number, t: number): number {
    const e = this.events[i];
    if (e.type !== "target") return e.value;
    e.from ??= i === 0 ? this.value : this.between(i - 1, e.time);
    return e.value + (e.from - e.value) * Math.exp(-(t - e.time) / e.constant);
  }

  /** Valeur à `t`, entre l'événement `i` et le suivant. */
  private between(i: number, t: number): number {
    const e = this.events[i];
    const next = this.events[i + 1];
    if (next && (next.type === "linear" || next.type === "exponential") && next.time > e.time) {
      const v0 = this.settled(i, next.time);
      const k = Math.min(1, (t - e.time) / (next.time - e.time));
      return next.type === "linear" || v0 <= 0 || next.value <= 0 ? v0 + (next.value - v0) * k : v0 * (next.value / v0) ** k;
    }
    return this.settled(i, t);
  }

  /** Valeur à l'instant `t` ; les appels se font dans l'ordre du temps. */
  at(t: number): number {
    const ev = this.events;
    if (!ev.length || t < ev[0].time) return this.value;
    while (this.cursor + 1 < ev.length && ev[this.cursor + 1].time <= t) this.cursor++;
    return this.between(this.cursor, t);
  }
}

abstract class Node {
  readonly inputs: Node[] = [];
  private stamp = -1;
  private cached: Block | null = null;

  constructor(readonly context: FakeOfflineAudioContext) {}

  connect<T extends Node | Param>(to: T): T {
    to.inputs.push(this);
    return to;
  }

  disconnect(): void {
    for (const n of this.context.nodes) {
      const i = n.inputs.indexOf(this);
      if (i >= 0) n.inputs.splice(i, 1);
    }
  }

  /** Bloc de 128 échantillons commençant à `frame`, ou `null` s'il est muet. */
  pull(frame: number): Block | null {
    if (this.stamp !== frame) {
      this.cached = this.process(frame);
      this.stamp = frame;
    }
    return this.cached;
  }

  protected mix(frame: number): Block | null {
    return mixNodes(this.inputs, frame);
  }

  protected abstract process(frame: number): Block | null;
}

abstract class Source extends Node {
  protected from = Infinity;
  protected to = Infinity;
  onended: (() => void) | null = null;

  /** Instant de départ programmé. */
  get startedAt(): number {
    return this.from;
  }

  stop(when = 0): void {
    this.to = when;
  }

  /** Le bloc recoupe-t-il la période de jeu ? */
  protected live(frame: number): boolean {
    const sr = this.context.sampleRate;
    return (frame + BLOCK) / sr > this.from && frame / sr < this.to;
  }
}

class Oscillator extends Source {
  type = "sine";
  readonly frequency = new Param(440);
  readonly detune = new Param(0);
  private phase = 0;

  start(when = 0): void {
    this.from = when;
  }

  protected process(frame: number): Block | null {
    if (!this.live(frame)) return null;
    const sr = this.context.sampleRate;
    const out = new Float32Array(BLOCK);
    const bend = 2 ** (this.detune.value / 1200);
    const fm = mixNodes(this.frequency.inputs, frame);
    for (let i = 0; i < BLOCK; i++) {
      const t = (frame + i) / sr;
      if (t < this.from || t >= this.to) continue;
      out[i] = Math.sin(this.phase);
      this.phase += (2 * Math.PI * (this.frequency.at(t) + (fm ? fm.l[i] : 0)) * bend) / sr;
    }
    return { l: out, r: out };
  }
}

class Buffer {
  private readonly channels: Float32Array[];
  constructor(count: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: count }, () => new Float32Array(length));
  }
  get numberOfChannels(): number { return this.channels.length; }
  get duration(): number { return this.length / this.sampleRate; }
  getChannelData(channel: number): Float32Array { return this.channels[channel]; }
}

class BufferSource extends Source {
  buffer: Buffer | null = null;
  loop = false;
  private offset = 0;

  start(when = 0, offset = 0): void {
    this.from = when;
    this.offset = offset;
  }

  protected process(frame: number): Block | null {
    if (!this.buffer || !this.live(frame)) return null;
    const sr = this.context.sampleRate;
    const data = this.buffer.getChannelData(0);
    const first = Math.round(this.from * sr);
    const shift = Math.round(this.offset * sr);
    const out = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      const t = (frame + i) / sr;
      if (t < this.from || t >= this.to) continue;
      const at = frame + i - first + shift;
      if (this.loop) out[i] = data[at % data.length];
      else if (at < data.length) out[i] = data[at];
    }
    return { l: out, r: out };
  }
}

class Gain extends Node {
  readonly gain = new Param(1);

  protected process(frame: number): Block | null {
    const b = this.mix(frame);
    if (!b) return null;
    const sr = this.context.sampleRate;
    const stereo = b.l !== b.r;
    for (let i = 0; i < BLOCK; i++) {
      const g = this.gain.automated ? this.gain.at((frame + i) / sr) : this.gain.value;
      b.l[i] *= g;
      if (stereo) b.r[i] *= g;
    }
    return b;
  }
}

/** Panoramique à puissance constante d'une entrée mono (le seul cas dont l'ambiance se sert). */
class StereoPanner extends Node {
  readonly pan = new Param(0);

  protected process(frame: number): Block | null {
    const b = this.mix(frame);
    if (!b) return null;
    const angle = ((Math.min(1, Math.max(-1, this.pan.value)) + 1) / 2) * (Math.PI / 2);
    const left = Math.cos(angle);
    const right = Math.sin(angle);
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      const mono = b.l === b.r ? b.l[i] : (b.l[i] + b.r[i]) / 2;
      l[i] = mono * left;
      r[i] = mono * right;
    }
    return { l, r };
  }
}

class Biquad extends Node {
  type: BiquadFilterType = "lowpass";
  readonly frequency = new Param(350);
  readonly Q = new Param(1);
  readonly gain = new Param(0);
  private readonly state = [new Float64Array(4), new Float64Array(4)];
  private ringing = false;

  /** Coefficients normalisés [b0, b1, b2, a1, a2] (formules de la spécification Web Audio). */
  private coefficients(): number[] {
    const w0 = (2 * Math.PI * this.frequency.value) / this.context.sampleRate;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    const A = 10 ** (this.gain.value / 40);
    let b: number[];
    let a: number[];
    switch (this.type) {
      case "lowpass":
      case "highpass": {
        const alpha = sin / (2 * 10 ** (this.Q.value / 20));
        const low = this.type === "lowpass";
        const k = low ? 1 - cos : 1 + cos;
        b = [k / 2, low ? k : -k, k / 2];
        a = [1 + alpha, -2 * cos, 1 - alpha];
        break;
      }
      case "bandpass": {
        const alpha = sin / (2 * this.Q.value);
        b = [alpha, 0, -alpha];
        a = [1 + alpha, -2 * cos, 1 - alpha];
        break;
      }
      case "lowshelf":
      case "highshelf": {
        const s = (this.type === "lowshelf" ? 1 : -1) * cos;
        const beta = 2 * (sin / 2) * Math.SQRT2 * Math.sqrt(A);
        const sign = this.type === "lowshelf" ? 1 : -1;
        b = [A * (A + 1 - (A - 1) * s + beta), sign * 2 * A * (A - 1 - (A + 1) * s), A * (A + 1 - (A - 1) * s - beta)];
        a = [A + 1 + (A - 1) * s + beta, sign * -2 * (A - 1 + (A + 1) * s), A + 1 + (A - 1) * s - beta];
        break;
      }
      default:
        throw new Error(`Filtre non géré par le rendu de test : ${this.type}`);
    }
    return [b[0] / a[0], b[1] / a[0], b[2] / a[0], a[1] / a[0], a[2] / a[0]];
  }

  protected process(frame: number): Block | null {
    const input = this.mix(frame);
    if (!input && !this.ringing) return null;
    const [b0, b1, b2, a1, a2] = this.coefficients();
    const stereo = !!input && input.l !== input.r;
    const run = (x: Float32Array | null, s: Float64Array): Float32Array => {
      const y = new Float32Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) {
        const xi = x ? x[i] : 0;
        const yi = b0 * xi + b1 * s[0] + b2 * s[1] - a1 * s[2] - a2 * s[3];
        s[1] = s[0];
        s[0] = xi;
        s[3] = s[2];
        s[2] = yi;
        y[i] = yi;
      }
      return y;
    };
    const l = run(input ? input.l : null, this.state[0]);
    const r = stereo ? run(input.r, this.state[1]) : l;
    if (!stereo) this.state[1].set(this.state[0]);
    // la queue du filtre continue après la fin de l'entrée, tant qu'elle n'est pas éteinte
    this.ringing = Math.abs(this.state[0][2]) + Math.abs(this.state[1][2]) > 1e-9;
    return { l, r };
  }
}

/**
 * Retard fixe. Il lit ce qui a été écrit au moins un bloc plus tôt : une boucle de réinjection
 * (retard, gain, retour au retard) se calcule donc sans récursion ; l'entrée du bloc courant est
 * écrite après coup par `capture`.
 */
class Delay extends Node {
  readonly delayTime = new Param(0);
  private readonly ring: [Float32Array, Float32Array];
  /** Fin du dernier bloc non muet écrit dans la mémoire. */
  private liveUntil = -1;

  constructor(context: FakeOfflineAudioContext) {
    super(context);
    this.ring = [new Float32Array(context.length + BLOCK), new Float32Array(context.length + BLOCK)];
  }

  private get shift(): number {
    const n = Math.round(this.delayTime.value * this.context.sampleRate);
    if (n < BLOCK) throw new Error("Retard plus court qu'un bloc : non géré par le rendu de test");
    return n;
  }

  protected process(frame: number): Block | null {
    const from = frame - this.shift;
    if (from + BLOCK <= 0 || from >= this.liveUntil) return null;
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) {
      if (from + i < 0) continue;
      l[i] = this.ring[0][from + i];
      r[i] = this.ring[1][from + i];
    }
    return { l, r };
  }

  /** Écrit l'entrée du bloc courant dans la mémoire (appelé une fois le bloc de sortie calculé). */
  capture(frame: number): void {
    const b = this.mix(frame);
    if (!b) return;
    this.ring[0].set(b.l, frame);
    this.ring[1].set(b.r, frame);
    this.liveUntil = frame + BLOCK;
  }
}

/** Transformée de Fourier rapide en place (taille puissance de deux) ; `inverse` divise par la taille. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

interface Spectrum {
  re: Float64Array;
  im: Float64Array;
}

/**
 * Convolution par une réponse stéréo, découpée en tranches d'un bloc et calculée en fréquence
 * (même résultat qu'une convolution directe, sans latence). Normalisation de la spécification.
 */
class Convolver extends Node {
  normalize = true;
  buffer: Buffer | null = null;
  /** Spectres des tranches de la réponse, par canal. */
  private parts: Spectrum[][] | null = null;
  private scale = 1;
  /** Spectres des derniers blocs d'entrée (le plus récent en tête), par canal ; `null` : bloc muet. */
  private readonly history: (Spectrum | null)[][] = [[], []];
  private readonly overlap = [new Float64Array(BLOCK), new Float64Array(BLOCK)];
  private tail = 0;

  private prepare(buffer: Buffer): Spectrum[][] {
    const count = Math.ceil(buffer.length / BLOCK);
    let power = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) for (const x of buffer.getChannelData(ch)) power += x * x;
    power = Math.max(0.000125, Math.sqrt(power / (buffer.numberOfChannels * buffer.length)));
    this.scale = this.normalize ? (0.00125 / power) * (44100 / buffer.sampleRate) : 1;
    return [0, 1].map((ch) => {
      const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      return Array.from({ length: count }, (_, p) => {
        const re = new Float64Array(2 * BLOCK);
        const im = new Float64Array(2 * BLOCK);
        re.set(data.subarray(p * BLOCK, (p + 1) * BLOCK));
        fft(re, im);
        return { re, im };
      });
    });
  }

  protected process(frame: number): Block | null {
    if (!this.buffer) return null;
    const parts = (this.parts ??= this.prepare(this.buffer));
    const input = this.mix(frame);
    if (input) this.tail = parts[0].length + 1;
    else if (this.tail-- <= 0) return null;
    const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    let shared: Spectrum | null = null;
    for (let ch = 0; ch < 2; ch++) {
      // entrée mono : un seul spectre pour les deux canaux
      let x: Spectrum | null = null;
      if (input) {
        if (ch === 1 && input.l === input.r) x = shared;
        else {
          x = { re: new Float64Array(2 * BLOCK), im: new Float64Array(2 * BLOCK) };
          x.re.set(ch === 0 ? input.l : input.r);
          fft(x.re, x.im);
          shared = x;
        }
      }
      const past = this.history[ch];
      past.unshift(x);
      if (past.length > parts[ch].length) past.pop();
      const re = new Float64Array(2 * BLOCK);
      const im = new Float64Array(2 * BLOCK);
      for (let p = 0; p < past.length; p++) {
        const a = past[p];
        if (!a) continue;
        const h = parts[ch][p];
        for (let k = 0; k < 2 * BLOCK; k++) {
          re[k] += a.re[k] * h.re[k] - a.im[k] * h.im[k];
          im[k] += a.re[k] * h.im[k] + a.im[k] * h.re[k];
        }
      }
      fft(re, im, true);
      const carry = this.overlap[ch];
      for (let i = 0; i < BLOCK; i++) {
        out[ch][i] = (re[i] + carry[i]) * this.scale;
        carry[i] = re[i + BLOCK];
      }
    }
    return { l: out[0], r: out[1] };
  }
}

class Destination extends Node {
  protected process(frame: number): Block | null {
    return this.mix(frame);
  }
}

export class FakeOfflineAudioContext {
  readonly nodes: Node[] = [];
  readonly destination: Destination;

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.destination = this.keep(new Destination(this));
  }

  /** Le rendu hors ligne programme tout avant de calculer : le temps y reste à zéro. */
  get currentTime(): number {
    return 0;
  }

  private keep<T extends Node>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  createOscillator(): Oscillator { return this.keep(new Oscillator(this)); }
  createGain(): Gain { return this.keep(new Gain(this)); }
  createStereoPanner(): StereoPanner { return this.keep(new StereoPanner(this)); }
  createBiquadFilter(): Biquad { return this.keep(new Biquad(this)); }
  createBufferSource(): BufferSource { return this.keep(new BufferSource(this)); }
  createDelay(_maxDelayTime = 1): Delay { return this.keep(new Delay(this)); }
  createConvolver(): Convolver { return this.keep(new Convolver(this)); }
  createBuffer(channels: number, length: number, sampleRate: number): Buffer { return new Buffer(channels, length, sampleRate); }

  startRendering(): Promise<Buffer> {
    const out = new Buffer(2, this.length, this.sampleRate);
    const l = out.getChannelData(0);
    const r = out.getChannelData(1);
    const delays = this.nodes.filter((n): n is Delay => n instanceof Delay);
    for (let frame = 0; frame < this.length; frame += BLOCK) {
      const b = this.destination.pull(frame);
      for (const delay of delays) delay.capture(frame);
      if (!b) continue;
      const n = Math.min(BLOCK, this.length - frame);
      l.set(b.l.subarray(0, n), frame);
      r.set(b.r.subarray(0, n), frame);
    }
    return Promise.resolve(out);
  }
}

/** Contexte hors ligne de test, vu comme un `BaseAudioContext` par le code à mesurer. */
export function offlineContext(seconds: number, sampleRate = 16000): BaseAudioContext & { startRendering(): Promise<AudioBuffer> } {
  return new FakeOfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate) as unknown as BaseAudioContext & { startRendering(): Promise<AudioBuffer> };
}

/** Hasard reproductible (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Level {
  /** Plus grande valeur absolue, canaux confondus. */
  peak: number;
  /** Niveau efficace moyen des deux canaux. */
  rms: number;
  /** Plus grand écart entre deux échantillons voisins : un claquement y fait un pic. */
  step: number;
}

/** Mesure un rendu entre `from` et `to` secondes. */
export function measure(buffer: AudioBuffer, from = 0, to = buffer.duration): Level {
  const a = Math.floor(from * buffer.sampleRate);
  const b = Math.min(buffer.length, Math.ceil(to * buffer.sampleRate));
  let peak = 0;
  let sum = 0;
  let step = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = a; i < b; i++) {
      const x = data[i];
      peak = Math.max(peak, Math.abs(x));
      sum += x * x;
      if (i > a) step = Math.max(step, Math.abs(x - data[i - 1]));
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, (b - a) * buffer.numberOfChannels)), step };
}

export const dB = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));
