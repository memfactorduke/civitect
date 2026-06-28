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

interface CameraSnapshot {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly renderedX: number;
  readonly renderedY: number;
  readonly renderedZoom: number;
}

declare global {
  interface Window {
    __civitect?: {
      displayState(): {
        tick: number;
        highlight: { x: number; y: number } | null;
      };
      commandCount(): number;
      camera(): CameraSnapshot;
    };
  }
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} unavailable`);
  }
  return value;
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
});

test("select-mode drag pans the camera and wheel zooms at the canvas", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  const canvas = page.locator("#world canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("no canvas box");
  }
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const beforePan = requireValue(
    await page.evaluate(() => window.__civitect?.camera()),
    "camera before pan",
  );

  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 160, center.y + 80, { steps: 5 });
  await page.mouse.up();

  const afterPan = requireValue(
    await page.evaluate(() => window.__civitect?.camera()),
    "camera after pan",
  );
  expect(Math.hypot(afterPan.x - beforePan.x, afterPan.y - beforePan.y)).toBeGreaterThan(120);

  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -600);
  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.camera().zoom ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(afterPan.zoom);

  const afterZoom = requireValue(
    await page.evaluate(() => window.__civitect?.camera()),
    "camera after zoom",
  );
  expect(afterZoom.zoom).toBeGreaterThan(afterPan.zoom);
  expect(Math.hypot(afterZoom.x - afterPan.x, afterZoom.y - afterPan.y)).toBeLessThan(1);
});
