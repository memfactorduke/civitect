import { describe, expect, it } from "vitest";
import {
  checkPalette,
  PALETTE_OFFENDER_RATIO_MAX,
  PALETTE_PIXEL_DISTANCE_MAX,
  type Rgb,
  snapPalette,
} from "./palette";
import type { RawImage } from "./png";

const PALETTE: readonly Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 64, g: 96, b: 128 },
  { r: 255, g: 255, b: 255 },
];

function image(width: number, height: number, pixels: readonly number[]): RawImage {
  return { width, height, pixels: Uint8Array.from(pixels) };
}

describe("palette snapping", () => {
  it("maps visible pixels to their nearest swatch and preserves alpha", () => {
    const input = image(2, 1, [62, 99, 130, 255, 250, 251, 249, 80]);

    expect(snapPalette(input, PALETTE)).toEqual({
      image: image(2, 1, [64, 96, 128, 255, 255, 255, 255, 80]),
      mappedPixels: 2,
      changedPixels: 2,
      transparentPixels: 0,
    });
  });

  it("keeps fully transparent hidden RGB bytes untouched by default", () => {
    const input = image(2, 1, [123, 45, 67, 0, 62, 99, 130, 255]);

    expect(snapPalette(input, PALETTE)).toEqual({
      image: image(2, 1, [123, 45, 67, 0, 64, 96, 128, 255]),
      mappedPixels: 1,
      changedPixels: 1,
      transparentPixels: 1,
    });
  });

  it("can treat low-alpha fringe pixels as transparent", () => {
    const input = image(2, 1, [62, 99, 130, 4, 62, 99, 130, 5]);

    expect(snapPalette(input, PALETTE, { transparentAlphaMax: 4 })).toEqual({
      image: image(2, 1, [62, 99, 130, 4, 64, 96, 128, 5]),
      mappedPixels: 1,
      changedPixels: 1,
      transparentPixels: 1,
    });
  });

  it("is deterministic on nearest-swatch ties by keeping palette order", () => {
    const input = image(1, 1, [32, 48, 64, 255]);

    expect(snapPalette(input, PALETTE).image).toEqual(image(1, 1, [0, 0, 0, 255]));
  });

  it("does not mutate the source image", () => {
    const input = image(1, 1, [62, 99, 130, 255]);
    const before = Uint8Array.from(input.pixels);

    snapPalette(input, PALETTE);

    expect(input.pixels).toEqual(before);
  });

  it("turns off-palette visible pixels into a passing palette check", () => {
    const snapped = snapPalette(image(1, 1, [62, 99, 130, 255]), PALETTE).image;

    expect(checkPalette(snapped, PALETTE)).toMatchObject({
      ok: true,
      meanDistance: 0,
      offenderRatio: 0,
      opaquePixels: 1,
    });
  });

  it("rejects empty palettes, invalid alpha thresholds, and malformed images", () => {
    expect(() => snapPalette(image(1, 1, [0, 0, 0, 255]), [])).toThrow(/at least one swatch/);
    expect(() =>
      snapPalette(image(1, 1, [0, 0, 0, 255]), PALETTE, { transparentAlphaMax: 256 }),
    ).toThrow(/integer byte/);
    expect(() => snapPalette({ width: 2, height: 1, pixels: new Uint8Array(4) }, PALETTE)).toThrow(
      /pixel buffer/,
    );
  });

  it("keeps the snap target comfortably inside current gate thresholds", () => {
    expect(PALETTE_PIXEL_DISTANCE_MAX).toBeGreaterThan(0);
    expect(PALETTE_OFFENDER_RATIO_MAX).toBeGreaterThan(0);
  });
});
