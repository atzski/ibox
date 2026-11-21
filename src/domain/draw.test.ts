import { describe, expect, it } from "vitest";
import { drawPath, pickDraw } from "./draw";

describe("pickDraw", () => {
  const rows = [["a", "b", "c"], ["d", "e"]];
  const all = () => true;

  it("ne retombe jamais sur le jeu déjà choisi", () => {
    for (let n = 0; n < 50; n++) {
      const r = n / 50;
      const slot = pickDraw(rows, { row: 0, index: 1 }, all, () => r);
      expect(slot).not.toEqual({ row: 0, index: 1 });
      expect(rows[slot!.row][slot!.index]).toBeDefined();
    }
  });

  it("préfère un jeu qu'on peut lancer", () => {
    const playable = (g: string) => g === "e";
    for (const r of [0, 0.3, 0.6, 0.999]) expect(pickDraw(rows, null, playable, () => r)).toEqual({ row: 1, index: 1 });
  });

  it("tire quand même si aucun n'est jouable, et rien s'il n'y a pas d'autre jeu", () => {
    expect(pickDraw(rows, null, () => false, () => 0)).toEqual({ row: 0, index: 0 });
    expect(pickDraw([["seul"]], { row: 0, index: 0 }, all)).toBeNull();
    expect(pickDraw([], null, all)).toBeNull();
  });

  it("couvre toute la collection", () => {
    const seen = new Set<string>();
    for (let n = 0; n < 5; n++) {
      const s = pickDraw(rows, null, all, () => n / 5 + 0.01)!;
      seen.add(rows[s.row][s.index]);
    }
    expect([...seen].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("drawPath", () => {
  it("finit toujours sur le jeu tiré, sans sortir de la rangée", () => {
    for (const [from, to, length] of [[0, 40, 60], [40, 0, 60], [5, 7, 60], [0, 1, 2], [59, 58, 60], [3, 30, 31]] as const) {
      const path = drawPath(from, to, length);
      expect(path.at(-1)!.index).toBe(to);
      for (const step of path) {
        expect(step.index).toBeGreaterThanOrEqual(0);
        expect(step.index).toBeLessThan(length);
      }
    }
  });

  it("ralentit : chaque pas attend plus longtemps que le précédent", () => {
    const path = drawPath(0, 40, 60);
    expect(path.length).toBeGreaterThan(8);
    expect(path.length).toBeLessThanOrEqual(18);
    for (let i = 1; i < path.length; i++) expect(path[i].delay).toBeGreaterThan(path[i - 1].delay);
    // la fin avance place par place
    expect(Math.abs(path.at(-1)!.index - path.at(-2)!.index)).toBe(1);
  });

  it("prend de l'élan quand le jeu tiré est tout proche", () => {
    const path = drawPath(20, 22, 60);
    const travel = path.reduce((sum, step, i) => sum + Math.abs(step.index - (i ? path[i - 1].index : 20)), 0);
    expect(travel).toBeGreaterThanOrEqual(12);
    // l'élan part à l'opposé du jeu tiré, ou le dépasse : le chemin n'est pas direct
    expect(path.some((s) => s.index < 20 || s.index > 22)).toBe(true);
  });

  it("reste direct dans une petite rangée, et vide si rien ne change", () => {
    expect(drawPath(0, 1, 2).map((s) => s.index)).toEqual([1]);
    expect(drawPath(4, 4, 10)).toEqual([]);
  });

  it("ne répète pas deux fois de suite la même place", () => {
    for (const [from, to, length] of [[0, 3, 4], [2, 9, 12], [0, 40, 60]] as const) {
      const path = drawPath(from, to, length);
      for (let i = 1; i < path.length; i++) expect(path[i].index).not.toBe(path[i - 1].index);
    }
  });
});
