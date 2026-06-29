/**
 * Board task 6 verification: maps are reproducible (same seed twice ⇒
 * identical), the committed catalog decodes content-equal to regeneration
 * (bytes may differ across zlib builds; CONTENT may not), and every
 * archetype produces a sane, distinct world.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeMap, encodeMap, ResourceKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import {
  archetypeMapId,
  CATALOG_SEEDS,
  GENERATED_MAP_SIZE,
  generateMap,
  MAP_ARCHETYPES,
} from "./generate";
import { renderPreview } from "./preview";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = (name: string): string => join(ROOT, "maps", `${name}.civmap`);
const previewPath = (name: string): string => join(ROOT, "previews", `${name}.png`);

describe("map generator v1 (TDD §13, GDD §3)", () => {
  it("ships a broader deterministic catalog toward the 24-map launch target", () => {
    expect(MAP_ARCHETYPES.length).toBe(12);
    expect(new Set(MAP_ARCHETYPES).size).toBe(MAP_ARCHETYPES.length);
    expect(MAP_ARCHETYPES.map((archetype) => archetypeMapId(archetype))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("same archetype + seed generates identical maps (reproducibility)", () => {
    for (const archetype of MAP_ARCHETYPES) {
      const a = generateMap(archetype, 12345, 64);
      const b = generateMap(archetype, 12345, 64);
      expect(b).toEqual(a);
    }
  });

  it("different seeds generate different terrain", () => {
    const a = generateMap(MAP_ARCHETYPES[0] as (typeof MAP_ARCHETYPES)[number], 1, 64);
    const b = generateMap(MAP_ARCHETYPES[0] as (typeof MAP_ARCHETYPES)[number], 2, 64);
    expect(b.terrain).not.toEqual(a.terrain);
  });

  it.each(MAP_ARCHETYPES.map((a) => [a] as const))("%s is a sane world", (archetype) => {
    const map = generateMap(archetype, CATALOG_SEEDS[archetype], 128);
    const { water, elevation } = map.terrain.layers;
    let waterTiles = 0;
    let landTiles = 0;
    let resourceTiles = 0;
    let maxElevation = 0;
    for (let i = 0; i < water.length; i++) {
      if ((water[i] as number) !== 0) {
        waterTiles++;
        expect(elevation[i]).toBe(0); // water is flat
      } else {
        landTiles++;
        if ((map.terrain.layers.resource[i] as number) !== ResourceKind.none) {
          resourceTiles++;
        }
        if ((elevation[i] as number) > maxElevation) {
          maxElevation = elevation[i] as number;
        }
      }
    }
    // Every archetype must be playable: mostly land, some water, real relief.
    expect(landTiles).toBeGreaterThan(water.length * 0.3);
    expect(waterTiles).toBeGreaterThan(0);
    expect(resourceTiles).toBeGreaterThan(0);
    expect(maxElevation).toBeGreaterThanOrEqual(2);
    expect(maxElevation).toBeLessThanOrEqual(6);
  });

  it("covers all raw resource starts for industry-specialization playtests", () => {
    const kinds = new Set<number>();
    for (const archetype of MAP_ARCHETYPES) {
      const map = generateMap(archetype, CATALOG_SEEDS[archetype], GENERATED_MAP_SIZE);
      for (const value of map.terrain.layers.resource) {
        if (value !== ResourceKind.none) {
          kinds.add(value);
        }
      }
    }
    expect(kinds).toEqual(
      new Set([ResourceKind.ore, ResourceKind.farm, ResourceKind.forest, ResourceKind.oil]),
    );
  });

  if (process.env.SEED_FIXTURES === "1") {
    it("seeds the v1 catalog (maps + previews, first time only)", async () => {
      mkdirSync(join(ROOT, "maps"), { recursive: true });
      mkdirSync(join(ROOT, "previews"), { recursive: true });
      for (const archetype of MAP_ARCHETYPES) {
        if (existsSync(mapPath(archetype))) {
          continue;
        }
        const map = generateMap(archetype, CATALOG_SEEDS[archetype], GENERATED_MAP_SIZE);
        writeFileSync(mapPath(archetype), await encodeMap(map));
        writeFileSync(previewPath(archetype), await renderPreview(map.terrain));
      }
      expect(MAP_ARCHETYPES.every((a) => existsSync(mapPath(a)))).toBe(true);
    });
  }

  it.each(
    MAP_ARCHETYPES.map((a) => [a] as const),
  )("committed %s decodes content-equal to regeneration", async (archetype) => {
    if (!existsSync(mapPath(archetype))) {
      throw new Error(`catalog missing ${archetype} — run SEED_FIXTURES=1 pnpm test and commit`);
    }
    const committed = await decodeMap(new Uint8Array(readFileSync(mapPath(archetype))));
    const regenerated = generateMap(archetype, CATALOG_SEEDS[archetype], GENERATED_MAP_SIZE);
    // Content equality, not byte equality: deflate output may vary across
    // zlib builds; the MAP may not.
    expect(committed).toEqual(regenerated);
  });
});
