import { describe, expect, it } from "vitest";
import { fileNameOf, folderOf, nextPending, orderCandidates, preselected, sameFolder, type PendingIso } from "./isoQueue";

const iso = (path: string, guess: string | null = null): PendingIso => ({
  path, folderId: 1, size: 1, title: fileNameOf(path).replace(/\.iso$/i, ""), region: null, guess, guessSource: guess ? "folder" : null,
});

describe("fichiers .iso en attente", () => {
  const a = iso("D:\\Jeux\\Vrac\\Okami.iso");
  const b = iso("D:\\Jeux\\Vrac\\Ico.iso");
  const c = iso("D:/Jeux/vrac/Jak.iso");
  const d = iso("D:\\Jeux\\PS2\\Rez.iso", "ps2");

  it("sépare le nom du fichier de son dossier, quel que soit le séparateur", () => {
    expect(fileNameOf(a.path)).toBe("Okami.iso");
    expect(folderOf(a.path)).toBe("D:\\Jeux\\Vrac");
    expect(folderOf(c.path)).toBe("D:/Jeux/vrac");
    expect(folderOf("Okami.iso")).toBe("");
  });

  it("réunit les fichiers d'un même dossier sans tenir compte de la casse ni des séparateurs", () => {
    expect(sameFolder([a, b, c, d], a)).toEqual([b, c]);
    expect(sameFolder([a, b, c, d], d)).toEqual([]);
  });

  it("présente le premier fichier qui n'a pas été remis à plus tard", () => {
    expect(nextPending([a, b, d], new Set())).toBe(a);
    expect(nextPending([a, b, d], new Set([a.path, b.path]))).toBe(d);
    expect(nextPending([a], new Set([a.path]))).toBeUndefined();
    expect(nextPending([], new Set())).toBeUndefined();
  });

  it("propose les consoles dans l'ordre du registre", () => {
    expect(orderCandidates(["gamecube", "ps1", "ps2", "wii", "inconnue"], ["wii", "gamecube", "ds", "ps2", "ps1"])).toEqual(["wii", "gamecube", "ps2", "ps1"]);
  });

  it("ne présélectionne qu'une console proposée", () => {
    expect(preselected(d, ["ps1", "ps2"])).toBe("ps2");
    expect(preselected(d, ["gamecube"])).toBeNull();
    expect(preselected(a, ["ps2"])).toBeNull();
  });
});
