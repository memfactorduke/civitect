import { SnapshotKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createDevHarnessSnapshot, createDevHarnessTerrain, DEV_HARNESS_MAP_SIZE } from "./harness";

describe("renderer dev harness inputs", () => {
  it("creates a non-empty synthetic island terrain with water, relief, and resources", () => {
    const terrain = createDevHarnessTerrain();
    expect(terrain.width).toBe(DEV_HARNESS_MAP_SIZE);
    expect(terrain.height).toBe(DEV_HARNESS_MAP_SIZE);

    let waterTiles = 0;
    let resourceTiles = 0;
    let raisedLandTiles = 0;
    for (let i = 0; i < terrain.layers.water.length; i++) {
      if ((terrain.layers.water[i] as number) !== 0) {
        waterTiles++;
        expect(terrain.layers.elevation[i]).toBe(0);
      }
      if ((terrain.layers.resource[i] as number) !== 0) {
        resourceTiles++;
      }
      if ((terrain.layers.elevation[i] as number) > 0) {
        raisedLandTiles++;
      }
    }

    expect(waterTiles).toBeGreaterThan(0);
    expect(resourceTiles).toBeGreaterThan(0);
    expect(raisedLandTiles).toBeGreaterThan(0);
  });

  it("keeps the synthetic highlight path inside the map", () => {
    const mapSize = 8;
    const visited = new Set<string>();
    for (let tick = 0; tick < mapSize * mapSize * 5 * 2; tick++) {
      const snapshot = createDevHarnessSnapshot(tick, mapSize);
      expect(snapshot.kind).toBe(SnapshotKind.delta);
      expect(snapshot.tick).toBe(tick);
      expect(snapshot.selectedTile).not.toBeNull();
      const tile = snapshot.selectedTile as { readonly x: number; readonly y: number };
      expect(tile.x).toBeGreaterThanOrEqual(0);
      expect(tile.x).toBeLessThan(mapSize);
      expect(tile.y).toBeGreaterThanOrEqual(0);
      expect(tile.y).toBeLessThan(mapSize);
      visited.add(`${tile.x},${tile.y}`);
    }

    expect(visited.size).toBe(mapSize * mapSize);
  });
});
