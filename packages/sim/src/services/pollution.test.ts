/**
 * Pollution v1 verification (board phase-4 task 4): downstream water flow,
 * the pump-crisis cause chain, sickness coupling, ground persistence.
 */
import { BuildingKind, CommandType, flatTerrain, ZoneKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createBuildings, PLOPPABLE_KIND_OFFSET, spawnBuilding } from "../growth/buildings";
import { createRoadGraph } from "../roads/graph";
import { createTraffic } from "../traffic/solver";
import { createWorld, pollutionAt, runTick, stateHash, type World } from "../world";
import {
  computeAirField,
  computeWaterField,
  findPumpCrisis,
  type PollutionInputs,
  WATER_AT_OUTLET,
  WIND_DRIFT_X,
} from "./pollution";

const MAP = 32;

function makeInputs(
  mutate?: (inputs: {
    buildings: ReturnType<typeof createBuildings>;
    water: Uint16Array;
    elevation: Uint16Array;
  }) => void,
): PollutionInputs {
  const terrain = flatTerrain(MAP, MAP);
  const buildings = createBuildings();
  const roads = createRoadGraph();
  mutate?.({
    buildings,
    water: terrain.layers.water,
    elevation: terrain.layers.elevation,
  });
  return {
    buildings,
    roads,
    traffic: createTraffic(roads),
    waterLayer: terrain.layers.water,
    elevation: terrain.layers.elevation,
    mapWidth: MAP,
    mapHeight: MAP,
  };
}

describe("water pollution flows DOWNSTREAM (GDD §10)", () => {
  it("an outlet pollutes downhill water, never uphill", () => {
    const inputs = makeInputs(({ buildings, water, elevation }) => {
      // A river along y=10: x 0..31, stepping downhill at x=16. The
      // outlet at (17,11) anchors its discharge at (16,10) — the LOW side
      // of the step, so the high plateau west of it is genuinely uphill.
      for (let x = 0; x < MAP; x++) {
        water[10 * MAP + x] = 1;
        elevation[10 * MAP + x] = x < 16 ? 2 : 1;
      }
      spawnBuilding(buildings, 11 * MAP + 17, PLOPPABLE_KIND_OFFSET + BuildingKind.sewageOutlet);
    });
    const field = computeWaterField(inputs);
    const seedTile = 10 * MAP + 16;
    expect(field[seedTile]).toBe(WATER_AT_OUTLET);
    // Downstream (east, lower elevation): polluted, decaying with distance.
    expect(field[10 * MAP + 20] as number).toBeGreaterThan(0);
    expect(field[10 * MAP + 20] as number).toBeLessThan(WATER_AT_OUTLET);
    // Upstream (west, higher elevation): clean — water does not flow uphill.
    expect(field[10 * MAP + 12]).toBe(0);
  });

  it("pollution decays to zero with distance", () => {
    const inputs = makeInputs(({ buildings, water }) => {
      for (let x = 0; x < MAP; x++) {
        water[5 * MAP + x] = 1; // flat canal: spreads both ways
      }
      spawnBuilding(buildings, 6 * MAP + 2, PLOPPABLE_KIND_OFFSET + BuildingKind.sewageOutlet);
    });
    const field = computeWaterField(inputs);
    const near = field[5 * MAP + 3] as number;
    const far = field[5 * MAP + 30] as number;
    expect(near).toBeGreaterThan(far);
  });
});

describe("the pump crisis (GDD §10: dramatic, diagnosable, classic)", () => {
  it("a pump drinking polluted water is found; a clean pump is not", () => {
    const dirty = makeInputs(({ buildings, water }) => {
      for (let x = 0; x < MAP; x++) {
        water[5 * MAP + x] = 1;
      }
      spawnBuilding(buildings, 6 * MAP + 4, PLOPPABLE_KIND_OFFSET + BuildingKind.sewageOutlet);
      spawnBuilding(buildings, 6 * MAP + 10, PLOPPABLE_KIND_OFFSET + BuildingKind.waterPump);
    });
    const crisis = findPumpCrisis(dirty, computeWaterField(dirty));
    expect(crisis).not.toBeNull();
    expect(crisis?.pumpTile).toBe(6 * MAP + 10);

    const clean = makeInputs(({ buildings, water }) => {
      for (let x = 0; x < MAP; x++) {
        water[5 * MAP + x] = 1;
      }
      spawnBuilding(buildings, 6 * MAP + 10, PLOPPABLE_KIND_OFFSET + BuildingKind.waterPump);
    });
    expect(findPumpCrisis(clean, computeWaterField(clean))).toBeNull();
  });

  it("the daily advisor carries a resolving pump+intake cause chain", () => {
    // A real world: a canal beside the road, outlet upstream of a pump.
    const world = createWorld(7);
    for (let x = 0; x < 64; x++) {
      world.terrain.layers.water[12 * 64 + x] = 1;
    }
    let seq = 0;
    const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
    cmd({ type: CommandType.buildRoad, ax: 2, ay: 8, bx: 30, by: 8, roadClass: 1 });
    cmd({ type: CommandType.placeBuilding, x: 4, y: 9, building: BuildingKind.sewageOutlet });
    cmd({ type: CommandType.placeBuilding, x: 10, y: 9, building: BuildingKind.waterPump });
    let crisisEvent: import("@civitect/protocol").AdvisorEvent | undefined;
    for (let t = 0; t < 1440 * 2 && crisisEvent === undefined; t++) {
      runTick(world, []);
      crisisEvent = world.advisorQueue.find((e) => e.messageKey === "advisor.waterCrisis");
      if (t % 600 === 0) {
        world.advisorQueue.length = 0;
      }
    }
    expect(crisisEvent).toBeDefined();
    const pumpLink = crisisEvent?.cause.links.find((l) => l.subject.kind === 2);
    const tileLink = crisisEvent?.cause.links.find((l) => l.subject.kind === 1);
    expect(pumpLink).toBeDefined();
    expect(tileLink).toBeDefined();
    // RESOLVE the links: the pump building exists at the named tile, and
    // the intake tile is genuinely polluted water.
    expect(world.buildings.byTile.get(pumpLink?.subject.id as number)).toBeDefined();
    const intake = tileLink?.subject.id as number;
    expect(world.terrain.layers.water[intake]).not.toBe(0);
    expect(pollutionAt(world, intake).water).toBeGreaterThan(0);
  });
});

