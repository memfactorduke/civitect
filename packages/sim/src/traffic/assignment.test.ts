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
          // Universal invariant ONLY. Richness (generated > 0) is existential —
          // growth-luck-dependent at 3 days (CI counterexample: seed 2, days 3
          // grew a city with zero employed commuters at the final hourly
          // solve) — and is pinned deterministically in the seed-7 test below.
          expect(t.generated).toBe(t.assigned + t.walked + t.unroutable);
        },
      ),
      { numRuns: 8 }, // each run simulates days of city time
    );
  });

  it("assigned trips put volume on edges; congestion raises travel times", () => {
    const world = grownWorld(7, 8);
    const t = world.traffic;
    expect(t.generated).toBeGreaterThan(0); // richness asserted HERE, deterministically
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

describe("jam diagnosis (Phase 3 exit criterion: diagnosable bottleneck)", () => {
  it("an under-built single corridor saturates and emits an edge-ref cause chain", () => {
    const world = createWorld(4242);
    let seq = 0;
    const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
    // West residential island ↔ east jobs island, ONE street between them.
    cmd({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 20, by: 20, roadClass: 1 });
    cmd({ type: CommandType.buildRoad, ax: 20, ay: 20, bx: 44, by: 20, roadClass: 1 }); // the bottleneck
    cmd({ type: CommandType.buildRoad, ax: 44, ay: 20, bx: 56, by: 20, roadClass: 1 });
    cmd({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
    cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
    cmd({ type: CommandType.placeBuilding, x: 52, y: 21, building: 1 });
    cmd({ type: CommandType.placeBuilding, x: 54, y: 21, building: 2 });
    cmd({ type: CommandType.zoneRect, x0: 9, y0: 14, x1: 19, y1: 19, zone: 2 });
    cmd({ type: CommandType.zoneRect, x0: 9, y0: 21, x1: 19, y1: 24, zone: 2 });
    cmd({ type: CommandType.zoneRect, x0: 45, y0: 21, x1: 55, y1: 23, zone: 5 });
    cmd({ type: CommandType.zoneRect, x0: 45, y0: 17, x1: 55, y1: 19, zone: 4 });
    let jam: import("@civitect/protocol").AdvisorEvent | undefined;
    for (let t = 0; t < 1440 * 45 && jam === undefined; t++) {
      runTick(world, []);
      jam = world.advisorQueue.find((e) => e.messageKey === "advisor.congestion");
      if (t % 1440 === 0) {
        world.advisorQueue.length = 0; // drain non-jam noise like a snapshot would
      }
    }
    expect(jam).toBeDefined();
    const edgeLink = jam?.cause.links.find((l) => l.subject.kind === 3);
    expect(edgeLink).toBeDefined();
    // RESOLVE: the named edge is alive and genuinely over capacity.
    const e = edgeLink?.subject.id as number;
    expect(world.roads.edgeAlive[e]).toBe(1);
    expect(world.traffic.volumes[e] as number).toBeGreaterThan(
      world.roads.edgeCapacity_[e] as number,
    );
  });
});
