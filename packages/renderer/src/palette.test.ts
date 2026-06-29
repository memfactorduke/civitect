import { describe, expect, it } from "vitest";
import {
  AGENT_CAR_COLOR,
  AGENT_PEDESTRIAN_COLOR,
  COVERAGE_OVERLAY_COLOR,
  type ColorVisionMode,
  congestionColor,
  contrastRatio,
  GRID_COLOR,
  HIGHLIGHT_COLOR,
  PLOPPABLE_COLOR,
  ROAD_STYLE,
  simulateColorVision,
  ZONE_COLOR,
} from "./palette";

const COLOR_VISION_MODES: readonly ColorVisionMode[] = ["protanopia", "deuteranopia", "tritanopia"];

function simulatedContrast(a: number, b: number, mode: ColorVisionMode): number {
  return contrastRatio(simulateColorVision(a, mode), simulateColorVision(b, mode));
}

describe("renderer palette accessibility gate", () => {
  it("keeps the traffic overlay ramp separable under common color-vision simulations", () => {
    const ramp = [0, 500, 900, 1200].map((permille) => congestionColor(permille));
    expect(new Set(ramp).size).toBe(ramp.length);

    for (let i = 1; i < ramp.length; i++) {
      expect(contrastRatio(ramp[i - 1] as number, ramp[i] as number)).toBeGreaterThanOrEqual(1.45);
      for (const mode of COLOR_VISION_MODES) {
        expect(
          simulatedContrast(ramp[i - 1] as number, ramp[i] as number, mode),
        ).toBeGreaterThanOrEqual(1.25);
      }
    }
  });

  it("keeps the selection highlight and live overlays visible over the placeholder grid", () => {
    expect(contrastRatio(HIGHLIGHT_COLOR, GRID_COLOR)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(COVERAGE_OVERLAY_COLOR, GRID_COLOR)).toBeGreaterThanOrEqual(2.4);
    expect(contrastRatio(AGENT_CAR_COLOR, GRID_COLOR)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(AGENT_PEDESTRIAN_COLOR, GRID_COLOR)).toBeGreaterThanOrEqual(4.5);

    for (const mode of COLOR_VISION_MODES) {
      expect(simulatedContrast(HIGHLIGHT_COLOR, GRID_COLOR, mode)).toBeGreaterThanOrEqual(4.5);
      expect(simulatedContrast(COVERAGE_OVERLAY_COLOR, GRID_COLOR, mode)).toBeGreaterThanOrEqual(
        2.4,
      );
    }
  });

  it("keeps placeholder zone, ploppable, and road palettes complete for the current protocol ids", () => {
    expect(
      Object.keys(ZONE_COLOR)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      Object.keys(PLOPPABLE_COLOR)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 22 }, (_, i) => i + 101));
    expect(
      Object.keys(ROAD_STYLE)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 11, 12, 13, 14]);
  });

  it("makes bridges read as wider/lighter versions of their matching base roads", () => {
    for (const base of [1, 2, 3, 4]) {
      const road = ROAD_STYLE[base] as { readonly width: number; readonly color: number };
      const bridge = ROAD_STYLE[base + 10] as { readonly width: number; readonly color: number };
      expect(bridge.width).toBeGreaterThan(road.width);
      expect(contrastRatio(bridge.color, road.color)).toBeGreaterThanOrEqual(1.2);
    }
  });
});
