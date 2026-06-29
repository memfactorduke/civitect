import { tileCenterToWorld } from "@civitect/renderer";
import { describe, expect, it } from "vitest";
import { pickTileAt } from "./picking";

describe("world-px → tile picking", () => {
  it("picks the tile whose diamond center is given", () => {
    const c = tileCenterToWorld(5, 9);
    expect(pickTileAt(c.wx, c.wy, 64, 64)).toEqual({ x: 5, y: 9 });
  });

  it("picks every map corner at its center", () => {
    for (const [x, y] of [
      [0, 0],
      [63, 0],
      [0, 63],
      [63, 63],
    ] as const) {
      const c = tileCenterToWorld(x, y);
      expect(pickTileAt(c.wx, c.wy, 64, 64)).toEqual({ x, y });
    }
  });

  it("returns null off-map instead of clamping (no phantom selections)", () => {
    const offMap = tileCenterToWorld(64, 0); // first column past a 64-wide map
    expect(pickTileAt(offMap.wx, offMap.wy, 64, 64)).toBeNull();
    const negative = tileCenterToWorld(-1, 0);
    expect(pickTileAt(negative.wx, negative.wy, 64, 64)).toBeNull();
  });

  it("rejects invalid world coordinates instead of returning NaN tiles", () => {
    expect(pickTileAt(Number.NaN, 16, 64, 64)).toBeNull();
    expect(pickTileAt(16, Number.POSITIVE_INFINITY, 64, 64)).toBeNull();
  });

  it("rejects invalid map dimensions before picking", () => {
    const c = tileCenterToWorld(0, 0);
    expect(pickTileAt(c.wx, c.wy, 0, 64)).toBeNull();
    expect(pickTileAt(c.wx, c.wy, -1, 64)).toBeNull();
    expect(pickTileAt(c.wx, c.wy, 64.5, 64)).toBeNull();
    expect(pickTileAt(c.wx, c.wy, 64, Number.NaN)).toBeNull();
  });
});
