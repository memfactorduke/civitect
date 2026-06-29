/**
 * Input boundary smoke: invalid pointer locations must fail closed in the real
 * browser path. Off-map selection and off-map tool drags should dispatch no
 * sim command, create no road, and raise no rejected-command warning.
 */
import { expect, type Page, test } from "@playwright/test";

interface CivitectHook {
  displayState(): {
    readonly tick: number;
    readonly highlight: { readonly x: number; readonly y: number } | null;
    readonly roads: readonly unknown[];
  };
  commandCount(): number;
  tool?(): string;
}

declare global {
  interface Window {
    __civitect?: CivitectHook;
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

async function dispatchCanvasPointer(
  page: Page,
  type: "pointerdown" | "pointermove" | "pointerup",
  point: { readonly x: number; readonly y: number },
): Promise<void> {
  await page.evaluate(
    ({ eventType, clientX, clientY }) => {
      const canvas = document.querySelector<HTMLCanvasElement>("#world canvas");
      if (canvas === null) {
        throw new Error("world canvas missing");
      }
      canvas.dispatchEvent(
        new PointerEvent(eventType, {
          bubbles: true,
          clientX,
          clientY,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
    },
    { eventType: type, clientX: point.x, clientY: point.y },
  );
}

test("off-map select clicks do not dispatch phantom tile commands", async ({ page }) => {
  const rejections: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("rejected command")) {
      rejections.push(message.text());
    }
  });

  await waitForBoot(page);
  const before = await page.evaluate(() => ({
    commands: window.__civitect?.commandCount() ?? -1,
    highlight: window.__civitect?.displayState().highlight ?? null,
  }));

  await dispatchCanvasPointer(page, "pointerdown", { x: -10_000, y: -10_000 });
  await page.waitForTimeout(150);

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        commands: window.__civitect?.commandCount() ?? -1,
        highlight: window.__civitect?.displayState().highlight ?? null,
      })),
    )
    .toEqual(before);
  expect(rejections).toHaveLength(0);
});

test("road drags that end off-map create no segment", async ({ page }) => {
  const rejections: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("rejected command")) {
      rejections.push(message.text());
    }
  });

  await waitForBoot(page);
  await page.keyboard.press("r");
  expect(await page.evaluate(() => window.__civitect?.tool?.())).toBe("road");

  const canvas = page.locator("#world canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("world canvas has no box");
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const offMap = { x: box.x - 10_000, y: box.y - 10_000 };
  const before = await page.evaluate(() => ({
    commands: window.__civitect?.commandCount() ?? -1,
    roads: window.__civitect?.displayState().roads.length ?? -1,
  }));

  await dispatchCanvasPointer(page, "pointerdown", start);
  await dispatchCanvasPointer(page, "pointermove", offMap);
  await dispatchCanvasPointer(page, "pointerup", offMap);
  await page.waitForTimeout(250);

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        commands: window.__civitect?.commandCount() ?? -1,
        roads: window.__civitect?.displayState().roads.length ?? -1,
      })),
    )
    .toEqual(before);
  expect(rejections).toHaveLength(0);
});
