/**
 * Catalog identity contract: map selection UIs need stable ids, seeds, and
 * non-duplicate terrain fingerprints before they can rank or compare starts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMap } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { archetypeMapId, CATALOG_SEEDS, GENERATED_MAP_SIZE, MAP_ARCHETYPES } from "./generate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function mapPath(archetype: string): string {
  return join(ROOT, "maps", `${archetype}.civmap`);
}

function terrainFingerprint(map: Awaited<ReturnType<typeof decodeMap>>): string {
  const { elevation, resource, water } = map.terrain.layers;
  let waterTiles = 0;
  let resourceTiles = 0;
  let elevationSum = 0;
  let elevationWeighted = 0;
  for (let i = 0; i < water.length; i++) {
    const waterValue = water[i] ?? 0;
    const resourceValue = resource[i] ?? 0;
    const elevationValue = elevation[i] ?? 0;
    waterTiles += waterValue;
    resourceTiles += resourceValue;
    elevationSum += elevationValue;
    elevationWeighted = (elevationWeighted + elevationValue * ((i % 997) + 1)) >>> 0;
  }
  return [
    map.terrain.width,
    map.terrain.height,
    waterTiles,
    resourceTiles,
    elevationSum,
    elevationWeighted,
  ].join(":");
}

describe("committed map catalog identity", () => {
  it("keeps one stable map id and generator seed per archetype", async () => {
    const ids = new Set<number>();
    const seeds = new Set<number>();
    const fingerprints = new Set<string>();

    for (const archetype of MAP_ARCHETYPES) {
      const map = await decodeMap(new Uint8Array(readFileSync(mapPath(archetype))));

      expect(map.mapId).toBe(archetypeMapId(archetype));
      expect(map.generatorSeed).toBe(CATALOG_SEEDS[archetype]);
      expect(map.terrain.width).toBe(GENERATED_MAP_SIZE);
      expect(map.terrain.height).toBe(GENERATED_MAP_SIZE);

      ids.add(map.mapId);
      seeds.add(map.generatorSeed);
      fingerprints.add(terrainFingerprint(map));
    }

    expect(ids.size).toBe(MAP_ARCHETYPES.length);
    expect(seeds.size).toBe(MAP_ARCHETYPES.length);
    expect(fingerprints.size).toBe(MAP_ARCHETYPES.length);
  });
});
