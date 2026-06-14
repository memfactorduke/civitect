import { type Command, CommandType, flatTerrain, RejectionReason } from "@civitect/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeDemand } from "./growth/demand";
import { aggregates } from "./growth/system";
import { replay } from "./replay";
import { segmentRelation } from "./roads/geometry";
import { canonicalGraph, nodeAt } from "./roads/graph";
import {
  controlAt,
  createWorld,
  IntersectionControl,
  runTick,
  stateHash,
  TICKS_PER_GAME_YEAR,
  type World,
} from "./world";

const MAP = 64; // default Phase 0 map

/**
 * Command logs over a small tick horizon, mixing valid and invalid commands
 * (out-of-bounds tiles, illegal speeds) — rejections must be exactly as
 * deterministic as acceptances.
 */
const commandLogArb: fc.Arbitrary<Command[]> = fc
  .array(
    fc.record({
      tick: fc.nat({ max: 49 }),
      payload: fc.oneof(
        fc.record({ x: fc.nat({ max: 100 }), y: fc.nat({ max: 100 }) }),
        fc.record({ speed: fc.nat({ max: 9 }) }),
      ),
    }),
    { maxLength: 30 },
  )
  .map((entries) =>
    entries.map((e, i): Command => {
      if ("x" in e.payload) {
        return {
          seq: i,
          tick: e.tick,
          type: CommandType.selectTile,
          x: e.payload.x,
          y: e.payload.y,
        };
      }
      return { seq: i, tick: e.tick, type: CommandType.setSpeed, speed: e.payload.speed };
    }),
  );

describe("replay determinism (ADR-005)", () => {
  it("same seed + same log ⇒ identical state hash and rejections (property)", () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), commandLogArb, (seed, log) => {
        const a = replay(seed, log, 50);
        const b = replay(seed, log, 50);
        expect(stateHash(b.world)).toBe(stateHash(a.world));
        expect(b.rejections).toEqual(a.rejections);
      }),
    );
  });

  it("log assembly order is irrelevant — replay canonicalizes by (tick, seq) (property)", () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), commandLogArb, (seed, log) => {
        const reversed = [...log].reverse();
        expect(stateHash(replay(seed, reversed, 50).world)).toBe(
          stateHash(replay(seed, log, 50).world),
        );
      }),
    );
  });

  it("different seeds ⇒ different hashes (RNG state is part of the world)", () => {
    expect(stateHash(replay(1, [], 10).world)).not.toBe(stateHash(replay(2, [], 10).world));
  });
});

describe("command application", () => {
  it("selectTile in bounds updates the selection", () => {
    const world = createWorld(42);
    const rejections = runTick(world, [
      { seq: 0, tick: 0, type: CommandType.selectTile, x: 3, y: 4 },
    ]);
    expect(rejections).toEqual([]);
    expect(world.selectedTileIdx).toBe(4 * MAP + 3);
  });

  it("selectTile out of bounds is rejected and leaves state untouched", () => {
    const accepted = createWorld(42);
    const rejected = createWorld(42);
    runTick(accepted, []);
    const rejections = runTick(rejected, [
      { seq: 7, tick: 0, type: CommandType.selectTile, x: MAP, y: 0 },
    ]);
    expect(rejections).toEqual([{ seq: 7, tick: 0, reason: RejectionReason.outOfBounds }]);
    expect(stateHash(rejected)).toBe(stateHash(accepted));
  });

  it("setSpeed accepts exactly the GDD §13 tiers (0/1/3/9) and rejects the rest", () => {
    const world = createWorld(42);
    for (const speed of [0, 1, 3, 9]) {
      const rejections = runTick(world, [
        { seq: speed, tick: world.tick, type: CommandType.setSpeed, speed },
      ]);
      expect(rejections).toEqual([]);
      expect(world.speed).toBe(speed);
    }
    const rejections = runTick(world, [
      { seq: 99, tick: world.tick, type: CommandType.setSpeed, speed: 2 },
    ]);
    expect(rejections).toEqual([{ seq: 99, tick: 4, reason: RejectionReason.invalidTarget }]);
    expect(world.speed).toBe(9); // unchanged by the rejection
  });

  it("same-tick commands apply in seq order regardless of array order", () => {
    const world = createWorld(42);
    runTick(world, [
      { seq: 2, tick: 0, type: CommandType.selectTile, x: 9, y: 9 },
      { seq: 1, tick: 0, type: CommandType.selectTile, x: 1, y: 1 },
    ]);
    expect(world.selectedTileIdx).toBe(9 * MAP + 9); // seq 2 wins, not "last in array"
  });

  it("refuses commands stamped for the wrong tick (caller bug, not a rejection)", () => {
    const world = createWorld(42);
    expect(() =>
      runTick(world, [{ seq: 0, tick: 5, type: CommandType.selectTile, x: 0, y: 0 }]),
    ).toThrow(/stamped for tick 5/);
  });

  it("replay refuses logs that extend past the horizon instead of dropping them", () => {
    const log: Command[] = [{ seq: 0, tick: 10, type: CommandType.setSpeed, speed: 3 }];
    expect(() => replay(1, log, 10)).toThrow(/extends to tick 10/);
  });
});

