import { expect, type Page, test } from "@playwright/test";

interface ControlsState {
  readonly tool: "select" | "road" | "bulldoze";
  readonly zoneOverlayOn: boolean;
  readonly trafficOverlayOn: boolean;
}

declare global {
  interface Window {
    __civitect?: {
      displayState(): { tick: number };
      commandCount(): number;
      controlsState(): ControlsState;
    };
  }
}

async function controls(page: Page): Promise<ControlsState> {
  return page.evaluate(() => {
    const state = window.__civitect?.controlsState();
    if (state === undefined) {
      throw new Error("controlsState debug hook is missing");
    }
    return state;
  });
}

test("tool and overlay hotkeys update app state without sim commands", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  const initialCommands = await page.evaluate(() => window.__civitect?.commandCount() ?? -1);
  expect(await controls(page)).toEqual({
    tool: "select",
    zoneOverlayOn: false,
    trafficOverlayOn: false,
  });

  await page.keyboard.press("r");
  expect((await controls(page)).tool).toBe("road");

  await page.keyboard.press("b");
  expect((await controls(page)).tool).toBe("bulldoze");

  await page.keyboard.press("Escape");
  expect((await controls(page)).tool).toBe("select");

  await page.keyboard.press("r");
  await page.keyboard.press("s");
  expect((await controls(page)).tool).toBe("select");

  await page.keyboard.press("z");
  expect((await controls(page)).zoneOverlayOn).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", repeat: true })),
  );
  expect((await controls(page)).zoneOverlayOn).toBe(true);
  await page.keyboard.press("z");
  expect((await controls(page)).zoneOverlayOn).toBe(false);

  await page.keyboard.press("t");
  expect((await controls(page)).trafficOverlayOn).toBe(true);
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", repeat: true })),
  );
  expect((await controls(page)).trafficOverlayOn).toBe(true);
  await page.keyboard.press("t");
  expect((await controls(page)).trafficOverlayOn).toBe(false);

  expect(await page.evaluate(() => window.__civitect?.commandCount() ?? -1)).toBe(initialCommands);
});
