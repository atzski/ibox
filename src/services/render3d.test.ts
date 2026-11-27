import { describe, expect, it } from "vitest";
import { resolveThreeD } from "./render3d";
import { wantedRefresh } from "./androidDevice";
import { flatGrid, flatMove } from "@/domain/flatGrid";

describe("mode sans 3D", () => {
  const ok = { available: true, renderer: "Adreno (TM) 740" };
  it("WebGL absent : toujours en 2D, même si la 3D est demandée", () => {
    expect(resolveThreeD("on", { available: false, renderer: null }, false, "handheld")).toEqual({ enabled: false, reason: "missing" });
  });
  it("automatique : 2D sur rendu logiciel et au palier minimal", () => {
    expect(resolveThreeD("auto", ok, false, "handheld").enabled).toBe(true);
    expect(resolveThreeD(undefined, ok, false, "low").enabled).toBe(true);
    expect(resolveThreeD("auto", ok, false, "minimal")).toEqual({ enabled: false, reason: "tier" });
    expect(resolveThreeD("auto", { available: true, renderer: "Google SwiftShader" }, false, "full")).toEqual({ enabled: false, reason: "software" });
  });
  it("le choix de l'utilisateur l'emporte, sauf contexte perdu deux fois", () => {
    expect(resolveThreeD("on", ok, false, "minimal").enabled).toBe(true);
    expect(resolveThreeD("off", ok, false, "full")).toEqual({ enabled: false, reason: "choice" });
    expect(resolveThreeD("on", ok, true, "full")).toEqual({ enabled: false, reason: "lost" });
  });
});

describe("grille de jaquettes", () => {
  it("colonnes et cases d'après la largeur", () => {
    const g = flatGrid(1000, 16, 25, 0.7);
    expect(g.cols).toBe(6);
    expect(g.rows).toBe(5);
    expect(g.cellW * g.cols + g.gap * (g.cols - 1)).toBeCloseTo(1000, 5);
    // au moins deux colonnes sur un écran étroit
    expect(flatGrid(120, 16, 3, 0.7).cols).toBe(2);
  });
  it("déplacements : bords haut et bas rendus à l'appelant (changer de console)", () => {
    expect(flatMove(0, "ArrowUp", 6, 25)).toBeNull();
    expect(flatMove(7, "ArrowUp", 6, 25)).toBe(1);
    expect(flatMove(20, "ArrowDown", 6, 25)).toBe(24);
    expect(flatMove(24, "ArrowDown", 6, 25)).toBeNull();
    expect(flatMove(0, "ArrowLeft", 6, 25)).toBe(0);
    expect(flatMove(24, "ArrowRight", 6, 25)).toBe(24);
    expect(flatMove(3, "PageDown", 6, 25, 2)).toBe(15);
    expect(flatMove(10, "End", 6, 25)).toBe(24);
  });
});

describe("fréquence d'affichage", () => {
  it("la plus haute au palier fort, 60 Hz ailleurs", () => {
    expect(wantedRefresh([60, 90, 120], true)).toBe(120);
    expect(wantedRefresh([60, 90, 120], false)).toBe(60);
    expect(wantedRefresh([60, 144], true)).toBe(60);
    expect(wantedRefresh([], true)).toBe(0);
  });
});
