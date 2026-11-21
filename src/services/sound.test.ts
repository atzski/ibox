import { describe, expect, it } from "vitest";
import { SOUND_CUES, VOICES, type Tone, type Voice } from "./sound";

const isTone = (v: Voice): v is Tone => !("noise" in v);
const length = (cue: (typeof SOUND_CUES)[number]) => Math.max(...VOICES[cue].map((v) => v.at + v.dur));
/** Demi-tons au-dessus de ré, toutes octaves confondues. */
const degree = (freq: number) => ((Math.round(12 * Math.log2(freq / 293.66)) % 12) + 12) % 12;

describe("sons d'interface", () => {
  it("chaque cue a au moins une voix", () => {
    for (const cue of SOUND_CUES) expect(VOICES[cue].length, cue).toBeGreaterThan(0);
  });

  it("des signaux, pas des musiques : tout tient en moins de 1,3 s", () => {
    for (const cue of SOUND_CUES) expect(length(cue), cue).toBeLessThanOrEqual(1.3);
    // les gestes les plus répétés restent très brefs
    for (const cue of ["move", "tap", "tab", "toggle"] as const) expect(length(cue), cue).toBeLessThanOrEqual(0.2);
  });

  it("aucune saturation possible : la somme des niveaux reste sous 1", () => {
    for (const cue of SOUND_CUES) expect(VOICES[cue].reduce((s, v) => s + v.gain, 0), cue).toBeLessThan(1);
  });

  it("les notes des signaux restent dans la gamme pentatonique de ré majeur", () => {
    const scale = new Set([0, 2, 4, 7, 9]);
    const melodic = SOUND_CUES.filter((c) => !["caseOpen", "caseClose", "trayOpen", "trayClose", "mediaOut", "mediaIn", "pull", "page", "bookOpen", "bookClose"].includes(c));
    for (const cue of melodic) {
      // les chocs sourds (sous 200 Hz) ne sont pas des notes
      for (const v of VOICES[cue].filter(isTone).filter((t) => t.freq > 200)) expect(scale.has(degree(v.freq)), `${cue} ${v.freq}`).toBe(true);
    }
  });

  it("hiérarchie : le déplacement est le plus discret, la confirmation plus présente", () => {
    const peak = (cue: (typeof SOUND_CUES)[number]) => Math.max(...VOICES[cue].filter(isTone).map((t) => t.gain));
    expect(peak("move")).toBeLessThan(peak("tap"));
    expect(peak("tap")).toBeLessThan(peak("select"));
    expect(peak("move")).toBeLessThan(peak("confirm"));
  });
});
