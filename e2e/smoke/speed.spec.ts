/**
 * Simulation speed smoke: the real browser app sends setSpeed through the
 * worker, and scheduled ticks obey pause/fast-forward state.
 */
import { CommandType } from "@civitect/protocol";
import { expect, type Page, test } from "@playwright/test";

interface SpeedState {
  readonly tick: number;
  readonly speed: number;
}

declare global {
  interface Window {
    __civitect?: {
      displayState(): SpeedState;
      commandCount(): number;
      dispatchIntent(intent: Record<string, unknown>): void;
    };
  }
}

async function maybeSpeedState(page: Page): Promise<SpeedState | null> {
  return await page.evaluate(() => window.__civitect?.displayState() ?? null);
}

async function speedState(page: Page): Promise<SpeedState> {
  const state = await maybeSpeedState(page);
  if (state === null) {
    throw new Error("missing civitect debug hook");
  }
  return state;
}

async function dispatchSpeed(page: Page, speed: number): Promise<void> {
  await page.evaluate(
    ({ commandType, speedValue }) => {
      window.__civitect?.dispatchIntent({ type: commandType, speed: speedValue });
    },
    { commandType: CommandType.setSpeed, speedValue: speed },
  );
}

test("setSpeed pauses scheduled ticks, resumes fast-forward, and rejects invalid tiers", async ({
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
    .poll(async () => (await maybeSpeedState(page))?.tick ?? -1, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(0);
  expect((await speedState(page)).speed).toBe(1);

  await dispatchSpeed(page, 0);
  await expect.poll(async () => (await speedState(page)).speed, { timeout: 5_000 }).toBe(0);
  const paused = await speedState(page);
  await page.waitForTimeout(350);
  expect(await speedState(page)).toMatchObject({ tick: paused.tick, speed: 0 });

  await dispatchSpeed(page, 2);
  await expect.poll(() => rejections.length, { timeout: 5_000 }).toBe(1);
  expect(rejections[0]).toContain("rejected command");
  await expect.poll(async () => (await speedState(page)).speed).toBe(0);
  const rejected = await speedState(page);
  await page.waitForTimeout(250);
  expect(await speedState(page)).toMatchObject({ tick: rejected.tick, speed: 0 });

  await dispatchSpeed(page, 3);
  await expect.poll(async () => (await speedState(page)).speed, { timeout: 5_000 }).toBe(3);
  const resumed = await speedState(page);
  await expect
    .poll(async () => (await speedState(page)).tick, { timeout: 5_000 })
    .toBeGreaterThanOrEqual(resumed.tick + 6);
  expect(rejections).toHaveLength(1);

  await dispatchSpeed(page, 0);
  await expect.poll(async () => (await speedState(page)).speed, { timeout: 5_000 }).toBe(0);
  expect(await page.evaluate(() => window.__civitect?.commandCount() ?? 0)).toBe(4);
});
