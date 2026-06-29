/**
 * Render frame-budget harness (Phase 1 exit criterion 1, render half):
 * boots the REAL renderer on an L-map terrain, feeds a 500-segment road
 * snapshot, then pans the camera while measuring frame times.
 * window.__runRenderPerf drives it; the spec asserts the budget.
 */
import { flatTerrain, type RoadSegment, type Snapshot, SnapshotKind } from "@civitect/protocol";
import { bootRenderer } from "@civitect/renderer";

const SIZE = 512;
const PERF_FRAME_COUNT_MAX = 1_200;
const ROAD_SAMPLE_FRAME = {
  x: -320,
  y: 4_420,
  width: 640,
  height: 640,
  copyTo<T extends { x: number; y: number; width: number; height: number }>(target: T): T {
    target.x = this.x;
    target.y = this.y;
    target.width = this.width;
    target.height = this.height;
    return target;
  },
};
const ROAD_SAMPLE_RESOLUTION = 0.5;

export interface RenderPerfSample {
  readonly width: number;
  readonly height: number;
  readonly visiblePixels: number;
  readonly roadLikePixels: number;
}

export interface RenderPerfResult {
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly over33Ms: number;
  readonly frames: number;
  readonly sample: RenderPerfSample;
}

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

function sampleRoadGrid(renderer: Awaited<ReturnType<typeof bootRenderer>>): RenderPerfSample {
  const { pixels, width, height } = renderer.app.renderer.extract.pixels({
    target: renderer.stage.root,
    frame: ROAD_SAMPLE_FRAME,
    resolution: ROAD_SAMPLE_RESOLUTION,
  });
  let visiblePixels = 0;
  let roadLikePixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    const alpha = pixels[i + 3] ?? 0;
    if (alpha === 0) {
      continue;
    }
    visiblePixels++;
    if (Math.abs(r - g) <= 5 && Math.abs(g - b) <= 8 && r >= 60 && r <= 130) {
      roadLikePixels++;
    }
  }
  return { width, height, visiblePixels, roadLikePixels };
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
      if (!Number.isInteger(frameCount) || frameCount <= 0 || frameCount > PERF_FRAME_COUNT_MAX) {
        throw new Error(`invalid render perf frame count: ${frameCount}`);
      }
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
          const result: RenderPerfResult = {
            p95Ms: sorted[Math.ceil(0.95 * sorted.length) - 1],
            maxMs: sorted[sorted.length - 1],
            over33Ms: durations.filter((d) => d > 33.4).length,
            frames: durations.length,
            sample: sampleRoadGrid(renderer),
          };
          resolve(result);
        }
      };
      renderer.app.ticker.add(tickerFn);
    });
  (window as unknown as Record<string, unknown>).__renderPerfReady = true;
}

void main();
