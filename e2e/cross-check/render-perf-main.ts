/**
 * Render frame-budget harness (Phase 1 exit criterion 1, render half):
 * boots the REAL renderer on an L-map terrain, feeds a 500-segment road
 * snapshot, then pans the camera while measuring frame times.
 * window.__runRenderPerf drives it; the spec asserts the budget.
 */
import { flatTerrain, type RoadSegment, type Snapshot, SnapshotKind } from "@civitect/protocol";
import { bootRenderer } from "@civitect/renderer";

const SIZE = 512;

function syntheticTerrain() {
  const terrain = flatTerrain(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      terrain.layers.elevation[i] = ((x >> 5) + (y >> 5)) % 7;
      if (((x * 31 + y * 17) & 127) === 0) terrain.layers.water[i] = 1;
    }
  }
  return terrain;
}

/** The same 25×10 + 25×10 grid as the road-grid-500-01 golden. */
function gridSegments(): RoadSegment[] {
  const segs: RoadSegment[] = [];
  for (let row = 0; row < 25; row++) {
    const y = 100 + row * 12;
    for (let i = 0; i < 10; i++) {
      segs.push({ ax: 100 + i * 10, ay: y, bx: 100 + (i + 1) * 10, by: y, roadClass: 1 });
    }
  }
  for (let col = 0; col < 25; col++) {
    const x = 100 + col * 10;
    for (let i = 0; i < 10; i++) {
      segs.push({ ax: x, ay: 100 + i * 12, bx: x, by: 100 + (i + 1) * 12, roadClass: 2 });
    }
  }
  return segs;
}

function snapshotWithRoads(roads: RoadSegment[]): Snapshot {
  return {
    kind: SnapshotKind.keyframe,
    tick: 0,
    speed: 1,
    selectedTile: null,
    dirtyChunkIds: new Uint32Array(0),
    hud: { population: 0, fundsCents: 0 },
    advisorEvents: [],
    roadVersion: 1,
    roads,
    demand: { r: 0, c: 0, i: 0, o: 0, factors: [] },
    buildingVersion: 0,
    buildings: null,
    zoneVersion: 0,
    zones: null,
  };
}

async function main(): Promise<void> {
  const host = document.getElementById("world");
  if (host === null) throw new Error("missing #world");
  const renderer = await bootRenderer({
    host,
    mapWidth: SIZE,
    mapHeight: SIZE,
    terrain: syntheticTerrain(),
  });
  renderer.consume(snapshotWithRoads(gridSegments()));

  (window as unknown as Record<string, unknown>).__runRenderPerf = (frameCount: number) =>
    new Promise((resolve) => {
      const durations: number[] = [];
      let last = performance.now();
      let frame = 0;
      const tickerFn = (): void => {
        const now = performance.now();
        durations.push(now - last);
        last = now;
        // Pan across the road grid so chunks + road layer + camera all work.
        renderer.panBy(-8, -4);
        if (++frame >= frameCount) {
          renderer.app.ticker.remove(tickerFn);
          const sorted = [...durations].sort((a, b) => a - b);
          resolve({
            p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
            maxMs: sorted[sorted.length - 1],
            over33Ms: durations.filter((d) => d > 33.4).length,
            frames: durations.length,
          });
        }
      };
      renderer.app.ticker.add(tickerFn);
    });
  (window as unknown as Record<string, unknown>).__renderPerfReady = true;
}

void main();
