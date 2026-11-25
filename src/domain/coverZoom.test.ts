import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  ZOOM_LEVELS,
  anchoredScroll,
  cellRect,
  clampZoom,
  columnsFor,
  computeLayout,
  coverRect,
  indexAt,
  maxScroll,
  metaHeight,
  moveIndex,
  pageIndex,
  pickAnchor,
  revealScroll,
  rowRange,
  stepZoom,
  thumbWidth,
  zoomTransition,
  type GridLayout,
  type GridTransform,
} from "./coverZoom";

const DVD = 136 / 191;
const same = (n: number, aspect = DVD) => new Array<number>(n).fill(aspect);
/** Fenêtre 1600 × 900 de l'aperçu : rem de 16,92 px, zone de défilement de 1489 px. */
const desk = (level: number, count = 1200, aspects = same(count)) =>
  computeLayout({ width: 1489, rem: 16.92, cardRem: 11.5, level, aspects });

describe("niveaux de recul", () => {
  it("borne et arrondit le niveau enregistré", () => {
    expect(clampZoom(undefined)).toBe(0);
    expect(clampZoom("2")).toBe(0);
    expect(clampZoom(NaN)).toBe(0);
    expect(clampZoom(-3)).toBe(0);
    expect(clampZoom(2.4)).toBe(2);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });

  it("recule et avance sans dépasser les extrémités", () => {
    expect(stepZoom(0, -1)).toBe(0);
    expect(stepZoom(0, 1)).toBe(1);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MAX_ZOOM, -1)).toBe(MAX_ZOOM - 1);
  });

  it("chaque niveau est plus petit et plus serré que le précédent", () => {
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      expect(ZOOM_LEVELS[i].scale).toBeLessThan(ZOOM_LEVELS[i - 1].scale);
      expect(ZOOM_LEVELS[i].gapX).toBeLessThan(ZOOM_LEVELS[i - 1].gapX);
    }
    expect(ZOOM_LEVELS[0]).toMatchObject({ scale: 1, gapX: 1.5, gapY: 1.75, detail: "full" });
  });

  it("le texte disparaît aux niveaux reculés", () => {
    expect(metaHeight("full")).toBeCloseTo(3.48);
    expect(metaHeight("full", true)).toBeCloseTo(3.625);
    expect(metaHeight("title")).toBeGreaterThan(0);
    expect(metaHeight("cover")).toBe(0);
    expect(metaHeight("bare")).toBe(0);
  });
});

describe("colonnes", () => {
  it("suit la règle du CSS auto-fill", () => {
    expect(columnsFor(1000, 200, 20)).toBe(4); // 4 × 200 + 3 × 20 = 860 ; la cinquième ne tient pas
    expect(columnsFor(1080, 200, 20)).toBe(5); // 5 × 200 + 4 × 20 = 1080 : tient tout juste
    expect(columnsFor(1079, 200, 20)).toBe(4);
    expect(columnsFor(50, 200, 20)).toBe(1);
    expect(columnsFor(0, 200, 20)).toBe(1);
  });

  it("le niveau 0 retrouve la grille d'origine (6 colonnes de 222,7 px à 1600 × 900)", () => {
    // première rangée de l'aperçu : des boîtiers GameCube et un boîtier PS2, un peu plus haut
    const l = desk(0, 1200, [DVD, DVD, DVD, 135 / 190, ...same(1196)]);
    expect(l.cols).toBe(6);
    expect(l.cellW).toBeCloseTo(222.7, 0);
    // carte entière : jaquette + titre + infos = 372,3 px mesurés avant la virtualisation
    expect(l.rowH[0]).toBeCloseTo(372.3, 0);
    expect(l.rowTop[1] - l.rowTop[0] - l.rowH[0]).toBeCloseTo(1.75 * 16.92);
  });

  it("chaque niveau montre plus de colonnes, jusqu'à des centaines de jaquettes à l'écran", () => {
    const cols = ZOOM_LEVELS.map((_, level) => desk(level).cols);
    expect(cols).toEqual([6, 9, 13, 20, 31]);
    const dense = desk(MAX_ZOOM);
    const perScreen = dense.cols * Math.floor(800 / (dense.rowH[0] + dense.gapY));
    expect(perScreen).toBeGreaterThan(300);
  });

  it("reste dense sur un Steam Deck (1280 × 800)", () => {
    const l = computeLayout({ width: 1176, rem: 14.94, cardRem: 11.5, level: MAX_ZOOM, aspects: same(1000) });
    expect(l.cols).toBeGreaterThanOrEqual(26);
    expect(l.cellW).toBeGreaterThan(30);
  });

  it("tient compte de la densité des Paramètres et de la largeur de carte de la console", () => {
    expect(computeLayout({ width: 1489, rem: 16.92, cardRem: 11.5 * 0.8, level: 0, aspects: same(10) }).cols).toBe(8);
    expect(computeLayout({ width: 1489, rem: 16.92, cardRem: 16, level: 0, aspects: same(10, 1.38) }).cols).toBe(5);
  });
});

