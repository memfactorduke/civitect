/**
 * Renderer dev harness (`pnpm --filter @civitect/renderer dev`).
 *
 * Boots the real Pixi stage and feeds it synthetic protocol snapshots that
 * walk the highlight around the map — proves boot + snapshot consumption +
 * highlight visually, with zero sim involvement (the wall holds even in dev
 * tooling: renderer may not import @civitect/sim). The genuine
 * worker round trip is board PR 7's job.
 */
import { flatTerrain, type Snapshot, SnapshotKind } from "@civitect/protocol";
import { attachCameraControls, bootRenderer } from "../boot";

const MAP = 64;

function syntheticSnapshot(tick: number): Snapshot {
  const step = Math.floor(tick / 5); // crawl one tile per half second
  return {
    kind: SnapshotKind.delta,
    tick,
    speed: 1,
    selectedTile: { x: step % MAP, y: Math.floor(step / MAP) % MAP },
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

async function main(): Promise<void> {
  const host = document.getElementById("world");
  if (host === null) {
    throw new Error("dev page is missing #world");
  }
  // Synthetic terraced island (same formula family as the map fixture) —
  // the dev harness shows real chunk tints without touching the sim.
  const terrain = flatTerrain(MAP, MAP);
  for (let y = 0; y < MAP; y++) {
    for (let x = 0; x < MAP; x++) {
      const i = y * MAP + x;
      const d = Math.max(Math.abs(x - MAP / 2), Math.abs(y - MAP / 2));
      terrain.layers.elevation[i] = d < 28 ? Math.max(0, 6 - (d >> 2)) : 0;
      terrain.layers.water[i] = d >= 28 ? 1 : 0;
      terrain.layers.resource[i] = x > 40 && x < 48 && y > 10 && y < 14 ? 1 : 0;
    }
  }
  const renderer = await bootRenderer({ host, mapWidth: MAP, mapHeight: MAP, terrain });
  attachCameraControls(renderer, host); // drag to pan, wheel to zoom

  let tick = 0;
  renderer.app.ticker.add(() => {
    // 10 Hz-ish synthetic feed off the render ticker — dev-only shortcut.
    tick += 1;
    renderer.consume(syntheticSnapshot(tick));
  });
}

void main();
