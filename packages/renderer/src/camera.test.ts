import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  clampToBounds,
  containerTransform,
  createCamera,
  frameBlend,
  LodTier,
  lodTier,
  pan,
  render,
  screenToWorld,
  visibleWorldBounds,
  worldToScreen,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
} from "./camera";

const VIEW = { width: 1280, height: 720 };

const camArb = fc
  .record({
    x: fc.double({ min: -5000, max: 5000, noNaN: true }),
    y: fc.double({ min: -5000, max: 5000, noNaN: true }),
    zoom: fc.double({ min: ZOOM_MIN, max: ZOOM_MAX, noNaN: true }),
  })
  .map(({ x, y, zoom }) => createCamera(x, y, zoom));

describe("camera (TDD §8, phase-1 task 2)", () => {
  it("worldToScreen ∘ screenToWorld is identity (property)", () => {
    fc.assert(
      fc.property(
        camArb,
        fc.double({ min: 0, max: 1280, noNaN: true }),
        fc.double({ min: 0, max: 720, noNaN: true }),
        (cam, sx, sy) => {
          const w = screenToWorld(cam, VIEW, sx, sy);
          const s = worldToScreen(cam, VIEW, w.wx, w.wy);
          expect(s.sx).toBeCloseTo(sx, 6);
          expect(s.sy).toBeCloseTo(sy, 6);
        },
      ),
    );
  });

  it("zoomAt keeps the world point under the anchor fixed (property)", () => {
    fc.assert(
      fc.property(
        camArb,
        fc.double({ min: 100, max: 1180, noNaN: true }),
        fc.double({ min: 100, max: 620, noNaN: true }),
        fc.double({ min: 0.5, max: 2, noNaN: true }).filter((f) => Math.abs(f - 1) > 0.01),
        (cam, sx, sy, factor) => {
          render(cam); // sync rendered to target before measuring
          const before = screenToWorld(cam, VIEW, sx, sy);
          zoomAt(cam, VIEW, sx, sy, factor);
          render(cam);
          const after = screenToWorld(cam, VIEW, sx, sy);
          expect(after.wx).toBeCloseTo(before.wx, 6);
          expect(after.wy).toBeCloseTo(before.wy, 6);
        },
      ),
    );
  });

  it("pan moves the center opposite the drag, scaled by zoom", () => {
    const cam = createCamera(100, 100, 2);
    pan(cam, 50, -30);
    expect(cam.x).toBe(100 - 25);
    expect(cam.y).toBe(100 + 15);
  });

  it("zoom clamps to [ZOOM_MIN, ZOOM_MAX]", () => {
    const cam = createCamera(0, 0, 1);
    zoomAt(cam, VIEW, 640, 360, 100);
    expect(cam.zoom).toBe(ZOOM_MAX);
    zoomAt(cam, VIEW, 640, 360, 0.0001);
    expect(cam.zoom).toBe(ZOOM_MIN);
  });

  it("clampToBounds pins the center inside the world rect", () => {
    const cam = createCamera(-999, 5000, 1);
    clampToBounds(cam, { minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(1000);
  });

  it("LOD tiers split at the [TUNE] thresholds", () => {
    expect(lodTier(0.25)).toBe(LodTier.far);
    expect(lodTier(0.5)).toBe(LodTier.mid);
    expect(lodTier(1)).toBe(LodTier.mid);
    expect(lodTier(1.5)).toBe(LodTier.near);
    expect(lodTier(4)).toBe(LodTier.near);
  });

  it("render(blend<1) approaches the target — the 120 Hz hook", () => {
    const cam = createCamera(0, 0, 1);
    cam.x = 100;
    render(cam, 0.5);
    expect(cam.renderedX).toBe(50);
    render(cam, 0.5);
    expect(cam.renderedX).toBe(75);
    render(cam); // blend 1 snaps
    expect(cam.renderedX).toBe(100);
  });

  it("containerTransform places the rendered center mid-view", () => {
    const cam = createCamera(200, 100, 2);
    render(cam);
    const t = containerTransform(cam, VIEW);
    expect(t.scale).toBe(2);
    expect(t.x).toBe(VIEW.width / 2 - 200 * 2);
    expect(t.y).toBe(VIEW.height / 2 - 100 * 2);
  });

  it("visibleWorldBounds maps viewport corners through the rendered transform", () => {
    const cam = createCamera(200, -80, 2);
    render(cam);
    const bounds = visibleWorldBounds(cam, VIEW);
    expect(bounds).toEqual({
      minX: -120,
      minY: -260,
      maxX: 520,
      maxY: 100,
    });

    expect(worldToScreen(cam, VIEW, bounds.minX, bounds.minY)).toEqual({ sx: 0, sy: 0 });
    expect(worldToScreen(cam, VIEW, bounds.maxX, bounds.maxY)).toEqual({
      sx: VIEW.width,
      sy: VIEW.height,
    });
  });

  it("visibleWorldBounds follows render interpolation, not the target camera", () => {
    const cam = createCamera(0, 0, 1);
    cam.x = 100;
    cam.y = 50;
    render(cam, 0.5);
    const bounds = visibleWorldBounds(cam, VIEW);
    expect(bounds.minX).toBe(-590);
    expect(bounds.maxX).toBe(690);
    expect(bounds.minY).toBe(-335);
    expect(bounds.maxY).toBe(385);
  });
});

describe("frame-rate-aware blend (ADR-008 ProMotion, task 12g)", () => {
  it("60 Hz and 120 Hz converge identically per wall-clock time (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -2000, max: 2000, noNaN: true }),
        fc.integer({ min: 1, max: 20 }),
        (target, sixtyFrames) => {
          const at60 = createCamera(0, 0, 1);
          const at120 = createCamera(0, 0, 1);
          at60.x = target;
          at120.x = target;
          for (let i = 0; i < sixtyFrames; i++) {
            render(at60, frameBlend(1000 / 60));
          }
          for (let i = 0; i < sixtyFrames * 2; i++) {
            render(at120, frameBlend(1000 / 120));
          }
          expect(at120.renderedX).toBeCloseTo(at60.renderedX, 6);
        },
      ),
    );
  });

  it("blend is 0 for non-positive deltas and approaches 1 for huge ones", () => {
    expect(frameBlend(0)).toBe(0);
    expect(frameBlend(-5)).toBe(0);
    expect(frameBlend(10_000)).toBeCloseTo(1, 6);
  });
});
