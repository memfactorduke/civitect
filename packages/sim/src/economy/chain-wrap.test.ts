/**
 * Ledger u32-wrap conservation (the ~20-game-year horizon, GDD §8).
 * The cumulative ledgers (produced/consumed/imported/exported/lost) are
 * Uint32Array and wrap at 2^32 over very long games (~20+ game-years at metro
 * scale). The conservation identity holds EXACTLY in modular u32 arithmetic, so
 * chainConservationResidual / reconcileLost must treat a balanced-but-wrapped
 * ledger as conserved — while still surfacing a genuine (small, non-multiple-of-
 * 2^32) leak. Constructed directly so the wrap is exercised without a 10M-tick run.
 */
import { describe, expect, it } from "vitest";
import { createWorld, type World } from "../world";
import { chainConservationResidual, reconcileLost } from "./chain";

// Empty world: no buildings (stock = 0), no shipments (inTransit = 0).
// Commodity index 0 with a producer that wrapped once past 2^32:
//   true produced = 2^32 + 10  -> stored 10
//   out side (consumed + exported) sums to 2^32 + 10 with NO individual wrap
//   raw residual = 10 - (4_000_000_000 + 294_967_306) = -2^32  -> books balance
function balancedWrappedWorld(): World {
  const world = createWorld(71, 64, 64);
  world.chain.produced[0] = 10;
  world.chain.consumed[0] = 4_000_000_000;
  world.chain.exported[0] = 294_967_306;
  return world;
}

describe("ledger u32 wrap (the ~20-game-year horizon)", () => {
  it("conservation residual is 0 for a balanced ledger that wrapped 2^32", () => {
    const world = balancedWrappedWorld();
    expect(chainConservationResidual(world.chain, world.buildings)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("reconcileLost books no phantom deficit when a balanced ledger wrapped", () => {
    const world = balancedWrappedWorld();
    const lostBefore = world.chain.lost[0] as number;
    reconcileLost(world.chain, world.buildings);
    expect(world.chain.lost[0]).toBe(lostBefore);
    expect(chainConservationResidual(world.chain, world.buildings)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("still surfaces a genuine leak (a small residual) despite the wrap", () => {
    const world = balancedWrappedWorld();
    // 7 units vanish from the books on top of the wrap: residual = -2^32 - 7,
    // which must reduce to -7 (a real leak), not 0 (the wrap must not hide it).
    world.chain.lost[0] = (world.chain.lost[0] as number) + 7;
    const residual = chainConservationResidual(world.chain, world.buildings);
    expect(residual[0]).toBe(-7);
  });

  it("residual is 0 when the CONSUMED side wrapped (K<0, raw = +2^32)", () => {
    // produced+imported high, consumed wrapped once past 2^32 (stored 10).
    // raw residual = (4_000_000_000 + 294_967_306) - 10 = +2^32 -> reduces to 0.
    const world = createWorld(71, 64, 64);
    world.chain.produced[0] = 4_000_000_000;
    world.chain.imported[0] = 294_967_306;
    world.chain.consumed[0] = 10;
    expect(chainConservationResidual(world.chain, world.buildings)).toEqual([0, 0, 0, 0, 0, 0]);
    const lostBefore = world.chain.lost[0] as number;
    reconcileLost(world.chain, world.buildings); // +2^32 raw deficit must NOT book a phantom
    expect(world.chain.lost[0]).toBe(lostBefore);
  });

  it("residual is 0 when produced wrapped TWICE (K=2), and a genuine leak still shows", () => {
    // produced true = 2*2^32 + 10 (stored 10); out side sums to 2*2^32 + 10.
    const world = createWorld(71, 64, 64);
    world.chain.produced[0] = 10;
    world.chain.consumed[0] = 4_000_000_000;
    world.chain.exported[0] = 4_000_000_000;
    world.chain.lost[0] = 589_934_602; // 4e9 + 4e9 + 589_934_602 = 2*2^32 + 10
    expect(chainConservationResidual(world.chain, world.buildings)).toEqual([0, 0, 0, 0, 0, 0]);
    world.chain.lost[0] = (world.chain.lost[0] as number) + 3; // genuine 3-unit leak atop K=2
    expect(chainConservationResidual(world.chain, world.buildings)[0]).toBe(-3);
  });
});
