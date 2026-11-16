import { describe, expect, it } from "vitest";
import { matchesQuery, relativeDay, sortKey, variantKey, versionTags } from "./text";
import { PLATFORMS, platformsForExtension, getPlatform, folderHintsOf } from "./platforms";
import formats from "../../shared/platform-formats.json";
import { DEMO_GAMES } from "./demoLibrary";
import { countByPlatform, lastPlayed, recentlyAdded } from "@/services/library";

describe("sortKey", () => {
  it("ignore articles, accents et ponctuation", () => {
    expect(sortKey("The Legend of Pip")).toBe("legend of pip");
    expect(sortKey("L'Étoile filante")).toBe("etoile filante");
    expect(sortKey("  Mossback   Mountain! ")).toBe("mossback mountain");
  });
});

describe("variantKey / versionTags", () => {
  it("réunit les régions et révisions d'un même jeu", () => {
    const k = variantKey("Super Mario Galaxy (Europe) (En,Fr)");
    expect(variantKey("Super Mario Galaxy (USA)")).toBe(k);
    expect(variantKey("Super Mario Galaxy [!] (Rev 1)")).toBe(k);
    expect(variantKey("Super Mario Galaxy v1.1.iso")).toBe(k);
    expect(variantKey("Super Mario Galaxy 2 (USA)")).not.toBe(k);
  });
  it("lit les étiquettes du nom de fichier", () => {
    expect(versionTags("D:/Jeux/Zelda (Europe) (Rev 1) [!].rvz")).toBe("Europe · Rev 1");
    expect(versionTags("Zelda.iso")).toBe("");
  });
});

describe("matchesQuery", () => {
  it("accepte une requête vide", () => expect(matchesQuery("Lumen Grove", "")).toBe(true));
  it("est tolérant aux accents et à la casse", () => {
    expect(matchesQuery("Réflexion Petit Phare", "reflexion")).toBe(true);
    expect(matchesQuery("Tidepool Detectives", "DETECT pool")).toBe(true);
    expect(matchesQuery("Tidepool Detectives", "kart")).toBe(false);
  });
});

describe("relativeDay", () => {
  const now = new Date(2026, 10, 12, 15, 0);
  it("formule les écarts courants", () => {
    expect(relativeDay(new Date(2026, 10, 12, 9).toISOString(), now)).toBe("aujourd'hui");
    expect(relativeDay(new Date(2026, 10, 11, 23).toISOString(), now)).toBe("hier");
    expect(relativeDay(new Date(2026, 10, 9).toISOString(), now)).toBe("il y a 3 jours");
  });
});

describe("registre des consoles", () => {
  it("a des identifiants uniques", () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("déclare des extensions normalisées", () => {
    for (const p of PLATFORMS) {
      // le PC n'est pas une console à fichiers : ses jeux viennent des boutiques et des ajouts
      if (p.id !== "pc") expect(p.extensions.length).toBeGreaterThan(0);
      for (const e of p.extensions) expect(e).toMatch(/^\.[a-z0-9]+$/);
    }
  });

  it("couvre les consoles demandées", () => {
    for (const id of ["gamecube", "wii", "ds", "3ds", "n64", "gb", "gbc", "gba", "snes", "switch", "switch2", "pc", "ps1", "ps2", "psp"]) {
      expect(getPlatform(id), id).toBeDefined();
    }
  });

  it("est synchronisé avec la table partagée du scanner", () => {
    expect(Object.keys(formats.platforms).sort()).toEqual(PLATFORMS.map((p) => p.id).sort());
    for (const p of PLATFORMS) expect(folderHintsOf(p.id).length).toBeGreaterThan(0);
  });

  it("signale les extensions ambiguës au lieu de deviner", () => {
    const iso = platformsForExtension("ISO").map((p) => p.id);
    expect(iso).toEqual(expect.arrayContaining(["gamecube", "wii", "ps2", "psp"]));
    expect(platformsForExtension(".nds").map((p) => p.id)).toEqual(["ds"]);
    expect(platformsForExtension("gba").map((p) => p.id)).toEqual(["gba"]);
  });
});

describe("bibliothèque de démonstration", () => {
  it("contient cinq jeux GameCube marqués comme démo", () => {
    expect(DEMO_GAMES).toHaveLength(5);
    expect(DEMO_GAMES.every((g) => g.platformId === "gamecube" && g.isDemo)).toBe(true);
    expect(countByPlatform(DEMO_GAMES).get("gamecube")).toBe(5);
  });

  it("identifie le dernier jeu joué et les ajouts récents", () => {
    expect(lastPlayed(DEMO_GAMES)?.id).toBe("demo-lumen-grove");
    expect(recentlyAdded(DEMO_GAMES, 1)[0].id).toBe("demo-starfall-bakery");
  });
});
