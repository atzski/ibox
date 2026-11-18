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
    expect(graphicsFor("quality")).toEqual({ profile: "quality", dpr: [1, 1.5], fps: null });
    expect(graphicsFor("deck")).toEqual({ profile: "deck", dpr: 1, fps: 60 });
    expect(graphicsFor("battery")).toEqual({ profile: "battery", dpr: 1, fps: 30 });
  });
});
