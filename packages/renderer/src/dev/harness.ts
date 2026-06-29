/**
 * Pure inputs for the renderer dev harness. Keeping these outside the browser
 * entry lets CI prove the diagnostic scene still feeds realistic map + snapshot
 * data without importing Pixi, DOM, or sim code.
 */
import { flatTerrain, type Snapshot, SnapshotKind, type TerrainGrid } from "@civitect/protocol";

export const DEV_HARNESS_MAP_SIZE = 64;

export function createDevHarnessTerrain(mapSize = DEV_HARNESS_MAP_SIZE): TerrainGrid {
  const terrain = flatTerrain(mapSize, mapSize);
  for (let y = 0; y < mapSize; y++) {
    for (let x = 0; x < mapSize; x++) {
      const i = y * mapSize + x;
      const d = Math.max(Math.abs(x - mapSize / 2), Math.abs(y - mapSize / 2));
      terrain.layers.elevation[i] = d < 28 ? Math.max(0, 6 - (d >> 2)) : 0;
      terrain.layers.water[i] = d >= 28 ? 1 : 0;
      terrain.layers.resource[i] = x > 40 && x < 48 && y > 10 && y < 14 ? 1 : 0;
    }
  }
  return terrain;
}

export function createDevHarnessSnapshot(tick: number, mapSize = DEV_HARNESS_MAP_SIZE): Snapshot {
  const step = Math.floor(tick / 5); // crawl one tile per half second
  return {
    kind: SnapshotKind.delta,
    tick,
    speed: 1,
    selectedTile: { x: step % mapSize, y: Math.floor(step / mapSize) % mapSize },
    dirtyChunkIds: new Uint32Array(0),
    hud: { population: 0, fundsCents: 0 },
    advisorEvents: [],
    roadVersion: 0,
    roads: null,
    demand: { r: 0, c: 0, i: 0, o: 0, factors: [] },
    buildingVersion: 0,
    buildings: null,
    zoneVersion: 0,
    zones: null,
    agentCount: 0,
    congestionVersion: 0,
    congestion: null,
    coverageService: 0,
    coverageVersion: 0,
    coverage: null,
    report: null,
    milestone: null,
  };
}
