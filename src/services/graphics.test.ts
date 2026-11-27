import { describe, expect, it } from "vitest";
import { androidDpr, graphicsFor, keepFor, resolveProfile } from "./graphics";

describe("consoles Android", () => {
  // 731×411 points à densité 2,625 (1080p de 6 pouces), le cas le plus courant
  const phone = { cssHeight: 411, dpr: 2.625, refresh: 60 };
  it("définition de rendu par budget de lignes, jamais sous 1 ni au-delà de l'écran", () => {
    expect(graphicsFor("handheld", "handheld", phone).dpr).toBe(2.63);
    expect(graphicsFor("deck", "lite", phone).dpr).toBe(2.19);
    expect(graphicsFor("deck", "low", phone).dpr).toBe(1.75);
    expect(graphicsFor("deck", "minimal", phone).dpr).toBe(1.31);
    expect(graphicsFor("battery", "lite", phone).dpr).toBe(1.31);
    // écran peu dense (960×540 à densité 2) : le palier fort reste à la définition native
    expect(graphicsFor("handheld", "handheld", { cssHeight: 540, dpr: 2, refresh: 60 }).dpr).toBe(2);
    expect(graphicsFor("deck", "minimal", { cssHeight: 800, dpr: 1, refresh: 60 }).dpr).toBe(1);
  });
  it("rythme : écran rapide au palier fort, 30 im/s aux paliers modestes", () => {
    expect(graphicsFor("handheld", "handheld", { ...phone, refresh: 120 }).fps).toBe(120);
    expect(graphicsFor("handheld", "handheld", phone).fps).toBe(60);
    expect(graphicsFor("deck", "lite", phone).fps).toBe(60);
    expect(graphicsFor("deck", "low", phone).fps).toBe(30);
    expect(graphicsFor("battery", "handheld", { ...phone, refresh: 120 }).fps).toBe(30);
  });
  it("textures et boîtiers gardés selon le palier et la mémoire", () => {
    expect(graphicsFor("deck", "low", phone)).toMatchObject({ textures: 0.55, keep: 6, shadowMap: 512 });
    expect(graphicsFor("deck", "minimal", phone)).toMatchObject({ textures: 0.5, keep: 4 });
    expect(keepFor(32, 11_700)).toBe(32);
    expect(keepFor(32, 7_800)).toBe(32);
    expect(keepFor(32, 5_700)).toBe(12);
    expect(keepFor(32, 3_800)).toBe(6);
    expect(keepFor(12, 2_800)).toBe(4);
    expect(keepFor(12, undefined)).toBe(12);
  });
  it("le PC et le Steam Deck gardent leurs réglages", () => {
    expect(graphicsFor("deck", "lite")).toMatchObject({ dpr: 1, fps: 60 });
    expect(graphicsFor("quality", "full")).toMatchObject({ dpr: [1, 1.5], fps: null });
    expect(androidDpr(900, { cssHeight: 0, dpr: 2, refresh: 60 })).toBe(2);
  });
});

describe("profils graphiques", () => {
  it("choisit tout seul selon l'appareil et l'alimentation", () => {
    expect(resolveProfile("auto", false, false)).toBe("quality");
    expect(resolveProfile("auto", true, false)).toBe("deck");
    expect(resolveProfile("auto", true, true)).toBe("battery");
    expect(resolveProfile("auto", false, true)).toBe("battery");
    // un choix explicite l'emporte
    expect(resolveProfile("quality", true, true)).toBe("quality");
  });
  it("garde l'étagère, change seulement définition et rythme", () => {
    const full = { idle: false, textures: 1, inspectTextures: 1.6, shadowMap: 2048, keep: 32, antialias: true };
    expect(graphicsFor("quality")).toEqual({ profile: "quality", dpr: [1, 1.5], fps: null, ...full });
    expect(graphicsFor("deck")).toEqual({ profile: "deck", dpr: 1, fps: 60, ...full });
    expect(graphicsFor("battery")).toEqual({ profile: "battery", dpr: 1, fps: 30, ...full });
  });
  it("mode performance : définition de l'écran et rendu à la demande, sauf choix explicite", () => {
    // petite machine qui n'est pas un Steam Deck : même profil que lui
    expect(resolveProfile("auto", false, false, true)).toBe("deck");
    expect(resolveProfile("auto", false, true, true)).toBe("battery");
    // le profil choisi à la main reste respecté, seule la mise au repos s'ajoute
    expect(resolveProfile("quality", false, false, true)).toBe("quality");
    const lite = { idle: true, textures: 0.7, inspectTextures: 1.1, shadowMap: 1024, keep: 12, antialias: false };
    expect(graphicsFor("quality", "lite")).toEqual({ profile: "quality", dpr: [1, 1.5], fps: null, ...lite });
    expect(graphicsFor("deck", "lite")).toEqual({ profile: "deck", dpr: 1, fps: 60, ...lite });
  });
  it("console portable puissante : rendu affiné, 60 im/s, au repos quand rien ne bouge", () => {
    expect(resolveProfile("auto", false, false, false, true)).toBe("handheld");
    expect(resolveProfile("auto", false, true, false, true)).toBe("battery");
    expect(graphicsFor("handheld", "handheld")).toEqual({ profile: "handheld", dpr: [1, 1.5], fps: 60, idle: true, textures: 1, inspectTextures: 1.6, shadowMap: 2048, keep: 32, antialias: true });
  });
});
