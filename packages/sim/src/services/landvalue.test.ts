/**
 * Land value v1 verification (board phase-5 task 1): the field equals an
 * independent weighted-sum oracle over a real serviced/polluted city, and
 * the GDD §6 directional facts hold (parks lift, industry drags, water
 * views pay).
 */
import { BuildingKind, CommandType, type ServiceId } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import {
  createWorld,
  landValueAtTile,
  landValueField,
  pollutionAt,
  runTick,
  serviceCoverageAt,
  type World,
} from "../world";
import { LAND_VALUE_BASE, LV_WATER_VIEW, landValueAt } from "./landvalue";

function servicedTown(): World {
  const world = createWorld(2024);
  for (let x = 0; x < 64; x++) {
    world.terrain.layers.water[30 * 64 + x] = 1; // a river along y=30
  }
  let seq = 0;
  const cmd = (c: object) => {
    const r = runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
    if (r.length) throw new Error(JSON.stringify(r));
  };
  cmd({ type: CommandType.buildRoad, ax: 4, ay: 8, bx: 56, by: 8, roadClass: 1 });
  cmd({ type: CommandType.placeBuilding, x: 5, y: 9, building: 1 });
  cmd({ type: CommandType.placeBuilding, x: 6, y: 9, building: 2 });
  cmd({ type: CommandType.placeBuilding, x: 10, y: 9, building: BuildingKind.parkSmall });
  cmd({ type: CommandType.placeBuilding, x: 12, y: 9, building: BuildingKind.schoolElementary });
  cmd({ type: CommandType.zoneRect, x0: 30, y0: 5, x1: 40, y1: 7, zone: 5 }); // industry east
  cmd({ type: CommandType.zoneRect, x0: 8, y0: 10, x1: 24, y1: 12, zone: 1 });
  for (let t = 0; t < 1440 * 5; t++) {
    runTick(world, []);
  }
  return world;
}

describe("land value v1 (GDD §6)", () => {
  it("the field equals the weighted-sum oracle at every tile", () => {
    const world = servicedTown();
    const { field } = landValueField(world);
    const oracleInputs = {
      coverageAt: (service: ServiceId, tileIdx: number) =>
        serviceCoverageAt(world, service, tileIdx),
      airAt: (tileIdx: number) => pollutionAt(world, tileIdx).air,
      groundAt: (tileIdx: number) => world.groundPollution[tileIdx] as number,
      noiseAt: (tileIdx: number) => pollutionAt(world, tileIdx).noise,
      waterLayer: world.terrain.layers.water,
      mapWidth: 64,
      mapHeight: 64,
    };
    for (let idx = 0; idx < field.length; idx += 7) {
      expect(field[idx]).toBe(landValueAt(oracleInputs, idx));
    }
  });

  it("parks lift, industry drags, water views pay (directional facts)", () => {
    const world = servicedTown();
    const nearPark = landValueAtTile(world, 10 * 64 + 11);
    const nearIndustry = landValueAtTile(world, 6 * 64 + 35);
    const plainFar = landValueAtTile(world, 50 * 64 + 50);
    const riverside = landValueAtTile(world, 28 * 64 + 50); // 2 tiles off water, no services
    expect(nearPark).toBeGreaterThan(plainFar);
    expect(nearIndustry).toBeLessThan(plainFar);
    expect(riverside).toBe(Math.min(255, LAND_VALUE_BASE + LV_WATER_VIEW));
    expect(plainFar).toBe(LAND_VALUE_BASE);
  });

  it("the digest is content-stable (same world twice ⇒ same digest)", () => {
    const a = landValueField(servicedTown());
    const b = landValueField(servicedTown());
    expect(a.digestU32).toBe(b.digestU32);
  });
});
