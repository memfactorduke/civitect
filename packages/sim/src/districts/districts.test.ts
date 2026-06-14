/**
 * District command + state verification (board phase-6 task 1 interface).
 * Aggregation and policy EFFECTS land in tasks 2/3; here we prove the canonical
 * state the commands manage round-trips and validates its domain.
 */
import { CommandType, MAX_DISTRICTS, RejectionReason } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createWorld, runTick, stateHash, type World } from "../world";
import { hasPolicy } from "./districts";

function cmd(world: World, c: object): ReturnType<typeof runTick> {
  return runTick(world, [{ ...c, seq: nextSeq(), tick: world.tick } as never]);
}
let seq = 7000;
function nextSeq(): number {
  return seq++;
}

describe("district commands (GDD §11, the canonical state)", () => {
  it("paint creates the district row + paints the tile layer; name/policy/ordinance mutate", () => {
    const world = createWorld(11, 32, 32);
    expect(
      cmd(world, { type: CommandType.paintDistrict, x0: 4, y0: 4, x1: 8, y1: 8, districtId: 2 }),
    ).toEqual([]);
    // Ensures rows up to id 2 (district 1 default + district 2).
    expect(world.districts.rows.length).toBe(2);
    expect(world.terrain.layers.district[6 * 32 + 6]).toBe(2);
    expect(world.terrain.layers.district[0]).toBe(0); // outside the rect

    cmd(world, { type: CommandType.nameDistrict, districtId: 2, name: "Harbor" });
    expect(world.districts.rows[1]?.name).toBe("Harbor");

    cmd(world, { type: CommandType.setPolicy, districtId: 2, policy: 3, on: 1 });
    expect(hasPolicy(world.districts, 2, 3)).toBe(true);
    cmd(world, { type: CommandType.setPolicy, districtId: 2, policy: 3, on: 0 });
    expect(hasPolicy(world.districts, 2, 3)).toBe(false);

    cmd(world, { type: CommandType.setOrdinance, ordinance: 5, on: 1 });
    expect(hasPolicy(world.districts, 0, 5)).toBe(true); // id 0 = city-wide
  });

  it("rejects out-of-domain district/policy ids without mutating", () => {
    const world = createWorld(2, 16, 16);
    expect(
      cmd(world, {
        type: CommandType.paintDistrict,
        x0: 0,
        y0: 0,
        x1: 1,
        y1: 1,
        districtId: MAX_DISTRICTS + 1,
      }).map((r) => r.reason),
    ).toEqual([RejectionReason.invalidTarget]);
    expect(
      cmd(world, { type: CommandType.nameDistrict, districtId: 0, name: "x" }).map((r) => r.reason),
    ).toEqual([RejectionReason.invalidTarget]);
    expect(
      cmd(world, { type: CommandType.setPolicy, districtId: 1, policy: 99, on: 1 }).map(
        (r) => r.reason,
      ),
    ).toEqual([RejectionReason.invalidTarget]);
    // Rejected commands leave NO fingerprints: hash-equal to a world that
    // idled the same three ticks (the insufficientFunds-test pattern).
    const reference = createWorld(2, 16, 16);
    runTick(reference, []);
    runTick(reference, []);
    runTick(reference, []);
    expect(stateHash(world)).toBe(stateHash(reference));
  });

  it("clearing the district (id 0) repaints the layer to none", () => {
    const world = createWorld(3, 16, 16);
    cmd(world, { type: CommandType.paintDistrict, x0: 2, y0: 2, x1: 6, y1: 6, districtId: 1 });
    expect(world.terrain.layers.district[4 * 16 + 4]).toBe(1);
    cmd(world, { type: CommandType.paintDistrict, x0: 2, y0: 2, x1: 6, y1: 6, districtId: 0 });
    expect(world.terrain.layers.district[4 * 16 + 4]).toBe(0);
  });
});