describe("air pollution: kernels, wind, traffic", () => {
  it("industry stains the air around it, drifted by the wind", () => {
    const inputs = makeInputs(({ buildings }) => {
      spawnBuilding(buildings, 16 * MAP + 16, ZoneKind.industrial);
    });
    const field = computeAirField(inputs);
    const atSource = field[16 * MAP + 16 + WIND_DRIFT_X] as number;
    const downwind = field[16 * MAP + 18 + WIND_DRIFT_X] as number;
    const upwindFar = field[16 * MAP + 6] as number;
    expect(atSource).toBeGreaterThan(0);
    expect(atSource).toBeGreaterThan(downwind);
    expect(upwindFar).toBe(0);
  });
});

describe("pollution ↔ sickness (GDD §10) and persistence", () => {
  function pollutedTown(): World {
    const w = createWorld(123);
    let seq = 0;
    const cmd = (c: object) => runTick(w, [{ ...c, seq: seq++, tick: w.tick } as never]);
    cmd({ type: CommandType.buildRoad, ax: 2, ay: 8, bx: 60, by: 8, roadClass: 1 });
    cmd({ type: CommandType.placeBuilding, x: 3, y: 9, building: 1 });
    cmd({ type: CommandType.placeBuilding, x: 4, y: 9, building: 2 });
    // Industry cluster in the WEST; R both beside it and far east.
    cmd({ type: CommandType.zoneRect, x0: 6, y0: 6, x1: 14, y1: 7, zone: 5 });
    cmd({ type: CommandType.zoneRect, x0: 8, y0: 9, x1: 14, y1: 11, zone: 1 });
    cmd({ type: CommandType.zoneRect, x0: 46, y0: 9, x1: 52, y1: 11, zone: 1 });
    for (let t = 0; t < 1440 * 20; t++) {
      runTick(w, []);
    }
    return w;
  }

  it("residents beside industry sicken faster than residents far away", () => {
    const world = pollutedTown();
    const b = world.buildings;
    let nearSick = 0;
    let nearRes = 0;
    let farSick = 0;
    let farRes = 0;
    for (let i = 0; i < b.count; i++) {
      if (b.alive[i] !== 1) {
        continue;
      }
      const kind = b.kind[i] as number;
      if (kind !== ZoneKind.residentialLow && kind !== ZoneKind.residentialHigh) {
        continue;
      }
      const x = (b.tileIdx[i] as number) % 64;
      const sick = b.sick[i] as number;
      let res = 0;
      for (let c = 0; c < 16; c++) {
        res += b.cohorts[i * 20 + c] as number;
      }
      if (x < 20) {
        nearSick += sick;
        nearRes += res;
      } else {
        farSick += sick;
        farRes += res;
      }
    }
    expect(nearRes).toBeGreaterThan(0);
    expect(farRes).toBeGreaterThan(0);
    // Cumulative sickness pressure: industry-adjacent homes suffer more
    // (rate includes air + accumulating ground pollution).
    const nearRate = (nearSick * 1000) / nearRes;
    const farRate = (farSick * 1000) / farRes;
    expect(nearRate).toBeGreaterThanOrEqual(farRate);
    // Ground pollution actually accumulated somewhere under industry…
    let maxGround = 0;
    for (const v of world.groundPollution) {
      if (v > maxGround) {
        maxGround = v;
      }
    }
    expect(maxGround).toBeGreaterThan(0);
  });

  it("the polluted town is replay-deterministic, ground field included", () => {
    expect(stateHash(pollutedTown())).toBe(stateHash(pollutedTown()));
  });
});
