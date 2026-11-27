import { describe, expect, it } from "vitest";
import { presetOf, resolveBudget, type BudgetInput } from "./budget";

const input = (over: Partial<BudgetInput>): BudgetInput => ({ preset: "auto", auto: "full", deck: false, onBattery: false, ...over });

describe("budget de performance (un seul réglage)", () => {
  it("Automatique suit l'appareil et la batterie", () => {
    expect(resolveBudget(input({ auto: "full" }))).toMatchObject({ tier: "full", light: false, profile: "quality", fps: null, idle: false });
    expect(resolveBudget(input({ auto: "handheld" }))).toMatchObject({ tier: "handheld", light: false, profile: "handheld", fps: 60, idle: true });
    expect(resolveBudget(input({ auto: "lite", deck: true }))).toMatchObject({ tier: "lite", light: true, profile: "deck", dpr: 1, fps: 60, textures: 0.7 });
    expect(resolveBudget(input({ auto: "full", onBattery: true }))).toMatchObject({ tier: "full", profile: "battery", fps: 30 });
  });
  it("les positions du réglage", () => {
    expect(resolveBudget(input({ preset: "quality", auto: "lite" }))).toMatchObject({ tier: "full", light: false, profile: "quality", fps: null });
    expect(resolveBudget(input({ preset: "balanced", auto: "full" }))).toMatchObject({ tier: "handheld", light: false, fps: 60, idle: true });
    expect(resolveBudget(input({ preset: "light", auto: "full" }))).toMatchObject({ tier: "lite", light: true, profile: "deck", fps: 60 });
    expect(resolveBudget(input({ preset: "battery", auto: "handheld" }))).toMatchObject({ tier: "lite", light: true, profile: "battery", fps: 30 });
    // Allégé et Économie ne remontent pas une puce modeste
    expect(resolveBudget(input({ preset: "light", auto: "minimal" })).tier).toBe("minimal");
  });
  it("console Android : définition par lignes, mémoire comptée", () => {
    const screen = { cssHeight: 400, dpr: 2.6, refresh: 120 };
    const b = resolveBudget(input({ auto: "lite", screen, memoryMb: 3000 }));
    expect(b.dpr).toBe(2.25);
    expect(b.keep).toBe(4);
  });
  it("reprend les anciens réglages tant que le nouveau n'est pas choisi", () => {
    expect(presetOf({})).toBe("auto");
    expect(presetOf({ performanceMode: "on" })).toBe("light");
    expect(presetOf({ performanceMode: "off" })).toBe("quality");
    expect(presetOf({ graphicsProfile: "battery", performanceMode: "off" })).toBe("battery");
    expect(presetOf({ graphicsProfile: "deck" })).toBe("light");
    expect(presetOf({ perfPreset: "balanced", performanceMode: "on" })).toBe("balanced");
  });
});
