import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRender3D } from "@/services/render3d";
import { watchContextLoss } from "./rendererTuning";

/** Canevas minimal : seuls l'écoute, `dataset` et `isConnected` servent à `watchContextLoss`. */
function fakeCanvas(isConnected: boolean) {
  const target = new EventTarget();
  return Object.assign(target, { dataset: {} as Record<string, string>, isConnected }) as unknown as HTMLCanvasElement;
}

const lose = (canvas: HTMLCanvasElement) => canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("watchContextLoss", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: () => 0 });
    useRender3D.setState({ losses: 0, lost: false, generation: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("compte la perte d'un canevas affiché", async () => {
    const canvas = fakeCanvas(true);
    watchContextLoss(canvas);
    lose(canvas);
    await vi.waitFor(() => expect(useRender3D.getState().losses).toBe(1));
  });

  it("ignore le contexte libéré au démontage d'une scène (fiche fermée, réglage en jaquettes)", async () => {
    // React Three Fiber appelle `forceContextLoss` sur le canevas déjà retiré de la page :
    // comptée, cette libération passait iBox en jaquettes à la deuxième fiche fermée (1.0.29)
    for (let i = 0; i < 3; i++) {
      const canvas = fakeCanvas(false);
      watchContextLoss(canvas);
      lose(canvas);
    }
    await settle();
    expect(useRender3D.getState()).toMatchObject({ losses: 0, lost: false });
  });
});
