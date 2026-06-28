import { CommandType } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { loadExpectations, loadScenarios } from "./goldens";

const scenarios = loadScenarios();
const expectations = loadExpectations();

interface Coordinate {
  readonly axis: "x" | "y" | "tile";
  readonly label: string;
  readonly value: number;
}

function commandTouchesMap(
  command: (typeof scenarios)[number]["commands"][number],
): readonly Coordinate[] {
  switch (command.type) {
    case CommandType.selectTile:
      return [
        { axis: "x", label: "x", value: command.x },
        { axis: "y", label: "y", value: command.y },
      ];
    case CommandType.buildRoad:
    case CommandType.bulldozeRoad:
    case CommandType.upgradeRoad:
      return [
        { axis: "x", label: "ax", value: command.ax },
        { axis: "y", label: "ay", value: command.ay },
        { axis: "x", label: "bx", value: command.bx },
        { axis: "y", label: "by", value: command.by },
      ];
    case CommandType.zoneRect:
    case CommandType.dezoneRect:
    case CommandType.paintDistrict:
      return [
        { axis: "x", label: "x0", value: command.x0 },
        { axis: "y", label: "y0", value: command.y0 },
        { axis: "x", label: "x1", value: command.x1 },
        { axis: "y", label: "y1", value: command.y1 },
      ];
    case CommandType.placeBuilding:
      return [
        { axis: "x", label: "x", value: command.x },
        { axis: "y", label: "y", value: command.y },
      ];
    case CommandType.pinCim:
    case CommandType.unpinCim:
      return [{ axis: "tile", label: "tileIdx", value: command.tileIdx }];
    default:
      return [];
  }
}

describe("golden corpus integrity", () => {
  it("has one committed expectation for every scenario and no stale expectations", () => {
    const scenarioNames = scenarios.map((scenario) => scenario.name).sort();
    const expectationNames = Object.keys(expectations).sort();

    expect(new Set(scenarioNames).size).toBe(scenarioNames.length);
    expect(expectationNames).toEqual(scenarioNames);
  });

  it.each(
    scenarios.map((scenario) => [scenario.name, scenario] as const),
  )("%s has a canonical command log and map-safe script", (_name, scenario) => {
    expect(scenario.mapWidth).toBeGreaterThan(0);
    expect(scenario.mapHeight).toBeGreaterThan(0);
    expect(scenario.untilTick).toBeGreaterThan(0);

    let previousTick = -1;
    let previousSeq = -1;
    for (const [index, command] of scenario.commands.entries()) {
      expect(command.seq).toBe(index);
      expect(command.tick).toBeGreaterThanOrEqual(previousTick);
      if (command.tick === previousTick) {
        expect(command.seq).toBeGreaterThan(previousSeq);
      }
      previousTick = command.tick;
      previousSeq = command.seq;
      expect(command.tick).toBeLessThanOrEqual(scenario.untilTick);

      for (const coordinate of commandTouchesMap(command)) {
        const limit =
          coordinate.axis === "x"
            ? scenario.mapWidth
            : coordinate.axis === "y"
              ? scenario.mapHeight
              : scenario.mapWidth * scenario.mapHeight;
        expect(
          coordinate.value,
          `${scenario.name} command ${index} ${coordinate.label}`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          coordinate.value,
          `${scenario.name} command ${index} ${coordinate.label}`,
        ).toBeLessThan(limit);
      }
    }

    for (const [index, rect] of scenario.terrainRects.entries()) {
      expect(rect.x0, `${scenario.name} terrainRect ${index} x0`).toBeGreaterThanOrEqual(0);
      expect(rect.y0, `${scenario.name} terrainRect ${index} y0`).toBeGreaterThanOrEqual(0);
      expect(rect.x0, `${scenario.name} terrainRect ${index} x0`).toBeLessThanOrEqual(rect.x1);
      expect(rect.y0, `${scenario.name} terrainRect ${index} y0`).toBeLessThanOrEqual(rect.y1);
      expect(rect.x1, `${scenario.name} terrainRect ${index} x1`).toBeLessThan(scenario.mapWidth);
      expect(rect.y1, `${scenario.name} terrainRect ${index} y1`).toBeLessThan(scenario.mapHeight);
    }
  });
});
