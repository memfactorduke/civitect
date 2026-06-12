/**
 * Phase 4 task 6 verification: the coverage overlay works through the REAL
 * worker boundary — place a fire station, select the fire overlay, and the
 * coverage layer rides snapshots into renderer display state, nonzero near
 * the station and zero far off-network. A budget cut visibly shrinks reach.
 */
import { expect, test } from "@playwright/test";

test("fire-coverage overlay rides snapshots; budget slider reshapes it", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => (window as any).__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  await page.evaluate(() => {
    const c = (window as any).__civitect;
    c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 40, by: 20, roadClass: 1 }); // street
    c.dispatchIntent({ type: 10, x: 10, y: 21, building: 3 }); // fire station
    c.selectOverlay(1); // ServiceId.fire
    c.dispatchIntent({ type: 2, speed: 9 });
  });

  // The coverage layer arrives with the next snapshots: hot beside the
  // station, zero in the far map corner (network distance, not euclidean).
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const cov = (window as any).__civitect.coverage();
          return cov.service === 1 && cov.field !== null ? cov.field[21 * 64 + 11] : -1;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(128);
  const farCorner = await page.evaluate(
    () => (window as any).__civitect.coverage().field?.[63 * 64 + 63] ?? -1,
  );
  expect(farCorner).toBe(0);

  // Starve the fire budget to 50% — the east end of the street falls out
  // of reach (the digest moves and the field genuinely shrinks).
  const eastBefore = await page.evaluate(
    () => (window as any).__civitect.coverage().field?.[20 * 64 + 38] ?? -1,
  );
  await page.evaluate(() => {
    (window as any).__civitect.dispatchIntent({ type: 13, service: 1, permille: 500 });
  });
  await expect
    .poll(
      async () =>
        page.evaluate(() => (window as any).__civitect.coverage().field?.[20 * 64 + 38] ?? -1),
      { timeout: 30_000 },
    )
    .toBeLessThan(eastBefore);
});