describe("pinned hashes (engine-stability tripwires)", () => {
  // If one of these changes, either world layout/serialization changed (fine:
  // re-pin, say so in the PR — this is a bless) or the engine broke integer
  // determinism (catastrophic: investigate before touching the pin).
  // RE-PINNED at each canonical-state append (deliberate, documented):
  // terrain (P1 7b), roads (P1 8), buildings+cohorts (P2 systems),
  // traffic MSA volumes + solver job (P3 tranche 2), pins (P3 tranche 3),
  // service fields + budgets + ground pollution (P4 task 2), the economy
  // block + starting funds (P5 task 2 — THE funds bless), the chain block +
  // per-building chainRole/stockIn/stockOut (P5 task 3 — the freight bless;
  // empty worlds append zeroed chain state, so these move with no behavior
  // change — freight/de-level are dormant without industry or anchors), the
  // district block + ordinance mask (P6 task 1 — empty worlds append a zeroed
  // districts block, again no behavior change).

  it("fresh world, seed 1234", () => {
    expect(stateHash(createWorld(1234))).toBe("2049565035105689");
  });

  it("empty city after 1000 ticks, seed 1234", () => {
    expect(stateHash(replay(1234, [], 1000).world)).toBe("1ca07338702f1dbc");
  });

  it("empty city after one game-year, seed 1234 (the proto-golden, ROADMAP Phase 0 exit)", () => {
    const { world } = replay(1234, [], TICKS_PER_GAME_YEAR);
    expect(world.tick).toBe(525_600);
    expect(stateHash(world)).toBe("dd0e2cd2ba97d9a6");
  });
});

describe("service budgets in the tick pipeline (phase-4 task 2)", () => {
  const budget = (seq: number, tick: number, service: number, permille: number) =>
    ({ seq, tick, type: CommandType.setServiceBudget, service, permille }) as Command;

  it("a slider move is canonical: accepted, hashed, replay-stable", () => {
    const a = replay(7, [budget(0, 3, 1, 1500)], 10);
    const b = replay(7, [budget(0, 3, 1, 1500)], 10);
    expect(a.rejections).toEqual([]);
    expect(stateHash(a.world)).toBe(stateHash(b.world));
    expect(a.world.services.budgetsPermille[0]).toBe(1500);
    expect(stateHash(a.world)).not.toBe(stateHash(replay(7, [], 10).world));
  });

  it("the sim re-checks the domain even though decode already did (authority)", () => {
    const world = createWorld(7);
    const rejections = runTick(world, [budget(0, 0, 1, 400)]);
    expect(rejections.map((r) => r.reason)).toEqual([RejectionReason.invalidTarget]);
    const more = runTick(world, [budget(1, 1, 99, 1000)]);
    expect(more.map((r) => r.reason)).toEqual([RejectionReason.invalidTarget]);
    // Rejected sliders leave no fingerprints: same hash as idle ticks.
    const reference = createWorld(7);
    runTick(reference, []);
    runTick(reference, []);
    expect(stateHash(world)).toBe(stateHash(reference));
  });
});

