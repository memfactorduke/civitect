import { flatTerrain } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import {
  CHUNK_TILES,
  chunkIdOf,
  chunkLayout,
  chunkTiles,
  dirtyChunks,
  terrainTint,
} from "./chunks";

describe("chunk math (TDD §8: 32×32-tile chunks)", () => {
  it("lays out exact multiples and ragged edges", () => {
    expect(chunkLayout(64, 64)).toEqual({ chunksX: 2, chunksY: 2, count: 4 });
    expect(chunkLayout(512, 512).count).toBe(256);
    expect(chunkLayout(33, 1)).toEqual({ chunksX: 2, chunksY: 1, count: 2 });
  });

  it("addresses chunks row-major and clips ragged tiles to the map", () => {
    const layout = chunkLayout(64, 64);
    expect(chunkIdOf(layout, 0, 0)).toBe(0);
    expect(chunkIdOf(layout, 32, 0)).toBe(1);
    expect(chunkIdOf(layout, 31, 32)).toBe(2);
    expect(chunkIdOf(layout, 63, 63)).toBe(3);

    const ragged = chunkLayout(40, 40);
    expect(chunkTiles(ragged, 3, 40, 40)).toEqual({ x0: 32, y0: 32, x1: 40, y1: 40 });
  });

  it("chunk tiles tile the map exactly once (no gaps, no overlaps)", () => {
    const layout = chunkLayout(40, 33);
    const seen = new Set<number>();
    for (let id = 0; id < layout.count; id++) {
      const rect = chunkTiles(layout, id, 40, 33);
      for (let y = rect.y0; y < rect.y1; y++) {
        for (let x = rect.x0; x < rect.x1; x++) {
          const key = y * 40 + x;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
    expect(seen.size).toBe(40 * 33);
  });

  it("maps changed tiles to a deduplicated, sorted re-bake list", () => {
    const layout = chunkLayout(64, 64);
    expect(
      dirtyChunks(layout, [
        { x: 0, y: 0 },
        { x: 1, y: 1 }, // same chunk
        { x: 40, y: 40 }, // chunk 3
        { x: CHUNK_TILES, y: 0 }, // chunk 1
      ]),
    ).toEqual([0, 1, 3]);
  });

  it("tints water over resources over elevation, clamping the ramp", () => {
    const terrain = flatTerrain(4, 1);
    terrain.layers.elevation[0] = 99; // clamps to ramp top
    terrain.layers.resource[1] = 1;
    terrain.layers.water[2] = 1;
    terrain.layers.resource[2] = 1; // water wins
    const top = terrainTint(terrain, 0, 0);
    const resource = terrainTint(terrain, 1, 0);
    const water = terrainTint(terrain, 2, 0);
    const flat = terrainTint(terrain, 3, 0);
    expect(new Set([top, resource, water, flat]).size).toBe(4);
    expect(water).toBe(terrainTint(terrain, 2, 0));
  });
});
