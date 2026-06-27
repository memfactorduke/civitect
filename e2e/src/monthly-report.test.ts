/**
 * Monthly report city-scale contract (GDD §8/§12): a real starter city must
 * produce an explainable month-one report whose visible lines add up exactly,
 * and the worker snapshot path must deliver that report once for the UI to
 * retain.
 */
import {
  BuildingKind,
  CommandType,
  ReportLineKind,
  RoadClassWire,
  SnapshotKind,
  ZoneKind,
} from "@civitect/protocol";
import { createWorld, runTick, TICKS_PER_MONTH, toSnapshot, type World } from "@civitect/sim";
import { describe, expect, it } from "vitest";

type Intent = Record<string, number>;

function dispatchAll(world: World, commands: readonly Intent[]): number {
  let rejections = 0;
  for (const [seq, command] of commands.entries()) {
    rejections += runTick(world, [{ ...command, seq, tick: world.tick } as never]).length;
  }
  return rejections;
}

async function runUntilReport(world: World): Promise<void> {
  while (world.pendingReport === null) {
    runTick(world, []);
    if (world.tick % 25_000 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

describe("monthly report city-scale replay (GDD §12)", () => {
  it("a starter city produces a report whose lines explain the treasury movement", async () => {
    const world = createWorld(9090, 64, 64);
    world.fundsCents = 1_000_000_00;
    const fundsBeforeBuild = world.fundsCents;

    const commands: readonly Intent[] = [
      {
        type: CommandType.buildRoad,
        ax: 8,
        ay: 20,
        bx: 56,
        by: 20,
        roadClass: RoadClassWire.street,
      },
      {
        type: CommandType.buildRoad,
        ax: 8,
        ay: 32,
        bx: 56,
        by: 32,
        roadClass: RoadClassWire.street,
      },
      {
        type: CommandType.buildRoad,
        ax: 8,
        ay: 44,
        bx: 56,
        by: 44,
        roadClass: RoadClassWire.street,
      },
      {
        type: CommandType.buildRoad,
        ax: 8,
        ay: 20,
        bx: 8,
        by: 44,
        roadClass: RoadClassWire.street,
      },
      {
        type: CommandType.buildRoad,
        ax: 24,
        ay: 20,
        bx: 24,
        by: 44,
        roadClass: RoadClassWire.street,
      },
      {
        type: CommandType.buildRoad,
        ax: 40,
        ay: 20,
        bx: 40,
        by: 44,
        roadClass: RoadClassWire.street,
      },
      {
        type: CommandType.buildRoad,
        ax: 56,
        ay: 20,
        bx: 56,
        by: 44,
        roadClass: RoadClassWire.street,
      },
      { type: CommandType.placeBuilding, x: 10, y: 21, building: BuildingKind.powerPlant },
      { type: CommandType.placeBuilding, x: 12, y: 21, building: BuildingKind.waterPump },
      { type: CommandType.zoneRect, x0: 9, y0: 21, x1: 23, y1: 25, zone: ZoneKind.residentialLow },
      { type: CommandType.zoneRect, x0: 9, y0: 27, x1: 23, y1: 31, zone: ZoneKind.residentialLow },
      { type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 25, zone: ZoneKind.commercialLow },
      { type: CommandType.zoneRect, x0: 41, y0: 33, x1: 55, y1: 43, zone: ZoneKind.industrial },
    ];

    expect(dispatchAll(world, commands)).toBe(0);
    await runUntilReport(world);

    expect(world.tick).toBeGreaterThanOrEqual(TICKS_PER_MONTH);
    expect(world.population).toBeGreaterThanOrEqual(250);

    const report = world.pendingReport;
    expect(report).not.toBeNull();
    expect(report?.month).toBe(1);
    const lines = report?.lines ?? [];
    const amountByKind = new Map(lines.map((line) => [line.kind, line.amountCents]));
    const amount = (kind: ReportLineKind): number => amountByKind.get(kind) ?? 0;
    const net = lines.reduce((sum, line) => sum + line.amountCents, 0);

    expect(amount(ReportLineKind.construction)).toBeLessThan(0);
    expect(amount(ReportLineKind.serviceUpkeep)).toBeLessThan(0);
    expect(amount(ReportLineKind.roadMaintenance)).toBeLessThan(0);
    expect(amount(ReportLineKind.taxResidential)).toBeGreaterThan(0);
    expect(
      amount(ReportLineKind.taxCommercial) + amount(ReportLineKind.taxIndustrial),
    ).toBeGreaterThan(0);
    expect(world.fundsCents - fundsBeforeBuild).toBe(net);

    const closeSnapshot = toSnapshot(world, SnapshotKind.delta);
    expect(closeSnapshot.report?.month).toBe(1);
    expect(closeSnapshot.report?.lines).toEqual(lines);
    expect(toSnapshot(world, SnapshotKind.delta).report).toBeNull();
  });
});
