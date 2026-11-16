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
});
