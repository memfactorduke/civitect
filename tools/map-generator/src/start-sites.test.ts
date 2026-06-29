import { flatTerrain } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { CATALOG_SEEDS, generateMap, MAP_ARCHETYPES } from "./generate";
import { findStartSites } from "./start-sites";

describe("map start-site scoring", () => {
  it("prefers buildable land with water and resource access", () => {
    const terrain = flatTerrain(16, 16);
    for (let y = 0; y < terrain.height; y++) {
      for (let x = 0; x < terrain.width; x++) {
        const i = y * terrain.width + x;
        terrain.layers.elevation[i] = x < 8 ? 1 : 5;
      }
    }

    for (let y = 4; y <= 11; y++) {
      terrain.layers.water[y * terrain.width + 2] = 1;
    }
    terrain.layers.resource[8 * terrain.width + 6] = 1;
    terrain.layers.resource[9 * terrain.width + 6] = 1;

    const sites = findStartSites(terrain, { count: 3, radius: 2, edgeBuffer: 2 });

    expect(sites).toHaveLength(3);
    expect(sites[0]).toMatchObject({
      x: 4,
      y: 7,
      buildableTiles: 20,
      waterTiles: 5,
      resourceTiles: 2,
      elevationRange: 0,
    });
    expect(sites[0]?.score).toBeGreaterThanOrEqual(sites[1]?.score ?? Number.NEGATIVE_INFINITY);
  });

  it("is deterministic and sorted for every generated archetype", () => {
    for (const archetype of MAP_ARCHETYPES) {
      const terrain = generateMap(archetype, CATALOG_SEEDS[archetype], 64).terrain;
      const firstPass = findStartSites(terrain, { count: 5, radius: 4, edgeBuffer: 5 });
      const secondPass = findStartSites(terrain, { count: 5, radius: 4, edgeBuffer: 5 });

      expect(secondPass).toEqual(firstPass);
      expect(firstPass).toHaveLength(5);
      for (let i = 0; i < firstPass.length; i++) {
        const site = firstPass[i];
        expect(site).toBeDefined();
        if (!site) {
          continue;
        }
        expect(terrain.layers.water[site.y * terrain.width + site.x]).toBe(0);
        expect(site.buildableTiles).toBeGreaterThan(0);
        expect(site.score).toBeGreaterThan(0);
        if (i > 0) {
          expect((firstPass[i - 1]?.score ?? Number.POSITIVE_INFINITY) >= site.score).toBe(true);
        }
      }
    }
  });

  it("validates option bounds", () => {
    const terrain = flatTerrain(8, 8);

    expect(() => findStartSites(terrain, { count: 0 })).toThrow(/count/);
    expect(() => findStartSites(terrain, { radius: -1 })).toThrow(/radius/);
    expect(() => findStartSites(terrain, { edgeBuffer: -1 })).toThrow(/edgeBuffer/);
  });
});
