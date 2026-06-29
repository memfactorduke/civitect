import { describe, expect, it } from "vitest";
import type { RawImage } from "./png";
import { normalizeShadow } from "./shadow";

function image(width: number, height: number, pixels: readonly number[]): RawImage {
  return { width, height, pixels: Uint8Array.from(pixels) };
}

function px(image: RawImage, index: number): readonly number[] {
  const at = index * 4;
  return Array.from(image.pixels.subarray(at, at + 4));
}

describe("normalizeShadow", () => {
  it("normalizes semi-transparent neutral dark pixels to the canonical shadow", () => {
    const result = normalizeShadow(image(2, 1, [42, 40, 38, 144, 60, 58, 54, 80]));

    expect(result.normalizedPixels).toBe(2);
    expect(px(result.image, 0)).toEqual([24, 26, 25, 96]);
    expect(px(result.image, 1)).toEqual([24, 26, 25, 80]);
  });

  it("leaves saturated or opaque object pixels untouched", () => {
    const result = normalizeShadow(
      image(3, 1, [8, 20, 90, 120, 34, 32, 30, 220, 120, 118, 116, 120]),
    );

    expect(result.normalizedPixels).toBe(0);
    expect(px(result.image, 0)).toEqual([8, 20, 90, 120]);
    expect(px(result.image, 1)).toEqual([34, 32, 30, 220]);
    expect(px(result.image, 2)).toEqual([120, 118, 116, 120]);
  });

  it("preserves fully transparent hidden RGB bytes", () => {
    const result = normalizeShadow(image(2, 1, [200, 13, 77, 0, 20, 20, 20, 9]));

    expect(result.normalizedPixels).toBe(1);
    expect(px(result.image, 0)).toEqual([200, 13, 77, 0]);
    expect(px(result.image, 1)).toEqual([24, 26, 25, 9]);
  });

  it("honors custom thresholds and target colors", () => {
    const result = normalizeShadow(image(1, 1, [90, 80, 72, 150]), {
      target: { r: 10, g: 11, b: 12 },
      lumaMax: 90,
      chromaMax: 20,
      outputAlphaMax: 64,
    });

    expect(result.normalizedPixels).toBe(1);
    expect(px(result.image, 0)).toEqual([10, 11, 12, 64]);
  });

  it("rejects malformed images and invalid options", () => {
    expect(() => normalizeShadow({ width: 2, height: 2, pixels: new Uint8Array(4) })).toThrow(
      /pixel buffer/,
    );
    expect(() => normalizeShadow(image(0, 1, []))).toThrow(/non-empty/);
    expect(() => normalizeShadow(image(1, 1, [1, 1, 1, 1]), { outputAlphaMax: 300 })).toThrow(
      /outputAlphaMax/,
    );
    expect(() =>
      normalizeShadow(image(1, 1, [1, 1, 1, 1]), {
        transparentAlphaMax: 20,
        detectAlphaMax: 10,
      }),
    ).toThrow(/transparentAlphaMax/);
  });

  it("does not mutate the source image", () => {
    const source = image(1, 1, [30, 30, 30, 120]);
    const before = Uint8Array.from(source.pixels);

    normalizeShadow(source);

    expect(source.pixels).toEqual(before);
  });
});
