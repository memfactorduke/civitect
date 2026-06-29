import { flatTerrain } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { CATALOG_SEEDS, generateMap, MAP_ARCHETYPES } from "./generate";
import { scoreTerrainPlayability } from "./playability";

describe("map playability score", () => {
  it.each(MAP_ARCHETYPES.map((a) => [a] as const))("%s catalog map is playable", (archetype) => {
    const map = generateMap(archetype, CATALOG_SEEDS[archetype], 128);
    const score = scoreTerrainPlayability(map.terrain);

    expect(score.score).toBeGreaterThanOrEqual(45);
    expect(score.band).not.toBe("hostile");
    expect(score.landTiles + score.waterTiles).toBe(score.totalTiles);
    expect(score.resourceTiles).toBeGreaterThan(0);
  });

  it("counts easy waterfront and resource access from terrain layers", () => {
    const terrain = flatTerrain(4, 3);
    for (let x = 0; x < 4; x++) {
      terrain.layers.water[x] = 1;
    }
    terrain.layers.elevation[4] = 1;
    terrain.layers.elevation[5] = 2;
    terrain.layers.elevation[6] = 3;
    terrain.layers.elevation[7] = 4;
    terrain.layers.resource[5] = 1;

    const score = scoreTerrainPlayability(terrain);

    expect(score.totalTiles).toBe(12);
    expect(score.landTiles).toBe(8);
    expect(score.waterTiles).toBe(4);
    expect(score.easyBuildableTiles).toBe(7);
    expect(score.waterfrontBuildableTiles).toBe(3);
    expect(score.resourceTiles).toBe(1);
  });

  it("warns on flat maps with no water or resources", () => {
    const score = scoreTerrainPlayability(flatTerrain(16, 16));

    expect(score.score).toBeLessThan(80);
    expect(score.warnings).toContain("limited-water-access");
    expect(score.warnings).toContain("resource-scarcity");
  });

  it("penalizes water-heavy starts with little buildable land", () => {
    const terrain = flatTerrain(16, 16);
    terrain.layers.water.fill(1);
    for (let y = 6; y < 10; y++) {
      for (let x = 6; x < 10; x++) {
        const i = y * 16 + x;
        terrain.layers.water[i] = 0;
      }
    }
    terrain.layers.resource[7 * 16 + 7] = 1;

    const score = scoreTerrainPlayability(terrain);

    expect(score.band).toBe("hostile");
    expect(score.warnings).toContain("low-buildable-land");
    expect(score.warnings).toContain("water-heavy");
  });

  it("reports malformed terrain layers", () => {
    const terrain = {
      ...flatTerrain(4, 4),
      layers: {
        ...flatTerrain(4, 4).layers,
        water: new Uint16Array(2),
      },
    };

    expect(() => scoreTerrainPlayability(terrain)).toThrow(
      "terrain layer water has 2 cells, grid wants 16",
    );
  });
});
