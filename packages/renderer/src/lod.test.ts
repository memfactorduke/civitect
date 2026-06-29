import { describe, expect, it } from "vitest";
import { LodTier } from "./camera";
import { layerVisibilityForLod } from "./lod";

describe("renderer LOD layer visibility (ADR-008/TDD §8)", () => {
  it("far zoom keeps planning layers, but hides expensive detail", () => {
    expect(layerVisibilityForLod(LodTier.far)).toEqual({
      buildings: false,
      agents: false,
      toolGhosts: true,
      dataOverlays: true,
    });
  });

  it("mid zoom restores static city detail, but not live agents", () => {
    expect(layerVisibilityForLod(LodTier.mid)).toEqual({
      buildings: true,
      agents: false,
      toolGhosts: true,
      dataOverlays: true,
    });
  });

  it("near zoom renders the full live scene", () => {
    expect(layerVisibilityForLod(LodTier.near)).toEqual({
      buildings: true,
      agents: true,
      toolGhosts: true,
      dataOverlays: true,
    });
  });
});
