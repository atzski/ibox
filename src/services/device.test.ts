import { describe, expect, it } from "vitest";
import { baseFontPx, deviceTier, gpuClassFromRenderer, handheldTextScale, isLightTier, lowerTier, simulatedPlatform, thermalSteps, type HandheldDevice } from "./device";
import { resolveBudget } from "./budget";

/** Ancien réglage Mode performance, rendu par le budget (Allégé, Qualité, Automatique). */
const resolveTier = (choice: "auto" | "on" | "off" | undefined, auto: Parameters<typeof resolveBudget>[0]["auto"]) =>
  resolveBudget({ preset: choice === "on" ? "light" : choice === "off" ? "quality" : "auto", auto, deck: false, onBattery: false }).tier;

describe("consoles Android", () => {
  const android = (gpu: HandheldDevice["gpu"], known = true, memoryMb = 8000): HandheldDevice => ({ id: "android", name: "x", screen: null, gpu, chip: { soc: "X", name: null, known, memoryMb } });
  const p = (device: HandheldDevice) => ({ steamDeck: null, handheld: true, device });
  it("palier d'après la classe de la puce", () => {
    expect(deviceTier(p(android("mid")))).toBe("handheld");
    expect(deviceTier(p(android("low")))).toBe("lite");
    expect(deviceTier(p(android("weak")))).toBe("low");
    expect(deviceTier(p(android("minimal")))).toBe("minimal");
  });
  it("puce inconnue : affinée par le GPU vu par WebGL, plafonnée par la mémoire", () => {
    expect(deviceTier(p(android("minimal", false)), "Adreno (TM) 740")).toBe("handheld");
    expect(deviceTier(p(android("minimal", false, 3000)), "Adreno (TM) 740")).toBe("low");
    expect(deviceTier(p(android("weak", false)), "Mali-G52 MC2")).toBe("minimal");
    // renderer illisible (émulateur) : classe d'après la mémoire
    expect(deviceTier(p(android("weak", false)), "Android Emulator OpenGL ES Translator")).toBe("low");
    // puce connue : le renderer ne change rien
    expect(deviceTier(p(android("weak")), "Adreno (TM) 740")).toBe("low");
  });
  it("GPU reconnus par WebGL", () => {
    expect(gpuClassFromRenderer("Adreno (TM) 750")).toBe("mid");
    expect(gpuClassFromRenderer("Adreno (TM) 650")).toBe("low");
    expect(gpuClassFromRenderer("Adreno (TM) 618")).toBe("weak");
    expect(gpuClassFromRenderer("Adreno (TM) 610")).toBe("minimal");
    expect(gpuClassFromRenderer("Mali-G77 MC9")).toBe("low");
    expect(gpuClassFromRenderer("Mali-G57 MC4")).toBe("weak");
    expect(gpuClassFromRenderer("Mali-G57 MC2")).toBe("minimal");
    expect(gpuClassFromRenderer("Mali-G710 MC10")).toBe("mid");
    expect(gpuClassFromRenderer("PowerVR Rogue GE8320")).toBe("minimal");
    expect(gpuClassFromRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)")).toBe("minimal");
    expect(gpuClassFromRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11)")).toBeNull();
    expect(gpuClassFromRenderer(null)).toBeNull();
  });
  it("chaleur : un palier de moins à « modéré », deux à « sévère », jamais jusqu'à couper la 3D", () => {
    expect(thermalSteps(0)).toBe(0);
    expect(thermalSteps(1)).toBe(0);
    expect(thermalSteps(2)).toBe(1);
    expect(thermalSteps(4)).toBe(2);
    expect(lowerTier("handheld", 1, "low")).toBe("lite");
    expect(lowerTier("handheld", 2, "low")).toBe("low");
    expect(lowerTier("lite", 2, "low")).toBe("low");
    expect(lowerTier("minimal", 2, "low")).toBe("minimal");
  });
  it("le mode performance n'élève jamais un appareil modeste", () => {
    expect(resolveTier("on", "minimal")).toBe("minimal");
    expect(resolveTier("on", "handheld")).toBe("lite");
    expect(isLightTier("low")).toBe(true);
    expect(isLightTier("handheld")).toBe(false);
    expect(simulatedPlatform("thor")?.android).toBe(true);
    expect(deviceTier(simulatedPlatform("t618")!)).toBe("minimal");
    expect(deviceTier(simulatedPlatform("rp5")!)).toBe("lite");
  });
});

