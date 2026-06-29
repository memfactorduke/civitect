/**
 * Settings smoke: the player-facing settings panel must be wired to the app
 * preference store, update runtime document attributes, and survive reloads.
 */
import { expect, type Page, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): { readonly tick: number };
      commandCount(): number;
    };
  }
}

async function waitForBoot(page: Page): Promise<void> {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);
}

test("settings panel persists presentation preferences without dispatching sim commands", async ({
  page,
}) => {
  await waitForBoot(page);

  const html = page.locator("html");
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  await expect(html).toHaveAttribute("data-civitect-reduced-motion", "false");
  await expect(html).toHaveAttribute("data-civitect-battery-saver", "false");
  await expect(html).toHaveAttribute("data-civitect-agent-density", "1000");
  const commandsBefore = await page.evaluate(() => window.__civitect?.commandCount() ?? -1);

  await page.getByRole("checkbox", { name: "Reduced motion" }).check();
  await page.getByRole("checkbox", { name: "Battery saver" }).check();
  await page.getByRole("slider", { name: "Agent density" }).fill("550");

  await expect(html).toHaveAttribute("data-civitect-reduced-motion", "true");
  await expect(html).toHaveAttribute("data-civitect-battery-saver", "true");
  await expect(html).toHaveAttribute("data-civitect-agent-density", "550");
  await expect(page.getByTestId("settings-agent-density-value")).toHaveText("55%");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.commandCount() ?? -1))
    .toBe(commandsBefore);

  const stored = await page.evaluate(() => localStorage.getItem("civitect.preferences.v1"));
  expect(JSON.parse(stored ?? "null")).toEqual({
    reducedMotion: true,
    batterySaver: true,
    agentDensityPermille: 550,
  });

  await page.reload();
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByRole("checkbox", { name: "Reduced motion" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Battery saver" })).toBeChecked();
  await expect(html).toHaveAttribute("data-civitect-agent-density", "550");
});
