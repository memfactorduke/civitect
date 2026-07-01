/**
 * Economy controls through the real app/worker boundary: tax and service
 * budget sliders must dispatch accepted protocol commands, update their
 * optimistic DOM value, and avoid command rejection warnings.
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

test("tax and service budget sliders dispatch accepted economy commands", async ({ page }) => {
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

  const before = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);

  await setRangeValue(page, "tax-slider-1", 150);
  await expect(page.getByTestId("tax-value-1")).toHaveText("15%");

  await page.getByTestId("budget-panel").locator("summary").click();
  await setRangeValue(page, "budget-slider-8", 1300);
  await expect(page.getByTestId("budget-value-8")).toHaveText("130%");

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.commandCount() ?? 0), {
      timeout: 5_000,
    })
    .toBe(before + 2);
  await page.waitForTimeout(300);
  expect(rejections).toEqual([]);
});
