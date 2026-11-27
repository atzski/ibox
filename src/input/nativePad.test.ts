import { describe, expect, it } from "vitest";
import { NATIVE_INDEX_BASE, applyNativePad, nativePads } from "./nativePad";
import { PadProcessor } from "./gamepad";

const state = (pressed: number[]) => ({
  index: 0,
  id: "Manette (Vendor: 045e Product: 028e)",
  connected: true,
  buttons: Array.from({ length: 17 }, (_, i) => pressed.includes(i)),
  axes: [0, 0, 0, 0],
});

describe("relais natif de la manette", () => {
  it("donne des Gamepad lisibles par la boucle, avec des index à part", () => {
    expect(applyNativePad(state([]))).toBe(true);
    const [pad] = nativePads();
    expect(pad.index).toBe(NATIVE_INDEX_BASE);
    expect(pad.mapping).toBe("standard");
    expect(pad.buttons).toHaveLength(17);
    expect(applyNativePad(state([]))).toBe(false);
  });

  it("un appui plus bref qu'une image est vu une fois par la boucle", () => {
    applyNativePad(state([]));
    nativePads(true);
    // appui puis relâchement entre deux lectures (adb « input gamepad keyevent »)
    applyNativePad(state([15]));
    applyNativePad(state([]));
    // la liste des joueurs ne consomme pas l'appui
    expect(nativePads()[0].buttons[15].pressed).toBe(true);
    const processor = new PadProcessor();
    const read = () => {
      const g = nativePads(true)[0];
      return processor.update({ buttons: g.buttons.map((b) => b.pressed), axes: [...g.axes] }, "south", 0);
    };
    expect(read()).toEqual(["right"]);
    expect(read()).toEqual([]);
  });

  it("une manette débranchée disparaît", () => {
    applyNativePad(state([]));
    expect(applyNativePad({ index: 0, id: "", connected: false })).toBe(true);
    expect(nativePads()).toHaveLength(0);
  });
});
