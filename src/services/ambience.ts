import { roomImpulse, warmth } from "./sound";

/**
 * Ambiance sonore des menus d'iBox : un petit air calme, doux et un peu enjoué, qui tourne
 * tranquillement. Composition originale d'iBox, entièrement synthétisée (Web Audio, aucun
 * fichier, aucun son ni aucune mélodie repris d'ailleurs), en ré majeur comme les sons
 * d'interface, dont elle reprend aussi la pièce (même résonance).
 *
 * Instruments :
 * - le clavier : notes rondes de piano électrique doux (un sinus dont l'attaque est éclaircie
 *   par un soupçon de modulation de fréquence, plus un tintement très bref à la double octave) ;
 * - la basse : ronde et discrète, sur le premier temps de chaque mesure ;
 * - la nappe : deux notes de l'accord, très en retrait ;
 * - l'espace : un écho calé sur le tempo (croche pointée, un peu de réinjection, gauche puis
 *   droite) et la courte résonance des sons d'interface.
 *
 * Le motif tient en deux phrases de quatre mesures (`PHRASES`) qui alternent, séparées par une
 * ou deux mesures de respiration. Pour ne pas lasser, chaque passage est légèrement varié
 * (octave, notes omises ou ornées, respiration plus ou moins longue) : l'air reste le même,
 * mais deux tours ne sont jamais identiques.
 *
 * `AmbienceComposer` décide quoi jouer (pur, testable), `scheduleVoice` le programme sur un
 * contexte audio (en direct comme hors ligne, pour les mesures), `music.ts` pilote le tout.
 */

/** Tempo, en noires par minute : lent et régulier. */
export const TEMPO = 72;
/** Durée d'une croche et d'une mesure à quatre temps (s). */
export const STEP = 60 / TEMPO / 2;
export const BAR = STEP * 8;

/** Une note du clavier : [croche dans la mesure (0 à 7), hauteur en demi-tons au-dessus de ré 3, niveau relatif]. */
type Hit = readonly [step: number, semis: number, level?: number];

export interface Measure {
  /** Note de basse, en demi-tons au-dessus de ré 3. */
  bass: number;
  /** Les deux notes tenues par la nappe. */
  pad: readonly [number, number];
  hits: readonly Hit[];
}

// Demi-tons au-dessus de ré 3 : sol 2 = -7, la 2 = -5, si 2 = -3, ré 3 = 0, mi 3 = 2, fa♯ 3 = 4, sol 3 = 5, la 3 = 7,
// si 3 = 9, ré 4 = 12, mi 4 = 14, fa♯ 4 = 16, la 4 = 19, si 4 = 21, ré 5 = 24, mi 5 = 26, fa♯ 5 = 28, la 5 = 31, si 5 = 33, ré 6 = 36.
/**
 * Le motif d'iBox. La mélodie reste dans la gamme pentatonique de ré majeur (celle des sons
 * d'interface) ; la basse et la nappe posent les accords.
 *
 * Phrase A (ré, si mineur, sol, la) :  la4 ré5 · fa♯5 · · mi5 · | ré5 · · si4 · · · · | si4 ré5 · mi5 · · ré5 · | mi5 · · la4 · · · ·
 * Phrase B (sol, ré/fa♯, mi mineur, ré) : · ré5 mi5 · si5 · · la5 | fa♯5 · · · ré5 · · · | · mi5 fa♯5 · la5 · fa♯5 · | ré5 · · · la4 · · ·
 */
export const PHRASES: Record<"A" | "B", readonly Measure[]> = {
  A: [
    { bass: 0, pad: [16, 19], hits: [[0, 19], [1, 24], [3, 28], [6, 26]] },
    { bass: -3, pad: [12, 16], hits: [[0, 24], [3, 21]] },
    { bass: -7, pad: [9, 12], hits: [[0, 21], [1, 24], [3, 26], [6, 24]] },
    { bass: -5, pad: [7, 14], hits: [[0, 26], [3, 19]] },
  ],
  B: [
    { bass: 5, pad: [9, 12], hits: [[1, 24], [2, 26], [4, 33], [7, 31]] },
    { bass: 4, pad: [7, 12], hits: [[0, 28], [4, 24]] },
    { bass: 2, pad: [5, 9], hits: [[1, 26], [2, 28], [4, 31], [6, 28]] },
    { bass: 0, pad: [7, 16], hits: [[0, 24], [4, 19, 0.7]] },
  ],
};

