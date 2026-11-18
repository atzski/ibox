import { describe, expect, it } from "vitest";
import { translate } from "./index";

describe("traduction", () => {
  it("garde les pluriels", () => {
    expect(translate("3 jours")).toBe("3 days");
    expect(translate("1 jour")).toBe("1 day");
    expect(translate("12 jeux")).toBe("12 games");
  });
  it("ne coupe plus les mots au milieu d'une phrase", () => {
    expect(translate("Mises à jour automatiques : iBox vérifie tout seul.") ?? "").not.toContain("days");
    expect(translate("iBox est à jour.") ?? "").not.toContain("day");
  });
  it("accorde les compteurs écrits d'un seul tenant (plus de « 5 gamex »)", () => {
    expect(translate("1 jeu")).toBe("1 game");
    expect(translate("Associer 3 jeux…")).toBe("Match 3 games…");
    expect(translate("7 jeux dans la collection · cliquez pour ajouter ou retirer")).toBe("7 games in the collection · click to add or remove");
    expect(translate("Au total : 6 h 51 de jeu lancé depuis iBox.")).toBe("In total: 6 h 51 of play launched from iBox.");
    expect(translate("2 consoles associées")).toBe("2 consoles linked");
  });
});
