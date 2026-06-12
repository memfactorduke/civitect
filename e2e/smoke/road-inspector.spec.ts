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

test("road inspector reports live volume/capacity/travel time; overlay data aligns", async ({
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
    c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
    c.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 });
    c.dispatchIntent({ type: 10, x: 12, y: 21, building: 2 });
    c.dispatchIntent({ type: 8, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 });
    c.dispatchIntent({ type: 8, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 });
    c.dispatchIntent({ type: 2, speed: 9 });
  });

  // Inspect a corridor tile: a road answers immediately (zero volume is
  // fine pre-growth — the structure is the claim here).
  const corridorTile = 20 * 64 + 30;
  await page.evaluate((tile) => (window as any).__civitect.inspectTile(tile), corridorTile);
  await expect
    .poll(async () => page.evaluate(() => (window as any).__civitect.roadInfo()), {
      timeout: 10_000,
    })
    .not.toBeNull();
  const early = await page.evaluate(() => (window as any).__civitect.roadInfo());
  expect(early.roadClass).toBe(1);
  expect(early.capacity).toBeGreaterThan(0);
  expect(early.congestedCost).toBeGreaterThanOrEqual(early.freeFlowCost);

  // A tile with no road answers with NO road payload.
  await page.evaluate(() => (window as any).__civitect.inspectTile(5));
  await expect
    .poll(async () => page.evaluate(() => (window as any).__civitect.roadInfo()), {
      timeout: 10_000,
    })
    .toBeNull();

  // The panel appears for road tiles (DOM side of GDD §9.5).
  await page.evaluate((tile) => (window as any).__civitect.inspectTile(tile), corridorTile);
  await expect(page.locator('[data-testid="road-inspector"]')).toBeVisible({ timeout: 10_000 });

  // Grow through a morning peak: re-inspect until trips appear (rush-hour
  // curves put departures on hours 6–9; growth needs a couple game-days).
  await expect
    .poll(
      async () =>
        page.evaluate((tile) => {
          const c = (window as any).__civitect;
          c.inspectTile(tile);
          return c.roadInfo()?.volume ?? 0;
        }, corridorTile),
      { timeout: 180_000, intervals: [2000] },
    )
    .toBeGreaterThan(0);

  // Overlay data: congestion rides snapshots aligned 1:1 with roads.
  const aligned = await page.evaluate(() => {
    const s = (window as any).__civitect.displayState();
    return {
      roads: s.roads.length,
      congestion: s.congestion === null ? -1 : s.congestion.length,
    };
  });
  expect(aligned.congestion).toBe(aligned.roads);
  // Toggling the overlay draws without error and sticks.
  await page.evaluate(() => (window as any).__civitect.setTrafficOverlay(true));
  const volumeShown = await page.locator('[data-testid="road-volume"]').textContent();
  expect(Number(volumeShown)).toBeGreaterThan(0);
});
