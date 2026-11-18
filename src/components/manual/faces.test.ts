import { describe, expect, it } from "vitest";
import { buildFaces, readerPageSize, spreadOf, warmupPlan } from "./faces";

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

  it("ouvre sur la couverture et garde le dos pour la fin (couverture dépliée scannée)", () => {
    const f = buildFaces([1.4, 0.7, 0.7, 0.7]);
    const label = (x: (typeof f)[number]) => (x.blank ? "-" : `${x.page}${x.half?.[0] ?? ""}`);
    expect(f.map(label)).toEqual(["1r", "2", "3", "4", "-", "1l"]);
    // le dos est sur une page de gauche
    expect((f.length - 1) % 2).toBe(1);
  });

  it("double page de gauche et de droite selon les feuilles tournées", () => {
    expect(spreadOf(0)).toEqual([-1, 0]);
    expect(spreadOf(1)).toEqual([1, 2]);
  });

  it("prépare la couverture et la première double page à la taille du lecteur", () => {
    const plan = warmupPlan([0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], 1920, 1080, 1);
    const { w } = readerPageSize(0.7, 1920, 1080);
    expect(plan[0]).toEqual({ page: 1, px: w });
    expect(plan.filter((p) => p.px === w).map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
    // deux tiers de l'écran au plus, et jamais plus que la zone libre mesurée
    expect(readerPageSize(0.7, 1920, 1080).h).toBeLessThanOrEqual(Math.round(1080 * 0.58));
    expect(readerPageSize(0.7, 1920, 1080, { w: 1800, h: 500 }).h).toBe(500 - 56);
  });
});
