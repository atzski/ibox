import { describe, expect, it } from "vitest";
import { graphicsFor, resolveProfile } from "./graphics";

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
    expect(graphicsFor("quality")).toEqual({ profile: "quality", dpr: [1, 1.5], fps: null, idle: false });
    expect(graphicsFor("deck")).toEqual({ profile: "deck", dpr: 1, fps: 60, idle: false });
    expect(graphicsFor("battery")).toEqual({ profile: "battery", dpr: 1, fps: 30, idle: false });
  });
  it("mode performance : définition de l'écran et rendu à la demande, sauf choix explicite", () => {
    // petite machine qui n'est pas un Steam Deck : même profil que lui
    expect(resolveProfile("auto", false, false, true)).toBe("deck");
    expect(resolveProfile("auto", false, true, true)).toBe("battery");
    // le profil choisi à la main reste respecté, seule la mise au repos s'ajoute
    expect(resolveProfile("quality", false, false, true)).toBe("quality");
    expect(graphicsFor("quality", true)).toEqual({ profile: "quality", dpr: [1, 1.5], fps: null, idle: true });
    expect(graphicsFor("deck", true)).toEqual({ profile: "deck", dpr: 1, fps: 60, idle: true });
  });
});
