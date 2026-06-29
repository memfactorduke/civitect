import { tileCenterToWorld } from "@civitect/renderer";
import { describe, expect, it } from "vitest";
import { viewportHintFromWorldCorners } from "./viewport";

describe("viewportHintFromWorldCorners", () => {
  it("returns the clamped tile bounds covered by visible world corners", () => {
    expect(
      viewportHintFromWorldCorners(
        [
          tileCenterToWorld(10, 20),
          tileCenterToWorld(18, 22),
          tileCenterToWorld(12, 28),
          tileCenterToWorld(20, 30),
        ],
        64,
        64,
      ),
    ).toEqual({ x0: 10, y0: 20, x1: 20, y1: 30 });
  });

  it("clamps north-edge corners by tile axes instead of world-x sign", () => {
    expect(
      viewportHintFromWorldCorners(
        [
          tileCenterToWorld(20, -4),
          tileCenterToWorld(30, -4),
          tileCenterToWorld(20, -1),
          tileCenterToWorld(30, -1),
        ],
        64,
        64,
      ),
    ).toEqual({ x0: 20, y0: 0, x1: 30, y1: 0 });
  });

  it("expands to the whole map when the viewport corners span past every edge", () => {
    expect(
      viewportHintFromWorldCorners(
        [
          tileCenterToWorld(-10, -10),
          tileCenterToWorld(80, -10),
          tileCenterToWorld(-10, 80),
          tileCenterToWorld(80, 80),
        ],
        64,
        64,
      ),
    ).toEqual({ x0: 0, y0: 0, x1: 63, y1: 63 });
  });

  it("rejects empty corner lists and invalid maps", () => {
    expect(() => viewportHintFromWorldCorners([], 64, 64)).toThrow(
      "viewport hint needs at least one world corner",
    );
    expect(() => viewportHintFromWorldCorners([tileCenterToWorld(0, 0)], 0, 64)).toThrow(
      "viewport hint needs positive map dimensions",
    );
  });
});
