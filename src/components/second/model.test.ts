import { describe, expect, it } from "vitest";
import { applyKey, DEFAULT_SECOND_PREFS, keyboardRows, parseCommand, playTime, secondPrefs, sessionTime, viewOf, yieldsScreen, type SecondGame } from "./model";

const game: SecondGame = { id: "g1", title: "µCity", platformId: "gbc", platform: "Game Boy Color", tint: ["#fff", "#000"] };

describe("écran du bas : modèle", () => {
  it("complète les réglages enregistrés", () => {
    expect(secondPrefs(undefined)).toEqual(DEFAULT_SECOND_PREFS);
    const p = secondPrefs({ menu: "shortcuts", play: { notes: false } as never });
    expect(p.menu).toBe("shortcuts");
    expect(p.play).toEqual({ achievements: true, manual: true, notes: false, music: true });
  });

  it("choisit la vue selon le contexte", () => {
    const prefs = DEFAULT_SECOND_PREFS;
    expect(viewOf({ phase: "menu", game, prefs, achievements: null, music: null })).toEqual({ kind: "card" });
    expect(viewOf({ phase: "menu", game: null, prefs, achievements: null, music: null })).toEqual({ kind: "shortcuts" });
    expect(viewOf({ phase: "menu", game, prefs: { ...prefs, menu: "shortcuts" }, achievements: null, music: null })).toEqual({ kind: "shortcuts" });
    // en jeu : pas de manuel sans manuel, pas de musique sans plugin
    expect(viewOf({ phase: "playing", game, prefs, achievements: null, music: null })).toEqual({ kind: "play", panels: ["achievements", "notes"] });
    expect(
      viewOf({ phase: "playing", game: { ...game, hasManual: true }, prefs, achievements: null, music: { title: "t", artist: "a", playing: true } }),
    ).toEqual({ kind: "play", panels: ["achievements", "manual", "notes", "music"] });
  });

  it("laisse l'écran aux jeux à deux écrans", () => {
    expect(yieldsScreen("ds", DEFAULT_SECOND_PREFS)).toBe(true);
    expect(yieldsScreen("3ds", DEFAULT_SECOND_PREFS)).toBe(true);
    expect(yieldsScreen("gbc", DEFAULT_SECOND_PREFS)).toBe(false);
    expect(yieldsScreen("ds", { ...DEFAULT_SECOND_PREFS, yieldDualScreen: false })).toBe(false);
  });

  it("vérifie les commandes reçues du bas", () => {
    expect(parseCommand({ type: "open", target: "search" })).toEqual({ type: "open", target: "search" });
    expect(parseCommand({ type: "open", target: "ailleurs" })).toBeNull();
    expect(parseCommand({ type: "manual", index: 2.7 })).toEqual({ type: "manual", index: 2 });
    expect(parseCommand({ type: "manual", index: -1 })).toBeNull();
    expect(parseCommand({ type: "note", gameId: "g1", text: "x".repeat(5000) })).toMatchObject({ text: "x".repeat(4000) });
    expect(parseCommand({ type: "music", action: "seek" })).toBeNull();
    expect(parseCommand("return")).toBeNull();
    expect(parseCommand({ type: "return" })).toEqual({ type: "return" });
  });

  it("écrit les durées", () => {
    expect(playTime(undefined)).toBe("Jamais joué");
    expect(playTime(30)).toBe("Moins d'une minute");
    expect(playTime(12 * 60)).toBe("12 min");
    expect(playTime(3 * 3600 + 20 * 60)).toBe("3 h 20");
    expect(playTime(2 * 3600)).toBe("2 h");
    expect(sessionTime(1_000, 1_000 + 5 * 60_000)).toBe("5 min");
    expect(sessionTime(undefined, 0)).toBe("");
  });

  it("tape au clavier tactile", () => {
    expect(keyboardRows("fr")[1].slice(0, 6).join("")).toBe("azerty");
    expect(keyboardRows("en")[1].slice(0, 6).join("")).toBe("qwerty");
    expect(applyKey("ab", "backspace")).toBe("a");
    expect(applyKey("été", "backspace")).toBe("ét");
    expect(applyKey("a", "space")).toBe("a ");
    expect(applyKey("a", "enter")).toBe("a\n");
    expect(applyKey("", "é")).toBe("é");
  });
});
