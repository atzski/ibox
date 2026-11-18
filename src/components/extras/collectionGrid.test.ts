import { describe, expect, it } from "vitest";
import { anchorFor, layoutGrid, moveInGrid, occupiedCells, type GridItem } from "./collectionGrid";

const items: GridItem[] = [
  { id: 1, span: 1 },
  { id: 2, span: 1 },
  { id: 3, span: 2 },
  { id: 4, span: 2 },
  { id: 5, span: 1 },
];

describe("grille des collections", () => {
  it("range sans trou, cartes larges sur deux cases sans couper la ligne", () => {
    const at = layoutGrid(items, 5);
    expect([...at]).toEqual([[1, 0], [2, 1], [3, 2], [4, 5], [5, 4]]);
  });

  it("garde une case choisie, même avec des cases vides avant", () => {
    const at = layoutGrid([{ id: 1, span: 1, slot: 7 }, { id: 2, span: 2 }], 4);
    expect(at.get(1)).toBe(7);
    expect(at.get(2)).toBe(0);
  });

  it("replace une carte large qui ne tient plus (écran plus étroit)", () => {
    const at = layoutGrid([{ id: 1, span: 2, slot: 3 }], 4);
    expect(at.get(1)).toBe(0);
  });

  it("cale à gauche une carte large lâchée sur la dernière colonne", () => {
    expect(anchorFor(3, 2, 4)).toBe(2);
    expect(anchorFor(3, 1, 4)).toBe(3);
  });

  it("échange deux cartes, et déplace dans une case vide", () => {
    const at = layoutGrid(items, 5);
    const swapped = moveInGrid(items, 5, at, 1, 4);
    expect(swapped.get(1)).toBe(4);
    expect(swapped.get(5)).toBe(0);
    const moved = moveInGrid(items, 5, at, 2, 9);
    expect(moved.get(2)).toBe(9);
    expect(occupiedCells(items, moved).size).toBe(7);
  });

  it("une carte large posée sur deux petites les recase sans chevauchement", () => {
    const at = layoutGrid(items, 5);
    const next = moveInGrid(items, 5, at, 4, 0);
    expect(next.get(4)).toBe(0);
    const cells = items.flatMap((i) => Array.from({ length: i.span }, (_, k) => next.get(i.id)! + k));
    expect(new Set(cells).size).toBe(cells.length);
  });
});
