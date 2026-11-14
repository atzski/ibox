import { describe, expect, it } from "vitest";
import { nearestAngle, pickNext, type Rect } from "./spatial";

const r = (x: number, y: number, w = 100, h = 100): Rect => ({ x, y, w, h });

describe("pickNext", () => {
  // Grille 3 × 2 :  A B C
  //                 D E F
  const grid = [r(0, 0), r(120, 0), r(240, 0), r(0, 120), r(120, 120), r(240, 120)];
  const [A, B, C, D, E, F] = grid;
  const pick = (from: Rect, dir: Parameters<typeof pickNext>[2]) => {
    const others = grid.filter((g) => g !== from);
    const i = pickNext(from, others, dir);
    return i < 0 ? null : others[i];
  };

  it("se déplace vers le voisin direct", () => {
    expect(pick(A, "right")).toBe(B);
    expect(pick(B, "left")).toBe(A);
    expect(pick(B, "down")).toBe(E);
    expect(pick(E, "up")).toBe(B);
  });

  it("ne trouve rien au bord", () => {
    expect(pick(A, "left")).toBeNull();
    expect(pick(A, "up")).toBeNull();
    expect(pick(F, "right")).toBeNull();
  });

  it("préfère l'élément aligné à l'élément plus proche mais décalé", () => {
    expect(pick(C, "down")).toBe(F);
    expect(pick(D, "right")).toBe(E);
  });

  it("descend d'un grand bloc vers l'élément le plus centré en dessous", () => {
    const hero = r(0, 0, 600, 200);
    const row = [r(0, 260, 150, 120), r(170, 260, 150, 120), r(340, 260, 150, 120)];
    const i = pickNext(hero, row, "down");
    expect(row[i]).toBe(row[1]);
  });

  it("ignore les voisins de rangée quand l'élément focalisé est agrandi", () => {
    // carte focalisée agrandie (scale 1.04, centre remonté de 4 px)
    const focused = r(330, 691, 312, 260);
    const row = [r(0, 707, 300, 243), r(660, 707, 300, 243)];
    const below = r(100, 1100, 230, 160);
    const i = pickNext(focused, [...row, below], "down");
    expect(i).toBe(2);
  });

  it("ne saute pas une ligne de réglage dont la commande est alignée à droite", () => {
    // carte de palette à gauche ; en dessous, un réglage (commande à droite), puis une grille
    const card = r(380, 430, 230, 160);
    const control = r(1440, 720, 390, 44);
    const grid = r(380, 1000, 140, 120);
    expect(pickNext(card, [grid, control], "down")).toBe(1);
    expect(pickNext(control, [card, grid], "up")).toBe(0);
  });
});

describe("nearestAngle", () => {
  it("choisit le chemin le plus court", () => {
    expect(nearestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(nearestAngle(4 * Math.PI, 0)).toBeCloseTo(4 * Math.PI);
    expect(nearestAngle(2 * Math.PI - 0.1, 0)).toBeCloseTo(2 * Math.PI);
    expect(nearestAngle(0.1, Math.PI * 1.9)).toBeCloseTo(-Math.PI * 0.1);
  });
});
