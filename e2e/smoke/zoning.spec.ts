/**
 * Zoning/dezoning smoke through the REAL app -> worker -> renderer path.
 *
 * The test covers a core city-builder action without touching sim/protocol:
 * roads make nearby land zoneable, zone paints ride back on snapshots, dezone
 * clears only the selected subset, and invalid zone intents stay rejected.
 */
import { expect, type Page, test } from "@playwright/test";

const MAP_WIDTH = 64;

type DisplayStateProbe = {
  readonly tick: number;
  readonly roadVersion: number;
  readonly roads: readonly unknown[];
  readonly zoneVersion: number;
  readonly zones: ArrayLike<number> | null;
};

declare global {
  interface Window {
    __civitect?: {
      displayState(): DisplayStateProbe;
      dispatchIntent(intent: Record<string, unknown>): void;
    };
  }
}

function tileIndex(x: number, y: number): number {
  return y * MAP_WIDTH + x;
}

async function sampleZones(page: Page) {
  return page.evaluate(
    (indices) => {
      const state = window.__civitect?.displayState();
      if (state?.zones === null || state?.zones === undefined) {
        return null;
      }
      return {
        version: state.zoneVersion,
        westResidential: state.zones[indices.westResidential],
        clearedResidential: state.zones[indices.clearedResidential],
        eastCommercial: state.zones[indices.eastCommercial],
      };
    },
    {
      westResidential: tileIndex(10, 18),
      clearedResidential: tileIndex(11, 18),
      eastCommercial: tileIndex(14, 18),
    },
  );
}

test("zone paint, dezone, and rejection update renderer state", async ({ page }) => {
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

  const startingZoneVersion = await page.evaluate(
    () => window.__civitect?.displayState().zoneVersion ?? -1,
  );

  await page.evaluate(() => {
    const c = window.__civitect;
    c?.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 20, by: 20, roadClass: 1 });
    c?.dispatchIntent({ type: 8, x0: 10, y0: 18, x1: 13, y1: 19, zone: 1 });
    c?.dispatchIntent({ type: 8, x0: 14, y0: 18, x1: 16, y1: 19, zone: 3 });
  });

  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const state = window.__civitect?.displayState();
          return {
            roadCount: state?.roads.length ?? 0,
            zoneVersion: state?.zoneVersion ?? -1,
            residential: state?.zones?.[18 * 64 + 10] ?? 0,
            commercial: state?.zones?.[18 * 64 + 14] ?? 0,
          };
        }),
      { timeout: 10_000 },
    )
    .toEqual({ roadCount: 1, zoneVersion: startingZoneVersion + 2, residential: 1, commercial: 3 });
  expect(rejections).toHaveLength(0);

  await page.evaluate(() => {
    window.__civitect?.dispatchIntent({ type: 9, x0: 11, y0: 18, x1: 13, y1: 19 });
  });

  await expect
    .poll(async () => sampleZones(page), { timeout: 10_000 })
    .toEqual({
      version: startingZoneVersion + 3,
      westResidential: 1,
      clearedResidential: 0,
      eastCommercial: 3,
    });
  expect(rejections).toHaveLength(0);

  await page.evaluate(() => {
    window.__civitect?.dispatchIntent({ type: 8, x0: 999, y0: 999, x1: 1000, y1: 1000, zone: 1 });
  });

  await expect.poll(() => rejections.length, { timeout: 5_000 }).toBe(1);
  await expect
    .poll(async () => sampleZones(page), { timeout: 5_000 })
    .toEqual({
      version: startingZoneVersion + 3,
      westResidential: 1,
      clearedResidential: 0,
      eastCommercial: 3,
    });
});
