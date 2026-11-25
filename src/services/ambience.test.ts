import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AMBIENCE_FADE, AmbienceComposer, BAR, PHRASES, STEP, TEMPO, ambienceLevel, ambienceOutput, pitch, renderAmbience, scheduleVoice, voiceEnd,
  type AmbienceBus, type AmbientVoice,
} from "./ambience";
import { musicToAmbience, useSettings } from "./settings";
import { FakeOfflineAudioContext, dB, measure, offlineContext, seeded } from "../test/offlineAudio";

const compose = (seconds: number, seed = 1) => new AmbienceComposer(seeded(seed)).next(seconds);
const keys = (voices: AmbientVoice[]) => voices.filter((v) => v.kind === "key");
/** Demi-tons au-dessus de ré 3 (arrondis) d'une fréquence. */
const semis = (freq: number) => Math.round(12 * Math.log2(freq / pitch(0)));
const degree = (freq: number) => ((semis(freq) % 12) + 12) % 12;
/** Mesure et croche (éventuellement demi-croche) d'un instant. */
const place = (at: number) => ({ bar: Math.floor((at + 0.001) / BAR), step: Math.round(((at % BAR) / STEP) * 2) / 2 });
/** Ce qui est joué mesure par mesure : la basse et les notes du clavier (croche:hauteur). */
const score = (voices: AmbientVoice[], bars: number) =>
  Array.from({ length: bars }, (_, bar) => {
    const here = voices.filter((v) => place(v.at).bar === bar);
    const bass = here.find((v) => v.kind === "bass")!;
    return `${semis(bass.freq)}|${keys(here).map((v) => `${place(v.at).step % 8}:${semis(v.freq)}`).join(" ")}`;
  });
const written = (phrase: "A" | "B") => PHRASES[phrase].map((m) => `${m.bass}|${m.hits.map(([step, s]) => `${step}:${s}`).join(" ")}`);

