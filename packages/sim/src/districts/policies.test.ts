/**
 * Policies move MODELED outcomes, not flavour (GDD §11, board task 3). Each
 * lever is a gated integer read of the (already hashed+saved) policy/ordinance
 * mask, so a city that leaves it off is byte-identical (the district hash-equal-
 * to-idle proof in districts.test covers that) — here we prove the ON direction.
 */
import { CommandType, Policy, ZoneKind } from "@civitect/protocol";
import { beforeAll, describe, expect, it } from "vitest";
import { computeDemand } from "../growth/demand";
import { aggregates } from "../growth/system";
import { createWorld, runTick, type World } from "../world";

type Cmd = Parameters<typeof runTick>[1][number];

/** A zoned R+I town, painted as district 1; `apply` sets a lever (or ticks
 *  once for the baseline, so all worlds share the same tick count), then grow. */
function town(seed: number, days: number, apply: (w: World) => void): World {
  const world = createWorld(seed);
  world.fundsCents += 100_000_000_00; // solvent across the whole run
  let seq = 0;
  const step = (c: Record<string, unknown>) =>
    runTick(world, [{ seq: seq++, tick: world.tick, ...c } as Cmd]);
  step({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
  step({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
  step({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
  step({
    type: CommandType.zoneRect,
    x0: 13,
    y0: 18,
    x1: 40,
    y1: 19,
    zone: ZoneKind.residentialLow,
  });
  step({ type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 22, zone: ZoneKind.industrial });
  step({ type: CommandType.paintDistrict, x0: 8, y0: 18, x1: 56, y1: 22, districtId: 1 });
  apply(world);
  for (let t = 0; t < 1440 * days; t++) {
    runTick(world, []);
  }
  return world;
}

const maxLevel = (w: World): number => {
  let m = 0;
  for (let i = 0; i < w.buildings.count; i++) {
    m = Math.max(m, w.buildings.level[i] as number);
  }
  return m;
};
const groundPollutionSum = (w: World): number => {
  let s = 0;
  for (let i = 0; i < w.groundPollution.length; i++) {
    s += w.groundPollution[i] as number;
  }
  return s;
};

const setPolicy = (bit: number) => (w: World) =>
  runTick(w, [
    {
      seq: 900,
      tick: w.tick,
      type: CommandType.setPolicy,
      districtId: 1,
      policy: bit,
      on: 1,
    } as Cmd,
  ]);
const setOrdinance = (bit: number) => (w: World) =>
  runTick(w, [
    { seq: 900, tick: w.tick, type: CommandType.setOrdinance, ordinance: bit, on: 1 } as Cmd,
  ]);
const idleTick = (w: World) => runTick(w, []);

describe("policies move their modeled outcome (phase-6 task 3)", () => {
  const SEED = 31337;
  const DAYS = 24;
  let free: World;
  beforeAll(() => {
    free = town(SEED, DAYS, idleTick);
  });

  it("high-rise ban caps building level below the free-build max", () => {
    const banned = town(SEED, DAYS, setPolicy(Policy.highRiseBan));
    expect(maxLevel(free)).toBeGreaterThan(3); // the run reaches high-rise unbanned
    expect(maxLevel(banned)).toBeLessThanOrEqual(3); // ban holds it low
    expect(maxLevel(banned)).toBeLessThan(maxLevel(free));
  });

  it("recycling ordinance cuts garbage generated city-wide", () => {
    const recycling = town(SEED, DAYS, setOrdinance(Policy.recycling));
    expect(free.serviceFlows.garbageGenerated).toBeGreaterThan(0);
    expect(recycling.serviceFlows.garbageGenerated).toBeLessThan(
      free.serviceFlows.garbageGenerated,
    );
  });

  it("clean-industry district cuts industrial ground pollution", () => {
    const clean = town(SEED, DAYS, setPolicy(Policy.cleanIndustry));
    expect(groundPollutionSum(free)).toBeGreaterThan(0);
    expect(groundPollutionSum(clean)).toBeLessThan(groundPollutionSum(free));
  });

  it("industry-subsidy ordinance lifts industrial demand by the boost", () => {
    // Direct fold test — no growth feedback, so the effect is exact.
    const agg = aggregates(createWorld(SEED).buildings);
    const base = computeDemand(agg, undefined, 0);
    const subsidized = computeDemand(agg, undefined, 1 << Policy.industrySubsidy);
    expect(subsidized.i).toBe(base.i + 200);
    // The panel's factors-sum property must survive the fold (it lands in a
    // factor, not a new term): Σ factors ≡ the four block totals.
    const factorSum = subsidized.factors.reduce((s, f) => s + f, 0);
    expect(factorSum).toBe(subsidized.r + subsidized.c + subsidized.i + subsidized.o);
  });
});