/** Respiration entre deux phrases : la basse et la nappe restent sur ré. */
const REST: Measure = { bass: 0, pad: [7, 12], hits: [] };
/** Notes de la gamme pentatonique de ré majeur, pour les ornements. */
const PENTATONIC = [12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36, 38, 40, 43];

const D3 = 146.83;
/** Fréquence d'une hauteur donnée en demi-tons au-dessus de ré 3. */
export const pitch = (semis: number): number => D3 * 2 ** (semis / 12);

/** Niveaux des instruments (avant le volume général) et durées de résonance (s). */
const KEY = { gain: 0.1, ring: 2.6, attack: 0.006, index: 1.1, tine: 0.07 };
const BASS = { gain: 0.085, ring: 1.5, attack: 0.018 };
const PAD = { gain: 0.012, attack: 1.4, release: 1.8 };
/** Places du clavier dans l'espace : gauche, centre, droite. */
const PANS = [-0.35, 0, 0.35] as const;

/** Une voix de l'ambiance : une note du clavier, une note de basse, ou une note tenue de la nappe. */
export interface AmbientVoice {
  kind: "key" | "bass" | "pad";
  /** Secondes depuis le début de l'ambiance. */
  at: number;
  freq: number;
  gain: number;
  /** Place dans l'espace : indice dans `PANS` (clavier seulement). */
  pan: number;
  /** Clavier et basse : durée de la résonance jusqu'au silence. Nappe : durée de la tenue. */
  ring: number;
}

/** Instant où la voix est entièrement éteinte. */
export const voiceEnd = (v: AmbientVoice): number => (v.kind === "pad" ? v.at + PAD.attack + v.ring + PAD.release : v.at + v.ring + 0.04);

/** Façons de jouer une phrase : telle quelle, une octave plus haut, épurée, ornée. */
type Style = "plain" | "high" | "bare" | "graced";

