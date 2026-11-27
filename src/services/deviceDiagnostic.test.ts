import { describe, expect, it } from "vitest";
import { frameStats } from "./deviceDiagnostic";

describe("frameStats", () => {
  it("rien à mesurer sans deux images", () => {
    expect(frameStats([])).toBeNull();
    expect(frameStats([5])).toBeNull();
  });

  it("60 im/s réguliers, puis une saccade", () => {
    const steady = Array.from({ length: 61 }, (_, i) => i * (1000 / 60));
    const s = frameStats(steady)!;
    expect(s.fps).toBeCloseTo(60, 5);
    expect(s.slow).toBe(0);
    // une image de 100 ms au milieu : comptée comme saccade et pire image
    const jank = [...steady.slice(0, 30), ...steady.slice(30).map((t) => t + 100)];
    const j = frameStats(jank)!;
    expect(j.slow).toBe(1);
    expect(j.maxMs).toBeCloseTo(1000 / 60 + 100, 5);
    expect(j.fps).toBeLessThan(60);
  });
});
