import { useSettings } from "./settings";

/**
 * Sons d'interface d'iBox.
 *
 * Une seule famille sonore, entièrement synthétisée (Web Audio, aucun fichier, aucun son
 * officiel) : des lames de verre et de bois accordées sur la gamme pentatonique de ré majeur,
 * avec une courte résonance commune. La hiérarchie va du plus discret (déplacement, simple
 * appui) au plus présent (confirmation, succès, lancement) ; l'erreur reste douce, dans le grave.
 * Les sons répétés varient légèrement (hauteur, niveau) pour ne pas fatiguer.
 *
 * Un fichier peut remplacer n'importe quelle cue via `registerSoundFile`.
 * La musique d'ambiance (menu, consoles) est gérée par `music.ts`.
 */
export const SOUND_CUES = [
  // navigation
  "move", "tap", "select", "confirm", "back", "open", "close", "tab", "view",
  // états
  "toggle", "on", "off", "favorite", "unfavorite", "delete", "error",
  // événements
  "notify", "message", "success", "launch",
  // sons « physiques » des boîtiers et des carnets
  "caseOpen", "caseClose", "trayOpen", "trayClose", "mediaOut", "mediaIn", "pull", "page", "bookOpen", "bookClose",
] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

/** Partiels d'un timbre : [rapport de fréquence, niveau relatif, durée relative]. */
type Partial3 = readonly [number, number, number];
const TIMBRES = {
  /** Lame de verre : claire, ronde, partiels de carillon vite éteints. */
  glass: [[1, 1, 1], [2, 0.22, 0.5], [2.76, 0.1, 0.3], [5.4, 0.05, 0.14]],
  /** Carillon : le verre, doublé d'une voix à peine désaccordée qui fait scintiller la queue. */
  chime: [[1, 1, 1], [1.004, 0.4, 1], [2, 0.2, 0.55], [2.76, 0.12, 0.35], [5.4, 0.05, 0.16]],
  /** Lame de bois (marimba) : attaque nette, très courte. */
  wood: [[1, 1, 1], [4, 0.16, 0.22], [9.2, 0.04, 0.1]],
  /** Voix feutrée : retours, fermetures, extinctions. */
  soft: [[1, 1, 1], [2, 0.1, 0.45]],
  /** Voix creuse (partiels impairs) : l'erreur, reconnaissable sans être agressive. */
  hollow: [[1, 1, 1], [3, 0.22, 0.6], [5, 0.07, 0.35]],
} as const satisfies Record<string, readonly Partial3[]>;
type Timbre = keyof typeof TIMBRES;

export interface Tone {
  freq: number;
  /** Secondes après le déclenchement. */
  at: number;
  /** Durée de la résonance (extinction complète). */
  dur: number;
  gain: number;
  timbre?: Timbre;
  /** Petite inflexion d'attaque : la note part de `freq × from` et rejoint `freq` en `glide` s. */
  from?: number;
  glide?: number;
  attack?: number;
}

/** Souffle filtré : frottements, clics de plastique, glissements de carton, air d'une ouverture. */
export interface Noise {
  noise: true;
  at: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  slideTo?: number;
  q?: number;
  /** Montée du volume (s) : courte = clic, longue = frottement. */
  attack?: number;
}

export type Voice = Tone | Noise;

// Gamme pentatonique de ré majeur (ré, mi, fa dièse, la, si).
const Fs4 = 369.99, D5 = 587.33, Fs5 = 739.99, A5 = 880, B5 = 987.77;
const D6 = 1174.66, E6 = 1318.51, Fs6 = 1479.98, A6 = 1760, D7 = 2349.32;