const dev = (id: string, gpu: HandheldDevice["gpu"], width: number, height: number, inches: number): HandheldDevice => ({ id, name: id, gpu, screen: { width, height, inches } });

describe("consoles portables", () => {
  it("palier d'office selon l'appareil", () => {
    expect(deviceTier({ steamDeck: null })).toBe("full");
    expect(deviceTier({ steamDeck: "Steam Deck OLED" })).toBe("lite");
    // console SteamOS sans fiche (SteamDeck=1) : prudence, interface allégée
    expect(deviceTier({ steamDeck: null, handheld: true })).toBe("lite");
    expect(deviceTier({ steamDeck: null, handheld: true, device: dev("rog-ally", "low", 1920, 1080, 7) })).toBe("lite");
    expect(deviceTier({ steamDeck: null, handheld: true, device: dev("rog-ally", "mid", 1920, 1080, 7) })).toBe("handheld");
  });
  it("le réglage l'emporte sur l'appareil", () => {
    expect(resolveTier("auto", "handheld")).toBe("handheld");
    expect(resolveTier("on", "full")).toBe("lite");
    expect(resolveTier("off", "lite")).toBe("full");
    expect(resolveTier(undefined, "lite")).toBe("lite");
  });
  it("texte agrandi sur les petits écrans denses, jamais au-delà de ×1,15", () => {
    expect(baseFontPx(1280)).toBeCloseTo(14.94, 2);
    // Steam Deck LCD (7 pouces, 1280×800) et OLED (7,4 pouces)
    expect(handheldTextScale(dev("steam-deck-lcd", "low", 1280, 800, 7), 1280, 1)).toBe(1.14);
    expect(handheldTextScale(dev("steam-deck-oled", "low", 1280, 800, 7.4), 1280, 1)).toBe(1.08);
    // ROG Ally à 150 % (1280×720 points), à 125 % : plafonné
    expect(handheldTextScale(dev("rog-ally", "mid", 1920, 1080, 7), 1280, 1.5)).toBe(1.11);
    expect(handheldTextScale(dev("rog-ally", "mid", 1920, 1080, 7), 1536, 1.25)).toBe(1.15);
    // Legion Go à 200 %, Legion Go S à 150 % : déjà assez grand
    expect(handheldTextScale(dev("legion-go", "mid", 2560, 1600, 8.8), 1280, 2)).toBe(1);
    expect(handheldTextScale(dev("legion-go-s", "low", 1920, 1200, 8), 1280, 1.5)).toBe(1);
    // écran intégré reconnu (paysage ou portrait) : agrandi ; télévision ou moniteur : inchangé
    const ally = dev("rog-ally", "mid", 1920, 1080, 7);
    expect(handheldTextScale(ally, 1280, 1.5, { width: 1920, height: 1080 })).toBe(1.11);
    expect(handheldTextScale(ally, 1280, 1.5, { width: 1080, height: 1920 })).toBe(1.11);
    expect(handheldTextScale(ally, 2560, 1.5, { width: 3840, height: 2160 })).toBe(1);
    expect(handheldTextScale(dev("steam-deck-lcd", "low", 1280, 800, 7), 1920, 1, { width: 1920, height: 1080 })).toBe(1);
    expect(handheldTextScale(dev("steam-deck-lcd", "low", 1280, 800, 7), 1280, 1, { width: 1280, height: 800 })).toBe(1.14);
    // PC, ou console sans fiche d'écran : inchangé
    expect(handheldTextScale(null, 1920, 1)).toBe(1);
    expect(handheldTextScale({ id: "handheld", name: "x", gpu: "mid", screen: null }, 1280, 1.5)).toBe(1);
  });
  it("appareils simulés pour l'aperçu", () => {
    expect(simulatedPlatform("ally")?.device?.gpu).toBe("mid");
    expect(simulatedPlatform("deck")?.gameMode).toBe(true);
    expect(simulatedPlatform("inconnu")).toBeNull();
  });
});
