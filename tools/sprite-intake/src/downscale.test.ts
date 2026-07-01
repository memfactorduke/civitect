import { describe, expect, it } from "vitest";
import { downscaleSprite3x } from "./downscale";
import type { RawImage } from "./png";

function image(width: number, height: number, pixels: readonly number[]): RawImage {
  return { width, height, pixels: Uint8Array.from(pixels) };
}

function gradient3x3(): RawImage {
  const pixels: number[] = [];
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      pixels.push(x * 90, y * 90, 17, 255);
    }
  }
  return image(3, 3, pixels);
}

describe("downscaleSprite3x", () => {
  it("averages each 3x block into one 1x pixel", () => {
    const input = image(
      3,
      3,
      [
        0, 0, 0, 255, 30, 0, 0, 255, 60, 0, 0, 255, 0, 30, 0, 255, 30, 30, 0, 255, 60, 30, 0, 255,
        0, 60, 0, 255, 30, 60, 0, 255, 60, 60, 0, 255,
      ],
    );

    expect(downscaleSprite3x(input, { targetScale: 1 })).toEqual(image(1, 1, [30, 30, 0, 255]));
  });

  it("uses an exact area kernel for 3x to 2x derivatives", () => {
    expect(downscaleSprite3x(gradient3x3(), { targetScale: 2 })).toEqual(
      image(2, 2, [30, 30, 17, 255, 150, 30, 17, 255, 30, 150, 17, 255, 150, 150, 17, 255]),
    );
  });

  it("premultiplies alpha so transparent edges keep their source color", () => {
    const transparent = [0, 0, 0, 0] as const;
    const red = [255, 0, 0, 255] as const;
    const input = image(3, 3, [
      ...red,
      ...transparent,
      ...transparent,
      ...transparent,
      ...transparent,
      ...transparent,
      ...transparent,
      ...transparent,
      ...transparent,
    ]);

    expect(downscaleSprite3x(input, { targetScale: 1 })).toEqual(image(1, 1, [255, 0, 0, 28]));
  });

  it("rejects canvases that are not aligned to the 3x sprite grid", () => {
    const input = image(4, 3, new Array(4 * 3 * 4).fill(0));
    expect(() => downscaleSprite3x(input, { targetScale: 1 })).toThrow(/3x sprite grid/);
  });

  it("does not mutate the source pixels", () => {
    const input = gradient3x3();
    const before = Uint8Array.from(input.pixels);
    downscaleSprite3x(input, { targetScale: 2 });
    expect(input.pixels).toEqual(before);
  });
});
