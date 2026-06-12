import { tileCenterToWorld } from "@civitect/renderer";
import { describe, expect, it } from "vitest";
import { pickTile } from "./picking";

const IDENTITY = { offsetX: 0, offsetY: 0, scale: 1 };

describe("pointer → tile picking", () => {
  it("picks the tile whose diamond center is under the pointer", () => {
    const c = tileCenterToWorld(5, 9);
    expect(pickTile(IDENTITY, c.wx, c.wy, 64, 64)).toEqual({ x: 5, y: 9 });
  });

  it("honors the stage offset (camera position)", () => {
    const c = tileCenterToWorld(2, 3);
    const transform = { offsetX: 400, offsetY: 120, scale: 1 };
    expect(pickTile(transform, c.wx + 400, c.wy + 120, 64, 64)).toEqual({ x: 2, y: 3 });
  });

  it("returns null off-map instead of clamping (no phantom selections)", () => {
    const offMap = tileCenterToWorld(64, 0); // first column past a 64-wide map
    expect(pickTile(IDENTITY, offMap.wx, offMap.wy, 64, 64)).toBeNull();
    const negative = tileCenterToWorld(-1, 0);
    expect(pickTile(IDENTITY, negative.wx, negative.wy, 64, 64)).toBeNull();
  });
});
