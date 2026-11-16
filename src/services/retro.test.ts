import { describe, expect, it } from "vitest";
import { parseGame, raBadge, raMedia, rarity } from "./retro";

describe("RetroAchievements", () => {
  it("lit un jeu et sa progression", () => {
    const d = parseGame({
      Title: "Super Mario 64",
      ConsoleName: "Nintendo 64",
      ImageIcon: "/Images/000001.png",
      NumDistinctPlayers: 200,
      HighestAwardKind: "beaten-hardcore",
      Achievements: {
        "2": { ID: 2, Title: "Deux", Description: "b", Points: 10, TrueRatio: 20, BadgeName: "222", NumAwarded: 20, NumAwardedHardcore: 10, DisplayOrder: 2, DateEarned: "2026-11-01 10:00:00" },
        "1": { ID: 1, Title: "Un", Description: "a", Points: 5, TrueRatio: 5, BadgeName: "111", NumAwarded: 150, NumAwardedHardcore: 90, DisplayOrder: 1, type: "progression" },
      },
    }, 42);
    expect(d.achievements.map((a) => a.id)).toEqual([1, 2]);
    expect(d.earned).toBe(1);
    expect(d.points).toBe(15);
    expect(d.pointsEarned).toBe(10);
    expect(d.icon).toBe("https://media.retroachievements.org/Images/000001.png");
    expect(d.achievements[0].type).toBe("progression");
  });

  it("classe la rareté", () => {
    const base = { id: 1, title: "", description: "", points: 0, trueRatio: 0, numAwardedHardcore: 0, displayOrder: 0 };
    expect(rarity({ ...base, numAwarded: 90 }, 100).tier).toBe("common");
    expect(rarity({ ...base, numAwarded: 20 }, 100).tier).toBe("uncommon");
    expect(rarity({ ...base, numAwarded: 5 }, 100).tier).toBe("rare");
    expect(rarity({ ...base, numAwarded: 1 }, 100).tier).toBe("ultra");
    expect(rarity({ ...base, numAwarded: 1 }, 0).percent).toBe(0);
  });

  it("construit les adresses d'images", () => {
    expect(raBadge("123", true)).toBe("https://media.retroachievements.org/Badge/123_lock.png");
    expect(raBadge(undefined)).toBeUndefined();
    expect(raMedia("https://x/y.png")).toBe("https://x/y.png");
  });
});
