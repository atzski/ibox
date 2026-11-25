import { describe, expect, it } from "vitest";
import { saturatePixels, softenedWidth } from "./soften";

describe("image adoucie sans filtre", () => {
  it("réduit d'autant plus que le flou est grand", () => {
    // halo d'une jaquette (flou de 60 px) : une vingtaine de pixels suffisent
    expect(softenedWidth(60, 1280, 600)).toBe(21);
    // grande illustration légèrement adoucie
    expect(softenedWidth(10, 1280, 1920)).toBe(128);
    expect(softenedWidth(7, 1280, 1920)).toBe(183);
  });
  it("n'agrandit jamais l'image et garde un minimum", () => {
    expect(softenedWidth(2, 1280, 300)).toBe(300);
    expect(softenedWidth(400, 1280, 600)).toBe(12);
  });
  it("sature comme le filtre CSS : gris inchangé, couleurs renforcées", () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255, 200, 100, 50, 255]);
    saturatePixels(px, 1.15);
    expect([...px.slice(0, 4)]).toEqual([100, 100, 100, 255]);
    expect(px[4]).toBeGreaterThan(200);
    expect(px[6]).toBeLessThan(50);
    expect(px[7]).toBe(255);
    // saturation neutre : rien ne bouge
    const same = new Uint8ClampedArray([12, 34, 56, 255]);
    saturatePixels(same, 1);
    expect([...same]).toEqual([12, 34, 56, 255]);
  });
});
