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
  it("laisse intacts les textes libres (descriptions de jeux)", () => {
    const desc =
      "Brûlez l'asphalte, planez dans les airs et plongez sous l'eau dans Mario Kart 7 sur les consoles de la famille Nintendo 3DS ! Personnalisez votre kart à votre image, prenez le volant et contrôlez votre bolide avec les commandes par mouvement.";
    expect(translate(desc)).toBeNull();
  });
  it("traduit les libellés autrefois restés en français", () => {
    expect(translate("Plus que 12 pour le 100 %")).toBe("12 left for 100%");
    expect(translate("Amis, 1 en ligne")).toBe("Friends, 1 online");
    expect(translate("Amis, 2 en ligne, 3 invitations")).toBe("Friends, 2 online, 3 invitations");
    expect(translate("avec ")).toBe("with ");
    expect(translate("Clé enregistrée (coffre Windows)")).toBe("Key saved (Windows vault)");
    expect(translate("Les correspondances sûres (identifiant interne, nom identique, même jeu dans une autre région) sont appliquées automatiquement. Les autres vous sont proposées sur la fiche du jeu, jamais appliquées sans vous. Tout est conservé sur cet ordinateur et reste disponible hors connexion.") ?? "").toMatch(/^Reliable matches/);
  });
});
