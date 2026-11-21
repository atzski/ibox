import { describe, expect, it } from "vitest";
import { rank, scoreMatch } from "./search";

describe("scoreMatch", () => {
  it("classe du plus sûr au plus souple", () => {
    const title = "The Legend of Zelda: Breath of the Wild";
    const exact = scoreMatch("Lumen Grove", "lumen grove");
    const prefix = scoreMatch(title, "legend of z");
    const words = scoreMatch(title, "zel bre");
    const acronym = scoreMatch(title, "lozbotw");
    const inside = scoreMatch(title, "eath");
    const typo = scoreMatch(title, "zleda");
    expect(exact).toBe(100);
    expect(prefix).toBe(80);
    expect(words).toBe(60);
    expect(acronym).toBe(50);
    expect(inside).toBe(40);
    expect(typo).toBe(20);
  });

  it("ignore accents, casse et article initial", () => {
    expect(scoreMatch("Pokémon Écarlate", "pokemon ecarlate")).toBe(100);
    expect(scoreMatch("Les Sims 2", "sims")).toBe(80);
  });

  it("reconnaît les initiales, chiffres compris", () => {
    expect(scoreMatch("Mario Kart 8 Deluxe", "mk8")).toBe(50);
    expect(scoreMatch("Super Smash Bros. Melee", "ssbm")).toBe(50);
  });

  it("tolère une seule faute, et seulement sur un mot assez long", () => {
    expect(scoreMatch("Metroid Prime", "metriod")).toBe(20);
    expect(scoreMatch("Metroid Prime", "metrod")).toBe(20);
    expect(scoreMatch("Metroid Prime", "mxtrxid")).toBe(0);
    // trois lettres : pas de tolérance, sinon tout se ressemble
    expect(scoreMatch("Metroid Prime", "mat")).toBe(0);
  });

  it("rejette ce qui ne correspond pas, et la requête vide", () => {
    expect(scoreMatch("Lumen Grove", "tidepool")).toBe(0);
    expect(scoreMatch("Lumen Grove", "   ")).toBe(0);
    expect(scoreMatch("", "lumen")).toBe(0);
  });
});

describe("rank", () => {
  const games = ["Mario Kart Wii", "Super Mario Galaxy", "Paper Mario", "Luigi's Mansion", "Mario Party 8"];

  it("met le meilleur résultat en tête et respecte la limite", () => {
    const out = rank(games, "mario", (g) => g, 3);
    expect(out).toHaveLength(3);
    // les titres qui commencent par « mario » passent devant ceux qui le contiennent
    expect(out.slice(0, 2).map((r) => r.item).sort()).toEqual(["Mario Kart Wii", "Mario Party 8"]);
  });

  it("le bonus départage sans dépasser un meilleur résultat", () => {
    const out = rank(games, "mario", (g) => g, 5, (g) => (g === "Paper Mario" ? 1000 : g === "Mario Party 8" ? 5 : 0));
    expect(out[0].item).toBe("Mario Party 8");
    expect(out.findIndex((r) => r.item === "Paper Mario")).toBeGreaterThan(1);
  });

  it("les mots-clés comptent, un cran sous le nom", () => {
    const pages = [
      { name: "Son", keys: ["musique", "volume"] },
      { name: "Musique du menu", keys: [] as string[] },
    ];
    const out = rank(pages, "musique", (p) => [p.name, ...p.keys], 5);
    expect(out.map((r) => r.item.name)).toEqual(["Musique du menu", "Son"]);
  });
});
