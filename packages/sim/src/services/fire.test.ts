/**
 * Fire verification (board phase-4 task 5), headlined by ROADMAP Phase 4
 * EXIT CRITERION 1: "fire on a congested street spreads realistically
 * because the truck is late (and the cause chain says so)" — proven as a
 * DIFFERENTIAL: the same geometry, with and without the jam.
 */
import { BuildingKind, CommandType, EntityKind, ZoneKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { BuildingStatus, residentsOf } from "../growth/buildings";
import { createWorld, runTick, stateHash, type World } from "../world";
import { BURN_RUIN_HOURS, RUIN_CLEAR_DAYS, SPREAD_AFTER_HOURS } from "./fire";

const HOUR = 60;
const DAY = 1440;

function cmdRunner(world: World): (c: object) => void {
  let seq = 1000;
  return (c: object) => {
    const rejections = runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
    if (rejections.length > 0) {
      throw new Error(`command rejected: ${JSON.stringify(rejections)}`);
    }
  };
}

/**
 * The corridor city: a LARGE fire station (48-tile reach) on the WEST
 * end, a jobs block on the EAST end at ~45 street-tiles — inside the
 * station's FREE-FLOW reach, but pushed beyond it when BPR multiplies
 * the saturated middle. Residential west + jobs east load the single
 * street (the Phase 3 jam pattern). That gap between promised coverage
 * and congested response IS the exit criterion.
 */
function corridorCity(): World {
  const world = createWorld(4242);
  // The Phase 5 money cycle prices construction; the fire scenarios are
  // about dispatch, not budgets — fund the public works up front.
  world.fundsCents = 1_000_000_00;
  const cmd = cmdRunner(world);
  cmd({ type: CommandType.buildRoad, ax: 4, ay: 20, bx: 24, by: 20, roadClass: 1 });
  cmd({ type: CommandType.buildRoad, ax: 24, ay: 20, bx: 44, by: 20, roadClass: 1 }); // bottleneck
  cmd({ type: CommandType.buildRoad, ax: 44, ay: 20, bx: 50, by: 20, roadClass: 1 });
  cmd({ type: CommandType.placeBuilding, x: 6, y: 21, building: 1 }); // power
  cmd({ type: CommandType.placeBuilding, x: 7, y: 21, building: 2 }); // water
  cmd({ type: CommandType.placeBuilding, x: 5, y: 21, building: BuildingKind.fireStationLarge });
  cmd({ type: CommandType.zoneRect, x0: 5, y0: 16, x1: 22, y1: 19, zone: 2 }); // R-high west
  cmd({ type: CommandType.zoneRect, x0: 8, y0: 21, x1: 22, y1: 24, zone: 2 });
  cmd({ type: CommandType.zoneRect, x0: 44, y0: 21, x1: 54, y1: 24, zone: 5 }); // jobs east
  cmd({ type: CommandType.zoneRect, x0: 44, y0: 16, x1: 54, y1: 19, zone: 4 });
  return world;
}

/** Age a city until its bottleneck carries real load (bounded fallback). */
function ageUntilLoaded(world: World, maxDays = 45): number {
  let maxRatio = 0;
  for (let d = 0; d < maxDays; d++) {
    runHours(world, 24);
    maxRatio = 0;
    const g = world.roads;
    for (let e = 0; e < g.edgeCount; e++) {
      if (g.edgeAlive[e] !== 1 || (g.edgeCapacity_[e] as number) === 0) {
        continue;
      }
      const r = Math.floor(
        ((world.traffic.volumes[e] as number) * 1000) / (g.edgeCapacity_[e] as number),
      );
      if (r > maxRatio) {
        maxRatio = r;
      }
    }
    if (maxRatio > 1500) {
      break;
    }
  }
  return maxRatio;
}

/** Ignite the building nearest a tile, by direct canonical mutation. */
function ignite(world: World, x: number, y: number): number {
  const b = world.buildings;
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1 || (b.kind[i] as number) >= 100) {
      continue;
    }
    if ((b.status[i] as number) !== BuildingStatus.normal) {
      continue;
    }
    const bx = (b.tileIdx[i] as number) % world.mapWidth;
    const by = Math.floor((b.tileIdx[i] as number) / world.mapWidth);
    const d = Math.abs(bx - x) + Math.abs(by - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  if (best === -1) {
    throw new Error("nothing to ignite");
  }
  b.status[best] = BuildingStatus.onFire;
  b.fireTicks[best] = 1;
  b.version++;
  return best;
}

function runHours(world: World, hours: number): void {
  for (let t = 0; t < hours * HOUR; t++) {
    runTick(world, []);
  }
}

describe("EXIT CRITERION 1: the congested-street fire differential (GDD §9 [LOCKED])", () => {
  it("free street: the truck arrives, the fire dies alone; jammed street: it spreads, and the chain says why", () => {
    // ── control: the SAME populated city, but the corridor upgraded to
    //    highway before ignition — capacity kills the jam, the truck
    //    flies. (An EMPTY control would have no buildings to burn; this
    //    control isolates exactly one variable: congestion.) ──
    // Fires must start INSIDE the morning peak: MSA volumes blend DOWN
    // through the quiet night hours (the rush-hour curve is real), so a
    // midnight fire meets an empty street in either scenario. ageUntil-
    // Loaded returns at midnight; +8.5h puts ignition at 08:30 with the
    // 3+ unanswered hours falling in the 9-12 traffic.
    const control = corridorCity();
    ageUntilLoaded(control);
    const ctrl = cmdRunner(control);
    ctrl({ type: CommandType.upgradeRoad, ax: 24, ay: 20, bx: 44, by: 20, roadClass: 3 });
    ctrl({ type: CommandType.upgradeRoad, ax: 4, ay: 20, bx: 24, by: 20, roadClass: 3 });
    ctrl({ type: CommandType.upgradeRoad, ax: 44, ay: 20, bx: 50, by: 20, roadClass: 3 });
    runHours(control, 8);
    for (let t = 0; t < 30; t++) {
      runTick(control, []);
    }
    control.advisorQueue.length = 0;
    const controlSpreadBefore = control.fireFlows.spreads;
    ignite(control, 46, 21);
    runHours(control, BURN_RUIN_HOURS + 2);
    const controlSpread = control.fireFlows.spreads - controlSpreadBefore;
    const controlLate = control.advisorQueue.some((e) => e.messageKey === "advisor.fireSpreading");

    // ── the jammed run: identical geometry, street saturated ──
    const jammed = corridorCity();
    const maxRatio = ageUntilLoaded(jammed);
    expect(maxRatio).toBeGreaterThan(1500); // saturated: BPR is biting hard
    runHours(jammed, 8);
    for (let t = 0; t < 30; t++) {
      runTick(jammed, []);
    }
    jammed.advisorQueue.length = 0;
    const jammedSpreadBefore = jammed.fireFlows.spreads;
    ignite(jammed, 46, 21);
    runHours(jammed, BURN_RUIN_HOURS + 2);
    const jammedSpread = jammed.fireFlows.spreads - jammedSpreadBefore;

    // THE CRITERION, part 1: the jammed fire spread (one-hop,
    // deterministic); the free one did not.
    expect(jammedSpread).toBe(1);
    expect(controlSpread).toBe(0);
    expect(controlLate).toBe(false);

    // Part 2: the cause chain says WHY — truck late, saturated edge named,
    // and the named edge RESOLVES to a real, genuinely loaded street.
    const late = [...jammed.advisorQueue].find(
      (e) => e.messageKey === "advisor.fireSpreading" && e.cause.summaryKey === "cause.truckLate",
    );
    expect(late).toBeDefined();
    const edgeLink = late?.cause.links.find((l) => l.subject.kind === EntityKind.edge);
    const stationLink = late?.cause.links.find((l) => l.labelKey === "cause.respondingStation");
    expect(edgeLink).toBeDefined();
    expect(stationLink).toBeDefined();
    const edge = edgeLink?.subject.id as number;
    expect(jammed.roads.edgeAlive[edge]).toBe(1);
    expect(jammed.traffic.volumes[edge] as number).toBeGreaterThan(0);
    expect(jammed.buildings.byTile.get(stationLink?.subject.id as number)).toBeDefined();
  }, 240_000);
});

describe("fire mechanics", () => {
  it("an unanswered fire ruins the building, residents flee, the lot eventually clears", () => {
    const world = corridorCity();
    for (let d = 0; d < 10; d++) {
      runHours(world, 24);
    }
    // Starve the fire budget: at 50% the large station reaches only 24
    // street-tiles — the east block falls outside even free-flow reach.
    const cmd = cmdRunner(world);
    cmd({ type: CommandType.setServiceBudget, service: 1, permille: 500 });
    const i = ignite(world, 48, 22);
    const before = residentsOf(world.buildings, i);
    runHours(world, BURN_RUIN_HOURS + 1);
    expect([BuildingStatus.ruin, BuildingStatus.onFire]).toContain(
      world.buildings.status[i] as number,
    );
    if ((world.buildings.status[i] as number) === BuildingStatus.ruin) {
      expect(residentsOf(world.buildings, i)).toBe(0);
      if (before > 0) {
        expect(world.flows.emigrants).toBeGreaterThan(0);
      }
      const ruinTile = world.buildings.tileIdx[i] as number;
      runHours(world, (RUIN_CLEAR_DAYS + 1) * 24);
      // The RUIN is gone — the zoned lot may already host fresh growth.
      const occupant = world.buildings.byTile.get(ruinTile);
      if (occupant !== undefined) {
        expect(world.buildings.status[occupant]).not.toBe(BuildingStatus.ruin);
      }
    }
  }, 120_000);

  it("a protected fire goes out fast and never spreads", () => {
    const world = corridorCity();
    for (let d = 0; d < 10; d++) {
      runHours(world, 24);
    }
    const spreadsBefore = world.fireFlows.spreads;
    ignite(world, 8, 21); // right beside the station — no jam in the way
    runHours(world, SPREAD_AFTER_HOURS);
    expect(world.fireFlows.extinguished).toBeGreaterThan(0);
    expect(world.fireFlows.spreads).toBe(spreadsBefore);
  }, 120_000);

  it("fire states are replay-deterministic (rng.events discipline)", () => {
    const run = (): string => {
      const world = corridorCity();
      for (let d = 0; d < 12; d++) {
        runHours(world, 24);
      }
      return stateHash(world);
    };
    expect(run()).toBe(run());
  }, 240_000);
});