/** Tirage indépendant (mulberry32), amorcé par le hasard reçu. */
function stream(rng: () => number): () => number {
  let a = Math.floor(rng() * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Joue le motif au fil de l'eau : `next(until)` renvoie les voix des mesures qui commencent
 * avant `until`, une seule fois chacune. Tout le hasard vient de `rng` (reproductible dans les
 * tests) ; le résultat ne dépend pas du rythme des appels.
 */
export class AmbienceComposer {
  private readonly rng: () => number;
  /** Mesures à venir : la phrase en cours puis sa respiration. */
  private queue: { measure: Measure; style: Style; rest: boolean }[] = [];
  private phrase: "A" | "B" = "B";
  /** Numéro de la prochaine mesure. */
  private bar = 0;

  constructor(rng: () => number = Math.random) {
    this.rng = stream(rng);
  }

  next(until: number): AmbientVoice[] {
    const out: AmbientVoice[] = [];
    while (this.bar * BAR < until) {
      if (!this.queue.length) this.plan();
      const { measure, style, rest } = this.queue.shift()!;
      this.play(measure, style, rest, this.bar * BAR, out);
      this.bar++;
    }
    return out.sort((a, b) => a.at - b.at);
  }

  /** Phrase suivante (A et B alternent toujours), sa façon d'être jouée, puis une ou deux mesures de respiration. */
  private plan(): void {
    this.phrase = this.phrase === "A" ? "B" : "A";
    const r = this.rng();
    // la toute première phrase est jouée telle quelle : on entend d'abord le motif
    const style: Style = this.bar === 0 || r < 0.5 ? "plain" : r < 0.67 ? "high" : r < 0.83 ? "bare" : "graced";
    for (const measure of PHRASES[this.phrase]) this.queue.push({ measure, style, rest: false });
    const rests = this.rng() < 0.6 ? 1 : 2;
    for (let i = 0; i < rests; i++) this.queue.push({ measure: REST, style: "plain", rest: true });
  }

  private play(m: Measure, style: Style, rest: boolean, at: number, out: AmbientVoice[]): void {
    const rng = this.rng;
    // Basse : le premier temps de chaque mesure ; dans les mesures chargées, un rappel plus doux sur le troisième.
    out.push({ kind: "bass", at, freq: pitch(m.bass), gain: BASS.gain * (rest ? 0.6 : 1), pan: 1, ring: BASS.ring });
    if (m.hits.length > 2) out.push({ kind: "bass", at: at + 4 * STEP, freq: pitch(m.bass), gain: BASS.gain * 0.45, pan: 1, ring: BASS.ring * 0.7 });
    // Nappe : les deux notes de l'accord, tenues jusqu'à la mesure suivante.
    for (const semis of m.pad) out.push({ kind: "pad", at, freq: pitch(semis), gain: PAD.gain, pan: 1, ring: BAR - PAD.attack });

    const key = (step: number, semis: number, level: number) => {
      const freq = pitch(semis + (style === "high" ? 12 : 0));
      out.push({
        kind: "key",
        // jeu humain : quelques millisecondes d'écart, un toucher jamais tout à fait égal
        at: at + step * STEP + rng() * 0.012,
        freq,
        // l'aigu s'entend mieux que le grave : les notes hautes sont jouées un peu moins fort
        gain: KEY.gain * level * (0.88 + 0.2 * rng()) * (style === "high" ? 0.7 : 1) * Math.min(1.1, (pitch(24) / freq) ** 0.35),
        pan: Math.min(PANS.length - 1, Math.floor(rng() * PANS.length)),
        ring: KEY.ring,
      });
    };

    if (rest) {
      // de temps en temps, une note seule, haut perchée, répond à la phrase
      if (rng() < 0.3) key(4, rng() < 0.5 ? 31 : 36, 0.5);
      return;
    }
    m.hits.forEach(([step, semis, level = 1], i) => {
      // variante épurée : les mesures chargées perdent leur dernière note
      if (style === "bare" && m.hits.length > 2 && i === m.hits.length - 1) return;
      // une note s'absente parfois (jamais la première de la mesure, ni dans la toute première phrase)
      if (i > 0 && at >= 4 * BAR && rng() < 0.05) return;
      // variante ornée : une petite note, un degré plus bas, glisse vers la troisième note de la mesure
      if (style === "graced" && m.hits.length > 2 && i === 2) key(step - 0.5, PENTATONIC[Math.max(0, PENTATONIC.indexOf(semis) - 1)], 0.45);
      key(step, semis, level);
    });
  }
}

/** Entrées de l'ambiance : le gain général, puis une entrée par instrument (elles règlent l'écho et la résonance). */
export interface AmbienceBus {
  master: GainNode;
  /** Clavier : une entrée par place dans l'espace (`PANS`). */
  keys: readonly AudioNode[];
  bass: AudioNode;
  pad: AudioNode;
}

/** Écho : une croche pointée, réinjectée à 30 %, adoucie, qui passe de gauche à droite. */
const ECHO = { time: STEP * 1.5, feedback: 0.3, send: 0.24, tone: 2200 };
/** Part envoyée dans la pièce (la résonance des sons d'interface). */
const ROOM = { keys: 0.2, bass: 0.05, pad: 0.12 };

/**
 * Sortie de l'ambiance : un gain général, muet au départ (les fondus partent de zéro), l'écho,
 * la pièce, puis la même couleur chaude que les sons d'interface. Pas de compresseur.
 */
export function ambienceOutput(ctx: BaseAudioContext): AmbienceBus {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(warmth(ctx));

  const room = ctx.createConvolver();
  room.normalize = true;
  room.buffer = roomImpulse(ctx);
  room.connect(master);
  const toRoom = (level: number) => {
    const send = ctx.createGain();
    send.gain.value = level;
    send.connect(room);
    return send;
  };

  // Écho en ping-pong : la première répétition à gauche, la suivante à droite, et ainsi de suite.
  const echoIn = ctx.createGain();
  echoIn.gain.value = ECHO.send;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = ECHO.tone;
  tone.Q.value = 0;
  echoIn.connect(tone);
  const taps = [-0.5, 0.5].map((side) => {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = ECHO.time;
    const pan = ctx.createStereoPanner();
    pan.pan.value = side;
    delay.connect(pan).connect(master);
    const feedback = ctx.createGain();
    feedback.gain.value = ECHO.feedback;
    delay.connect(feedback);
    return { delay, feedback };
  });
  tone.connect(taps[0].delay);
  taps[0].feedback.connect(taps[1].delay);
  taps[1].feedback.connect(taps[0].delay);

  const keysRoom = toRoom(ROOM.keys);
  const keys = PANS.map((side) => {
    const input = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = side;
    input.connect(pan).connect(master);
    input.connect(echoIn);
    input.connect(keysRoom);
    return input;
  });
  const bass = ctx.createGain();
  bass.connect(master);
  bass.connect(toRoom(ROOM.bass));
  const pad = ctx.createGain();
  pad.connect(master);
  pad.connect(toRoom(ROOM.pad));
  return { master, keys, bass, pad };
}

/** Fin de résonance d'une note, relative à sa crête (-50 dB), avant le dernier fondu vers zéro. */
const RING_FLOOR = 0.003;

/**
 * Programme une voix sur les entrées de `bus` (instants absolus du contexte). Chaque gain part
 * de zéro et y revient avant l'arrêt de sa source : ni claquement à l'entrée, ni à la sortie.
 */
export function scheduleVoice(ctx: BaseAudioContext, v: AmbientVoice, bus: AmbienceBus): void {
  /** Une note frappée : montée brève, résonance qui meurt, dernier fondu jusqu'au vrai zéro. */
  const struck = (freq: number, peak: number, attack: number, ring: number, out: AudioNode): OscillatorNode => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, v.at);
    g.gain.linearRampToValueAtTime(peak, v.at + attack);
    g.gain.exponentialRampToValueAtTime(peak * RING_FLOOR, v.at + ring);
    g.gain.linearRampToValueAtTime(0, v.at + ring + 0.04);
    osc.connect(g).connect(out);
    osc.start(v.at);
    osc.stop(v.at + ring + 0.06);
    return osc;
  };

  if (v.kind === "pad") {
    const end = voiceEnd(v);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = v.freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, v.at);
    g.gain.linearRampToValueAtTime(v.gain, v.at + PAD.attack);
    g.gain.linearRampToValueAtTime(v.gain, v.at + PAD.attack + v.ring);
    g.gain.linearRampToValueAtTime(0, end);
    osc.connect(g).connect(bus.pad);
    osc.start(v.at);
    osc.stop(end + 0.02);
    return;
  }

  if (v.kind === "bass") {
    // ronde : le fondamental, et deux harmoniques qui la rendent audible sur de petits haut-parleurs
    struck(v.freq, v.gain, BASS.attack, v.ring, bus.bass);
    struck(v.freq * 2, v.gain * 0.3, BASS.attack, v.ring * 0.7, bus.bass);
    struck(v.freq * 3, v.gain * 0.07, BASS.attack, v.ring * 0.4, bus.bass);
    return;
  }

  const out = bus.keys[v.pan] ?? bus.keys[0];
  // Piano électrique doux : un sinus, éclairci à l'attaque par une modulation de fréquence qui
  // retombe aussitôt (moins marquée dans l'aigu), puis une résonance presque pure.
  const carrier = struck(v.freq, v.gain, KEY.attack, v.ring, out);
  const index = KEY.index * Math.min(1, (pitch(24) / v.freq) ** 0.6);
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = v.freq;
  const depth = ctx.createGain();
  depth.gain.value = 0;
  depth.gain.setValueAtTime(index * v.freq, v.at);
  depth.gain.exponentialRampToValueAtTime(0.08 * v.freq, v.at + 0.3);
  mod.connect(depth).connect(carrier.frequency);
  mod.start(v.at);
  mod.stop(v.at + v.ring + 0.06);
  // Tintement de célesta : la double octave, très brève.
  if (v.freq * 4 < 6000) struck(v.freq * 4, v.gain * KEY.tine, 0.003, 0.2, out);
}

/** Constantes de temps des fondus du gain général (s) : l'ambiance arrive en deux à trois secondes, s'efface en une. */
export const AMBIENCE_FADE = { in: 0.8, out: 0.28, level: 0.12 } as const;

/** Niveau général pour un volume de 0 à 1 (courbe perceptive : le curseur paraît linéaire à l'oreille). */
export const ambienceLevel = (volume: number): number => Math.min(1, Math.max(0, volume)) ** 2 * 1.4;

/** Compose et programme `duration` secondes d'ambiance à partir de `t0` (rendu hors ligne, mesures). */
export function renderAmbience(ctx: BaseAudioContext, bus: AmbienceBus, t0: number, duration: number, rng: () => number = Math.random): AmbientVoice[] {
  const voices = new AmbienceComposer(rng).next(duration);
  for (const v of voices) scheduleVoice(ctx, { ...v, at: t0 + v.at }, bus);
  return voices;
}
