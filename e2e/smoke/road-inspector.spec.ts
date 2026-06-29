/**
 * Phase 3 tranche 4 verification (GDD §9.5): the road inspector answers
 * with volume / capacity / travel time through the REAL worker boundary,
 * and the traffic overlay's congestion data rides snapshots aligned to the
 * road list. The corridor city grows until the morning peak puts actual
 * trips on the road.
 *
 * (The congestion ADVISOR's diagnosability is proven sim-level — a jammed
 * city takes ~45 game-days, ~12 real minutes at 9×, out of smoke budget.)
 */
import { expect, test } from "@playwright/test";

type CommandIntent = { readonly type: number; readonly [key: string]: number };
type RoadInfo = {
  readonly roadClass: number;
  readonly volume: number;
  readonly capacity: number;
  readonly vcPermille: number;
  readonly freeFlowCost: number;
  readonly congestedCost: number;
};
type CivitectDebug = {
  readonly displayState: () => {
    readonly tick: number;
    readonly roads: readonly unknown[];
    readonly congestion: readonly number[] | null;
  };
  readonly dispatchIntent: (intent: CommandIntent) => void;
  readonly inspectTile: (tileIdx: number) => void;
  readonly roadInfo: () => RoadInfo | null;
  readonly setTrafficOverlay: (on: boolean) => void;
};

const MAP_WIDTH = 64;
const LOCAL_ROAD_CLASS = 1;
const CORRIDOR_TILE = 20 * MAP_WIDTH + 30;

const readDisplayTick = (): number =>
  (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect?.displayState().tick ??
  -1;

const bootstrapTrafficCorridor = (): void => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
  c.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 });
  c.dispatchIntent({ type: 10, x: 12, y: 21, building: 2 });
  c.dispatchIntent({ type: 8, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 });
  c.dispatchIntent({ type: 8, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 });
  c.dispatchIntent({ type: 2, speed: 9 });
};

const inspectRoad = (tileIdx: number): RoadInfo | null => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.inspectTile(tileIdx);
  return c.roadInfo();
};

const readRoadAlignment = (): { readonly roads: number; readonly congestion: number } => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  const state = c.displayState();
  return {
    roads: state.roads.length,
    congestion: state.congestion === null ? -1 : state.congestion.length,
  };
};

const enableTrafficOverlay = (): void => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.setTrafficOverlay(true);
};

const readRoadPanelParity = (): string => {
  const c = (window as unknown as { readonly __civitect?: CivitectDebug }).__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  const road = c.roadInfo();
  if (road === null) {
    return "missing-road";
  }
  if (road.volume <= 0) {
    return `waiting-volume:${road.volume}`;
  }
  const text = (testId: string): string =>
    document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "<missing>";
  const delayPermille =
    road.freeFlowCost === 0 ? 1000 : Math.floor((road.congestedCost * 1000) / road.freeFlowCost);
  const expected = {
    volume: String(road.volume),
    capacity: String(road.capacity),
    vc: `${(road.vcPermille / 10).toFixed(1)}%`,
    delay: `×${(delayPermille / 1000).toFixed(2)}`,
  };
  const actual = {
    volume: text("road-volume"),
    capacity: text("road-capacity"),
    vc: text("road-vc"),
    delay: text("road-delay"),
  };
  return actual.volume === expected.volume &&
    actual.capacity === expected.capacity &&
    actual.vc === expected.vc &&
    actual.delay === expected.delay
    ? "match"
    : `mismatch:${JSON.stringify({ actual, expected })}`;
};

test("road inspector reports live volume/capacity/travel time; overlay data aligns", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(readDisplayTick), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(bootstrapTrafficCorridor);

  // Inspect a corridor tile: a road answers immediately (zero volume is
  // fine pre-growth — the structure is the claim here).
  await expect
    .poll(async () => page.evaluate(inspectRoad, CORRIDOR_TILE), {
      timeout: 10_000,
    })
    .not.toBeNull();
  const early = await page.evaluate(inspectRoad, CORRIDOR_TILE);
  expect(early).not.toBeNull();
  const earlyRoad = early as RoadInfo;
  expect(earlyRoad.roadClass).toBe(LOCAL_ROAD_CLASS);
  expect(earlyRoad.capacity).toBeGreaterThan(0);
  expect(earlyRoad.congestedCost).toBeGreaterThanOrEqual(earlyRoad.freeFlowCost);

  // A tile with no road answers with NO road payload.
  await expect
    .poll(async () => page.evaluate(inspectRoad, 5), {
      timeout: 10_000,
    })
    .toBeNull();
  await expect(page.locator('[data-testid="road-inspector"]')).toBeHidden({ timeout: 10_000 });

  // The panel appears for road tiles (DOM side of GDD §9.5).
  await page.evaluate(inspectRoad, CORRIDOR_TILE);
  await expect(page.locator('[data-testid="road-inspector"]')).toBeVisible({ timeout: 10_000 });

  // Grow through a morning peak: re-inspect until trips appear (rush-hour
  // curves put departures on hours 6–9; growth needs a couple game-days).
  await expect
    .poll(async () => (await page.evaluate(inspectRoad, CORRIDOR_TILE))?.volume ?? 0, {
      timeout: 180_000,
      intervals: [2000],
    })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => page.evaluate(readRoadPanelParity), {
      timeout: 10_000,
      intervals: [250],
    })
    .toBe("match");

  // Overlay data: congestion rides snapshots aligned 1:1 with roads.
  const aligned = await page.evaluate(readRoadAlignment);
  expect(aligned.congestion).toBe(aligned.roads);
  // Toggling the overlay draws without error and sticks.
  await page.evaluate(enableTrafficOverlay);
  const volumeShown = await page.locator('[data-testid="road-volume"]').textContent();
  expect(Number(volumeShown)).toBeGreaterThan(0);
});
