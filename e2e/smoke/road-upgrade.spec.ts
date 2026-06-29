/**
 * Road upgrade smoke: the real browser app sends upgradeRoad through the
 * worker, and the renderer reflects the upgraded road class.
 */
import { expect, test } from "@playwright/test";

interface RoadView {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly roadClass: number;
}

declare global {
  interface Window {
    __civitect?: {
      displayState(): { tick: number; roadVersion: number; roads: RoadView[] };
      dispatchIntent(intent: Record<string, unknown>): void;
    };
  }
}

test("upgradeRoad promotes a rendered street segment and rejects missing segments", async ({
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
    if (c === undefined) {
      throw new Error("missing civitect debug hook");
    }
    c.dispatchIntent({ type: 3, ax: 12, ay: 24, bx: 44, by: 24, roadClass: 1 });
  });

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().roads.length ?? 0), {
      timeout: 5_000,
    })
    .toBe(1);

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().roads[0]?.roadClass))
    .toBe(1);
  const streetRoadVersion = await page.evaluate(
    () => window.__civitect?.displayState().roadVersion ?? -1,
  );

  await page.evaluate(() => {
    window.__civitect?.dispatchIntent({ type: 5, ax: 12, ay: 24, bx: 44, by: 24, roadClass: 2 });
  });

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().roadVersion ?? -1), {
      timeout: 5_000,
    })
    .toBeGreaterThan(streetRoadVersion);
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().roads[0]?.roadClass))
    .toBe(2);
  expect(rejections).toEqual([]);

  await page.evaluate(() => {
    window.__civitect?.dispatchIntent({ type: 5, ax: 4, ay: 4, bx: 8, by: 4, roadClass: 2 });
  });

  await expect.poll(() => rejections.length, { timeout: 5_000 }).toBe(1);
  expect(rejections[0]).toContain("rejected command");

  const finalRoad = await page.evaluate(() => window.__civitect?.displayState().roads[0]);
  expect(finalRoad).toMatchObject({ ax: 12, ay: 24, bx: 44, by: 24, roadClass: 2 });
});
