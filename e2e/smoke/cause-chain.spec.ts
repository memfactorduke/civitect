/**
 * Phase 2 exit criterion 2: cause-chain links resolve correctly in e2e.
 * Real path: zone a road with NO utilities → buildings spawn → abandon
 * after two game-days (run at 9×) → the advisor event arrives with a
 * CauseChain whose subject is the ACTUAL abandoned building — resolved
 * here against the building list in display state.
 */
import { expect, test } from "@playwright/test";

test("abandonment advisor's cause link resolves to the real abandoned building", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => (window as any).__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(() => {
    const c = (window as any).__civitect;
    c.dispatchIntent({ type: 3, ax: 10, ay: 20, bx: 40, by: 20, roadClass: 1 }); // road
    c.dispatchIntent({ type: 8, x0: 10, y0: 18, x1: 40, y1: 19, zone: 1 }); // R zone, NO utilities
    c.dispatchIntent({ type: 2, speed: 9 }); // fast-forward
  });

  // Wait for the ABANDONMENT advisor to surface in the DOM feed (≈2
  // game-days at 90 ticks/s ≈ 35 s + spawn lead time). Target it by
  // message key — Phase 4 services emit their own advisors into the same
  // feed, and this test is about the abandonment chain specifically.
  const link = page
    .locator(
      '[data-testid="advisor-event"][data-message-key="advisor.abandonment"] [data-testid="cause-link"]',
    )
    .first();
  await expect(link).toBeVisible({ timeout: 180_000 });
  expect(await link.getAttribute("data-subject-kind")).toBe("building");
  const subjectId = Number(await link.getAttribute("data-subject-id"));

  // RESOLVE: the ref must point at a real, currently-abandoned building.
  const resolved = await page.evaluate((tileIdx) => {
    const state = (window as any).__civitect.displayState();
    const mapWidth = 64;
    return state.buildings.find(
      (b: { x: number; y: number; status: number }) => b.y * mapWidth + b.x === tileIdx,
    );
  }, subjectId);
  expect(resolved).toBeDefined();
  expect(resolved.status).toBe(3); // abandoned
});
