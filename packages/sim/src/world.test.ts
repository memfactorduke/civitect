import { type Command, CommandType, flatTerrain, RejectionReason } from "@civitect/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
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
  // RE-PINNED in phase-1 task 7b (terrain appended) and again in task 8
  // (canonical road graph appended) — deliberate stacked blesses, each
  // with its own balance-diff in its PR.

  it("fresh world, seed 1234", () => {
    expect(stateHash(createWorld(1234))).toBe("7e928abf254402ce");
  });

  it("empty city after 1000 ticks, seed 1234", () => {
    expect(stateHash(replay(1234, [], 1000).world)).toBe("9c3ac62220fa2c29");
  });

  it("empty city after one game-year, seed 1234 (the proto-golden, ROADMAP Phase 0 exit)", () => {
    const { world } = replay(1234, [], TICKS_PER_GAME_YEAR);
    expect(world.tick).toBe(525_600);
    expect(stateHash(world)).toBe("9a92215ff0f2770f");
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
