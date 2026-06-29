/**
 * Building-inspector smoke: a player-placed service building must be
 * inspectable through the real browser app, worker inspector channel, and
 * React overlay. This is the in-game feedback loop for service capacity,
 * local effectiveness, and environmental side effects.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): {
        tick: number;
        buildings: readonly { x: number; y: number; kind: number; status: number }[];
      };
      dispatchIntent(intent: Record<string, unknown>): void;
      inspectTile(tileIdx: number): void;
    };
  }
}

test("building inspector shows service capacity, effectiveness, and environment", async ({
  page,
}) => {
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

  await page.evaluate(() => {
    const c = window.__civitect;
    c?.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 40, by: 20, roadClass: 1 });
    c?.dispatchIntent({ type: 10, x: 10, y: 21, building: 3 });
  });

  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            window.__civitect
              ?.displayState()
              .buildings.some((building) => building.x === 10 && building.y === 21) ?? false,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(rejections).toHaveLength(0);

  await page.evaluate(() => window.__civitect?.inspectTile(21 * 64 + 10));

  await expect(page.locator('[data-testid="building-inspector"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="building-kind"]')).toHaveText("103");
  await expect(page.locator('[data-testid="building-status"]')).toHaveText("normal");
  await expect
    .poll(async () => Number(await page.locator('[data-testid="building-capacity"]').textContent()))
    .toBeGreaterThan(0);
  const effectiveness = page.locator('[data-testid="building-effectiveness"]');
  await expect
    .poll(async () => Number((await effectiveness.textContent())?.replace("%", "") ?? -1))
    .toBeGreaterThan(0);
  await expect(page.locator('[data-testid="environ-block"]')).toBeVisible();
  await expect(page.locator('[data-testid="environ-air"]')).toHaveText(/\d+/);
  await expect(page.locator('[data-testid="environ-ground"]')).toHaveText(/\d+/);
  await expect(page.locator('[data-testid="environ-noise"]')).toHaveText(/\d+/);
  await expect(page.locator('[data-testid="environ-water"]')).toHaveText(/\d+/);
});
