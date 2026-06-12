import { type Command, CommandType, RejectionReason } from "@civitect/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { replay } from "./replay";
import { createWorld, runTick, stateHash, TICKS_PER_GAME_YEAR } from "./world";

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

  it("fresh world, seed 1234", () => {
    expect(stateHash(createWorld(1234))).toBe("5a856993df0e550e");
  });

  it("empty city after 1000 ticks, seed 1234", () => {
    expect(stateHash(replay(1234, [], 1000).world)).toBe("4700fd9615a1f109");
  });

  it("empty city after one game-year, seed 1234 (the proto-golden, ROADMAP Phase 0 exit)", () => {
    const { world } = replay(1234, [], TICKS_PER_GAME_YEAR);
    expect(world.tick).toBe(525_600);
    expect(stateHash(world)).toBe("bb15b4106250fb2f");
  });
});

describe("protocol v3 road commands before road state exists (phase-1 task 8)", () => {
  it("rejects buildRoad as unknownCommand and leaves state untouched", () => {
    const untouched = createWorld(42);
    const poked = createWorld(42);
    runTick(untouched, []);
    const rejections = runTick(poked, [
      {
        seq: 3,
        tick: 0,
        type: CommandType.buildRoad,
        ax: 1,
        ay: 1,
        bx: 2,
        by: 1,
        roadClass: 1,
      },
    ]);
    expect(rejections).toEqual([{ seq: 3, tick: 0, reason: RejectionReason.unknownCommand }]);
    expect(stateHash(poked)).toBe(stateHash(untouched));
  });
});