const note = (freq: number, at: number, dur: number, gain: number, timbre: Timbre = "glass", extra: Partial<Tone> = {}): Tone => ({ freq, at, dur, gain, timbre, ...extra });
/** Contact du maillet : un grain de souffle très bref qui précise l'attaque. */
const tick = (at: number, gain = 0.03, freq = 3600): Noise => ({ noise: true, at, dur: 0.012, gain, filter: "highpass", freq });
const click = (at: number, gain = 0.2, freq = 2800): Noise => ({ noise: true, at, dur: 0.022, gain, filter: "highpass", freq });
const thump = (at: number, gain = 0.2, from = 140, to = 80): Tone => ({ freq: to, from: from / to, glide: 0.07, at, dur: 0.1, gain, timbre: "soft", attack: 0.003 });
const whoosh = (at: number, dur: number, from: number, to: number, gain = 0.08): Noise => ({
  noise: true, at, dur, gain, filter: "bandpass", freq: from, slideTo: to, q: 1.2, attack: dur * 0.35,
});

export const VOICES: Record<SoundCue, Voice[]> = {
  // ——— navigation ———
  // Déplacement : le plus discret, une lame de bois effleurée.
  move: [tick(0, 0.022), note(A5, 0, 0.07, 0.085, "wood")],
  // Appui par défaut de tout élément cliquable : une petite bulle.
  tap: [tick(0, 0.02, 3000), note(D5, 0, 0.1, 0.11, "wood", { from: 1.35, glide: 0.028 })],
  // Sélection : quarte montante.
  select: [tick(0, 0.025), note(A5, 0, 0.16, 0.12), note(D6, 0.055, 0.28, 0.14)],
  // Confirmation : l'accord de ré égrené, plus présent.
  confirm: [tick(0, 0.03), note(A5, 0, 0.18, 0.12, "chime"), note(D6, 0.05, 0.22, 0.12, "chime"), note(Fs6, 0.1, 0.42, 0.13, "chime")],
  // Retour : la sélection à l'envers, feutrée.
  back: [note(D6, 0, 0.12, 0.1, "soft"), note(A5, 0.055, 0.22, 0.115, "soft")],
  // Ouverture d'une fenêtre : un souffle et trois notes qui montent.
  open: [whoosh(0, 0.2, 500, 2200, 0.03), note(D5, 0, 0.14, 0.085), note(A5, 0.045, 0.16, 0.095), note(D6, 0.09, 0.36, 0.115)],
  // Fermeture : la même phrase qui redescend, dans le temps de la sortie (160 ms).
  close: [whoosh(0, 0.14, 2000, 600, 0.022), note(D6, 0, 0.1, 0.075, "soft"), note(A5, 0.04, 0.12, 0.085, "soft"), note(D5, 0.08, 0.2, 0.1, "soft")],
  // Onglet, tri, segment : deux lames de bois rapprochées.
  tab: [tick(0, 0.02), note(B5, 0, 0.06, 0.085, "wood"), note(E6, 0.04, 0.13, 0.095, "wood")],
  // Changement de vue : balayage d'air et deux notes.
  view: [whoosh(0, 0.24, 500, 2000, 0.06), note(E6, 0.04, 0.14, 0.08), note(A6, 0.11, 0.32, 0.085)],

  // ——— états ———
  // Bascule sans état connu : une goutte.
  toggle: [tick(0, 0.02), note(Fs6, 0, 0.14, 0.11, "glass", { from: 0.8, glide: 0.04 })],
  // Interrupteur allumé : quinte montante ; éteint : quinte descendante, feutrée.
  on: [tick(0, 0.025), note(A5, 0, 0.08, 0.095), note(E6, 0.045, 0.22, 0.125)],
  off: [note(E6, 0, 0.08, 0.085, "soft"), note(A5, 0.045, 0.2, 0.105, "soft")],
  // Favori : une étincelle qui grimpe ; retiré : deux notes qui se posent.
  favorite: [note(D6, 0, 0.2, 0.085, "chime"), note(Fs6, 0.035, 0.2, 0.085, "chime"), note(A6, 0.07, 0.26, 0.09, "chime"), note(D7, 0.105, 0.48, 0.095, "chime")],
  unfavorite: [note(A6, 0, 0.1, 0.065, "soft"), note(D6, 0.05, 0.24, 0.095, "soft")],
  // Suppression : tierce descendante et petit choc sourd.
  delete: [note(Fs5, 0, 0.1, 0.105, "soft"), note(D5, 0.06, 0.22, 0.115, "soft"), thump(0.06, 0.09, 150, 85)],
  // Erreur : deux coups graves identiques, doux mais sans équivoque.
  error: [
    note(Fs4, 0, 0.13, 0.16, "hollow", { from: 1.035, glide: 0.05, attack: 0.006 }),
    note(Fs4, 0.115, 0.22, 0.15, "hollow", { from: 1.035, glide: 0.05, attack: 0.006 }),
    thump(0, 0.07, 130, 90),
  ],

  // ——— événements ———
  // Notification : carillon à deux notes, longue queue.
  notify: [note(D6, 0, 0.5, 0.115, "chime"), note(A6, 0.09, 0.72, 0.105, "chime")],
  // Message reçu : deux petits coups sur la même note.
  message: [tick(0, 0.02), note(B5, 0, 0.09, 0.09, "wood"), note(B5, 0.085, 0.3, 0.1, "chime")],
  // Tâche réussie : l'arpège complet, posé sur son octave.
  success: [
    note(D6, 0, 0.25, 0.095, "chime"), note(Fs6, 0.07, 0.25, 0.095, "chime"), note(A6, 0.14, 0.3, 0.1, "chime"),
    note(D7, 0.21, 0.8, 0.11, "chime"), note(D6, 0.21, 0.8, 0.05, "soft"),
  ],
  // Lancement d'un jeu : la signature d'iBox, un envol puis un accord qui s'ouvre.
  launch: [
    whoosh(0, 0.45, 300, 3000, 0.05),
    note(D5, 0, 0.2, 0.09), note(A5, 0.07, 0.2, 0.09), note(D6, 0.13, 0.2, 0.095), note(Fs6, 0.18, 0.2, 0.095), note(A6, 0.22, 0.24, 0.095),
    note(D6, 0.28, 0.9, 0.06, "chime"), note(A6, 0.28, 0.9, 0.07, "chime"), note(D7, 0.28, 0.95, 0.08, "chime"),
  ],

  // ——— boîtiers et carnets ———
  // Charnière d'un boîtier plastique : petit « pop », souffle, note claire
  caseOpen: [click(0, 0.2), thump(0, 0.18, 150, 95), whoosh(0.02, 0.22, 900, 2400, 0.09), note(A5, 0.12, 0.2, 0.06), note(D6, 0.19, 0.3, 0.05)],
  // Fermeture : souffle descendant puis « clac »
  caseClose: [whoosh(0, 0.14, 2200, 800, 0.08), click(0.11, 0.18, 3000), thump(0.11, 0.22, 125, 70)],
  // Plateau de carton qui glisse, puis petite butée
  trayOpen: [
    { noise: true, at: 0, dur: 0.38, gain: 0.16, filter: "lowpass", freq: 600, slideTo: 1500, attack: 0.06 },
    { noise: true, at: 0.33, dur: 0.05, gain: 0.14, filter: "bandpass", freq: 420, q: 2 },
  ],
  trayClose: [{ noise: true, at: 0, dur: 0.32, gain: 0.15, filter: "lowpass", freq: 1500, slideTo: 500, attack: 0.05 }, thump(0.29, 0.22, 110, 75)],
  // Support saisi : déclic, souffle, petite note ascendante
  mediaOut: [click(0, 0.16, 3200), whoosh(0.01, 0.2, 700, 1800, 0.075), note(Fs6, 0.12, 0.2, 0.075, "glass", { from: 0.75, glide: 0.09 })],
  // Support rangé : souffle puis encliquetage
  mediaIn: [whoosh(0, 0.16, 1800, 700, 0.075), click(0.14, 0.14, 3000), thump(0.14, 0.15, 170, 110)],
  // Boîtier tiré de l'étagère : léger frottement plastique
  pull: [click(0, 0.14, 2400), { noise: true, at: 0.01, dur: 0.3, gain: 0.12, filter: "bandpass", freq: 1200, slideTo: 2600, q: 1.5, attack: 0.08 }],
  // Page de papier tournée : froissement bref, plus aigu en fin de geste
  page: [
    { noise: true, at: 0, dur: 0.16, gain: 0.11, filter: "bandpass", freq: 1800, slideTo: 4200, q: 0.8, attack: 0.04 },
    { noise: true, at: 0.12, dur: 0.05, gain: 0.06, filter: "highpass", freq: 5000 },
  ],
  // Carnet tiré de ses clips puis ouvert
  bookOpen: [
    click(0, 0.13, 2400),
    whoosh(0.03, 0.3, 600, 2600, 0.085),
    { noise: true, at: 0.24, dur: 0.14, gain: 0.085, filter: "bandpass", freq: 2200, slideTo: 3800, q: 0.9, attack: 0.03 },
    note(A5, 0.2, 0.24, 0.045),
  ],
  // Carnet refermé : papier, puis petit claquement de couverture
  bookClose: [{ noise: true, at: 0, dur: 0.14, gain: 0.085, filter: "bandpass", freq: 3200, slideTo: 1600, q: 0.9 }, thump(0.12, 0.16, 160, 90), click(0.12, 0.13, 2000)],
};

