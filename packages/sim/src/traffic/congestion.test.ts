/**
 * Congestion charge (GDD §9/§11, board task 3): tolling driving through a
 * charged district raises the car cost, shifting commuters to transit. The
 * charge folds into the SAVED-state-derived twinCosts, so it is determinism-
 * safe (see the mid-hour save/load guard in save-codec.test) and a no-op when
 * off. Harness mirrors assignment.test's peakCommuteCity.
 */
import { CommandType, Policy, RejectionReason } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
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
