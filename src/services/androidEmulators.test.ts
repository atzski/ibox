import { describe, expect, it } from "vitest";
import { androidStatus } from "./androidEmulators";

const summary = {
  effective: { gc: "RetroArch (Dolphin)", psp: "PPSSPP", n64: null } as Record<string, string | null>,
  supported: new Set(["gc", "psp", "n64"]),
  viaRetroArch: new Set(["gc"]),
};

describe("androidStatus", () => {
  it("prête seulement avec un émulateur autonome installé", () => {
    expect(androidStatus("psp", summary)).toBe("ready");
  });

  it("RetroArch seul : cœur à vérifier, jamais « prête » (D4)", () => {
    expect(androidStatus("gc", summary)).toBe("core-check");
  });

  it("aucun émulateur installé, ou aucun connu", () => {
    expect(androidStatus("n64", summary)).toBe("not-installed");
    expect(androidStatus("ps3", summary)).toBe("discovery");
  });

  it("un BIOS manquant passe avant le reste", () => {
    expect(androidStatus("gc", summary, [{ id: "x", required: true, names: [], found: null }])).toBe("missing-bios");
  });
});
