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

describe("pickNext, navigation à la manette 1.0.31", () => {
  it("gauche et droite restent sur la rangée : en bout de rangée, rien", () => {
    // premier jeu d'une rangée de l'accueil ; la barre du haut est plus à gauche, bien plus haut
    const firstGame = r(45, 638, 159, 224);
    const userButton = r(10, 21, 55, 38);
    const otherRow = r(-201, 71, 227, 167);
    expect(pickNext(firstGame, [userButton, otherRow], "left")).toBe(-1);
    // interrupteur d'une ligne de réglage : un bouton 600 px plus bas n'est pas « à gauche »
    const toggle = r(1147, 283, 52, 30);
    const restart = r(1080, 886, 119, 41);
    expect(pickNext(toggle, [restart], "left")).toBe(-1);
  });

  it("droite rejoint un voisin de la même rangée même plus petit", () => {
    const tile = r(45, 153, 874, 314);
    const seeGame = r(1172, 403, 55, 41);
    expect(pickNext(tile, [seeGame], "right")).toBe(0);
  });

  it("un voisin posé à côté n'est ni au-dessus ni en dessous", () => {
    // « Voir le jeu » : la grande tuile à sa gauche a son centre plus haut, sans être au-dessus
    const seeGame = r(1172, 403, 55, 41);
    const tile = r(45, 153, 874, 314);
    const search = r(1184, 90, 37, 37);
    expect(pickNext(seeGame, [tile], "up")).toBe(-1);
    expect(pickNext(seeGame, [tile, search], "up")).toBe(1);
    // dock de la fiche : « Favori », dans la colonne de gauche, à peine plus bas
    const dock = r(859, 667, 102, 45);
    const favorite = r(45, 684, 149, 41);
    expect(pickNext(dock, [favorite], "down")).toBe(-1);
  });

  it("garde les éléments contenus dans un grand bloc (dock sous le boîtier 3D)", () => {
    const viewer = r(538, 78, 698, 658);
    const dock = r(859, 667, 102, 45);
    expect(pickNext(viewer, [dock], "down")).toBe(0);
    expect(pickNext(dock, [viewer], "up")).toBe(0);
  });

  it("overlapFirst : sous une rangée, les jeux en dessous plutôt qu'un petit bouton lointain", () => {
    const consoleCard = r(45, 567, 224, 164);
    const decoration = r(1145, 791, 37, 37);
    const game = r(45, 1126, 157, 220);
    // dans un groupe (lignes de réglages) : la rangée la plus proche d'abord
    expect(pickNext(consoleCard, [decoration, game], "down")).toBe(0);
    // en quittant le groupe : ce qui est dans la colonne
    expect(pickNext(consoleCard, [decoration, game], "down", { overlapFirst: true })).toBe(1);
    // rien dans la colonne : la rangée la plus proche reste atteignable
    expect(pickNext(consoleCard, [decoration], "down", { overlapFirst: true })).toBe(0);
  });

  it("overlapFirst : le menu déplié sous son bouton passe avant une barre d'icônes à l'autre bout", () => {
    const userButton = r(45, 21, 54, 37);
    const achievements = r(1027, 90, 37, 37);
    const menuItem = r(52, 126, 224, 49);
    expect(pickNext(userButton, [achievements, menuItem], "down", { overlapFirst: true })).toBe(1);
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
