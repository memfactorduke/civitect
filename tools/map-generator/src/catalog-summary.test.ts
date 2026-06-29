import { describe, expect, it } from "vitest";
import { catalogSummaries, summarizeMap } from "./catalog-summary";
import { CATALOG_SEEDS, generateMap, MAP_ARCHETYPES, MapArchetype } from "./generate";

describe("map catalog summaries", () => {
  it("summarizes every catalog archetype without mutating generation", () => {
    const summaries = catalogSummaries(64);

    expect(summaries).toHaveLength(MAP_ARCHETYPES.length);
    for (const summary of summaries) {
      expect(summary.seed).toBe(CATALOG_SEEDS[summary.archetype]);
      expect(summary.width).toBe(64);
      expect(summary.height).toBe(64);
      expect(summary.landTiles + summary.waterTiles).toBe(64 * 64);
      expect(summary.landTiles).toBeGreaterThan(0);
      expect(summary.waterTiles).toBeGreaterThan(0);
      expect(summary.waterPermille).toBeGreaterThanOrEqual(0);
      expect(summary.waterPermille).toBeLessThanOrEqual(1000);
      expect(summary.resourcePermille).toBeGreaterThanOrEqual(0);
      expect(summary.resourcePermille).toBeLessThanOrEqual(1000);
      expect(summary.tags).toContain(summary.archetype);
      expect(summary.tags).toContain(summary.waterProfile);
      expect(summary.tags).toContain(summary.relief);
      expect(summary.tags).toContain(summary.resourceProfile);
      expect(summary.tags).toContain(summary.difficulty);
    }
  });

  it("keeps summary output deterministic for the same map", () => {
    const seed = CATALOG_SEEDS[MapArchetype.coastalBay];
    const map = generateMap(MapArchetype.coastalBay, seed, 128);

    expect(summarizeMap(MapArchetype.coastalBay, seed, map)).toEqual(
      summarizeMap(MapArchetype.coastalBay, seed, map),
    );
  });

  it("classifies contrasting starts for future map selection UI", () => {
    const summaries = new Map(catalogSummaries(128).map((summary) => [summary.archetype, summary]));

    expect(summaries.get(MapArchetype.coastalBay)).toMatchObject({
      difficulty: "demanding",
      relief: "steep",
      waterProfile: "balanced-water",
    });
    expect(summaries.get(MapArchetype.greatPlains)).toMatchObject({
      difficulty: "standard",
      resourceProfile: "sparse-resources",
      waterProfile: "low-water",
    });
  });
});
