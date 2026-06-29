/**
 * City accessibility smoke: the assembled app must expose mayor-critical HUD
 * and control surfaces through browser-native roles/names, and keyboard focus
 * traversal must not accidentally dispatch simulation commands.
 */
import { expect, type Page, test } from "@playwright/test";

interface CivitectHook {
  displayState(): {
    readonly tick: number;
  };
  commandCount(): number;
}

declare global {
  interface Window {
    __civitect?: CivitectHook;
  }
}

const SPEED_BUTTONS = ["Pause", "1×", "3×", "9×"] as const;
const FOCUSABLE_SPEED_BUTTONS = ["Pause", "3×", "9×"] as const;
const OVERLAY_BUTTONS = [
  "Off",
  "Fire",
  "Police",
  "Health",
  "Deathcare",
  "Education",
  "Parks",
  "Telecom",
  "Garbage",
  "Sewage",
  "Land value",
  "Air pollution",
  "Ground pollution",
  "Noise",
  "Water pollution",
] as const;

async function waitForBoot(page: Page): Promise<void> {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);
}

test("city chrome exposes core controls by role and accessible name", async ({ page }) => {
  await waitForBoot(page);

  const status = page.getByRole("status", { name: "city status" });
  await expect(status).toBeVisible();
  await expect(status).toContainText("Population");
  await expect(status).toContainText("Funds");
  await expect(status).toContainText("Tick");

  await expect(page.getByRole("group", { name: "Speed" })).toBeVisible();
  for (const label of SPEED_BUTTONS) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "1×" })).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("navigation", { name: "Coverage overlay" })).toBeVisible();
  for (const label of OVERLAY_BUTTONS) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

  await expect(page.getByText("Service budgets")).toBeVisible();
  for (const label of ["Demand", "Tax rates", "Advisors"] as const) {
    await expect(page.getByRole("region", { name: label })).toBeVisible();
  }
});

test("keyboard focus reaches speed controls before dispatching commands", async ({ page }) => {
  await waitForBoot(page);

  const commandCount = async (): Promise<number> =>
    page.evaluate(() => window.__civitect?.commandCount() ?? -1);
  const beforeFocus = await commandCount();

  for (const label of FOCUSABLE_SPEED_BUTTONS) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: label })).toBeFocused();
  }
  expect(await commandCount()).toBe(beforeFocus);

  await page.keyboard.press("Enter");
  await expect.poll(commandCount).toBe(beforeFocus + 1);
  await expect(page.getByRole("button", { name: "9×" })).toHaveAttribute("aria-pressed", "true");
});
