import { describe, expect, it } from "vitest";
import { buildFaces, spreadOf } from "./faces";

describe("pages du carnet", () => {
  it("garde les pages en portrait entières", () => {
    const f = buildFaces([0.7, 0.7, 0.7]);
    expect(f.map((x) => x.page)).toEqual([1, 2, 3]);
    expect(f.every((x) => !x.half)).toBe(true);
  });

  it("coupe les doubles pages scannées en deux", () => {
    const f = buildFaces([0.7, 1.4, 1.4, 0.7]);
    expect(f.map((x) => `${x.page}${x.half?.[0] ?? ""}`)).toEqual(["1", "2l", "2r", "3l", "3r", "4"]);
    expect(f[1].ratio).toBeCloseTo(0.7);
  });

  it("place toujours la moitié gauche d'une double page à gauche", () => {
    const f = buildFaces([0.7, 0.7, 1.4, 0.7]);
    expect(f.map((x) => (x.blank ? "-" : `${x.page}${x.half?.[0] ?? ""}`))).toEqual(["1", "2", "-", "3l", "3r", "4"]);
    expect(f.findIndex((x) => x.half === "left") % 2).toBe(1);
  });

  it("double page de gauche et de droite selon les feuilles tournées", () => {
    expect(spreadOf(0)).toEqual([-1, 0]);
    expect(spreadOf(1)).toEqual([1, 2]);
  });
});