describe("road commands in the tick pipeline (phase-1 task 8)", () => {
  const build = (seq: number, tick: number, ax: number, ay: number, bx: number, by: number) =>
    ({ seq, tick, type: CommandType.buildRoad, ax, ay, bx, by, roadClass: 1 }) as Command;
  const undo = (seq: number, tick: number) => ({ seq, tick, type: CommandType.undo }) as Command;
  const redo = (seq: number, tick: number) => ({ seq, tick, type: CommandType.redo }) as Command;

  it("build∘undo ≡ identity on the state hash (Phase 1 exit criterion, property)", () => {
    fc.assert(
      fc.property(
        fc.maxSafeNat(),
        fc.array(
          fc.record({
            ax: fc.nat({ max: 63 }),
            ay: fc.nat({ max: 63 }),
            bx: fc.nat({ max: 63 }),
            by: fc.nat({ max: 63 }),
          }),
          { minLength: 1, maxLength: 12 },
        ),
        (seed, segments) => {
          const baseline = createWorld(seed);
          const world = createWorld(seed);
          runTick(baseline, []);

          // Build N segments on tick 0 (rejections fine — they're no-ops on
          // both undo accounting and state), then undo exactly the number
          // of ACCEPTED builds.
          const commands = segments.map((s2, i) => build(i, 0, s2.ax, s2.ay, s2.bx, s2.by));
          const rejected = runTick(world, commands).length;
          const accepted = segments.length - rejected;
          for (let i = 0; i < accepted; i++) {
            const r = runTick(world, [undo(100 + i, world.tick)]);
            expect(r).toEqual([]);
          }
          // Equal tick counts before comparing (ticks advance the counter).
          while (baseline.tick < world.tick) {
            runTick(baseline, []);
          }
          expect(stateHash(world)).toBe(stateHash(baseline));
        },
      ),
      { numRuns: 60 },
    );
  });

  it("build → bulldoze → undo restores the road; redo removes it again", () => {
    const world = createWorld(7);
    expect(runTick(world, [build(0, 0, 1, 1, 2, 1)])).toEqual([]);
    const withRoad = stateHash(world);
    expect(
      runTick(world, [
        { seq: 1, tick: 1, type: CommandType.bulldozeRoad, ax: 1, ay: 1, bx: 2, by: 1 },
      ]),
    ).toEqual([]);
    expect(runTick(world, [undo(2, 2)])).toEqual([]); // un-bulldoze
    const restored = createWorld(7);
    runTick(restored, [build(0, 0, 1, 1, 2, 1)]);
    while (restored.tick < world.tick) {
      runTick(restored, []);
    }
    expect(stateHash(world)).toBe(stateHash(restored));
    expect(withRoad).not.toBe(stateHash(createWorld(7))); // roads really hash
    expect(runTick(world, [redo(3, 3)])).toEqual([]); // re-bulldoze
  });

  it("upgrade changes the hash; undo restores the old class", () => {
    const world = createWorld(9);
    runTick(world, [build(0, 0, 0, 0, 3, 0)]);
    const street = stateHash(world);
    expect(
      runTick(world, [
        {
          seq: 1,
          tick: 1,
          type: CommandType.upgradeRoad,
          ax: 0,
          ay: 0,
          bx: 3,
          by: 0,
          roadClass: 3,
        },
      ]),
    ).toEqual([]);
    expect(stateHash(world)).not.toBe(street);
    runTick(world, [undo(2, 2)]);
    const reference = createWorld(9);
    runTick(reference, [build(0, 0, 0, 0, 3, 0)]);
    while (reference.tick < world.tick) {
      runTick(reference, []);
    }
    expect(stateHash(world)).toBe(stateHash(reference));
  });

  it("rejects out-of-bounds, degenerate, duplicate, and missing-road commands", () => {
    const world = createWorld(11);
    expect(runTick(world, [build(0, 0, 0, 0, 64, 0)])).toEqual([
      { seq: 0, tick: 0, reason: RejectionReason.outOfBounds },
    ]);
    expect(runTick(world, [build(1, 1, 5, 5, 5, 5)])).toEqual([
      { seq: 1, tick: 1, reason: RejectionReason.invalidSegment },
    ]);
    runTick(world, [build(2, 2, 1, 1, 2, 2)]);
    expect(runTick(world, [build(3, 3, 2, 2, 1, 1)])).toEqual([
      { seq: 3, tick: 3, reason: RejectionReason.invalidSegment }, // duplicate, either direction
    ]);
    expect(
      runTick(world, [
        { seq: 4, tick: 4, type: CommandType.bulldozeRoad, ax: 9, ay: 9, bx: 8, by: 9 },
      ]),
    ).toEqual([{ seq: 4, tick: 4, reason: RejectionReason.noSuchRoad }]);
  });

  it("empty stacks reject undo/redo with their own reasons", () => {
    const world = createWorld(13);
    expect(runTick(world, [undo(0, 0)])).toEqual([
      { seq: 0, tick: 0, reason: RejectionReason.nothingToUndo },
    ]);
    expect(runTick(world, [redo(1, 1)])).toEqual([
      { seq: 1, tick: 1, reason: RejectionReason.nothingToRedo },
    ]);
  });

  it("a new build clears the redo stack (standard editor semantics)", () => {
    const world = createWorld(17);
    runTick(world, [build(0, 0, 0, 0, 1, 0)]);
    runTick(world, [undo(1, 1)]);
    runTick(world, [build(2, 2, 0, 0, 0, 1)]);
    expect(runTick(world, [redo(3, 3)])).toEqual([
      { seq: 3, tick: 3, reason: RejectionReason.nothingToRedo },
    ]);
  });
});

