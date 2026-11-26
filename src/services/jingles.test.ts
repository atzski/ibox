import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("./native", () => ({ isTauri: () => true }));
vi.mock("./settings", () => ({ useSettings: { getState: () => ({ gameSounds: true, jingleVolume: 0.6 }) } }));
vi.mock("./music", () => ({ music: { duck: () => () => undefined } }));
vi.mock("./notifications", () => ({ notify: () => undefined }));
vi.mock("./library", () => ({ useLibrary: { subscribe: () => () => undefined } }));

const played: string[] = [];
class FakeAudio {
  volume = 1;
  onended: (() => void) | null = null;
  constructor(public src: string) {}
  play() { played.push(this.src); return Promise.resolve(); }
  pause() {}
}
vi.stubGlobal("window", globalThis);
vi.stubGlobal("Audio", FakeAudio);
vi.stubGlobal("requestAnimationFrame", () => 0);
URL.createObjectURL = (b: Blob) => `blob:${(b as Blob & { tag?: string }).tag ?? b.size}`;
URL.revokeObjectURL = () => undefined;

import { playJingle, stopJingle } from "./jingles";

beforeEach(() => {
  played.length = 0;
  invoke.mockReset();
  vi.useFakeTimers();
});

describe("jingles", () => {
  it("un son encore en chemin pour la fiche quittée ne joue jamais sur la suivante", async () => {
    // fiche Zelda : la lecture du fichier prend du temps
    let zelda!: (b: ArrayBuffer) => void;
    invoke.mockImplementationOnce(() => new Promise<ArrayBuffer>((r) => { zelda = r; }));
    playJingle(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(invoke).toHaveBeenCalledWith("game_sound", { gameId: 1 });

    // on ouvre « Callus », qui n'a pas de jingle
    invoke.mockRejectedValueOnce("aucun son");
    stopJingle();
    playJingle(2);
    zelda(new ArrayBuffer(4096)); // le son de Zelda arrive après coup
    await vi.advanceTimersByTimeAsync(500);
    expect(played).toEqual([]);
  });

  it("le jingle du jeu affiché joue normalement", async () => {
    invoke.mockResolvedValueOnce(new ArrayBuffer(10));
    playJingle(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(played).toHaveLength(1);
    stopJingle();
  });
});
