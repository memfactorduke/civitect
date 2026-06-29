import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planDirtyTileRects, rectArea } from "./dirty-rects";

describe("dirty rectangle planner", () => {
  it("drops invalid and duplicate tiles before building a stable plan", () => {
    const forward = planDirtyTileRects(8, 8, [
      { x: 5, y: 3 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: -1, y: 0 },
      { x: 8, y: 0 },
      { x: 3.5, y: 1 },
    ]);
    const reversed = planDirtyTileRects(8, 8, [
      { x: 3.5, y: 1 },
      { x: 8, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 5, y: 3 },
    ]);

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      dirtyTiles: 3,
      redrawTiles: 3,
      fallbackFullMap: false,
      reason: "within-budget",
    });
    expect(forward.rects).toEqual([
      { x0: 1, y0: 1, x1: 3, y1: 2 },
      { x0: 5, y0: 3, x1: 6, y1: 4 },
    ]);
  });

  it("coalesces matching row runs into vertical redraw rectangles", () => {
    expect(
      planDirtyTileRects(12, 12, [
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 2, y: 5 },
        { x: 3, y: 5 },
        { x: 8, y: 5 },
        { x: 2, y: 6 },
        { x: 3, y: 6 },
      ]).rects,
    ).toEqual([
      { x0: 2, y0: 4, x1: 4, y1: 7 },
      { x0: 8, y0: 5, x1: 9, y1: 6 },
    ]);
  });

  it("falls back to a full-map redraw when dirty tile or rect budgets are exceeded", () => {
    expect(
      planDirtyTileRects(
        10,
        10,
        [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
        { maxDirtyTiles: 2 },
      ),
    ).toMatchObject({
      rects: [{ x0: 0, y0: 0, x1: 10, y1: 10 }],
      dirtyTiles: 3,
      redrawTiles: 100,
      fallbackFullMap: true,
      reason: "too-many-dirty-tiles",
    });

    expect(
      planDirtyTileRects(
        10,
        10,
        [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
        ],
        { maxRects: 1 },
      ),
    ).toMatchObject({
      rects: [{ x0: 0, y0: 0, x1: 10, y1: 10 }],
      dirtyTiles: 2,
      redrawTiles: 100,
      fallbackFullMap: true,
      reason: "too-many-rects",
    });
  });

  it("rejects impossible map and budget values", () => {
    expect(() => planDirtyTileRects(0, 8, [])).toThrow(/mapWidth/);
    expect(() => planDirtyTileRects(8, 0, [])).toThrow(/mapHeight/);
    expect(() => planDirtyTileRects(8, 8, [], { maxRects: 0 })).toThrow(/maxRects/);
    expect(() => planDirtyTileRects(8, 8, [], { maxDirtyTiles: 0 })).toThrow(/maxDirtyTiles/);
  });

  it("covers every in-bounds dirty tile without emitting off-map rects (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 32 }),
        fc.integer({ min: 1, max: 32 }),
        fc.array(
          fc.record({
            x: fc.integer({ min: -4, max: 35 }),
            y: fc.integer({ min: -4, max: 35 }),
          }),
          { maxLength: 180 },
        ),
        (width, height, tiles) => {
          const plan = planDirtyTileRects(width, height, tiles, {
            maxDirtyTiles: width * height,
            maxRects: width * height,
          });
          const covered = new Set<number>();
          let redrawTiles = 0;
          for (const rect of plan.rects) {
            expect(rect.x0).toBeGreaterThanOrEqual(0);
            expect(rect.y0).toBeGreaterThanOrEqual(0);
            expect(rect.x1).toBeLessThanOrEqual(width);
            expect(rect.y1).toBeLessThanOrEqual(height);
            expect(rectArea(rect)).toBeGreaterThan(0);
            redrawTiles += rectArea(rect);
            for (let y = rect.y0; y < rect.y1; y++) {
              for (let x = rect.x0; x < rect.x1; x++) {
                covered.add(y * width + x);
              }
            }
          }

          const dirty = new Set(
            tiles
              .filter((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < width && tile.y < height)
              .map((tile) => tile.y * width + tile.x),
          );
          for (const key of dirty) {
            expect(covered.has(key)).toBe(true);
          }
          expect(plan.dirtyTiles).toBe(dirty.size);
          expect(plan.redrawTiles).toBe(redrawTiles);
        },
      ),
    );
  });
});
