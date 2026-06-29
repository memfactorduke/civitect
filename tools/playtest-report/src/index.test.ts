import { ZoneKind } from "@civitect/protocol";
import {
  BuildingStatus,
  COHORT_BLOCK,
  createWorld,
  spawnBuilding,
  TICKS_PER_GAME_YEAR,
} from "@civitect/sim";
import { describe, expect, it } from "vitest";
import { renderPlaytestReport, scorePlaytest, summarizeWorld } from ".";

function adultCohortOffset(buildingIndex: number): number {
  return buildingIndex * COHORT_BLOCK + 8;
}

function employedOffset(buildingIndex: number): number {
  return buildingIndex * COHORT_BLOCK + 16;
}

describe("playtest report", () => {
  it("summarizes growth, solvency, abandonment, labor, and monthly drains", () => {
    const world = createWorld(7, 16, 16);
    world.tick = TICKS_PER_GAME_YEAR;
    world.population = 12;
    world.fundsCents = -120_000_00;
    world.economy.milestoneIndex = 2;
    world.economy.lastMonthCents[0] = 50_000_00;
    world.economy.lastMonthCents[4] = -200_000_00;
    world.economy.lastMonthCents[8] = -90_000_00;

    const residential = spawnBuilding(world.buildings, 1, ZoneKind.residentialLow);
    world.buildings.cohorts[adultCohortOffset(residential)] = 8;
    world.buildings.cohorts[employedOffset(residential)] = 5;
    spawnBuilding(world.buildings, 2, ZoneKind.commercialLow);
    const abandoned = spawnBuilding(world.buildings, 3, ZoneKind.residentialLow);
    world.buildings.status[abandoned] = BuildingStatus.abandoned;

    const summary = summarizeWorld("knife-edge", world);

    expect(summary.gameYears).toBe(1);
    expect(summary.aliveBuildings).toBe(3);
    expect(summary.abandonedBuildings).toBe(1);
    expect(summary.abandonmentPermille).toBe(333);
    expect(summary.housingCapacity).toBe(8);
    expect(summary.adults).toBe(8);
    expect(summary.employed).toBe(5);
    expect(summary.unemploymentPermille).toBe(375);
    expect(summary.jobs).toBe(4);
    expect(summary.monthlyNetCents).toBe(-240_000_00);
    expect(summary.topDrains.map((line) => line.label)).toEqual(["Service upkeep", "Imports"]);
  });

  it("scores player-facing risks as explicit warning codes", () => {
    const world = createWorld(7, 16, 16);
    world.population = 120;
    world.fundsCents = -10_00;

    const warnings = scorePlaytest(summarizeWorld("stalled", world), {
      minPopulation: 240,
      minFundsCents: 0,
      requireMonthlyReport: true,
    });

    expect(warnings.map((warning) => warning.code)).toEqual([
      "stalled-growth",
      "solvency-risk",
      "missing-report",
      "housing-shortage",
    ]);
  });

  it("renders stable markdown sorted by city name", () => {
    const alpha = createWorld(1, 16, 16);
    alpha.population = 300;
    alpha.fundsCents = 10_000_00;
    alpha.economy.lastMonthCents[0] = 20_000_00;
    alpha.economy.lastMonthCents[5] = -5_000_00;
    const beta = createWorld(2, 16, 16);
    beta.population = 20;
    beta.fundsCents = -1_000_00;

    const report = renderPlaytestReport(
      [summarizeWorld("beta", beta), summarizeWorld("alpha", alpha)],
      {
        requireMonthlyReport: true,
      },
    );

    expect(report).toContain("# Playtest Health Report");
    expect(report.indexOf("| alpha |")).toBeLessThan(report.indexOf("| beta |"));
    expect(report).toContain("Road maintenance -$5000.00");
    expect(report).toContain("stalled-growth");
  });
});
