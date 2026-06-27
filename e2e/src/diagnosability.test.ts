/**
 * Diagnosability gate (GDD §17.1/§17.4): common city failures must not be
 * opaque. Each scenario below creates a real failing city state, waits for the
 * advisor, then resolves every cause-link subject back into current world data.
 */
import {
  type AdvisorEvent,
  BuildingKind,
  type Command,
  CommandType,
  EntityKind,
  type EntityKind as EntityKindType,
} from "@civitect/protocol";
import {
  BuildingStatus,
  createWorld,
  pollutionAt,
  runTick,
  TICKS_PER_GAME_YEAR,
  type World,
} from "@civitect/sim";
import { describe, expect, it } from "vitest";

interface Seq {
  value: number;
}

type CommandBody = Readonly<{ type: Command["type"] } & Record<string, number | string | boolean>>;

function apply(world: World, seq: Seq, body: CommandBody): void {
  const command = { ...body, seq: seq.value, tick: world.tick } as Command;
  seq.value++;
  expect(runTick(world, [command])).toEqual([]);
}

async function runUntil(
  world: World,
  untilTick: number,
  onTick?: (world: World) => void,
): Promise<void> {
  while (world.tick < untilTick) {
    runTick(world, []);
    onTick?.(world);
    if (world.tick % 25_000 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

async function waitForAdvisor(
  world: World,
  messageKey: string,
  maxTicks: number,
): Promise<AdvisorEvent> {
  let found: AdvisorEvent | undefined;
  await runUntil(world, world.tick + maxTicks, (w) => {
    found = w.advisorQueue.find((event) => event.messageKey === messageKey) ?? found;
    w.advisorQueue.length = 0;
  });
  expect(found).toBeDefined();
  if (found === undefined) {
    throw new Error(`advisor ${messageKey} did not fire within ${maxTicks} ticks`);
  }
  return found;
}

function resolveLinkSubject(world: World, event: AdvisorEvent): void {
  expect(event.cause.summaryKey).toMatch(/^cause\./);
  expect(event.cause.links.length).toBeGreaterThan(0);
  for (const link of event.cause.links) {
    expect(link.labelKey).toMatch(/^cause\./);
    expect(link.weightPermille).toBeGreaterThan(0);
    expect(link.weightPermille).toBeLessThanOrEqual(1000);
    switch (link.subject.kind) {
      case EntityKind.tile:
        expect(link.subject.id).toBeGreaterThanOrEqual(0);
        expect(link.subject.id).toBeLessThan(world.mapWidth * world.mapHeight);
        break;
      case EntityKind.building:
        expect(world.buildings.byTile.get(link.subject.id)).toBeDefined();
        break;
      case EntityKind.edge:
        expect(world.roads.edgeAlive[link.subject.id]).toBe(1);
        break;
      case EntityKind.system:
        expect(link.subject.id).toBe(0);
        break;
      case EntityKind.agent:
        throw new Error(`agent cause links are not resolvable by this headless gate yet`);
    }
  }
}

function firstLink(event: AdvisorEvent, kind: EntityKindType): number {
  const link = event.cause.links.find((candidate) => candidate.subject.kind === kind);
  expect(link).toBeDefined();
  if (link === undefined) {
    throw new Error(`advisor ${event.messageKey} did not include entity kind ${kind}`);
  }
  return link.subject.id;
}

describe("diagnosability gate (GDD §17)", () => {
  it("utility loss names the abandoned building and the cause link resolves", async () => {
    const world = createWorld(35);
    world.fundsCents = 2_000_000_00;
    const seq = { value: 0 };
    apply(world, seq, {
      type: CommandType.buildRoad,
      ax: 10,
      ay: 20,
      bx: 50,
      by: 20,
      roadClass: 1,
    });
    apply(world, seq, { type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
    apply(world, seq, { type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
    apply(world, seq, {
      type: CommandType.zoneRect,
      x0: 13,
      y0: 18,
      x1: 40,
      y1: 19,
      zone: 1,
    });
    await runUntil(world, 1440 * 10);
    expect(world.population).toBeGreaterThan(0);

    apply(world, seq, {
      type: CommandType.bulldozeRoad,
      ax: 10,
      ay: 20,
      bx: 50,
      by: 20,
    });
    const event = await waitForAdvisor(world, "advisor.abandonment", 1440 * 4);
    resolveLinkSubject(world, event);
    const tileIdx = firstLink(event, EntityKind.building);
    const building = world.buildings.byTile.get(tileIdx);
    expect(building).toBeDefined();
    if (building === undefined) {
      throw new Error(`abandoned building link ${tileIdx} did not resolve`);
    }
    expect(world.buildings.status[building]).toBe(BuildingStatus.abandoned);
  });

  it("single-corridor congestion names a live over-capacity edge", async () => {
    const world = createWorld(4242);
    world.fundsCents = 2_000_000_00;
    const seq = { value: 0 };
    apply(world, seq, {
      type: CommandType.buildRoad,
      ax: 8,
      ay: 20,
      bx: 20,
      by: 20,
      roadClass: 1,
    });
    apply(world, seq, {
      type: CommandType.buildRoad,
      ax: 20,
      ay: 20,
      bx: 44,
      by: 20,
      roadClass: 1,
    });
    apply(world, seq, {
      type: CommandType.buildRoad,
      ax: 44,
      ay: 20,
      bx: 56,
      by: 20,
      roadClass: 1,
    });
    apply(world, seq, { type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
    apply(world, seq, { type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
    apply(world, seq, { type: CommandType.placeBuilding, x: 52, y: 21, building: 1 });
    apply(world, seq, { type: CommandType.placeBuilding, x: 54, y: 21, building: 2 });
    apply(world, seq, {
      type: CommandType.zoneRect,
      x0: 9,
      y0: 14,
      x1: 19,
      y1: 19,
      zone: 2,
    });
    apply(world, seq, {
      type: CommandType.zoneRect,
      x0: 9,
      y0: 21,
      x1: 19,
      y1: 24,
      zone: 2,
    });
    apply(world, seq, {
      type: CommandType.zoneRect,
      x0: 45,
      y0: 21,
      x1: 55,
      y1: 23,
      zone: 5,
    });
    apply(world, seq, {
      type: CommandType.zoneRect,
      x0: 45,
      y0: 17,
      x1: 55,
      y1: 19,
      zone: 4,
    });

    const event = await waitForAdvisor(world, "advisor.congestion", 1440 * 45);
    resolveLinkSubject(world, event);
    const edge = firstLink(event, EntityKind.edge);
    expect(world.traffic.volumes[edge] as number).toBeGreaterThan(
      world.roads.edgeCapacity_[edge] as number,
    );
  });

  it("polluted water intake names both the pump and the polluted intake tile", async () => {
    const world = createWorld(7);
    world.fundsCents = 2_000_000_00;
    for (let x = 0; x < world.mapWidth; x++) {
      world.terrain.layers.water[12 * world.mapWidth + x] = 1;
    }
    const seq = { value: 0 };
    apply(world, seq, {
      type: CommandType.buildRoad,
      ax: 2,
      ay: 8,
      bx: 30,
      by: 8,
      roadClass: 1,
    });
    apply(world, seq, {
      type: CommandType.placeBuilding,
      x: 4,
      y: 9,
      building: BuildingKind.sewageOutlet,
    });
    apply(world, seq, {
      type: CommandType.placeBuilding,
      x: 10,
      y: 9,
      building: BuildingKind.waterPump,
    });

    const event = await waitForAdvisor(world, "advisor.waterCrisis", 1440 * 2);
    resolveLinkSubject(world, event);
    const pumpTile = firstLink(event, EntityKind.building);
    const intakeTile = firstLink(event, EntityKind.tile);
    expect(world.buildings.byTile.get(pumpTile)).toBeDefined();
    expect(world.terrain.layers.water[intakeTile]).not.toBe(0);
    expect(pollutionAt(world, intakeTile).water).toBeGreaterThan(0);
  });

  it("bankruptcy post-mortem names the city-level drain and report proves upkeep", async () => {
    const world = createWorld(13);
    world.fundsCents = 160_000_00;
    const seq = { value: 0 };
    apply(world, seq, {
      type: CommandType.buildRoad,
      ax: 0,
      ay: 8,
      bx: 63,
      by: 8,
      roadClass: 2,
    });
    for (let i = 0; i < 6; i++) {
      apply(world, seq, {
        type: CommandType.placeBuilding,
        x: 4 + i * 3,
        y: 9,
        building: i % 2 === 0 ? BuildingKind.hospital : BuildingKind.telecomTower,
      });
    }
    apply(world, seq, {
      type: CommandType.zoneRect,
      x0: 4,
      y0: 10,
      x1: 12,
      y1: 12,
      zone: 1,
    });

    const event = await waitForAdvisor(world, "advisor.bailout", TICKS_PER_GAME_YEAR);
    resolveLinkSubject(world, event);
    expect(firstLink(event, EntityKind.system)).toBe(0);
    expect(world.economy.bailoutUsed).toBe(1);
    expect(world.economy.lastMonthCents[5 - 1]).toBeLessThan(0);
  });
});