describe("ambiance des menus : le motif", () => {
  it("en ré majeur : mélodie dans la gamme pentatonique des sons d'interface, basse et nappe dans la gamme", () => {
    const pentatonic = new Set([0, 2, 4, 7, 9]);
    const major = new Set([0, 2, 4, 5, 7, 9, 11]);
    for (const v of compose(1800)) {
      expect((v.kind === "key" ? pentatonic : major).has(degree(v.freq)), `${v.kind} ${v.freq}`).toBe(true);
    }
  });

  it("tempo lent et régulier : tout tombe sur la grille, la basse sur les temps forts", () => {
    expect(TEMPO).toBeGreaterThanOrEqual(60);
    expect(TEMPO).toBeLessThanOrEqual(84);
    for (const v of compose(1800)) {
      const offGrid = Math.abs(v.at / (STEP / 2) - Math.round(v.at / (STEP / 2))) * (STEP / 2);
      // le clavier a un jeu humain de quelques millisecondes ; la basse et la nappe sont exactes
      expect(offGrid, `${v.kind} ${v.at}`).toBeLessThan(v.kind === "key" ? 0.013 : 1e-6);
      if (v.kind === "bass") expect([0, 4]).toContain(place(v.at).step % 8);
    }
  });

  it("on entend d'abord le motif tel qu'il est écrit, puis les phrases A et B alternent", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const bars = score(compose(40 * BAR, seed), 40);
      expect(bars.slice(0, 4), `graine ${seed}`).toEqual(written("A"));
      // suite des phrases, reconnues à leur ligne de basse
      const lines = bars.map((b) => b.split("|")[0]).join(",");
      const order = [...lines.matchAll(/0,-3,-7,-5|5,4,2,0/g)].map((m) => (m[0].startsWith("0,") ? "A" : "B"));
      expect(order.length).toBeGreaterThanOrEqual(6);
      order.forEach((p, i) => expect(p, `graine ${seed}`).toBe(i % 2 ? "B" : "A"));
    }
  });

  it("beaucoup de silences : une ou deux mesures de respiration après chaque phrase, peu de notes", () => {
    const voices = compose(1800);
    const bars = score(voices, Math.floor(1800 / BAR));
    let rests = 0;
    for (const bar of bars) {
      const notes = bar.split("|")[1].split(" ").filter(Boolean).length;
      expect(notes).toBeLessThanOrEqual(5);
      // une respiration : basse sur ré, une note isolée au plus
      const resting = bar.startsWith("0|") && notes <= 1 && !bar.includes("0:24");
      if (resting) rests++;
      else {
        expect(rests, "respirations d'affilée").toBeLessThanOrEqual(2);
        rests = 0;
      }
    }
    // en moyenne, moins d'une croche sur trois porte une note
    expect(keys(voices).length / (bars.length * 8)).toBeLessThan(0.33);
  });

  it("varié sans se perdre : aucune période exacte, deux écoutes différentes, les notes écrites dominent", () => {
    const voices = compose(3600);
    const bars = score(voices, Math.floor(3600 / BAR));
    for (let period = 1; period <= 60; period++) {
      expect(bars.slice(period).some((b, i) => b !== bars[i]), `période ${period}`).toBe(true);
    }
    expect(score(compose(600, 2), 150)).not.toEqual(bars.slice(0, 150));
    // au moins deux mesures sur trois sont jouées exactement comme écrites (ou sont des respirations)
    const known = new Set([...written("A"), ...written("B"), "0|"]);
    expect(bars.filter((b) => known.has(b)).length / bars.length).toBeGreaterThan(0.6);
    expect(new Set(bars).size).toBeGreaterThan(20);
  });

  it("composé au fil de l'eau (en direct) ou d'un bloc (mesures) : même résultat", () => {
    const live = new AmbienceComposer(seeded(5));
    const stepped: AmbientVoice[] = [];
    for (let t = 1; t <= 300; t++) stepped.push(...live.next(t));
    const key = (v: AmbientVoice) => `${v.kind} ${v.at.toFixed(4)} ${v.freq.toFixed(2)}`;
    expect(stepped.map(key).sort()).toEqual(compose(300, 5).map(key).sort());
  });

  it("coût négligeable : une vingtaine d'oscillateurs au plus", () => {
    const voices = compose(1800);
    for (let t = 0; t < 1800; t += 0.25) {
      const alive = voices.filter((v) => v.at <= t && voiceEnd(v) > t).reduce((n, v) => n + (v.kind === "pad" ? 1 : 3), 0);
      expect(alive).toBeLessThanOrEqual(26);
    }
  });
});

const SR = 16000;