describe("disposition", () => {
  it("une rangée prend la hauteur de sa jaquette la plus haute", () => {
    const aspects = [DVD, 1.38, 1.38, 1.38, 1.38, 1.38, 1.38, 1.38];
    const l = computeLayout({ width: 1489, rem: 16.92, cardRem: 11.5, level: 0, aspects });
    expect(l.cols).toBe(6);
    expect(l.rowH[0] - l.metaH).toBeCloseTo(l.cellW / DVD);
    expect(l.rowH[1] - l.metaH).toBeCloseTo(l.cellW / 1.38);
  });

  it("compte les rangées et la hauteur totale", () => {
    const l = desk(2, 100);
    expect(l.rows).toBe(Math.ceil(100 / l.cols));
    expect(l.rowTop).toHaveLength(l.rows + 1);
    const last = l.rows - 1;
    expect(l.height).toBeCloseTo(l.rowTop[last] + l.rowH[last] + 2 * 16.92);
    expect(desk(2, 0).rows).toBe(0);
    expect(desk(2, 0).height).toBeGreaterThan(0);
  });

  it("place chaque case", () => {
    const l = desk(1);
    const r = cellRect(l, l.cols + 2);
    expect(r.x).toBeCloseTo(l.padX + 2 * (l.cellW + l.gapX));
    expect(r.y).toBeCloseTo(l.rowTop[1]);
    expect(r.w).toBe(l.cellW);
  });

  it("pose la jaquette en haut de sa rangée, ou la centre quand il n'y a plus de texte", () => {
    const aspects = [0.6, 1.38, 0.6, 1.38];
    const withText = computeLayout({ width: 1489, rem: 16.92, cardRem: 11.5, level: 0, aspects });
    expect(coverRect(withText, 1).y).toBe(cellRect(withText, 1).y);
    expect(coverRect(withText, 1).h).toBeCloseTo(withText.cellW / 1.38);
    const bare = computeLayout({ width: 1489, rem: 16.92, cardRem: 11.5, level: MAX_ZOOM, aspects });
    const row = cellRect(bare, 1);
    const wide = coverRect(bare, 1);
    expect(wide.y + wide.h / 2).toBeCloseTo(row.y + row.h / 2);
    expect(coverRect(bare, 0).y).toBeCloseTo(row.y); // la plus haute remplit la rangée
  });

  it("ne garde que les rangées visibles", () => {
    const l = desk(MAX_ZOOM);
    expect(rowRange(l, 0, 800)[0]).toBe(0);
    const [first, last] = rowRange(l, 1000, 1800);
    expect(l.rowTop[first]).toBeLessThanOrEqual(1000);
    expect(l.rowTop[first] + l.rowH[first] + l.gapY).toBeGreaterThan(1000);
    expect(l.rowTop[last]).toBeLessThanOrEqual(1800);
    expect(last - first).toBeLessThan(16);
    // au-delà de la fin : la dernière rangée, jamais hors bornes
    expect(rowRange(l, 1e9, 1e9 + 800)).toEqual([l.rows - 1, l.rows - 1]);
    expect(rowRange(desk(0, 0), 0, 800)).toEqual([0, -1]);
  });

  it("retrouve le jeu sous un point", () => {
    const l = desk(3);
    for (const i of [0, 7, l.cols, 3 * l.cols + 5, l.count - 1]) {
      const r = cellRect(l, i);
      expect(indexAt(l, r.x + r.w / 2, r.y + r.h / 2)).toBe(i);
    }
    expect(indexAt(l, -50, -50)).toBe(0);
    expect(indexAt(l, 1e6, 1e9)).toBe(l.count - 1);
    expect(indexAt(desk(3, 0), 10, 10)).toBe(-1);
  });
});

