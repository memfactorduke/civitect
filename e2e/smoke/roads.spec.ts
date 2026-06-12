/**
 * Road command vocabulary through the REAL worker (phase-1 board task 10,
 * descoped to command-loop behavior: road RENDERING — and with it the
 * drag-to-build tool UX — is follow-on work; the board row says so).
 *
 * Observability: accepted commands produce no rejection; rejections surface
 * as the app's console.warn relay. Undo/redo depth bookkeeping is asserted
 * exactly.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): { tick: number; roads: unknown[] };
      dispatchIntent(intent: Record<string, unknown>): void;
    };
  }
}

test("build 10 → undo 10 → 11th undo rejects; redo replays", async ({ page }) => {
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

  // Build a 10-segment street row (type 3 = buildRoad, class 1 = street).
  await page.evaluate(() => {
    for (let i = 0; i < 10; i++) {
      window.__civitect?.dispatchIntent({
        type: 3,
        ax: 10 + i,
        ay: 10,
        bx: 11 + i,
        by: 10,
        roadClass: 1,
      });
    }
  });
  await page.waitForTimeout(300);
  expect(rejections).toHaveLength(0);

  // Undo all ten, then one more — only the 11th may reject.
  await page.evaluate(() => {
    for (let i = 0; i < 11; i++) {
      window.__civitect?.dispatchIntent({ type: 6 });
    }
  });
  await expect.poll(() => rejections.length, { timeout: 5_000 }).toBe(1);
  expect(rejections[0]).toContain("rejected command");

  // Redo one (accepted), bulldoze it (accepted), bulldoze again (noSuchRoad).
  await page.evaluate(() => {
    window.__civitect?.dispatchIntent({ type: 7 });
    window.__civitect?.dispatchIntent({ type: 4, ax: 10, ay: 10, bx: 11, by: 10 });
    window.__civitect?.dispatchIntent({ type: 4, ax: 10, ay: 10, bx: 11, by: 10 });
  });
  await expect.poll(() => rejections.length, { timeout: 5_000 }).toBe(2);
});

test("drag-to-build: R mode drags a ghost and lands a rendered segment", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  await page.keyboard.press("r");
  const canvas = page.locator("#world canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("no canvas box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 128, cy, { steps: 4 });
  await page.mouse.up();

  // The accepted buildRoad comes back as a snapshot whose segment list the
  // renderer display state now carries (12a/12b end-to-end).
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (
              window.__civitect as unknown as {
                displayState(): { roads: unknown[] };
              }
            ).displayState().roads.length,
        ),
      { timeout: 5_000 },
    )
    .toBe(1);

  // And select mode still pans (no road tool fighting the camera).
  await page.keyboard.press("s");
  expect(await page.evaluate(() => (window.__civitect as { tool?: () => string }).tool?.())).toBe(
    "select",
  );
});
