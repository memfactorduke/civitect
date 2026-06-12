import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TILE_H, TILE_W, tileCenterToWorld, tileToWorld, worldToTile } from "./iso";

describe("iso transforms (TDD §11 tile metric: 64×32 at 1×)", () => {
  it("origin tile's top corner is the world origin", () => {
    expect(tileToWorld(0, 0)).toEqual({ wx: 0, wy: 0 });
  });

  it("east neighbor (+x) steps right and down half a tile", () => {
    expect(tileToWorld(1, 0)).toEqual({ wx: TILE_W / 2, wy: TILE_H / 2 });
  });

  it("south neighbor (+y) steps left and down half a tile", () => {
    expect(tileToWorld(0, 1)).toEqual({ wx: -TILE_W / 2, wy: TILE_H / 2 });
  });

  it("tile centers sit half a tile-height below top corners", () => {
    expect(tileCenterToWorld(3, 5)).toEqual({
      wx: tileToWorld(3, 5).wx,
      wy: tileToWorld(3, 5).wy + TILE_H / 2,
    });
  });

  it("picking a tile's center returns that tile (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1024 }), fc.integer({ min: 0, max: 1024 }), (x, y) => {
        const { wx, wy } = tileCenterToWorld(x, y);
        expect(worldToTile(wx, wy)).toEqual({ x, y });
      }),
    );
  });

  it("picking any interior point of a tile's diamond returns that tile (property)", () => {
    // Sample interior points as a convex combination biased away from edges.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 512 }),
        fc.integer({ min: 0, max: 512 }),
        fc.double({ min: -0.45, max: 0.45, noNaN: true }),
        fc.double({ min: -0.45, max: 0.45, noNaN: true }),
        (x, y, u, v) => {
          const c = tileCenterToWorld(x, y);
          // u along the E-W diagonal, v along the N-S diagonal, |u|+|v| < 1/2
          // of each half-extent keeps the point strictly inside the diamond.
          const scale = 0.5;
          const wx = c.wx + u * scale * TILE_W;
          const wy = c.wy + v * scale * TILE_H * (1 - Math.abs(u) * 2);
          expect(worldToTile(wx, wy)).toEqual({ x, y });
        },
      ),
    );
  });
});
