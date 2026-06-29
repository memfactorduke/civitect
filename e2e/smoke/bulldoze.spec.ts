/**
 * Tool-loop smoke: road build and bulldoze both cross the real browser,
 * renderer hit-test, command queue, worker, and snapshot path. This keeps the
 * destructive half of the first road-building loop from regressing silently.
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): { tick: number; roads: unknown[] };
      tool?: () => string;
    };
  }
}

test("bulldoze mode removes a dragged road segment without rejection", async ({ page }) => {
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

  const canvas = page.locator("#world canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("no canvas box");
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const end = { x: start.x + 128, y: start.y };

  await page.keyboard.press("r");
  expect(await page.evaluate(() => window.__civitect?.tool?.())).toBe("road");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().roads.length ?? -1), {
      timeout: 5_000,
    })
    .toBe(1);
  expect(rejections).toHaveLength(0);

  await page.keyboard.press("b");
  expect(await page.evaluate(() => window.__civitect?.tool?.())).toBe("bulldoze");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().roads.length ?? -1), {
      timeout: 5_000,
    })
    .toBe(0);
  expect(rejections).toHaveLength(0);

  await page.keyboard.press("s");
  expect(await page.evaluate(() => window.__civitect?.tool?.())).toBe("select");
});
