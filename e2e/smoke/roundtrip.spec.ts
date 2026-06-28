/**
 * Phase 0 exit criterion 2 (ROADMAP): a tapped tile round-trips
 * command → sim → snapshot → highlight within the input→visual budget.
 *
 * Timing is measured IN PAGE (performance.now around a real pointerdown,
 * resolved by a MutationObserver on the HUD's selected-tile text) so
 * Playwright IPC never inflates the number. Three taps, median compared.
 *
 * Budget: defaults to the TDD §2 HARD GATE (100 ms — CI fails past it).
 * Run with SMOKE_BUDGET_MS=50 to assert the §2 target instead (how the
 * exit criterion itself is recorded, on real hardware rather than a noisy
 * shared runner).
 */
import { expect, test } from "@playwright/test";

const BUDGET_MS = Number(process.env.SMOKE_BUDGET_MS ?? 100);

interface TapResult {
  readonly ms: number;
  readonly hudText: string;
}

interface CameraState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

declare global {
  interface Window {
    __civitect?: {
      cameraState(): CameraState;
      displayState(): {
        tick: number;
        highlight: { x: number; y: number } | null;
      };
      commandCount(): number;
    };
  }
}

test("tap → command → sim → snapshot → highlight, under budget", async ({ page }) => {
  await page.goto("/");

  // Boot handshake: the worker's first keyframe must arrive (tick ≥ 0) and
  // the overlay must be live before we measure anything.
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByTestId("hud-selected-tile")).toHaveText("No tile selected");

  const taps: TapResult[] = [];
  for (const offset of [0, 96, -96]) {
    const result = await page.evaluate(
      (dx) =>
        new Promise<TapResult>((resolve, reject) => {
          const canvas = document.querySelector<HTMLCanvasElement>("#world canvas");
          const hud = document.querySelector('[data-testid="hud-selected-tile"]');
          if (canvas === null || hud === null) {
            reject(new Error("canvas or HUD missing"));
            return;
          }
          const before = hud.textContent;
          const timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error("no HUD selection update within 3 s — round trip broken"));
          }, 3000);
          const observer = new MutationObserver(() => {
            if (hud.textContent !== before) {
              observer.disconnect();
              clearTimeout(timeout);
              resolve({ ms: performance.now() - start, hudText: hud.textContent ?? "" });
            }
          });
          observer.observe(hud, { childList: true, characterData: true, subtree: true });
          const rect = canvas.getBoundingClientRect();
          const start = performance.now();
          canvas.dispatchEvent(
            new PointerEvent("pointerdown", {
              clientX: rect.left + rect.width / 2 + dx,
              clientY: rect.top + rect.height / 2,
              bubbles: true,
            }),
          );
        }),
      offset,
    );
    taps.push(result);
  }

  for (const tap of taps) {
    expect(tap.hudText).toContain("Selected tile");
  }
  const sorted = taps.map((t) => t.ms).sort((a, b) => a - b);
  const median = sorted[1] as number;
  console.log(
    `[smoke] tap→highlight ms: ${taps.map((t) => t.ms.toFixed(1)).join(", ")} ` +
      `(median ${median.toFixed(1)}, budget ${BUDGET_MS})`,
  );
  expect(median).toBeLessThan(BUDGET_MS);

  // The visual side of the criterion: the renderer's highlight is actually on.
  const highlight = await page.evaluate(() => window.__civitect?.displayState().highlight ?? null);
  expect(highlight).not.toBeNull();

  // And the sim stayed authoritative: selection came from snapshots, with one
  // command dispatched per tap.
  const commandCount = await page.evaluate(() => window.__civitect?.commandCount() ?? 0);
  expect(commandCount).toBe(3);

  const beforeCamera = await page.evaluate(() => window.__civitect?.cameraState());
  expect(beforeCamera).toBeDefined();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  const panned = await page.evaluate(() => window.__civitect?.cameraState());
  expect(panned?.x).toBeGreaterThan(beforeCamera?.x ?? Number.POSITIVE_INFINITY);
  expect(panned?.y).toBeGreaterThan(beforeCamera?.y ?? Number.POSITIVE_INFINITY);

  await page.keyboard.press("=");
  const zoomedIn = await page.evaluate(() => window.__civitect?.cameraState());
  expect(zoomedIn?.zoom).toBeGreaterThan(panned?.zoom ?? Number.POSITIVE_INFINITY);
  await page.keyboard.press("-");
  const zoomedOut = await page.evaluate(() => window.__civitect?.cameraState());
  expect(zoomedOut?.zoom).toBeLessThan(zoomedIn?.zoom ?? Number.NEGATIVE_INFINITY);
  expect(await page.evaluate(() => window.__civitect?.commandCount() ?? 0)).toBe(3);
});
