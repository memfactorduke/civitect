/**
 * Phase 3 tranche 6 / EXIT CRITERION 3 (TDD §2): 250k population + 10k
 * live agents, tick p95 ≤ 10 ms on the device floor. The metro city is
 * CONSTRUCTED (not grown — growing 250k organically is a balance exercise,
 * not a perf one): a 256×256 map, 16-tile avenue grid (auto-split into
 * ~1k edges), ~2.7k buildings carrying 250k+ residents in cohorts, a
 * 10k-cap agent pool watching the whole map.
 *
 * Two assertion tiers, render-perf's pattern inverted:
 * - CI (normalized machine): the 20 ms hard gate — the perf golden in the
 *   ladder, catching structural regressions per PR.
 * - Device (local run, CI unset): the REAL ≤10 ms exit-criterion floor.
 */
import { COHORT_BLOCK, createAgentPool, createWorld, runTick, spawnBuilding } from "@civitect/sim";
import { describe, expect, it } from "vitest";
import { percentile } from "./runner";

const MAP = 256;
const BLOCK = 16;
const SEED = 4242;

function buildMetro() {
  const world = createWorld(SEED, MAP, MAP);
  let seq = 0;
  const road = (ax: number, ay: number, bx: number, by: number) =>
    runTick(world, [
      { seq: seq++, tick: world.tick, type: 3, ax, ay, bx, by, roadClass: 2 } as never,
    ]);
  // Avenue grid: 16 verticals × 16 horizontals, auto-split intersections.
  for (let k = 0; k < 16; k++) {
    const c = 8 + BLOCK * k;
    road(c, 8, c, MAP - 8);
    road(8, c, MAP - 8, c);
  }
  // Residents + jobs per block, cohorts written directly (a constructed
  // scenario, not a replay — perf is the metric, not provenance).
  const b = world.buildings;
  let pop = 0;
  for (let by = 0; by < 15; by++) {
    for (let bx = 0; bx < 15; bx++) {
      const x0 = 8 + BLOCK * bx;
      const y0 = 8 + BLOCK * by;
      for (let i = 0; i < 8; i++) {
        // Residential row hugs the north avenue; jobs row the south.
        const rTile = (y0 + 1) * MAP + x0 + 2 + i;
        const r = spawnBuilding(b, rTile, 1); // residentialLow
        const base = r * COHORT_BLOCK;
        b.cohorts[base + 0] = 30; // children
        b.cohorts[base + 8] = 110; // adults E0
        b.cohorts[base + 16] = 90; // employed E0
        pop += 140;
        if (i < 4) {
          const jTile = (y0 + BLOCK - 1) * MAP + x0 + 2 + i;
          spawnBuilding(b, jTile, 3); // commercialLow — jobs from capacity
        }
      }
    }
  }
  // Utilities so the city HOLDS 250k through the run (unserved buildings
  // abandon within days and residents emigrate — found at pop 210k).
  for (let k = 0; k < 15; k += 2) {
    spawnBuilding(b, (8 + BLOCK * k + 2) * MAP + 9, 101); // power plant
    spawnBuilding(b, (8 + BLOCK * k + 2) * MAP + 11, 102); // water pump
  }
  // The 10k agent pool (GDD §9.4 scale), camera over the whole map = the
  // sampler's worst case; spawn budget raised to actually REACH 10k live.
  world.agents = createAgentPool(SEED, 10_000);
  world.agents.spawnsPerSample = 400;
  world.viewport = { x0: 0, y0: 0, x1: MAP - 1, y1: MAP - 1 };
  return { world, pop };
}

describe("metro perf (exit criterion 3: 250k pop + 10k agents)", () => {
  it("tick p95 within budget over a full game-day", async () => {
    const { world, pop } = buildMetro();
    expect(pop).toBeGreaterThanOrEqual(250_000);

    // Warm up through construction settling (utilities, first solves),
    // then run morning hours so peaks + the 04:00 full solve are in frame.
    // Yield the event loop periodically — a long synchronous loop starves
    // vitest's worker RPC on slow runners (the balance gate's lesson);
    // yields sit BETWEEN ticks, outside every per-tick measurement.
    for (let t = 0; t < 240; t++) {
      runTick(world, []);
      if (t % 120 === 0) {
        await new Promise(setImmediate);
      }
    }
    expect(world.population).toBeGreaterThanOrEqual(250_000);

    const durations = new Float64Array(1440);
    for (let t = 0; t < 1440; t++) {
      const start = performance.now();
      runTick(world, []);
      durations[t] = performance.now() - start;
      if (t % 120 === 0) {
        await new Promise(setImmediate);
      }
    }
    expect(world.agents.liveCount).toBeGreaterThanOrEqual(10_000 * 0.95); // pool saturated
    expect(world.population).toBeGreaterThanOrEqual(250_000); // held through the run

    const p95 = percentile(durations, 0.95);
    const p99 = percentile(durations, 0.99);
    let max = 0;
    let sum = 0;
    for (const d of durations) {
      if (d > max) max = d;
      sum += d;
    }
    console.log(
      `[metro-perf] pop=${world.population} agents=${world.agents.liveCount} ` +
        `edges≈${world.roads.edgeCount} ticks=${durations.length} ` +
        `p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms max=${max.toFixed(3)}ms ` +
        `total=${(sum / 1000).toFixed(2)}s`,
    );
    // CI: the 20 ms hard gate (normalized machine, structural tripwire).
    expect(p95).toBeLessThanOrEqual(20);
    if (process.env.CI === undefined) {
      // Device floor — THE exit criterion (TDD §2, ROADMAP Phase 3).
      expect(p95).toBeLessThanOrEqual(10);
    }
  });
});
