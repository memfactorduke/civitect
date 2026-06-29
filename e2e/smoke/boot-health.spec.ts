/**
 * Boot-health smoke: verifies the player-facing shell mounts cleanly before
 * deeper scenario tests spend time driving commands.
 */

import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __civitect?: {
      displayState(): {
        tick: number;
        highlight: { x: number; y: number } | null;
      };
      commandCount(): number;
    };
  }
}

test("app boots with HUD, renderer canvas, and no console errors", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto("/");

  await expect
    .poll(async () => page.evaluate(() => window.__civitect?.displayState().tick ?? -1), {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(0);

  await expect(page.getByRole("status", { name: "city status" })).toBeVisible();
  await expect(page.getByTestId("hud-population")).toHaveText(/\d/);
  await expect(page.getByTestId("hud-funds")).toHaveText(/\$/);
  await expect(page.getByTestId("hud-selected-tile")).toHaveText("No tile selected");

  const canvas = page.locator("#world canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);

  const renderProbe = scanPng(await canvas.screenshot({ type: "png" }));

  expect(renderProbe.opaque).toBeGreaterThan(0);
  expect(renderProbe.lit).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__civitect?.commandCount() ?? -1)).toBe(0);

  // Let one additional frame and one microtask turn flush late boot failures.
  await page.waitForTimeout(100);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

function scanPng(png: Buffer): {
  readonly lit: number;
  readonly opaque: number;
  readonly total: number;
} {
  const signature = png.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error("canvas screenshot is not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9] ?? -1;
      if (bitDepth !== 8) {
        throw new Error(`unsupported PNG bit depth ${bitDepth}`);
      }
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (width <= 0 || height <= 0 || channels === 0) {
    throw new Error(`unsupported PNG shape ${width}x${height} colorType=${colorType}`);
  }

  const bytesPerPixel = channels;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idat));
  const previous = new Uint8Array(stride);
  const current = new Uint8Array(stride);
  let inputOffset = 0;
  let opaque = 0;
  let lit = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset] ?? -1;
    inputOffset += 1;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[inputOffset + x] ?? 0;
      const left = x >= bytesPerPixel ? (current[x - bytesPerPixel] ?? 0) : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bytesPerPixel ? (previous[x - bytesPerPixel] ?? 0) : 0;
      current[x] = (raw + filterDelta(filter, left, up, upLeft)) & 0xff;
    }
    inputOffset += stride;

    for (let x = 0; x < stride; x += channels) {
      const r = current[x] ?? 0;
      const g = channels === 1 ? r : (current[x + 1] ?? 0);
      const b = channels === 1 ? r : (current[x + 2] ?? 0);
      const a = channels === 4 ? (current[x + 3] ?? 0) : 255;
      if (a > 0) {
        opaque += 1;
      }
      if (r + g + b > 0) {
        lit += 1;
      }
    }
    previous.set(current);
  }

  return { lit, opaque, total: width * height };
}

function filterDelta(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paeth(left, up, upLeft);
    default:
      throw new Error(`unsupported PNG filter ${filter}`);
  }
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) {
    return left;
  }
  return pb <= pc ? up : upLeft;
}