describe("ambiance des menus : rendu hors ligne", () => {
  afterEach(() => vi.restoreAllMocks());

  it("chaque voix naît du silence et y retourne, sans claquement", async () => {
    const samples: AmbientVoice[] = [
      { kind: "key", at: 0.1, freq: pitch(24), gain: 0.1, pan: 1, ring: 1.4 },
      { kind: "key", at: 0.1, freq: pitch(45), gain: 0.1, pan: 0, ring: 1.4 },
      { kind: "bass", at: 0.1, freq: pitch(-7), gain: 0.085, pan: 1, ring: 1.2 },
      { kind: "pad", at: 0.1, freq: pitch(12), gain: 0.012, pan: 1, ring: 0.2 },
    ];
    for (const voice of samples) {
      const end = voiceEnd(voice);
      const ctx = offlineContext(end + 0.3, SR);
      const out = ctx.destination;
      scheduleVoice(ctx, voice, { master: out, keys: [out, out, out], bass: out, pad: out } as unknown as AmbienceBus);
      const buf = await ctx.startRendering();
      const label = `${voice.kind} ${voice.freq.toFixed(0)} Hz`;
      expect(measure(buf, 0, 0.1).peak, `${label} avant`).toBe(0);
      expect(measure(buf, 0.1, 0.1005).peak, `${label} départ`).toBeLessThan(voice.gain * 0.2);
      expect(measure(buf, end - 0.002, end).peak, `${label} fin`).toBeLessThan(voice.gain * 0.01);
      expect(measure(buf, end + 0.1, end + 0.3).peak, `${label} après`).toBeLessThan(1e-6);
      expect(measure(buf).peak, label).toBeGreaterThan(voice.gain * 0.5);
      // Un son ne peut pas varier plus vite que sa composante la plus aiguë (ici : la porteuse
      // modulée, soit moins de trois fois la note, et le tintement à la double octave) : au-delà,
      // c'est un claquement.
      const fastest = voice.kind === "key" ? voice.gain * 3 * voice.freq + voice.gain * 0.07 * 4 * voice.freq : voice.gain * (1 + 0.6 + 0.21) * voice.freq;
      expect(measure(buf).step, label).toBeLessThan((2 * Math.PI * fastest) / SR + voice.gain / (0.003 * SR));
    }
  });

  it("niveau bas, démarrage et arrêt en fondu, écho et résonance compris", async () => {
    // la résonance est tirée au hasard une fois par contexte : hasard fixé pour une mesure stable
    vi.spyOn(Math, "random").mockImplementation(seeded(99));
    const T = 52;
    const ctx = offlineContext(T, SR);
    const bus = ambienceOutput(ctx);
    // comme le lecteur : entrée en fondu à plein volume, sortie en fondu à 48 s
    bus.master.gain.setTargetAtTime(ambienceLevel(1), 0, AMBIENCE_FADE.in);
    bus.master.gain.setTargetAtTime(0, 48, AMBIENCE_FADE.out);
    renderAmbience(ctx, bus, 0, T, seeded(3));
    const buf = await ctx.startRendering();

    const start = measure(buf, 0, 0.002);
    const steady = measure(buf, 6, 48);
    const fading = measure(buf, 48, 50);
    const after = measure(buf, 50.5, T);

    expect(start.peak, "départ").toBeLessThan(steady.peak * 0.005);
    // l'entrée est un fondu : après un quart de seconde, on est encore loin du plein niveau
    expect(measure(buf, 0, 0.25).peak, "entrée en fondu").toBeLessThan(steady.peak * 0.3);
    // jamais de saturation, même à plein volume avec un son d'interface par-dessus
    expect(steady.peak, "crête").toBeLessThan(0.6);
    expect(steady.peak, "crête").toBeGreaterThan(0.05);
    // au volume par défaut : crête sous -18 dB, niveau moyen entre -46 et -34 dB
    const byDefault = ambienceLevel(useSettings.getInitialState().ambienceVolume) / ambienceLevel(1);
    expect(dB(steady.peak * byDefault), "crête par défaut").toBeLessThan(-18);
    expect(dB(steady.rms * byDefault), "niveau par défaut").toBeLessThan(-34);
    expect(dB(steady.rms * byDefault), "niveau par défaut").toBeGreaterThan(-46);
    // l'arrêt ne claque pas : rien ne varie plus vite pendant le fondu qu'avant, puis le silence
    // (l'écho et la résonance passent eux aussi par le gain général)
    expect(fading.step, "fondu de sortie").toBeLessThanOrEqual(steady.step);
    expect(after.peak, "silence").toBeLessThan(steady.peak * 0.002);
  }, 60000);

  it("le volume suit une courbe perceptive, muette à zéro", () => {
    expect(ambienceLevel(0)).toBe(0);
    expect(ambienceLevel(-1)).toBe(0);
    expect(ambienceLevel(0.5)).toBeLessThan(ambienceLevel(1) / 3);
    expect(ambienceLevel(2)).toBe(ambienceLevel(1));
  });
});

