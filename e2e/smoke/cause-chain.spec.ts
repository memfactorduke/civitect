/**
 * Phase 2 exit criterion 2: cause-chain links resolve correctly in e2e.
 * Real path: zone a road with NO utilities → buildings spawn → abandon
 * after two game-days (run at 9×) → the advisor event arrives with a
 * CauseChain whose subject is the ACTUAL abandoned building — resolved
 * here against the building list in display state.
 */
import { expect, test } from "@playwright/test";

type CommandIntent = { readonly type: number; readonly [key: string]: number };
type BuildingRef = {
  readonly x: number;
  readonly y: number;
  readonly status: number;
};
type ResolvedBuilding = BuildingRef & { readonly tileIdx: number };
type CivitectDebug = {
  readonly displayState: () => {
    readonly tick: number;
    readonly buildings: readonly BuildingRef[];
  };
  readonly dispatchIntent: (intent: CommandIntent) => void;
};

declare global {
  interface Window {
    __civitect?: CivitectDebug;
  }
}

const MAP_WIDTH = 64;
const ABANDONED_STATUS = 3;

const readDisplayTick = (): number => window.__civitect?.displayState().tick ?? -1;

const bootstrapUtilityFailureCity = (): void => {
  const c = window.__civitect;
  if (c === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  c.dispatchIntent({ type: 3, ax: 10, ay: 20, bx: 40, by: 20, roadClass: 1 }); // road
  c.dispatchIntent({ type: 8, x0: 10, y0: 18, x1: 40, y1: 19, zone: 1 }); // R zone, NO utilities
  c.dispatchIntent({ type: 2, speed: 9 }); // fast-forward
};

const resolveBuildingByTile = (tileIdx: number): ResolvedBuilding | null => {
  const state = window.__civitect?.displayState();
  if (state === undefined) {
    throw new Error("Civitect debug bridge is not available");
  }
  const mapWidth = 64;
  const building =
    state.buildings.find((candidate) => candidate.y * mapWidth + candidate.x === tileIdx) ?? null;
  return building === null
    ? null
    : {
        x: building.x,
        y: building.y,
        status: building.status,
        tileIdx,
      };
};

test("abandonment advisor's cause link resolves to the real abandoned building", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(readDisplayTick), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(bootstrapUtilityFailureCity);

  // Wait for the ABANDONMENT advisor to surface in the DOM feed (≈2
  // game-days at 90 ticks/s ≈ 35 s + spawn lead time). Target it by
  // message key — Phase 4 services emit their own advisors into the same
  // feed, and this test is about the abandonment chain specifically.
  const event = page
    .locator('[data-testid="advisor-event"][data-message-key="advisor.abandonment"]')
    .first();
  const link = event.locator('[data-testid="cause-link"]').first();
  await expect(event).toBeVisible({ timeout: 180_000 });
  await expect(event).toHaveAttribute("data-severity", "2");
  await expect(link).toBeVisible({ timeout: 180_000 });
  expect(await link.getAttribute("data-subject-kind")).toBe("building");
  const subjectIdText = await link.getAttribute("data-subject-id");
  expect(subjectIdText).not.toBeNull();
  const subjectId = Number(subjectIdText);
  expect(Number.isInteger(subjectId)).toBe(true);
  expect(subjectId).toBeGreaterThanOrEqual(0);
  expect(subjectId).toBeLessThan(MAP_WIDTH * MAP_WIDTH);
  const linkText = await link.textContent();
  expect(linkText).toContain("cause.noUtilities");
  expect(linkText).toContain(`building#${subjectId}`);
  expect(linkText).toContain("1000‰");

  // RESOLVE: the ref must point at a real, currently-abandoned building.
  const resolved = await page.evaluate(resolveBuildingByTile, subjectId);
  expect(resolved).not.toBeNull();
  expect(resolved?.tileIdx).toBe(subjectId);
  expect(resolved?.status).toBe(ABANDONED_STATUS);
});
