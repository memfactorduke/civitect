/**
 * Visible overlay picker smoke: selecting coverage from the HUD must travel
 * through the real overlayRequest channel, update renderer display state, and
 * stay presentation-only instead of dispatching sim commands.
 */
import { expect, test } from "@playwright/test";

type DebugIntent =
  | {
      readonly type: 3;
      readonly ax: number;
      readonly ay: number;
      readonly bx: number;
      readonly by: number;
      readonly roadClass: number;
    }
  | { readonly type: 10; readonly x: number; readonly y: number; readonly building: number };

declare global {
  interface Window {
    __civitect?: {
      displayState(): {
        tick: number;
        buildings: readonly unknown[];
      };
      commandCount(): number;
      coverage(): {
        service: number;
        field: readonly number[] | null;
      };
      dispatchIntent(intent: DebugIntent): void;
    };
  }
}

test("visible coverage picker selects fire overlay and turns it off without sim commands", async ({
  page,
}) => {
  const rejectedCommands: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[sim] rejected command")) {
      rejectedCommands.push(text);
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
      throw new Error("Civitect debug hook missing");
    }
    c.dispatchIntent({ type: 3, ax: 8, ay: 20, bx: 40, by: 20, roadClass: 1 });
    c.dispatchIntent({ type: 10, x: 10, y: 21, building: 3 });
  });
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().buildings.length ?? 0))
    .toBeGreaterThan(0);

  const commandsBeforeOverlay = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);
  await page.getByRole("button", { name: "Fire" }).click();
  await expect(page.getByRole("button", { name: "Fire" })).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const coverage = window.__civitect?.coverage();
          return coverage?.service === 1 && coverage.field !== null
            ? coverage.field[21 * 64 + 11]
            : -1;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(128);

  await page.getByRole("button", { name: "Off" }).click();
  await expect(page.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.coverage().service ?? -1))
    .toBe(0);
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.coverage().field ?? null))
    .toBeNull();

  const commandsAfterOverlay = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);
  expect(commandsAfterOverlay).toBe(commandsBeforeOverlay);
  expect(rejectedCommands).toEqual([]);
});