describe("intersections, bridges, paths (phase-1 12d/12e)", () => {
  const build = (
    seq: number,
    tick: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    roadClass = 1,
  ) => ({ seq, tick, type: CommandType.buildRoad, ax, ay, bx, by, roadClass }) as Command;

  it("a proper crossing splits both roads through a shared intersection node", () => {
    const world = createWorld(21);
    expect(runTick(world, [build(0, 0, 1, 3, 7, 3)])).toEqual([]);
    expect(runTick(world, [build(1, 1, 4, 1, 4, 6, 2)])).toEqual([]);
    const canon = canonicalGraph(world.roads);
    expect(canon.edges).toHaveLength(4); // two halves each
    expect(nodeAt(world.roads, 4, 3)).not.toBe(-1);
    expect(controlAt(world, nodeAt(world.roads, 4, 3))).toBe(IntersectionControl.signal);
  });

  it("a T-junction splits the touched road and gets a stop (all streets)", () => {
    const world = createWorld(22);
    runTick(world, [build(0, 0, 0, 0, 6, 0)]);
    expect(runTick(world, [build(1, 1, 3, 0, 3, 4)])).toEqual([]);
    const canon = canonicalGraph(world.roads);
    expect(canon.edges).toHaveLength(3);
    expect(controlAt(world, nodeAt(world.roads, 3, 0))).toBe(IntersectionControl.stop);
  });

  it("non-integer crossings and collinear overlaps reject", () => {
    const world = createWorld(23);
    runTick(world, [build(0, 0, 0, 0, 3, 3)]);
    expect(runTick(world, [build(1, 1, 0, 3, 3, 0)])).toEqual([
      { seq: 1, tick: 1, reason: RejectionReason.invalidSegment }, // crosses at 1.5,1.5
    ]);
    expect(runTick(world, [build(2, 2, 1, 1, 5, 5)])).toEqual([
      { seq: 2, tick: 2, reason: RejectionReason.invalidSegment }, // collinear overlap
    ]);
  });

  it("crossing builds undo cleanly (split restoration)", () => {
    const world = createWorld(24);
    runTick(world, [build(0, 0, 1, 3, 7, 3)]);
    const before = stateHash(world);
    runTick(world, [build(1, 1, 4, 1, 4, 6)]);
    expect(runTick(world, [{ seq: 2, tick: 2, type: CommandType.undo } as Command])).toEqual([]);
    const reference = createWorld(24);
    runTick(reference, [build(0, 0, 1, 3, 7, 3)]);
    while (reference.tick < world.tick) {
      runTick(reference, []);
    }
    expect(stateHash(world)).toBe(stateHash(reference));
    expect(before).not.toBe(stateHash(createWorld(24)));
  });

  function riverWorld(): World {
    const terrain = flatTerrain(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 30; x <= 33; x++) {
        terrain.layers.water[y * 64 + x] = 1;
      }
    }
    return createWorld(77, 64, 64, terrain);
  }

  it("water rejects roads, accepts bridges; dry bridges reject", () => {
    const world = riverWorld();
    expect(runTick(world, [build(0, 0, 28, 10, 35, 10)])).toEqual([
      { seq: 0, tick: 0, reason: RejectionReason.invalidSegment }, // street into the river
    ]);
    expect(runTick(world, [build(1, 1, 28, 10, 35, 10, 11)])).toEqual([]); // bridgeStreet
    expect(runTick(world, [build(2, 2, 5, 5, 9, 5, 11)])).toEqual([
      { seq: 2, tick: 2, reason: RejectionReason.invalidSegment }, // dry bridge
    ]);
  });

  it("bridges are grade-separated: crossing under one makes no junction", () => {
    const world = riverWorld();
    runTick(world, [build(0, 0, 28, 10, 35, 10, 11)]); // bridge over river
    // A shore road passing under the bridge approach at (29, ...) — crosses
    // the bridge segment's line on land at integer point (29,10)? The road
    // runs vertically through x=29 land column.
    expect(runTick(world, [build(1, 1, 29, 5, 29, 15)])).toEqual([]);
    const canon = canonicalGraph(world.roads);
    expect(canon.edges).toHaveLength(2); // NO split on either — over/under-pass
  });

  it("cliffs reject roads (tunnels are a later slice)", () => {
    const terrain = flatTerrain(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 20; x < 64; x++) {
        terrain.layers.elevation[y * 64 + x] = 4; // plateau wall at x=20
      }
    }
    const world = createWorld(88, 64, 64, terrain);
    expect(runTick(world, [build(0, 0, 18, 5, 22, 5)])).toEqual([
      { seq: 0, tick: 0, reason: RejectionReason.invalidSegment },
    ]);
  });

  it("planarity invariant: accepted non-bridge edges never properly cross (property)", () => {
    fc.assert(
      fc.property(
        fc.maxSafeNat(),
        fc.array(
          fc.record({
            ax: fc.nat({ max: 15 }),
            ay: fc.nat({ max: 15 }),
            bx: fc.nat({ max: 15 }),
            by: fc.nat({ max: 15 }),
            roadClass: fc.constantFrom(1, 2, 4),
          }),
          { minLength: 2, maxLength: 16 },
        ),
        (seed, segs) => {
          const world = createWorld(seed);
          runTick(
            world,
            segs.map((s2, i) => build(i, 0, s2.ax, s2.ay, s2.bx, s2.by, s2.roadClass)),
          );
          const edges = canonicalGraph(world.roads).edges;
          for (let i = 0; i < edges.length; i++) {
            for (let j = i + 1; j < edges.length; j++) {
              const a = edges[i] as (typeof edges)[number];
              const b = edges[j] as (typeof edges)[number];
              const rel = segmentRelation(a.ax, a.ay, a.bx, a.by, b.ax, b.ay, b.bx, b.by);
              // Anything beyond endpoint-kissing would be a planarity hole.
              if (rel.kind === "point") {
                const sharesEndpoint =
                  (rel.x === a.ax && rel.y === a.ay) || (rel.x === a.bx && rel.y === a.by);
                expect(sharesEndpoint).toBe(true);
              } else {
                expect(rel.kind).toBe("none");
              }
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("zoning, growth, utilities (Phase 2)", () => {
  const road = (seq: number, tick: number, ax: number, ay: number, bx: number, by: number) =>
    ({ seq, tick, type: CommandType.buildRoad, ax, ay, bx, by, roadClass: 1 }) as Command;
  const zone = (
    seq: number,
    tick: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z: number,
  ) => ({ seq, tick, type: CommandType.zoneRect, x0, y0, x1, y1, zone: z }) as Command;
  const place = (seq: number, tick: number, x: number, y: number, building: number) =>
    ({ seq, tick, type: CommandType.placeBuilding, x, y, building }) as Command;

  /** Road spine + plants + zones — the canonical growth scenario. */
  function seedCity(world: World): void {
    let seq = 0;
    runTick(world, [road(seq++, world.tick, 10, 20, 50, 20)]);
    runTick(world, [place(seq++, world.tick, 12, 21, 1)]); // power
    runTick(world, [place(seq++, world.tick, 14, 21, 2)]); // water
    runTick(world, [zone(seq++, world.tick, 15, 18, 40, 19, 1)]); // R rows above road
    runTick(world, [zone(seq++, world.tick, 15, 21, 30, 22, 3)]); // C below
    runTick(world, [zone(seq++, world.tick, 31, 21, 40, 22, 5)]); // I below
  }

  it("zones paint only on land within road depth; zone∘undo ≡ identity on hash", () => {
    const world = createWorld(31);
    runTick(world, [road(0, 0, 10, 20, 30, 20)]);
    const before = stateHash(world);
    expect(runTick(world, [zone(1, 1, 12, 18, 20, 26, 1)])).toEqual([]); // rows ≤4 paint, rest skipped
    expect(world.terrain.layers.zone[18 * 64 + 12]).toBe(1);
    expect(world.terrain.layers.zone[26 * 64 + 12]).toBe(0); // depth 6 — beyond reach
    expect(runTick(world, [{ seq: 2, tick: 2, type: CommandType.undo } as Command])).toEqual([]);
    const reference = createWorld(31);
    runTick(reference, [road(0, 0, 10, 20, 30, 20)]);
    while (reference.tick < world.tick) {
      runTick(reference, []);
    }
    expect(stateHash(world)).toBe(stateHash(reference));
    expect(before).not.toBe(stateHash(createWorld(31)));
  });

  it("zoning far from any road rejects; placing on water rejects", () => {
    const world = createWorld(32);
    expect(runTick(world, [zone(0, 0, 50, 50, 55, 55, 1)])).toEqual([
      { seq: 0, tick: 0, reason: RejectionReason.invalidTarget },
    ]);
    expect(runTick(world, [place(1, 1, 5, 5, 1)])).toEqual([
      { seq: 1, tick: 1, reason: RejectionReason.invalidTarget },
    ]);
  });

  it("a seeded city grows: buildings spawn, people arrive, jobs fill", () => {
    const world = createWorld(33);
    seedCity(world);
    for (let day = 0; day < 30; day++) {
      for (let t = 0; t < 1440; t++) {
        runTick(world, []);
      }
    }
    expect(world.population).toBeGreaterThan(50);
    const agg = aggregates(world.buildings);
    expect(agg.housingCapacity).toBeGreaterThan(0);
    expect(agg.jobsC + agg.jobsI).toBeGreaterThan(0);
    expect(agg.employed).toBeGreaterThan(0);
  });

  it("population conservation: residents ≡ births + immigrants − deaths − emigrants", () => {
    const world = createWorld(34);
    seedCity(world);
    for (let t = 0; t < 1440 * 20; t++) {
      runTick(world, []);
    }
    const f = world.flows;
    expect(world.population).toBe(f.births + f.immigrants - f.deaths - f.emigrants);
  });

  it("losing utilities abandons buildings (with an advisor cause chain) and empties them", () => {
    const world = createWorld(35);
    seedCity(world);
    for (let t = 0; t < 1440 * 10; t++) {
      runTick(world, []);
    }
    const popBefore = world.population;
    expect(popBefore).toBeGreaterThan(0);
    // Bulldoze the power plant's tile building? Plants are buildings — no
    // bulldoze command for buildings yet; instead sever the ROAD the grid
    // rides on: everything disconnects.
    runTick(world, [
      { seq: 90, tick: world.tick, type: CommandType.bulldozeRoad, ax: 10, ay: 20, bx: 50, by: 20 },
    ]);
    let sawAdvisor = false;
    for (let t = 0; t < 1440 * 4; t++) {
      runTick(world, []);
      if (world.advisorQueue.some((e) => e.messageKey === "advisor.abandonment")) {
        sawAdvisor = world.advisorQueue.every((e) => e.cause.links.length > 0);
        world.advisorQueue.length = 0;
      }
    }
    expect(world.population).toBeLessThan(popBefore);
    expect(sawAdvisor).toBe(true); // every warning carries its chain (ADR-009)
  });

  it("demand factors sum EXACTLY to net demand (exit criterion property)", () => {
    fc.assert(
      fc.property(
        fc.record({
          housingCapacity: fc.nat({ max: 10000 }),
          residents: fc.nat({ max: 10000 }),
          jobsC: fc.nat({ max: 5000 }),
          jobsI: fc.nat({ max: 5000 }),
          jobsO: fc.nat({ max: 5000 }),
          employed: fc.nat({ max: 10000 }),
          adults: fc.nat({ max: 10000 }),
          educatedPermille: fc.nat({ max: 1000 }),
          countC: fc.nat({ max: 500 }),
          countI: fc.nat({ max: 500 }),
          countO: fc.nat({ max: 500 }),
        }),
        (agg) => {
          const d = computeDemand(agg);
          const sum = (from: number) =>
            (d.factors[from] as number) +
            (d.factors[from + 1] as number) +
            (d.factors[from + 2] as number);
          expect(d.r).toBe(sum(0));
          expect(d.c).toBe(sum(3));
          expect(d.i).toBe(sum(6));
          expect(d.o).toBe(sum(9));
        },
      ),
    );
  });
});
