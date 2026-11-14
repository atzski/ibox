import { describe, expect, it } from "vitest";
import { isFavorite, rowToGame } from "./library";
import { summarize } from "@/components/library/ScanStatus";
import type { GameRowDto, ScanSummary } from "./nativeLibrary";

const row: GameRowDto = {
  id: 7,
  platformId: "gamecube",
  title: "The Legend of Zelda",
  serial: "GZLP01",
  region: "PAL",
  year: null,
  publisher: null,
  developer: null,
  genre: null,
  players: null,
  description: null,
  favorite: true,
  addedAt: "2026-11-12T10:00:00Z",
  lastPlayedAt: null,
  idMethod: "folder",
  idConfidence: 0.3,
  alternatives: ["wii", "ps2"],
  userLocked: false,
  filePath: "D:/GC/Zelda.iso",
  fileSize: 1459978240,
  status: "missing",
  duplicate: false,
  discCount: 0,
  folderId: 1,
  media: [],
  mediaStatus: null,
  metaSource: null,
  emulatorId: null,
  playCount: 0,
  playSeconds: 0,
  pcInstalls: [],
};

describe("rowToGame", () => {
  it("convertit une ligne SQLite en jeu affichable", () => {
    const g = rowToGame(row);
    expect(g.id).toBe("lib-7");
    expect(g.dbId).toBe(7);
    expect(g.sortTitle).toBe("legend of zelda");
    expect(g.missing).toBe(true);
    expect(g.needsReview).toBe(true);
    expect(g.year).toBeUndefined();
    expect(g.art.motif).toBe("placeholder");
    expect(g.art.palette[1]).toBe("#B9A6E8");
  });
});

describe("isFavorite", () => {
  it("lit la base pour les vrais jeux et les réglages pour la démo", () => {
    expect(isFavorite(rowToGame(row), [])).toBe(true);
    expect(isFavorite(rowToGame({ ...row, favorite: false }), ["lib-7"])).toBe(false);
    const demo = { ...rowToGame(row), dbId: undefined, id: "demo-x" };
    expect(isFavorite(demo, ["demo-x"])).toBe(true);
  });
});

describe("summarize", () => {
  const base: ScanSummary = {
    folders: 1, files: 3, added: 0, updated: 0, unchanged: 3, moved: 0, missing: 0,
    reappeared: 0, duplicates: 0, needsReview: 0, errors: [],
  };
  it("résume en français, au singulier comme au pluriel", () => {
    expect(summarize(base)).toBe("Aucun changement");
    expect(summarize({ ...base, added: 12, moved: 1, missing: 2 })).toBe("12 ajoutés · 1 déplacé · 2 introuvables");
  });
});
