import { describe, expect, it } from "vitest";
import { natLabel, needsConfirmation, pathLabel, trustLabel } from "./remotePlayOnline";
import { EN } from "@/i18n/en";

describe("Remote Play en ligne", () => {
  it("affiche le type de connexion sans adresse", () => {
    expect(pathLabel("internet")).toBe("P2P Internet");
    expect(pathLabel("lan")).toBe("Réseau local");
    expect(pathLabel(null)).toBe("—");
    expect(natLabel("symmetric")).toBe("NAT symétrique");
    expect(natLabel("noResponse")).toBe("STUN sans réponse");
  });

  it("demande une confirmation pour le Collaborateur seulement", () => {
    expect(needsConfirmation("spectator")).toBe(false);
    expect(needsConfirmation("player")).toBe(false);
    expect(needsConfirmation("collaborator")).toBe(true);
  });

  it("traduit chaque libellé affiché", () => {
    const labels = [
      ...["internet", "lan", "loopback"].map(pathLabel),
      ...["open", "consistent", "symmetric", "noResponse"].map(natLabel),
      ...(["firstContact", "newDevice", "known", "verified"] as const).map(trustLabel),
    ];
    for (const l of labels) expect(EN[l], l).toBeTruthy();
  });
});
