import { describe, expect, it } from "vitest";
import { PadProcessor, confirmButton, detectFamily, padLabels, type PadState } from "./gamepad";

const pad = (pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): PadState => {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed.includes(i));
  return { buttons, axes };
};

describe("familles de manettes", () => {
  it("reconnaît les identifiants courants", () => {
    expect(detectFamily("Xbox 360 Controller (XInput STANDARD GAMEPAD)")).toBe("xbox");
    expect(detectFamily("DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c)")).toBe("playstation");
    expect(detectFamily("Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)")).toBe("nintendo");
    expect(detectFamily("8BitDo SN30")).toBe("generic");
  });

  it("valide à droite sur Nintendo, en bas ailleurs, sauf choix de l'utilisateur", () => {
    expect(confirmButton("nintendo", "auto")).toBe("east");
    expect(confirmButton("xbox", "auto")).toBe("south");
    expect(confirmButton("nintendo", "south")).toBe("south");
    expect(padLabels("playstation", "auto")).toMatchObject({ confirm: "✕", back: "○", tabPrev: "L1" });
    expect(padLabels("nintendo", "auto")).toMatchObject({ confirm: "A", back: "B" });
  });
});

describe("PadProcessor", () => {
  it("déclenche une action à l'appui, pas en continu", () => {
    const p = new PadProcessor();
    expect(p.update(pad([0]), "south", 0)).toEqual(["confirm"]);
    expect(p.update(pad([0]), "south", 16)).toEqual([]);
    expect(p.update(pad([]), "south", 32)).toEqual([]);
    expect(p.update(pad([1]), "south", 48)).toEqual(["back"]);
  });

  it("inverse validation et retour en disposition Nintendo", () => {
    const p = new PadProcessor();
    expect(p.update(pad([1]), "east", 0)).toEqual(["confirm"]);
    expect(p.update(pad([0]), "east", 20)).toEqual(["back"]);
  });

  it("répète une direction maintenue après un délai", () => {
    const p = new PadProcessor();
    const seq: string[] = [];
    for (let t = 0; t <= 700; t += 16) seq.push(...p.update(pad([15]), "south", t));
    // 1 appui + répétitions toutes les ~110 ms après 380 ms
    expect(seq[0]).toBe("right");
    expect(seq.length).toBeGreaterThanOrEqual(3);
    expect(seq.length).toBeLessThanOrEqual(5);
  });

  it("stick gauche avec zone morte et gâchettes d'onglets", () => {
    const p = new PadProcessor();
    expect(p.update(pad([], [0.3, 0, 0, 0]), "south", 0)).toEqual([]);
    expect(p.update(pad([], [0, -0.9, 0, 0]), "south", 16)).toEqual(["up"]);
    expect(p.update(pad([4]), "south", 32)).toEqual(["tabPrev"]);
  });
});