describe("conservation de la position", () => {
  const H = 640;

  it("le jeu repère reste à la même hauteur d'un niveau à l'autre", () => {
    for (let from = 0; from <= MAX_ZOOM; from++) {
      for (let to = 0; to <= MAX_ZOOM; to++) {
        const before = desk(from);
        const index = 600;
        const b = cellRect(before, index);
        const scrollBefore = b.y - 200;
        const viewportY = b.y + b.h / 2 - scrollBefore;
        const after = desk(to);
        const scrollAfter = anchoredScroll(after, index, viewportY, H);
        const a = cellRect(after, index);
        expect(a.y + a.h / 2 - scrollAfter).toBeCloseTo(viewportY);
      }
    }
  });

  it("se borne au début et à la fin de la liste", () => {
    const l = desk(MAX_ZOOM);
    expect(anchoredScroll(l, 0, 500, H)).toBe(0);
    expect(anchoredScroll(l, l.count - 1, 10, H)).toBe(maxScroll(l, H));
    expect(anchoredScroll(desk(0, 3), 1, 100, H)).toBe(0); // tout tient à l'écran
  });

  it("prend le jeu sélectionné s'il est à l'écran, sinon le centre de la vue", () => {
    const l = desk(1);
    const top = l.rowTop[10];
    const focused = 10 * l.cols + 1;
    expect(pickAnchor(l, top, H, focused)).toBe(focused);
    // sélection restée loin au-dessus : on garde ce que l'utilisateur regarde
    const center = pickAnchor(l, top, H, 0);
    const r = cellRect(l, center);
    expect(r.y).toBeLessThanOrEqual(top + H / 2);
    expect(r.y + r.h + l.gapY).toBeGreaterThan(top + H / 2);
    expect(pickAnchor(l, top, H)).toBe(center);
    expect(pickAnchor(desk(1, 0), 0, H)).toBe(-1);
  });

  it("fait défiler juste assez pour montrer un jeu", () => {
    const l = desk(0);
    const r = cellRect(l, 3 * l.cols);
    expect(revealScroll(l, 3 * l.cols, r.y - 50, H, 12)).toBe(r.y - 50); // déjà visible
    expect(revealScroll(l, 3 * l.cols, r.y + 100, H, 12)).toBeCloseTo(r.y - 12); // au-dessus
    expect(revealScroll(l, 3 * l.cols, 0, H, 12)).toBeCloseTo(r.y + r.h + 12 - H); // en dessous
    expect(revealScroll(l, 0, 300, H, 12)).toBeCloseTo(Math.max(0, cellRect(l, 0).y - 12));
  });
});

describe("animation du changement de niveau", () => {
  const H = 640;
  /** Rectangle vu à l'écran d'un jeu : contenu transformé, puis défilement. */
  const seen = (l: GridLayout, index: number, t: GridTransform, scrollTop: number) => {
    const r = coverRect(l, index);
    return {
      x: t.originX + (r.x + r.w / 2 - t.originX) * t.scale + t.x,
      y: t.originY + (r.y + r.h / 2 - t.originY) * t.scale + t.y - scrollTop,
      w: r.w * t.scale,
    };
  };
  const still: GridTransform = { x: 0, y: 0, scale: 1, originX: 0, originY: 0 };

  it("le jeu repère part exactement de là où on le voyait, à sa taille d'avant", () => {
    for (const [from, to] of [[0, 1], [1, 2], [2, 3], [3, 4], [4, 3], [1, 0], [4, 0]]) {
      const prev = desk(from);
      const next = desk(to);
      const focus = 613;
      const scrollTop = cellRect(prev, focus).y - 150;
      const before = seen(prev, focus, still, scrollTop);
      const t = zoomTransition(prev, next, { scrollTop, viewportH: H, focusIndex: focus })!;
      expect(t.index).toBe(focus);
      const start = seen(next, focus, t.from, t.scrollTop);
      expect(start.x).toBeCloseTo(before.x);
      expect(start.y).toBeCloseTo(before.y);
      expect(start.w).toBeCloseTo(before.w);
      // au repos, il n'a pas bougé en hauteur (loin des extrémités)
      expect(seen(next, focus, still, t.scrollTop).y).toBeCloseTo(before.y);
    }
  });

  it("en butée (début de liste), l'animation rattrape l'écart au lieu de sauter", () => {
    const prev = desk(0);
    const next = desk(MAX_ZOOM);
    const scrollTop = prev.rowTop[1] - 40;
    const before = seen(prev, prev.cols, still, scrollTop);
    const t = zoomTransition(prev, next, { scrollTop, viewportH: H, focusIndex: prev.cols })!;
    expect(t.scrollTop).toBe(0);
    expect(t.from.y).not.toBeCloseTo(0);
    expect(seen(next, prev.cols, t.from, 0).y).toBeCloseTo(before.y);
  });

  it("reprend une animation en cours sans à-coup", () => {
    const a = desk(1);
    const b = desk(2);
    const c = desk(3);
    const scrollTop = cellRect(a, 500).y - 300;
    const first = zoomTransition(a, b, { scrollTop, viewportH: H, focusIndex: 500 })!;
    // interrompue à mi-course
    const mid: GridTransform = { ...first.from, x: first.from.x / 2, y: first.from.y / 2, scale: (first.from.scale + 1) / 2 };
    const before = seen(b, 500, mid, first.scrollTop);
    const second = zoomTransition(b, c, { scrollTop: first.scrollTop, viewportH: H, focusIndex: 500, current: mid })!;
    const start = seen(c, 500, second.from, second.scrollTop);
    expect(start.x).toBeCloseTo(before.x);
    expect(start.y).toBeCloseTo(before.y);
    expect(start.w).toBeCloseTo(before.w);
  });

  it("suit le jeu sous le pointeur (Ctrl + molette), sinon le centre de la vue", () => {
    const prev = desk(1);
    const next = desk(2);
    const scrollTop = prev.rowTop[30];
    const pointed = 31 * prev.cols + 2;
    expect(zoomTransition(prev, next, { scrollTop, viewportH: H, anchorIndex: pointed })!.index).toBe(pointed);
    const centered = zoomTransition(prev, next, { scrollTop, viewportH: H })!;
    expect(centered.index).toBe(pickAnchor(prev, scrollTop, H));
  });

  it("ne s'applique pas si la liste a changé en même temps", () => {
    expect(zoomTransition(desk(1, 100), desk(2, 90), { scrollTop: 0, viewportH: H })).toBeNull();
    expect(zoomTransition(desk(1, 0), desk(2, 0), { scrollTop: 0, viewportH: H })).toBeNull();
  });
});

