/**
 * Visible speed controls smoke: the Pause/1x/3x/9x buttons must drive the
 * real app command queue, reach the worker, update snapshot speed, and affect
 * tick progression. Unit tests cover the React dispatch shape; this proves the
 * playable browser wiring.
 */
import { expect, type Page, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): {
        tick: number;
        speed: number;
      };
      commandCount(): number;
    };
  }
}

const buttonFor = (page: Page, speed: number) =>
  page.getByRole("button", { name: new RegExp(`^${speed}`) });

async function waitForSpeed(page: Page, speed: number) {
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().speed ?? -1), {
      timeout: 15_000,
    })
    .toBe(speed);
}

async function tick(page: Page): Promise<number> {
  return page.evaluate(() => window.__civitect?.displayState().tick ?? -1);
}

test("visible speed controls update worker speed and pause tick progression", async ({ page }) => {
  const rejectedCommands: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[sim] rejected command")) {
      rejectedCommands.push(text);
    }
  });

  await page.goto("/");
  await expect.poll(async () => tick(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);

  const commandCountBefore = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);
  await waitForSpeed(page, 1);
  await expect(buttonFor(page, 1)).toHaveAttribute("aria-pressed", "true");

  await buttonFor(page, 3).click();
  await waitForSpeed(page, 3);
  await expect(buttonFor(page, 3)).toHaveAttribute("aria-pressed", "true");

  const fastStartTick = await tick(page);
  await buttonFor(page, 9).click();
  await waitForSpeed(page, 9);
  await expect(buttonFor(page, 9)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => tick(page)).toBeGreaterThan(fastStartTick + 4);

  await page.getByRole("button", { name: "Pause" }).click();
  await waitForSpeed(page, 0);
  await expect(page.getByRole("button", { name: "Pause" })).toHaveAttribute("aria-pressed", "true");

  const pausedTick = await tick(page);
  await page.waitForTimeout(350);
  expect(await tick(page)).toBe(pausedTick);

  await buttonFor(page, 1).click();
  await waitForSpeed(page, 1);
  await expect(buttonFor(page, 1)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => tick(page)).toBeGreaterThan(pausedTick);

  const commandCountAfter = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);
  expect(commandCountAfter).toBe(commandCountBefore + 4);
  expect(rejectedCommands).toEqual([]);
});
