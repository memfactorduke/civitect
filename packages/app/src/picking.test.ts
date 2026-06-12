import { tileCenterToWorld } from "@civitect/renderer";
import { describe, expect, it } from "vitest";
import { pickTileAt } from "./picking";

describe("world-px → tile picking", () => {
  it("picks the tile whose diamond center is given", () => {
    const c = tileCenterToWorld(5, 9);
    expect(pickTileAt(c.wx, c.wy, 64, 64)).toEqual({ x: 5, y: 9 });
  });

  it("returns null off-map instead of clamping (no phantom selections)", () => {
    const offMap = tileCenterToWorld(64, 0); // first column past a 64-wide map
    expect(pickTileAt(offMap.wx, offMap.wy, 64, 64)).toBeNull();
    const negative = tileCenterToWorld(-1, 0);
    expect(pickTileAt(negative.wx, negative.wy, 64, 64)).toBeNull();
  });
});
