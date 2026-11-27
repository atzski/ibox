import { describe, expect, it } from "vitest";
import { isHandheld, shouldSleep } from "./performance";
import { attentionOf } from "./attention";
import { scenesActive, SETTLE_MS } from "@/three/activity";

describe("mode performance", () => {
  it("reconnaît le Steam Deck et les machines annoncées par Steam", () => {
    expect(isHandheld({ steamDeck: "Steam Deck OLED" })).toBe(true);
    expect(isHandheld({ steamDeck: null, handheld: true })).toBe(true);
    expect(isHandheld({ steamDeck: null, handheld: false })).toBe(false);
    expect(isHandheld({ steamDeck: null })).toBe(false);
  });
});

describe("veille de l'interface", () => {
  const awake = { documentHidden: false, windowHidden: false, focused: true, playing: false };
  it("reste éveillée tant qu'on la regarde", () => {
    expect(shouldSleep(awake)).toBe(false);
    // sans focus mais sans jeu en cours (seconde fenêtre, autre écran) : elle continue
    expect(shouldSleep({ ...awake, focused: false })).toBe(false);
    // jeu en cours mais iBox au premier plan (retour par le bouton Steam, Alt+Tab)
    expect(shouldSleep({ ...awake, playing: true })).toBe(false);
  });
  it("s'endort fenêtre masquée, document caché, ou derrière un jeu", () => {
    expect(shouldSleep({ ...awake, windowHidden: true })).toBe(true);
    expect(shouldSleep({ ...awake, documentHidden: true })).toBe(true);
    expect(shouldSleep({ ...awake, playing: true, focused: false })).toBe(true);
  });
});

describe("rendu 3D à la demande", () => {
  it("dessine pendant le temps de pose, puis s'arrête", () => {
    expect(scenesActive(1000, 1000)).toBe(true);
    expect(scenesActive(1000 + SETTLE_MS - 1, 1000)).toBe(true);
    expect(scenesActive(1000 + SETTLE_MS, 1000)).toBe(false);
  });
});

describe("attention : iBox seul à l'écran (Mode Jeu)", () => {
  const base = { documentHidden: false, windowHidden: false, focused: false, playing: false };
  it("manette lue sans focus seulement en Mode Jeu, sans partie ni lancement", () => {
    expect(attentionOf({ ...base, gameMode: true })).toEqual({ asleep: false, alone: true });
    expect(attentionOf({ ...base, gameMode: true, launching: true }).alone).toBe(false);
    expect(attentionOf({ ...base, gameMode: true, playing: true })).toEqual({ asleep: true, alone: false });
    expect(attentionOf({ ...base, gameMode: false }).alone).toBe(false);
  });
});
