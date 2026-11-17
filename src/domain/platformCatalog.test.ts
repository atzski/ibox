import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { CONSOLES, localizeSpec } from "./platformCatalog";
import { PLATFORMS, getPlatform } from "./platforms";
import { PLATFORM_BLURBS } from "./platformBlurbs";

// identifiants du catalogue natif (src-tauri/src/emulators/catalog.rs)
const catalogRs = readFileSync("src-tauri/src/emulators/catalog.rs", "utf8");
const PACKAGES = [...catalogRs.matchAll(/^\s+id: "([^"]+)",$/gm)].map((m) => m[1]);

describe("iBox Platforms : catalogue des consoles", () => {
  it("chaque console a une photo locale, une histoire bilingue et un identifiant unique", () => {
    const ids = CONSOLES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CONSOLES) {
      expect(existsSync(`public${c.photo}`), c.photo).toBe(true);
      expect(c.history.fr.length, c.id).toBeGreaterThan(40);
      expect(c.history.en.length, c.id).toBeGreaterThan(40);
    }
  });

  it("les consoles prises en charge existent dans la bibliothèque, avec une présentation", () => {
    for (const c of CONSOLES.filter((c) => c.support === "full")) {
      expect(getPlatform(c.id), c.id).toBeDefined();
      expect(PLATFORM_BLURBS[c.id], c.id).toBeTruthy();
    }
    // toutes les consoles de la bibliothèque (sauf le PC) ont leur fiche
    for (const p of PLATFORMS.filter((p) => p.id !== "pc")) {
      expect(CONSOLES.some((c) => c.id === p.id), p.id).toBe(true);
    }
  });

  it("les émulateurs recommandés existent dans le catalogue natif", () => {
    expect(PACKAGES.length).toBeGreaterThan(15);
    for (const c of CONSOLES) {
      for (const id of [c.recommended, ...c.alternatives].filter(Boolean) as string[]) {
        expect(PACKAGES, `${c.id} → ${id}`).toContain(id);
      }
    }
  });

  it("convertit les unités en anglais", () => {
    expect(localizeSpec("4 Mo RDRAM (8 Mo avec l'Expansion Pak)", "en")).toBe("4 MB RDRAM (8 MB with the Expansion Pak)");
    expect(localizeSpec("NEC VR4300, 93,75 MHz", "en")).toBe("NEC VR4300, 93.75 MHz");
    expect(localizeSpec("4 Mo", "fr")).toBe("4 Mo");
  });
});
