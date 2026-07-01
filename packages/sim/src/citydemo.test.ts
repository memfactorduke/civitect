/**
 * A headless walkthrough of the Civitect SIM — the deep systems in numbers,
 * since the visual front-end isn't built yet. Run: pnpm --filter @civitect/sim
 * exec vitest run src/citydemo.test.ts
 */
import { CommandType, Policy } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { aggregates } from "./growth/system";
import { createWorld, runTick, stateHash, type World } from "./world";

function line(msg: string) {
  console.log(msg);
}
function stats(w: World) {
  const a = aggregates(w.buildings);
  return {
    pop: a.residents,
    employed: a.employed,
    funds: Math.round(w.fundsCents / 100),
    buildings: w.buildings.count,
  };
}
function toPeak(w: World) {
  while (w.tick % 1440 !== 8 * 60) runTick(w, []);
  while (w.traffic.job !== null) runTick(w, []);
  return w.traffic;
}
function days(w: World, n: number) {
  for (let i = 0; i < 1440 * n; i++) runTick(w, []);
}

describe("CIVITECT — a city's story in numbers (headless demo)", () => {
  it("founds, grows, jams, builds transit, then prices congestion", () => {
    const w = createWorld(1234);
    w.economy.milestoneIndex = 8; // unlock late-game levers for the walkthrough
    let seq = 0;
    const cmd = (c: object) => runTick(w, [{ seq: seq++, tick: w.tick, ...c } as never]);

    line("\n============ CIVITECT — deterministic city, headless ============");
    cmd({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
    cmd({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 }); // power
    cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 }); // water
    cmd({ type: CommandType.zoneRect, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 }); // homes (west)
    cmd({ type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 }); // industry (east)
    line("· Founded: one road, power, water, homes to the west, jobs to the east.");

    days(w, 20);
    let s = stats(w);
    line(
      `\n[Day 20]   ${s.pop} residents · ${s.buildings} buildings · ${s.employed} employed · $${s.funds.toLocaleString()} treasury`,
    );
    let tr = toPeak(w);
    line(
      `  Rush hour: ${tr.generated} trips → ${tr.assigned} DRIVING, ${tr.ridden} on transit, ${tr.walked} walking.`,
    );

    cmd({ type: CommandType.createLine, lineId: 1, mode: 1, color: 0, name: "Crosstown" });
    cmd({ type: CommandType.addStop, lineId: 1, tileIdx: 20 * 64 + 20 }); // by the homes
    cmd({ type: CommandType.addStop, lineId: 1, tileIdx: 20 * 64 + 50 }); // by the jobs
    cmd({ type: CommandType.setLineVehicles, lineId: 1, vehicles: 6, headwayTicks: 20 });
    days(w, 3);
    tr = toPeak(w);
    line(
      `\n[+ Crosstown bus]   Rush hour: ${tr.assigned} DRIVING, ${tr.ridden} on transit — the line pulled commuters off the road.`,
    );

    cmd({ type: CommandType.paintDistrict, x0: 28, y0: 18, x1: 55, y1: 22, districtId: 1 });
    cmd({ type: CommandType.setPolicy, districtId: 1, policy: Policy.congestionCharge, on: 1 });
    days(w, 3);
    tr = toPeak(w);
    line(
      `[+ Congestion charge]   Rush hour: ${tr.assigned} DRIVING, ${tr.ridden} on transit — pricing downtown driving shifted more onto transit.`,
    );

    s = stats(w);
    line(`\n[Final]   ${s.pop} residents · $${s.funds.toLocaleString()} treasury`);
    line(
      `  State hash: ${stateHash(w)}  (bit-identical on every machine — same seed+commands ⇒ same city)`,
    );
    line("=================================================================\n");
    expect(w.buildings.count).toBeGreaterThan(0);
  });
});
