import { BuildingKind, CommandType, RoadClassWire, ServiceId, ZoneKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { parseScenario } from "./scenario";

const baseScenario = {
  name: "parser",
  seed: 1,
  mapWidth: 64,
  mapHeight: 64,
  untilTick: 1,
  terrainRects: [],
};

describe("scenario command parser", () => {
  it("accepts the current road, service, economy, persona, and district command surface", () => {
    const scenario = parseScenario(
      {
        ...baseScenario,
        commands: [
          {
            seq: 0,
            tick: 0,
            type: "buildRoad",
            ax: 1,
            ay: 2,
            bx: 8,
            by: 2,
            roadClass: RoadClassWire.path,
          },
          {
            seq: 1,
            tick: 0,
            type: "upgradeRoad",
            ax: 1,
            ay: 2,
            bx: 8,
            by: 2,
            roadClass: RoadClassWire.bridgeAvenue,
          },
          { seq: 2, tick: 0, type: "placeBuilding", x: 3, y: 4, building: BuildingKind.hospital },
          { seq: 3, tick: 0, type: "pinCim", tileIdx: 260, slot: 2 },
          { seq: 4, tick: 0, type: "unpinCim", tileIdx: 260, slot: 2 },
          { seq: 5, tick: 0, type: "setServiceBudget", service: ServiceId.sewage, permille: 1250 },
          { seq: 6, tick: 0, type: "setTaxRate", zone: ZoneKind.commercialHigh, permille: 120 },
          { seq: 7, tick: 0, type: "takeLoan", tier: 3 },
          { seq: 8, tick: 0, type: "repayLoan", tier: 2 },
          { seq: 9, tick: 0, type: "paintDistrict", x0: 1, y0: 1, x1: 5, y1: 5, districtId: 63 },
          { seq: 10, tick: 0, type: "nameDistrict", districtId: 12, name: "Harbor" },
          { seq: 11, tick: 0, type: "setPolicy", districtId: 12, policy: 31, on: 1 },
          { seq: 12, tick: 0, type: "setOrdinance", ordinance: 4, on: 0 },
        ],
      },
      "parser.json",
    );

    expect(scenario.commands).toEqual([
      {
        seq: 0,
        tick: 0,
        type: CommandType.buildRoad,
        ax: 1,
        ay: 2,
        bx: 8,
        by: 2,
        roadClass: RoadClassWire.path,
      },
      {
        seq: 1,
        tick: 0,
        type: CommandType.upgradeRoad,
        ax: 1,
        ay: 2,
        bx: 8,
        by: 2,
        roadClass: RoadClassWire.bridgeAvenue,
      },
      {
        seq: 2,
        tick: 0,
        type: CommandType.placeBuilding,
        x: 3,
        y: 4,
        building: BuildingKind.hospital,
      },
      { seq: 3, tick: 0, type: CommandType.pinCim, tileIdx: 260, slot: 2 },
      { seq: 4, tick: 0, type: CommandType.unpinCim, tileIdx: 260, slot: 2 },
      {
        seq: 5,
        tick: 0,
        type: CommandType.setServiceBudget,
        service: ServiceId.sewage,
        permille: 1250,
      },
      {
        seq: 6,
        tick: 0,
        type: CommandType.setTaxRate,
        zone: ZoneKind.commercialHigh,
        permille: 120,
      },
      { seq: 7, tick: 0, type: CommandType.takeLoan, tier: 3 },
      { seq: 8, tick: 0, type: CommandType.repayLoan, tier: 2 },
      {
        seq: 9,
        tick: 0,
        type: CommandType.paintDistrict,
        x0: 1,
        y0: 1,
        x1: 5,
        y1: 5,
        districtId: 63,
      },
      { seq: 10, tick: 0, type: CommandType.nameDistrict, districtId: 12, name: "Harbor" },
      { seq: 11, tick: 0, type: CommandType.setPolicy, districtId: 12, policy: 31, on: 1 },
      { seq: 12, tick: 0, type: CommandType.setOrdinance, ordinance: 4, on: 0 },
    ]);
  });

  it("rejects unsupported enum values instead of preserving impossible scenario commands", () => {
    expect(() =>
      parseScenario(
        {
          ...baseScenario,
          commands: [
            { seq: 0, tick: 0, type: "buildRoad", ax: 1, ay: 1, bx: 2, by: 1, roadClass: 99 },
          ],
        },
        "bad-road.json",
      ),
    ).toThrow("unsupported roadClass 99");

    expect(() =>
      parseScenario(
        {
          ...baseScenario,
          commands: [{ seq: 0, tick: 0, type: "setServiceBudget", service: 10, permille: 1000 }],
        },
        "bad-service.json",
      ),
    ).toThrow("unsupported service 10");

    expect(() =>
      parseScenario(
        {
          ...baseScenario,
          commands: [{ seq: 0, tick: 0, type: "setPolicy", districtId: 1, policy: 32, on: 1 }],
        },
        "bad-policy.json",
      ),
    ).toThrow("policy must be in [0, 31]");
  });
});
