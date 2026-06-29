import { BuildingKind, CommandType, RoadClassWire, ZoneKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { loadScenarios } from "./goldens";
import type { GoldenScenario } from "./scenario";
import {
  type ScenarioCoverageWarning,
  summarizeScenarioCorpus,
  summarizeScenarioCoverage,
} from "./scenario-coverage";

const BASE: GoldenScenario = {
  name: "fixture",
  seed: 1,
  mapWidth: 32,
  mapHeight: 32,
  untilTick: 100,
  commands: [],
  terrainRects: [],
};

describe("scenario coverage audit", () => {
  it("summarizes roads, zones, utilities, services, terrain, and pacing", () => {
    const scenario: GoldenScenario = {
      ...BASE,
      terrainRects: [
        { layer: "water", x0: 0, y0: 0, x1: 3, y1: 0, value: 1 },
        { layer: "resource", x0: 8, y0: 8, x1: 10, y1: 9, value: 1 },
      ],
      commands: [
        {
          seq: 0,
          tick: 1,
          type: CommandType.buildRoad,
          ax: 1,
          ay: 1,
          bx: 12,
          by: 1,
          roadClass: RoadClassWire.avenue,
        },
        {
          seq: 1,
          tick: 2,
          type: CommandType.buildRoad,
          ax: 4,
          ay: 0,
          bx: 4,
          by: 6,
          roadClass: RoadClassWire.bridgeStreet,
        },
        {
          seq: 2,
          tick: 3,
          type: CommandType.zoneRect,
          x0: 2,
          y0: 2,
          x1: 5,
          y1: 3,
          zone: ZoneKind.residentialLow,
        },
        {
          seq: 3,
          tick: 4,
          type: CommandType.zoneRect,
          x0: 6,
          y0: 2,
          x1: 8,
          y1: 3,
          zone: ZoneKind.commercialLow,
        },
        {
          seq: 4,
          tick: 5,
          type: CommandType.placeBuilding,
          x: 2,
          y: 4,
          building: BuildingKind.powerPlant,
        },
        {
          seq: 5,
          tick: 6,
          type: CommandType.placeBuilding,
          x: 4,
          y: 4,
          building: BuildingKind.clinic,
        },
      ],
    };

    const summary = summarizeScenarioCoverage(scenario);

    expect(summary.latestCommandTick).toBe(6);
    expect(summary.commandTickSpan).toBe(5);
    expect(summary.roads).toEqual({
      buildCount: 2,
      upgradeCount: 0,
      bulldozeCount: 0,
      roadClasses: [RoadClassWire.avenue, RoadClassWire.bridgeStreet],
      bridgeSegments: 1,
    });
    expect(summary.zones.residentialArea).toBe(8);
    expect(summary.zones.jobArea).toBe(6);
    expect(summary.zones.byZone[ZoneKind.residentialLow]).toBe(8);
    expect(summary.buildings.utilities).toBe(1);
    expect(summary.buildings.services).toBe(1);
    expect(summary.terrain.waterTiles).toBe(4);
    expect(summary.terrain.resourceTiles).toBe(6);
    expect(summary.warnings).toEqual([]);
  });

  it("warns about intentionally shallow or malformed scenario shape", () => {
    const scenario: GoldenScenario = {
      ...BASE,
      commands: [
        { seq: 0, tick: 10, type: CommandType.selectTile, x: 1, y: 1 },
        { seq: 0, tick: 5, type: CommandType.setSpeed, speed: 3 },
        { seq: 2, tick: 100, type: CommandType.undo },
      ],
    };

    const warnings = summarizeScenarioCoverage(scenario).warnings;

    expect(warnings).toEqual([
      "no-roads",
      "no-zoning",
      "no-residential-zoning",
      "no-job-zoning",
      "no-utilities",
      "duplicate-seq",
      "non-monotone-command-ticks",
      "commands-after-horizon",
    ] satisfies ScenarioCoverageWarning[]);
  });

  it("audits the committed golden corpus as a varied suite", () => {
    const scenarios = loadScenarios();
    const corpus = summarizeScenarioCorpus(scenarios);

    expect(corpus.scenarioCount).toBeGreaterThanOrEqual(6);
    expect(corpus.commandCount).toBeGreaterThan(0);
    expect(corpus.roadScenarioCount).toBeGreaterThanOrEqual(5);
    expect(corpus.zoningScenarioCount).toBeGreaterThanOrEqual(2);
    expect(corpus.utilityScenarioCount).toBeGreaterThanOrEqual(2);
    expect(corpus.serviceScenarioCount).toBeGreaterThanOrEqual(1);
    expect(corpus.terrainScenarioCount).toBeGreaterThanOrEqual(1);
    expect(corpus.stagedSetupScenarioCount).toBeGreaterThanOrEqual(3);
    expect(corpus.warningsByScenario["empty-city-01"]).toContain("empty-command-log");
  });
});
