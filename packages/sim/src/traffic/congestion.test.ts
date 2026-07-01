/**
 * Congestion charge (GDD §9/§11, board task 3): tolling driving through a
 * charged district raises the car cost, shifting commuters to transit. The
 * charge folds into the SAVED-state-derived twinCosts, so it is determinism-
 * safe (see the mid-hour save/load guard in save-codec.test) and a no-op when
 * off. Harness mirrors assignment.test's peakCommuteCity.
 */
import { CommandType, Policy, RejectionReason } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { replay } from "../replay";
import { createWorld, runTick, type World } from "../world";

type Mode = "plain" | "paintOnly" | "charged";

/**
 * A grown R→I commute town with a bus down the corridor, advanced to a
 * completed 08:00 peak solve. Every variant runs the SAME number of setup ticks
 * (the district/policy commands are padded with idle ticks in the other modes),
 * so all three grow bit-identically — only the traffic SPLIT differs.
 */
function commuteCity(mode: Mode, days = 8): World {
  const world = createWorld(7);
  world.economy.milestoneIndex = 8; // unlock congestion pricing in every variant
  let seq = 0;
  const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
  const idle = () => runTick(world, []);
  cmd({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
  cmd({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 }); // power
  cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 }); // water
  cmd({ type: CommandType.zoneRect, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 }); // R (west)
  cmd({ type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 }); // I (east)
  cmd({ type: CommandType.createLine, lineId: 1, mode: 1, color: 0, name: "L" });
  cmd({ type: CommandType.addStop, lineId: 1, tileIdx: 20 * 64 + 20 }); // by R
  cmd({ type: CommandType.addStop, lineId: 1, tileIdx: 20 * 64 + 50 }); // by I
  cmd({ type: CommandType.setLineVehicles, lineId: 1, vehicles: 4, headwayTicks: 30 });
  // 2 tick-aligned setup slots (cordon over the I-approach + the toggle).
  if (mode === "plain") {
    idle();
    idle();
  } else {
    cmd({ type: CommandType.paintDistrict, x0: 28, y0: 18, x1: 55, y1: 22, districtId: 1 });
    if (mode === "charged") {
      cmd({ type: CommandType.setPolicy, districtId: 1, policy: Policy.congestionCharge, on: 1 });
    } else {
      idle();
    }
  }
  for (let t = 0; t < 1440 * days; t++) {
    runTick(world, []);
  }
  while (world.tick % 1440 !== 8 * 60) {
    runTick(world, []);
  }
  while (world.traffic.job !== null) {
    runTick(world, []);
  }
  return world;
}

const conserves = (w: World) =>
  w.traffic.generated ===
  w.traffic.assigned + w.traffic.walked + w.traffic.ridden + w.traffic.unroutable;

describe("congestion charge (phase-6 task 3, GDD §9/§11)", () => {
  it("shifts commuters from car to transit through the charged district", () => {
    const plain = commuteCity("plain");
    const charged = commuteCity("charged");
    expect(conserves(plain)).toBe(true);
    expect(conserves(charged)).toBe(true);
    // Demand-side is identical (aligned growth) — the charge only moves the split.
    expect(charged.traffic.generated).toBe(plain.traffic.generated);
    expect(charged.traffic.walked).toBe(plain.traffic.walked);
    expect(charged.traffic.unroutable).toBe(plain.traffic.unroutable);
    // The charge pushed riders onto transit and off the car.
    expect(plain.traffic.ridden).toBeGreaterThan(0); // the line was already useful
    expect(charged.traffic.ridden).toBeGreaterThan(plain.traffic.ridden);
    expect(charged.traffic.assigned).toBeLessThan(plain.traffic.assigned);
  });

  it("painting a district without the charge leaves traffic unchanged", () => {
    const plain = commuteCity("plain");
    const painted = commuteCity("paintOnly");
    expect(painted.traffic.assigned).toBe(plain.traffic.assigned);
    expect(painted.traffic.ridden).toBe(plain.traffic.ridden);
  });

  it("rejects the congestion charge before its milestone unlocks", () => {
    const world = createWorld(7); // fresh city: milestoneIndex 0 (< 8), locked
    runTick(world, [
      {
        seq: 0,
        tick: 0,
        type: CommandType.paintDistrict,
        x0: 2,
        y0: 2,
        x1: 6,
        y1: 6,
        districtId: 1,
      } as never,
    ]);
    const rej = runTick(world, [
      {
        seq: 1,
        tick: world.tick,
        type: CommandType.setPolicy,
        districtId: 1,
        policy: Policy.congestionCharge,
        on: 1,
      } as never,
    ]);
    expect(rej[0]?.reason).toBe(RejectionReason.notUnlocked);
    expect(world.districts.rows[0]?.policyMask).toBe(0); // not set
    // An ungated policy (recycling) on the same district still lands.
    const ok = runTick(world, [
      {
        seq: 2,
        tick: world.tick,
        type: CommandType.setPolicy,
        districtId: 1,
        policy: Policy.recycling,
        on: 1,
      } as never,
    ]);
    expect(ok.length).toBe(0);
  });

  it("is deterministic: same charged city ⇒ identical ledger", () => {
    const a = commuteCity("charged", 6).traffic;
    const b = commuteCity("charged", 6).traffic;
    expect(b.ridden).toBe(a.ridden);
    expect(b.assigned).toBe(a.assigned);
  });
});

