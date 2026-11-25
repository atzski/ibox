import { describe, expect, it } from "vitest";
import { compareGames, groupVariants, isFavorite, rowToGame } from "./library";
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
  variantOf: null,
};

describe("groupVariants", () => {
  it("range les versions sous leur fiche principale et cumule le temps de jeu", () => {
    const main = rowToGame({ ...row, id: 1, playSeconds: 60, lastPlayedAt: "2026-11-01T10:00:00Z" });
    const usa = rowToGame({ ...row, id: 2, variantOf: 1, playSeconds: 30, lastPlayedAt: "2026-11-10T10:00:00Z", duplicate: true });
    const solo = rowToGame({ ...row, id: 3 });
    const out = groupVariants([main, usa, solo]);
    expect(out.map((g) => g.dbId)).toEqual([1, 3]);
    expect(out[0].variants?.map((g) => g.dbId)).toEqual([2]);
    expect(out[0].playSeconds).toBe(90);
    expect(out[0].lastPlayedAt).toBe("2026-11-10T10:00:00Z");
  });
  it("garde une version dont la fiche principale a disparu", () => {
    const orphan = rowToGame({ ...row, id: 2, variantOf: 99 });
    expect(groupVariants([orphan]).map((g) => g.dbId)).toEqual([2]);
  });
});

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

describe("compareGames", () => {
  const game = (id: number, title: string, addedAt: string, lastPlayedAt: string | null) => rowToGame({ ...row, id, title, addedAt, lastPlayedAt });
  const games = [
    game(1, "Zelda", "2026-01-01T00:00:00Z", "2026-11-10T20:00:00Z"),
    game(2, "The Animal Crossing", "2026-03-01T00:00:00Z", null),
    game(3, "Mario", "2026-02-01T00:00:00Z", "2026-11-12T20:00:00Z"),
    game(4, "Luigi", "2026-02-01T00:00:00Z", null),
  ];
  const order = (sort: Parameters<typeof compareGames>[0]) => [...games].sort(compareGames(sort)).map((g) => g.title);

  it("trie de A à Z sans tenir compte de l'article", () => {
    expect(order("alpha")).toEqual(["The Animal Crossing", "Luigi", "Mario", "Zelda"]);
  });

  it("met les derniers ajouts d'abord, de A à Z à date égale", () => {
    expect(order("added")).toEqual(["The Animal Crossing", "Luigi", "Mario", "Zelda"]);
    expect(order("added").slice(1, 3)).toEqual(["Luigi", "Mario"]);
  });

  it("met la dernière partie d'abord, puis les jeux jamais lancés de A à Z", () => {
    expect(order("played")).toEqual(["Mario", "Zelda", "The Animal Crossing", "Luigi"]);
  });
});

describe("summarize", () => {
  const base: ScanSummary = {
    folders: 1, files: 3, added: 0, updated: 0, unchanged: 3, moved: 0, missing: 0,
    reappeared: 0, duplicates: 0, needsReview: 0, isoNew: 0, errors: [],
  };
  it("résume en français, au singulier comme au pluriel", () => {
    expect(summarize(base)).toBe("Aucun changement");
    expect(summarize({ ...base, added: 12, moved: 1, missing: 2 })).toBe("12 ajoutés · 1 déplacé · 2 introuvables");
    expect(summarize({ ...base, added: 1, isoNew: 3 })).toBe("1 ajouté · 3 .iso à classer");
  });
});