describe("navigation dans la grille", () => {
  it("se déplace d'une case sans boucler", () => {
    // 4 colonnes, 10 jeux : 0 1 2 3 / 4 5 6 7 / 8 9
    expect(moveIndex(5, "left", 4, 10)).toBe(4);
    expect(moveIndex(4, "left", 4, 10)).toBe(4);
    expect(moveIndex(6, "right", 4, 10)).toBe(7);
    expect(moveIndex(7, "right", 4, 10)).toBe(7);
    expect(moveIndex(9, "right", 4, 10)).toBe(9);
    expect(moveIndex(5, "up", 4, 10)).toBe(1);
    expect(moveIndex(5, "down", 4, 10)).toBe(9);
  });

  it("quitte la grille par le haut, s'arrête en bas", () => {
    expect(moveIndex(2, "up", 4, 10)).toBeNull();
    expect(moveIndex(8, "down", 4, 10)).toBe(8);
    // dernière rangée incomplète : la colonne n'existe pas, on va sur le dernier jeu
    expect(moveIndex(7, "down", 4, 10)).toBe(9);
    expect(moveIndex(0, "down", 4, 0)).toBeNull();
  });

  it("reste juste à tous les niveaux", () => {
    for (let level = 0; level <= MAX_ZOOM; level++) {
      const l = desk(level, 1203);
      const i = 5 * l.cols + 3;
      expect(moveIndex(i, "down", l.cols, l.count)).toBe(i + l.cols);
      expect(moveIndex(i, "up", l.cols, l.count)).toBe(i - l.cols);
      expect(cellRect(l, moveIndex(i, "down", l.cols, l.count)!).x).toBeCloseTo(cellRect(l, i).x);
      expect(cellRect(l, moveIndex(i, "right", l.cols, l.count)!).y).toBeCloseTo(cellRect(l, i).y);
    }
  });

  it("saute d'une page dans la même colonne", () => {
    const l = desk(2);
    const i = 20 * l.cols + 4;
    const down = pageIndex(l, i, 1, 640);
    expect(down % l.cols).toBe(4);
    const jumped = cellRect(l, down).y - cellRect(l, i).y;
    expect(jumped).toBeGreaterThan(640 * 0.5);
    expect(jumped).toBeLessThanOrEqual(640 * 0.8);
    expect(pageIndex(l, down, -1, 640)).toBeLessThanOrEqual(i);
    // au moins une rangée, même si la page est plus petite qu'une rangée
    expect(pageIndex(desk(0), 0, 1, 100)).toBe(desk(0).cols);
    // bornes
    expect(pageIndex(l, 2, -1, 640)).toBe(2);
    expect(pageIndex(l, l.count - 1, 1, 640)).toBe(l.count - 1);
    expect(pageIndex(desk(2, 0), 0, 1, 640)).toBe(-1);
  });
});

describe("vignettes", () => {
  it("choisit une taille adaptée, ou l'image complète pour les grandes jaquettes", () => {
    expect(thumbWidth(43)).toBe(96);
    expect(thumbWidth(43, 2)).toBe(96);
    expect(thumbWidth(101)).toBe(192);
    expect(thumbWidth(154)).toBe(192);
    expect(thumbWidth(154, 1.5)).toBe(320);
    expect(thumbWidth(222)).toBe(320);
    expect(thumbWidth(222, 2)).toBe(0);
    expect(thumbWidth(400)).toBe(0);
  });
});
