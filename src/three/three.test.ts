import { describe, expect, it } from "vitest";
import { InspectController } from "./inspectController";
import { stepSpring, damp } from "./springs";

const settle = (c: InspectController, seconds = 3) => {
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60);
};

describe("InspectController", () => {
  it("démarre en pose de repos trois-quarts", () => {
    const c = new InspectController();
    expect(c.yaw).toBeCloseTo(InspectController.REST_YAW);
    expect(c.currentView()).toBe("front");
  });

  it("présente le dos puis la tranche", () => {
    const c = new InspectController();
    c.setView("back");
    settle(c);
    expect(c.yaw).toBeCloseTo(Math.PI, 2);
    expect(c.currentView()).toBe("back");
    c.setView("spine");
    settle(c);
    expect(c.currentView()).toBe("spine");
  });

  it("distingue le bord d'ouverture de la tranche", () => {
    const c = new InspectController();
    c.nudge(-Math.PI / 2 - InspectController.REST_YAW);
    settle(c);
    expect(c.currentView()).toBe("edge");
    c.setView("spine");
    settle(c);
    expect(c.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it("limite le tangage", () => {
    const c = new InspectController();
    c.dragStart();
    c.dragMove(0, 5000, 0.016);
    c.dragEnd();
    settle(c, 0.2);
    expect(Math.abs(c.pitch)).toBeLessThanOrEqual(InspectController.PITCH_LIMIT + 1e-6);
  });

  it("conserve une inertie qui s'amortit", () => {
    const c = new InspectController();
    c.dragStart();
    c.dragMove(40, 0, 0.016);
    c.dragEnd();
    const before = c.targetYaw;
    settle(c, 0.3);
    const mid = c.targetYaw;
    settle(c, 3);
    expect(mid).toBeGreaterThan(before);
    expect(c.targetYaw - mid).toBeLessThan(mid - before + 1);
  });

  it("borne le zoom", () => {
    const c = new InspectController();
    for (let i = 0; i < 50; i++) c.zoomBy(0.5);
    expect(c.targetZoom).toBe(InspectController.ZOOM_MIN);
    for (let i = 0; i < 50; i++) c.zoomBy(2);
    expect(c.targetZoom).toBe(InspectController.ZOOM_MAX);
  });
});

describe("ressorts", () => {
  it("converge vers la cible avec un léger dépassement", () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 240; i++) {
      stepSpring(s, 1, 1 / 60, 70, 11);
      max = Math.max(max, s.x);
    }
    expect(s.x).toBeCloseTo(1, 2);
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThan(1.25);
  });

  it("reste stable avec une frame très longue", () => {
    const s = { x: 0, v: 0 };
    stepSpring(s, 1, 0.5);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(2);
  });

  it("une image au dt aberrant (après une pause du canevas) ne fige pas l'interface", () => {
    // R3F : timestamp en ms − secondes à l'image qui suit frameloop="never" (~139 000 s mesurés)
    const s = { x: 0, v: 0 };
    const t0 = performance.now();
    stepSpring(s, 1, 138_982);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(Number.isFinite(s.x) && Math.abs(s.x) < 2).toBe(true);
    stepSpring(s, 1, -3);
    expect(Number.isFinite(s.x)).toBe(true);
  });

  it("damp est indépendant du découpage temporel", () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 5, 1 / 60);
    const b = damp(0, 1, 5, 1);
    expect(a).toBeCloseTo(b, 6);
  });
});
