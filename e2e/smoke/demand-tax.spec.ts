/**
 * Demand panel through the real app/worker boundary: the player-facing RCIO
 * demand numbers must be factorized, internally additive, and visibly respond
 * when tax pressure changes residential demand.
 */
import { expect, type Page, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      commandCount(): number;
      displayState(): { tick: number };
    };
  }
}

type DemandKey = "r" | "c" | "i" | "o";

async function setRangeValue(page: Page, testId: string, value: number): Promise<void> {
  await page.getByTestId(testId).evaluate((node, next) => {
    if (!(node instanceof HTMLInputElement)) {
      throw new Error("range target is not an input");
    }
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(node, String(next));
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function demandFor(
  page: Page,
  key: DemandKey,
): Promise<{
  readonly net: number;
  readonly factors: readonly number[];
}> {
  return {
    net: Number(await page.getByTestId(`demand-${key}`).textContent()),
    factors: await Promise.all(
      [0, 1, 2].map(async (offset) =>
        Number(await page.getByTestId(`demand-${key}-f${offset}`).textContent()),
      ),
    ),
  };
}

test("demand panel factors add up and residential demand reacts to tax pressure", async ({
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

  await expect
    .poll(async () => (await demandFor(page, "r")).net, { timeout: 5_000 })
    .toBeGreaterThan(0);

  for (const key of ["r", "c", "i", "o"] as const) {
    const demand = await demandFor(page, key);
    expect(demand.factors.reduce((sum, factor) => sum + factor, 0)).toBe(demand.net);
  }

  const before = await demandFor(page, "r");
  const beforeCommands = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);

  await setRangeValue(page, "tax-slider-1", 290);
  await expect(page.getByTestId("tax-value-1")).toHaveText("29%");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.commandCount() ?? 0), {
      timeout: 5_000,
    })
    .toBe(beforeCommands + 1);

  await expect
    .poll(async () => (await demandFor(page, "r")).net, { timeout: 5_000 })
    .toBeLessThan(before.net);

  const after = await demandFor(page, "r");
  expect(after.factors.reduce((sum, factor) => sum + factor, 0)).toBe(after.net);
  expect(after.factors[1]).toBeLessThan(before.factors[1] ?? Number.POSITIVE_INFINITY);
  expect(rejections).toEqual([]);
});
