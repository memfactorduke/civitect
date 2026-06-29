/**
 * First-city playable loop smoke (GDD §17): from the browser surface, build
 * the minimum mayor loop - roads, utilities, zoning, fast-forward - and prove
 * the running app turns that into population, grown buildings, and visible map
 * state. This is intentionally end-to-end: real Vite app, real worker, real
 * protocol snapshots, no sim imports.
 */

import { BuildingKind, CommandType, RoadClassWire, ZoneKind } from "@civitect/protocol";
import { expect, test } from "@playwright/test";

interface DisplayState {
  readonly tick: number;
  readonly hud: {
    readonly population: number;
    readonly fundsCents: number;
  };
  readonly roads: readonly unknown[];
  readonly buildings: readonly { readonly kind: number; readonly status: number }[];
  readonly zones: Uint16Array | null;
}

declare global {
  interface Window {
    __civitect?: {
      displayState(): DisplayState;
      dispatchIntent(intent: Record<string, unknown>): void;
    };
  }
}

test("starter city grows from roads, utilities, and zones", async ({ page }) => {
  test.setTimeout(180_000);
  const rejections: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("rejected command")) {
      rejections.push(message.text());
    }
  });

  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  const commands: readonly Record<string, number>[] = [
    { type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: RoadClassWire.street },
    { type: CommandType.buildRoad, ax: 8, ay: 32, bx: 56, by: 32, roadClass: RoadClassWire.street },
    { type: CommandType.buildRoad, ax: 8, ay: 44, bx: 56, by: 44, roadClass: RoadClassWire.street },
    { type: CommandType.buildRoad, ax: 8, ay: 20, bx: 8, by: 44, roadClass: RoadClassWire.street },
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
    { type: CommandType.setSpeed, speed: 9 },
  ];

  await page.evaluate((intents) => {
    const c = window.__civitect;
    if (c === undefined) {
      throw new Error("Civitect debug hook missing");
    }
    for (const intent of intents) {
      c.dispatchIntent(intent);
    }
  }, commands);

  await expect.poll(() => rejections, { timeout: 5_000 }).toHaveLength(0);

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().hud.population ?? 0), {
      timeout: 150_000,
    })
    .toBeGreaterThanOrEqual(250);

  const result = await page.evaluate(
    (zones) => {
      const state = window.__civitect?.displayState();
      if (state === undefined) {
        throw new Error("Civitect debug hook missing");
      }
      const zoneCounts = new Map<number, number>();
      if (state.zones !== null) {
        for (const z of state.zones) {
          if (z !== zones.none) {
            zoneCounts.set(z, (zoneCounts.get(z) ?? 0) + 1);
          }
        }
      }
      return {
        population: state.hud.population,
        fundsCents: state.hud.fundsCents,
        roads: state.roads.length,
        grownBuildings: state.buildings.filter((b) => b.kind < 100).length,
        normalBuildings: state.buildings.filter((b) => b.kind < 100 && b.status === 0).length,
        residentialTiles: zoneCounts.get(zones.residentialLow) ?? 0,
        commercialTiles: zoneCounts.get(zones.commercialLow) ?? 0,
        industrialTiles: zoneCounts.get(zones.industrial) ?? 0,
      };
    },
    {
      none: ZoneKind.none,
      residentialLow: ZoneKind.residentialLow,
      commercialLow: ZoneKind.commercialLow,
      industrial: ZoneKind.industrial,
    },
  );

  expect(result.roads).toBeGreaterThanOrEqual(7);
  expect(result.residentialTiles).toBeGreaterThan(100);
  expect(result.commercialTiles).toBeGreaterThan(50);
  expect(result.industrialTiles).toBeGreaterThan(100);
  expect(result.grownBuildings).toBeGreaterThanOrEqual(20);
  expect(result.normalBuildings).toBeGreaterThan(0);
  expect(result.fundsCents).toBeLessThan(1_000_000_00);
});
