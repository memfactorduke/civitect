/**
 * Phase 5 progression smoke: a real browser city reaches the first milestone,
 * the DOM unlocks loan controls from snapshot state, and a loan click is
 * accepted by the worker-backed command path.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      commandCount(): number;
      displayState(): {
        hud: { fundsCents: number; population: number };
        tick: number;
      };
      dispatchIntent(intent: Record<string, number>): void;
    };
  }
}

test("first milestone unlocks loans and the loan button funds the city", async ({ page }) => {
  test.setTimeout(240_000);
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
  await expect(page.getByTestId("loan-controls")).toHaveCount(0);

  await page.evaluate(() => {
    const c = window.__civitect;
    if (c === undefined) {
      throw new Error("Civitect debug hook missing");
    }
    c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
    c.dispatchIntent({ type: 10, x: 10, y: 21, building: 1 });
    c.dispatchIntent({ type: 10, x: 12, y: 21, building: 2 });
    c.dispatchIntent({ type: 8, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 });
    c.dispatchIntent({ type: 8, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 });
    c.dispatchIntent({ type: 2, speed: 9 });
  });

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().hud.population ?? 0), {
      intervals: [2000],
      timeout: 180_000,
    })
    .toBeGreaterThanOrEqual(240);
  await expect(page.getByTestId("milestone-index")).toHaveText(/Milestone 1/, {
    timeout: 15_000,
  });
  await expect(page.getByTestId("loan-controls")).toBeVisible({ timeout: 15_000 });

  // The setup city can surface unrelated warnings on future rule tweaks; this
  // assertion is specifically about the unlocked loan button path.
  rejections.length = 0;
  const commandsBefore = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);
  const fundsBefore = await page.evaluate(
    () => window.__civitect?.displayState().hud.fundsCents ?? 0,
  );
  await page.getByTestId("loan-take-1").click();

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.commandCount() ?? 0), {
      timeout: 5_000,
    })
    .toBe(commandsBefore + 1);
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().hud.fundsCents ?? 0), {
      timeout: 10_000,
    })
    .toBeGreaterThan(fundsBefore);
  await page.waitForTimeout(300);
  expect(rejections).toEqual([]);
});
