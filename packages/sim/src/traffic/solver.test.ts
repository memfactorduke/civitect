/**
 * Phase 3 tranche 2 verification (TDD §6.3): the solver is SLICED (no
 * hour-boundary work spike — the per-tick work bound is structural),
 * volumes persist and converge under MSA, the daily 04:00 full solve
 * resets the averaging counter, and network edits leave traffic state a
 * function of surviving operations (undo-identity holds — see world.test).
 */
import { CommandType } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createWorld, runTick, type World } from "../world";
import {
  FULL_SOLVE_HOUR,
  FULL_SOLVE_PASSES,
  ORIGINS_PER_TICK,
  SolveKind,
  startSolveJob,
  stepSolveJob,
  trafficToSave,
} from "./solver";

const TICKS_PER_HOUR = 60;

function grownWorld(seed: number, days: number): World {
  const world = createWorld(seed);
  let seq = 0;
  const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
  cmd({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
  cmd({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
  cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
  cmd({ type: CommandType.zoneRect, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 });
  cmd({ type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 });
  for (let t = 0; t < 1440 * days; t++) {
    runTick(world, []);
  }
  return world;
}

function finishJob(world: World, hourOfDay = 8): void {
  while (world.traffic.job !== null) {
    stepSolveJob(
      world.traffic,
      world.buildings,
      world.roads,
      world.mapWidth,
      world.mapHeight,
      hourOfDay,
    );
  }
}

/** Blend one PEAK-hour incremental step — overnight curves decay volumes
 * to zero (by design), so probes that need traffic drive a rush hour. */
function peakStep(world: World): void {
  finishJob(world);
  startSolveJob(world.traffic, SolveKind.incremental);
  finishJob(world, 8);
}

describe("sliced solver (TDD §6.3 — no hour-boundary spike)", () => {
  it("an hourly step spans multiple ticks and finishes within budget", () => {
    const world = grownWorld(7, 2);
    // Walk to the next hour boundary with no job in flight.
    finishJob(world);
    while (world.tick % TICKS_PER_HOUR !== 0 || world.traffic.job !== null) {
      runTick(world, []);
    }
    runTick(world, []); // the boundary tick starts (and slices) the job
    expect(world.traffic.job).not.toBeNull(); // genuinely sliced, not one-shot
    // Per-tick WORK is fixed; the pass bound derives from the cell count.
    const cellsX = Math.ceil(world.mapWidth / 8);
    const cellsY = Math.ceil(world.mapHeight / 8);
    const bound = Math.ceil((cellsX * cellsY) / ORIGINS_PER_TICK) * FULL_SOLVE_PASSES + 1;
    let ticks = 1;
    while (world.traffic.job !== null) {
      runTick(world, []);
      ticks++;
      expect(ticks).toBeLessThanOrEqual(bound); // structural work bound
    }
    expect(ticks).toBeGreaterThan(1);
  });

  it("volumes persist between solves and only move at pass finalize", () => {
    const world = grownWorld(7, 2);
    peakStep(world);
    const idle = trafficToSave(world.traffic, world.roads).volumes;
    expect(idle.reduce((s, v) => s + v, 0)).toBeGreaterThan(0); // memory, not derived
    while (world.tick % TICKS_PER_HOUR !== 0 || world.traffic.job !== null) {
      runTick(world, []);
    }
    runTick(world, []); // job starts; first slice processed
    if (world.traffic.job !== null) {
      // Mid-job: canonical volumes untouched until the blend.
      expect(trafficToSave(world.traffic, world.roads).volumes).toEqual(idle);
    }
  });

  it("the 04:00 full equilibrium solve resets the MSA counter to 1", () => {
    const world = grownWorld(7, 1);
    // Walk to 04:00, then run the boundary tick itself (it starts the job).
    while (Math.floor(world.tick / TICKS_PER_HOUR) % 24 !== FULL_SOLVE_HOUR) {
      runTick(world, []);
    }
    runTick(world, []);
    expect(world.traffic.job?.kind).toBe(SolveKind.full);
    while (world.traffic.job !== null) {
      runTick(world, []);
    }
    expect(world.traffic.msaK).toBe(1);
  });

  it("MSA converges on static demand: successive-step movement shrinks", () => {
    const world = grownWorld(7, 8);
    finishJob(world);
    // Drive the solver directly (no runTick → no growth): static OD.
    let prev = trafficToSave(world.traffic, world.roads).volumes;
    const movement: number[] = [];
    for (let step = 0; step < 6; step++) {
      startSolveJob(world.traffic, SolveKind.incremental);
      finishJob(world, 8); // fixed peak hour = static demand
      const cur = trafficToSave(world.traffic, world.roads).volumes;
      let delta = 0;
      for (let i = 0; i < cur.length; i++) {
        delta += Math.abs((cur[i] as number) - (prev[i] as number));
      }
      movement.push(delta);
      prev = cur;
    }
    // Convergence band: each step moves volumes no more than the first,
    // and the tail is strictly calmer than the head.
    for (const delta of movement) {
      expect(delta).toBeLessThanOrEqual(movement[0] as number);
    }
    expect(movement[5] as number).toBeLessThanOrEqual(Math.ceil((movement[0] as number) / 2));
  });

  it("network edits keep volumes for surviving canonical edges (no reset)", () => {
    const world = grownWorld(7, 2);
    peakStep(world);
    const before = world.traffic.canonVolumes;
    expect(before.size).toBeGreaterThan(0);
    // Build a disconnected spur far from the corridor: the corridor's
    // canonical edges (and their volumes) must survive untouched.
    runTick(world, [
      {
        seq: 9000,
        tick: world.tick,
        type: CommandType.buildRoad,
        ax: 60,
        ay: 60,
        bx: 63,
        by: 60,
        roadClass: 1,
      } as never,
    ]);
    for (const [key, v] of before) {
      expect(world.traffic.canonVolumes.get(key)).toBe(v);
    }
  });
});
