import { describe, expect, it } from "vitest";
import { quotaFull, quotaText } from "./community";

describe("limite de trois publications par jour", () => {
  const now = Date.UTC(2026, 10, 25, 12, 0, 0);
  it("dit combien de publications restent", () => {
    expect(quotaText({ limit: 3, used: 0, resetAt: null }, now)).toBe("Encore 3 publications possibles aujourd’hui");
    expect(quotaText({ limit: 3, used: 2, resetAt: null }, now)).toBe("Encore 1 publication possible aujourd’hui");
    expect(quotaFull({ limit: 3, used: 2, resetAt: null }, now)).toBe(false);
  });
  it("donne l'attente quand la limite est atteinte, en heures ou en minutes", () => {
    expect(quotaText({ limit: 3, used: 3, resetAt: now + 5 * 3_600_000 - 60_000 }, now)).toBe("Trois publications par jour au plus : la prochaine sera possible dans 5 h.");
    expect(quotaText({ limit: 3, used: 3, resetAt: now + 40 * 60_000 }, now)).toBe("Trois publications par jour au plus : la prochaine sera possible dans 40 min.");
    expect(quotaFull({ limit: 3, used: 3, resetAt: now + 1000 }, now)).toBe(true);
  });
  it("ne bloque rien avec un serveur plus ancien, ni une fois la place libérée", () => {
    expect(quotaText(null, now)).toBeNull();
    expect(quotaFull(null, now)).toBe(false);
    expect(quotaFull({ limit: 3, used: 3, resetAt: now - 1 }, now)).toBe(false);
  });
});
