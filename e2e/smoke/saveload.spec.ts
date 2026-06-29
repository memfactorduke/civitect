/**
 * Save→load through the REAL worker boundary (board task 9): select a tile,
 * pause (freezes the world — saves become tick-exact), quicksave, run the
 * sim onward so state diverges, quickload, and the world must rewind to the
 * exact saved tick with the saved selection. Bit-level hash equality is
 * proven in Node units over the same pipeline (app/save-codec.test.ts);
 * this spec proves the wiring end to end.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): {
        tick: number;
        highlight: { x: number; y: number } | null;
      };
      commandCount(): number;
      saveQuick(): Promise<number>;
      loadQuick(): Promise<{ ok: boolean; tick: number; detail: string }>;
      hasQuicksave(): boolean;
    };
  }
}

test("quicksave → keep playing → quickload rewinds to the saved tick", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  // Fingerprint the world: select a tile with a real tap.
  await page
    .locator("#world canvas")
    .dispatchEvent("pointerdown", { bubbles: true, clientX: 640, clientY: 360 });
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().highlight ?? null))
    .not.toBeNull();

  // Pause → the world freezes, making every assertion below tick-exact.
  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(250); // drain any in-flight scheduled tick's snapshot
  const saved = await page.evaluate(() => window.__civitect?.displayState() ?? null);
  expect(saved).not.toBeNull();
  const savedTick = (saved as { tick: number }).tick;

  const savedBytes = await page.evaluate(() => window.__civitect?.saveQuick());
  expect(savedBytes ?? 0).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__civitect?.hasQuicksave())).toBe(true);

  // Run onward — post-save state must visibly diverge before we load.
  await page.getByRole("button", { name: "9×" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1))
    .toBeGreaterThan(savedTick + 5);

  const verdict = await page.evaluate(() => window.__civitect?.loadQuick());
  expect(verdict?.ok).toBe(true);
  expect(verdict?.tick).toBe(savedTick);

  // The post-load keyframe rewinds the observable world; the loaded world is
  // paused (it was saved paused), so this state is stable, not racing.
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState() ?? null))
    .toEqual(saved);
});

test("keyboard quicksave and quickload shortcuts rewind the worker state", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  await page
    .locator("#world canvas")
    .dispatchEvent("pointerdown", { bubbles: true, clientX: 640, clientY: 360 });
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().highlight ?? null))
    .not.toBeNull();

  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForTimeout(250);
  const saved = await page.evaluate(() => window.__civitect?.displayState() ?? null);
  expect(saved).not.toBeNull();
  const savedTick = (saved as { tick: number }).tick;
  expect(await page.evaluate(() => window.__civitect?.hasQuicksave() ?? false)).toBe(false);

  await page.keyboard.press("Control+s");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.hasQuicksave() ?? false), {
      timeout: 5_000,
    })
    .toBe(true);

  await page.getByRole("button", { name: "9×" }).click();
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1))
    .toBeGreaterThan(savedTick + 5);

  await page.keyboard.press("Control+o");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState() ?? null), {
      timeout: 5_000,
    })
    .toEqual(saved);
});