/** An active-freight city (border grid + R/I/C); optionally cordon the central
 *  x=32 connector and ban trucks from it. All setup lands at tick 0, so growth
 *  (and freight generation) is identical — only truck ROUTING differs. */
function freightWorld(mode: "paintOnly" | "banned"): World {
  let seq = 0;
  const c = (o: object) => ({ seq: seq++, tick: 0, ...o }) as never;
  const log = [
    c({ type: CommandType.buildRoad, ax: 0, ay: 8, bx: 63, by: 8, roadClass: 2 }),
    c({ type: CommandType.buildRoad, ax: 0, ay: 32, bx: 63, by: 32, roadClass: 2 }),
    c({ type: CommandType.buildRoad, ax: 8, ay: 0, bx: 8, by: 63, roadClass: 2 }),
    c({ type: CommandType.buildRoad, ax: 32, ay: 0, bx: 32, by: 63, roadClass: 2 }),
    c({ type: CommandType.buildRoad, ax: 56, ay: 0, bx: 56, by: 63, roadClass: 2 }),
    c({ type: CommandType.placeBuilding, x: 33, y: 9, building: 1 }), // power
    c({ type: CommandType.placeBuilding, x: 35, y: 9, building: 2 }), // water
    c({ type: CommandType.zoneRect, x0: 10, y0: 10, x1: 30, y1: 30, zone: 1 }), // R
    c({ type: CommandType.zoneRect, x0: 34, y0: 10, x1: 54, y1: 30, zone: 5 }), // I
    c({ type: CommandType.zoneRect, x0: 10, y0: 34, x1: 30, y1: 54, zone: 3 }), // C
    // Cordon the EAST border road (x=56), an industry export route (freight
    // flows there); the north border (y=8) is the bypass.
    c({ type: CommandType.paintDistrict, x0: 55, y0: 0, x1: 57, y1: 63, districtId: 1 }),
  ];
  if (mode === "banned") {
    log.push(c({ type: CommandType.setPolicy, districtId: 1, policy: Policy.truckBan, on: 1 }));
  }
  const { world } = replay(7, log as never, 14400, {
    mapWidth: 64,
    mapHeight: 64,
    startingFundsCents: 100_000_000_00,
  });
  return world;
}

/** Freight volume on edges whose midpoint tile lies in district `id`. */
function freightInDistrict(w: World, id: number): number {
  let sum = 0;
  for (const [key, vol] of w.traffic.freightVolumes) {
    const p = key.split(",");
    const midX = ((Number(p[0]) + Number(p[2])) >> 1) as number;
    const midY = ((Number(p[1]) + Number(p[3])) >> 1) as number;
    if (w.terrain.layers.district[midY * w.mapWidth + midX] === id) {
      sum += vol;
    }
  }
  return sum;
}

describe("truck ban (phase-6 task 3, GDD §11)", () => {
  it("routes freight around the banned district", () => {
    const painted = freightWorld("paintOnly");
    const banned = freightWorld("banned");
    expect(painted.chain.shipments.length).toBeGreaterThan(0); // freight is live
    // Without the ban, trucks cross the central cordon; with it, they detour.
    expect(freightInDistrict(painted, 1)).toBeGreaterThan(0);
    expect(freightInDistrict(banned, 1)).toBeLessThan(freightInDistrict(painted, 1));
  });

  it("is deterministic: same banned city ⇒ identical freight", () => {
    const a = freightWorld("banned");
    const b = freightWorld("banned");
    expect(freightInDistrict(b, 1)).toBe(freightInDistrict(a, 1));
    expect(a.traffic.freightAssigned).toBe(b.traffic.freightAssigned);
  });
});
