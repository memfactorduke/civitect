/**
 * Ploppable building placement through the REAL app -> worker -> renderer path.
 *
 * This covers a city-builder core loop without touching sim/protocol: roads
 * unlock nearby land, utility/service buildings appear in renderer snapshots,
 * and invalid placements reject without mutating the rendered building list.
 */
import { expect, test } from "@playwright/test";

type BuildingViewProbe = {
  readonly x: number;
  readonly y: number;
  readonly kind: number;
  readonly level: number;
  readonly status: number;
};

type DisplayStateProbe = {
  readonly tick: number;
  readonly roadVersion: number;
  readonly roads: readonly unknown[];
  readonly buildingVersion: number;
  readonly buildings: readonly BuildingViewProbe[];
};

declare global {
  interface Window {
    __civitect?: {
      displayState(): DisplayStateProbe;
      dispatchIntent(intent: Record<string, unknown>): void;
    };
  }
}

const PLOPPABLE_KIND_OFFSET = 100;
const BuildingKind = {
  powerPlant: 1,
  waterPump: 2,
  fireStation: 3,
} as const;

function ploppableKind(kind: number): number {
  return PLOPPABLE_KIND_OFFSET + kind;
}

test("ploppable buildings render and invalid placements reject", async ({ page }) => {
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

  const startingBuildingVersion = await page.evaluate(
    () => window.__civitect?.displayState().buildingVersion ?? -1,
  );

  await page.evaluate(() => {
    const c = window.__civitect;
    c?.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 22, by: 20, roadClass: 1 });
    c?.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 });
    c?.dispatchIntent({ type: 10, x: 12, y: 21, building: 2 });
    c?.dispatchIntent({ type: 10, x: 14, y: 21, building: 3 });
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const state = window.__civitect?.displayState();
          const buildings = state?.buildings ?? [];
          return {
            roadCount: state?.roads.length ?? 0,
            buildingVersion: state?.buildingVersion ?? -1,
            buildings: buildings.map((building) => ({
              x: building.x,
              y: building.y,
              kind: building.kind,
              level: building.level,
              status: building.status,
            })),
          };
        }),
      { timeout: 10_000 },
    )
    .toEqual({
      roadCount: 1,
      buildingVersion: startingBuildingVersion + 3,
      buildings: [
        { x: 10, y: 21, kind: ploppableKind(BuildingKind.powerPlant), level: 1, status: 0 },
        { x: 12, y: 21, kind: ploppableKind(BuildingKind.waterPump), level: 1, status: 0 },
        { x: 14, y: 21, kind: ploppableKind(BuildingKind.fireStation), level: 1, status: 0 },
      ],
    });
  expect(rejections).toHaveLength(0);

  await page.evaluate(() => {
    const c = window.__civitect;
    c?.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 });
    c?.dispatchIntent({ type: 10, x: 63, y: 63, building: 2 });
    c?.dispatchIntent({ type: 10, x: 999, y: 999, building: 3 });
  });

  await expect.poll(() => rejections.length, { timeout: 5_000 }).toBe(3);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const state = window.__civitect?.displayState();
          return {
            buildingVersion: state?.buildingVersion ?? -1,
            buildingCount: state?.buildings.length ?? 0,
          };
        }),
      { timeout: 5_000 },
    )
    .toEqual({ buildingVersion: startingBuildingVersion + 3, buildingCount: 3 });
});