describe("ambiance des menus : une seule à la fois", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("couper, remettre, céder la place, changer de volume : un seul moteur, une seule minuterie, aucune note en double", async () => {
    vi.useFakeTimers();
    const contexts: LiveContext[] = [];
    /** Contexte « en direct » de test : le temps avance avec l'horloge simulée tant qu'il n'est pas en veille. */
    class LiveContext extends FakeOfflineAudioContext {
      state: "running" | "suspended" = "running";
      private elapsed = 0;
      private since = Date.now();
      constructor() {
        super(2, 128, SR);
        contexts.push(this);
      }
      override get currentTime(): number {
        return this.elapsed + (this.state === "running" ? (Date.now() - this.since) / 1000 : 0);
      }
      resume(): Promise<void> {
        if (this.state === "suspended") this.since = Date.now();
        this.state = "running";
        return Promise.resolve();
      }
      suspend(): Promise<void> {
        if (this.state === "running") this.elapsed += (Date.now() - this.since) / 1000;
        this.state = "suspended";
        return Promise.resolve();
      }
    }
    const intervals = new Set<unknown>();
    vi.stubGlobal("document", { hidden: false, addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal("AudioContext", LiveContext);
    vi.stubGlobal("window", {
      AudioContext: LiveContext,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
      setInterval: (fn: () => void, ms: number) => {
        const id = setInterval(fn, ms);
        intervals.add(id);
        return id;
      },
      clearInterval: (id: ReturnType<typeof setInterval>) => {
        intervals.delete(id);
        clearInterval(id);
      },
    });
    const { music } = await import("./music");
    const settings = (await import("./settings")).useSettings;
    const set = settings.getState().set;
    set("ambienceEnabled", true);
    set("ambienceVolume", 0.5);

    const detach = music.attach();
    const wait = (seconds: number) => vi.advanceTimersByTime(seconds * 1000);
    wait(8);
    set("ambienceEnabled", false); wait(0.4);
    set("ambienceEnabled", true); wait(5);
    set("ambienceEnabled", false); wait(6);
    expect(contexts[0].state, "veille après le fondu").toBe("suspended");
    set("ambienceEnabled", true); wait(7);
    music.setYielding(true); wait(3);
    music.setYielding(false); wait(4);
    music.setSuspended(true); music.setBackground(true); wait(5);
    music.setBackground(false); wait(2);
    expect(intervals.size, "toujours en pause : un jeu tourne").toBe(0);
    music.setSuspended(false); wait(6);
    for (const volume of [0.2, 0.9, 0.5]) { set("ambienceVolume", volume); wait(1.5); }
    const restore = music.duck(); wait(1); restore(); wait(9);

    expect(contexts.length, "moteurs audio créés").toBe(1);
    expect(intervals.size, "minuteries actives").toBe(1);
    // aucune note de basse en double : une par temps fort, jamais deux au même instant
    const starts = contexts[0].nodes.flatMap((n) => ("frequency" in n && "startedAt" in n ? [(n as { startedAt: number }).startedAt] : []));
    expect(starts.length).toBeGreaterThan(40);
    const bars = contexts[0].currentTime / BAR;
    // au plus ce que le motif peut contenir : 5 notes de clavier, 2 de basse et 2 de nappe par mesure, 3 oscillateurs par note
    expect(starts.length).toBeLessThanOrEqual((bars + 2) * (5 * 3 + 2 * 3 + 2));
    detach();
    wait(3);
    expect(intervals.size, "arrêt").toBe(0);
  });
});

describe("ambiance des menus : reprise des réglages", () => {
  it("musique coupée : ambiance coupée ; même volume ; anciens réglages retirés", () => {
    const off: Record<string, unknown> = { musicEnabled: false, musicVolume: 0.3, menuPlaylist: ["a.mp3"], menuShuffle: true, soundVolume: 0.6 };
    musicToAmbience(off);
    expect(off).toEqual({ ambienceEnabled: false, ambienceVolume: 0.3, soundVolume: 0.6 });

    const on: Record<string, unknown> = { musicEnabled: true, musicVolume: 0 };
    musicToAmbience(on);
    expect(on).toEqual({ ambienceEnabled: true, ambienceVolume: 0 });
  });

  it("rien à reprendre : les valeurs d'une installation neuve s'appliquent ; un choix déjà fait est gardé, sans la variante des essais", () => {
    const empty: Record<string, unknown> = {};
    musicToAmbience(empty);
    expect(empty).toEqual({});

    const chosen: Record<string, unknown> = { ambienceEnabled: true, ambienceVolume: 0.8, ambienceVariant: "brume", musicEnabled: false, musicVolume: 0.1 };
    musicToAmbience(chosen);
    expect(chosen).toEqual({ ambienceEnabled: true, ambienceVolume: 0.8 });

    const fresh = useSettings.getInitialState();
    expect(fresh.ambienceEnabled).toBe(true);
    expect("ambienceVariant" in fresh).toBe(false);
  });
});