/** Part de résonance : presque sec pour les gestes répétés, plus ample pour les événements. */
const WET: Partial<Record<SoundCue, number>> = { move: 0.04, tap: 0.05, tab: 0.07, toggle: 0.08, error: 0.06, notify: 0.2, success: 0.2, favorite: 0.18, launch: 0.22, confirm: 0.16 };
const DEFAULT_WET = 0.11;
/** Variation aléatoire de hauteur (centièmes de demi-ton) des sons les plus répétés. */
const DRIFT: Partial<Record<SoundCue, number>> = { move: 14, tap: 14, tab: 8, toggle: 8, on: 5, off: 5, select: 5, back: 5, page: 0 };
/** Écart minimal (ms) entre deux déclenchements de la même cue. */
const GAP: Partial<Record<SoundCue, number>> = { move: 45, tap: 40 };
/** Carillons d'événements : un seul à la fois, pour qu'ils ne se recouvrent pas. */
const CHIMES: ReadonlySet<SoundCue> = new Set(["notify", "message", "success"]);
const CHIME_GAP = 450;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
/** Une seconde de bruit blanc, générée une fois par contexte. */
function whiteNoise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

const rooms = new WeakMap<BaseAudioContext, ConvolverNode>();
/** Résonance commune : une petite pièce claire (0,4 s), calculée une fois par contexte. */
function room(ctx: BaseAudioContext): ConvolverNode {
  let conv = rooms.get(ctx);
  if (!conv) {
    const len = Math.floor(ctx.sampleRate * 0.42);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      let low = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // bruit adouci (passe-bas à un pôle) qui s'éteint vite : pas de sifflantes dans la queue
        low += (Math.random() * 2 - 1 - low) * 0.35;
        data[i] = low * Math.pow(1 - t, 2) * Math.exp(-5 * t);
      }
    }
    conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = ir;
    conv.connect(ctx.destination);
    rooms.set(ctx, conv);
  }
  return conv;
}

