/**
 * Phase 3 tranche 1 verification. The headline is CONSERVATION (exit
 * criterion 2): every generated trip is accounted — assigned, walked, or
 * unroutable — EXACTLY, across arbitrary grown cities.
 */
import { CommandType } from "@civitect/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createWorld, runTick, type World } from "../world";
import { bprCost } from "./assignment";

const road = (seq: number, tick: number, ax: number, ay: number, bx: number, by: number) =>
  ({ seq, tick, type: CommandType.buildRoad, ax, ay, bx, by, roadClass: 1 }) as const;

function grownWorld(seed: number, days: number): World {
  const world = createWorld(seed);
  let seq = 0;
  runTick(world, [road(seq++, 0, 8, 20, 56, 20)]);
  runTick(world, [
    { seq: seq++, tick: world.tick, type: CommandType.placeBuilding, x: 10, y: 21, building: 1 },
  ]);
  runTick(world, [
    { seq: seq++, tick: world.tick, type: CommandType.placeBuilding, x: 12, y: 21, building: 2 },
  ]);
  runTick(world, [
    {
      seq: seq++,
      tick: world.tick,
      type: CommandType.zoneRect,
      x0: 13,
      y0: 18,
      x1: 40,
      y1: 19,
      zone: 1,
    },
  ]);
  runTick(world, [
    {
      seq: seq++,
      tick: world.tick,
      type: CommandType.zoneRect,
      x0: 41,
      y0: 21,
      x1: 55,
      y1: 22,
      zone: 5,
    },
  ]);
  for (let t = 0; t < 1440 * days; t++) {
    runTick(world, []);
  }
  return world;
}

describe("traffic assignment (GDD §9, Phase 3 tranche 1)", () => {
  it("CONSERVATION: generated ≡ assigned + walked + unroutable (property — exit criterion)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 3, max: 8 }),
        (seed, days) => {
          const world = grownWorld(seed, days);
          const t = world.traffic;
          expect(t.generated).toBe(t.assigned + t.walked + t.unroutable);
          expect(t.generated).toBeGreaterThan(0); // a grown city commutes
        },
      ),
      { numRuns: 8 }, // each run simulates days of city time
    );
  });

  it("assigned trips put volume on edges; congestion raises travel times", () => {
    const world = grownWorld(7, 8);
    const t = world.traffic;
    expect(t.assigned).toBeGreaterThan(0);
    let volumeTotal = 0;
    let congestedEdges = 0;
    for (let e = 0; e < world.roads.edgeCount; e++) {
      if (world.roads.edgeAlive[e] !== 1) {
        continue;
      }
      volumeTotal += t.volumes[e] as number;
      if ((t.congestedCost[e] as number) > 0 && (t.volumes[e] as number) > 0) {
        congestedEdges++;
      }
    }
    expect(volumeTotal).toBeGreaterThan(0);
    expect(congestedEdges).toBeGreaterThan(0);
  });

  it("BPR is integer-exact, monotone in volume, and capped (no pow, no floats)", () => {
    expect(bprCost(1000, 0, 400)).toBe(1000);
    let last = 0;
    for (let v = 0; v <= 2000; v += 100) {
      const c = bprCost(1000, v, 400);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
    expect(bprCost(1000, 4000, 400)).toBe(bprCost(1000, 9999, 400)); // ratio cap
  });

  it("the hourly solve is replay-deterministic (same seed twice)", () => {
    const a = grownWorld(99, 5);
    const b = grownWorld(99, 5);
    expect(Array.from(a.traffic.volumes)).toEqual(Array.from(b.traffic.volumes));
    expect(a.traffic.generated).toBe(b.traffic.generated);
  });
});