/** Sortie d'un son : voie directe au volume demandé, plus un envoi vers la résonance commune. */
export function soundOutput(ctx: BaseAudioContext, volume: number, cue: SoundCue): AudioNode {
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  const send = ctx.createGain();
  send.gain.value = WET[cue] ?? DEFAULT_WET;
  out.connect(send).connect(room(ctx));
  return out;
}

/** Programme les voix d'une cue sur `out` à partir de `t0` (fonctionne aussi hors ligne, pour les mesures). */
export function renderCue(ctx: BaseAudioContext, cue: SoundCue, out: AudioNode, t0: number, detune = 0, level = 1): void {
  for (const n of VOICES[cue]) {
    const start = t0 + n.at;
    if ("noise" in n) {
      const attack = n.attack ?? 0.003;
      const g = ctx.createGain();
      // muet avant le départ : sans cela un échantillon peut passer à plein niveau (claquement)
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(n.gain * level, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, start + Math.max(n.dur, attack + 0.01));
      const src = ctx.createBufferSource();
      src.buffer = whiteNoise(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = n.filter;
      filter.Q.value = n.q ?? 0.7;
      filter.frequency.setValueAtTime(n.freq, start);
      if (n.slideTo) filter.frequency.exponentialRampToValueAtTime(n.slideTo, start + n.dur);
      src.connect(filter).connect(g).connect(out);
      src.start(start, Math.random() * 0.5);
      src.stop(start + n.dur + 0.02);
      continue;
    }
    const attack = n.attack ?? 0.004;
    for (const [ratio, rel, decay] of TIMBRES[n.timbre ?? "glass"]) {
      const f = n.freq * ratio;
      if (f > 11000) continue; // partiels trop aigus : inutiles et durs à l'oreille
      const end = start + Math.max(n.dur * decay, attack + 0.012);
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.detune.value = detune;
      if (n.from && n.from !== 1) {
        osc.frequency.setValueAtTime(f * n.from, start);
        osc.frequency.exponentialRampToValueAtTime(f, start + (n.glide ?? 0.03));
      } else {
        osc.frequency.setValueAtTime(f, start);
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(n.gain * rel * level, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g).connect(out);
      osc.start(start);
      osc.stop(end + 0.01);
    }
  }
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private files = new Map<SoundCue, AudioBuffer>();
  private lastPlayed = new Map<SoundCue, number>();
  private lastChime = 0;
  /** Horodatage du dernier son joué (sert au son par défaut des éléments cliquables). */
  private lastAny = 0;
  private background = false;

  private context(): AudioContext | null {
    if (typeof window === "undefined" || !("AudioContext" in window)) return null;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Fenêtre principale masquée (zone de notification) : plus aucun son d'interface. */
  setBackground(value: boolean): void {
    this.background = value;
  }

  /** Remplace la voix synthétisée d'une cue par un fichier audio. */
  async registerSoundFile(cue: SoundCue, url: string): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Son introuvable : ${url}`);
    this.files.set(cue, await ctx.decodeAudioData(await res.arrayBuffer()));
  }

  play(cue: SoundCue): void {
    const now = performance.now();
    // un son a été demandé pour ce geste, même s'il reste muet : pas de son par défaut en plus
    this.lastAny = now;
    const { soundEnabled, soundVolume } = useSettings.getState();
    if (!soundEnabled || soundVolume <= 0) return;
    if (this.background || (typeof document !== "undefined" && document.hidden)) return;

    // Anti-mitraillage (déplacements rapides) et carillons qui ne se recouvrent pas
    if (now - (this.lastPlayed.get(cue) ?? -1e9) < (GAP[cue] ?? 20)) return;
    if (CHIMES.has(cue)) {
      if (now - this.lastChime < CHIME_GAP) return;
      this.lastChime = now;
    }
    this.lastPlayed.set(cue, now);

    const ctx = this.context();
    if (!ctx) return;
    const out = soundOutput(ctx, soundVolume * 0.9, cue);

    const file = this.files.get(cue);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.connect(out);
      src.start();
      return;
    }

    const drift = DRIFT[cue] ?? 0;
    const detune = drift ? (Math.random() * 2 - 1) * drift : 0;
    const level = drift ? 0.94 + Math.random() * 0.12 : 1;
    renderCue(ctx, cue, out, ctx.currentTime + 0.005, detune, level);
  }

  /**
   * Son par défaut de tout ce qui se clique : si un bouton, un lien ou une case n'a joué aucun
   * son pendant son clic, il reçoit le petit « tap ». À appeler une fois par fenêtre.
   */
  attachClicks(): () => void {
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target.closest(CLICKABLE) : null;
      if (!target || target.closest("[data-silent]")) return;
      // champs de saisie et curseurs : on y écrit, on n'y « appuie » pas
      if (e.target instanceof Element && e.target.closest('textarea, input:not([type="checkbox"]):not([type="radio"])')) return;
      if ((target as HTMLButtonElement).disabled || target.getAttribute("aria-disabled") === "true") return;
      const at = performance.now();
      // après tous les gestionnaires du clic : ceux qui ont leur propre son ont déjà joué
      window.setTimeout(() => {
        if (this.lastAny < at) this.play("tap");
      }, 0);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }
}

const CLICKABLE = 'button, a[href], summary, select, input[type="checkbox"], input[type="radio"], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="option"], [data-focusable]';

export const sound = new SoundManager();
