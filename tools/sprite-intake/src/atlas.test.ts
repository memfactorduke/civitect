import { describe, expect, it } from "vitest";
import { type AtlasSprite, packSpriteAtlas } from "./atlas";
import type { RawImage } from "./png";

function image(width: number, height: number, rgba: readonly number[]): RawImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels.set(rgba, i);
  }
  return { width, height, pixels };
}

function pixel(atlas: RawImage, x: number, y: number): readonly number[] {
  const at = (y * atlas.width + x) * 4;
  return Array.from(atlas.pixels.subarray(at, at + 4));
}

describe("packSpriteAtlas", () => {
  it("packs sprites in stable id order with transparent padding", () => {
    const atlas = packSpriteAtlas(
      [
        { id: "z-road", image: image(2, 1, [255, 0, 0, 255]) },
        { id: "a-house", image: image(1, 2, [0, 255, 0, 255]) },
      ],
      { maxWidth: 8, padding: 1 },
    );

    expect(atlas.placements).toEqual([
      { id: "a-house", x: 1, y: 1, w: 1, h: 2 },
      { id: "z-road", x: 3, y: 1, w: 2, h: 1 },
    ]);
    expect(atlas.image.width).toBe(6);
    expect(atlas.image.height).toBe(4);
    expect(pixel(atlas.image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(atlas.image, 1, 1)).toEqual([0, 255, 0, 255]);
    expect(pixel(atlas.image, 4, 1)).toEqual([255, 0, 0, 255]);
  });

  it("wraps to a new shelf when the next sprite would exceed maxWidth", () => {
    const atlas = packSpriteAtlas(
      [
        { id: "a", image: image(3, 2, [10, 0, 0, 255]) },
        { id: "b", image: image(3, 1, [20, 0, 0, 255]) },
        { id: "c", image: image(2, 1, [30, 0, 0, 255]) },
      ],
      { maxWidth: 8, padding: 1 },
    );

    expect(atlas.placements).toEqual([
      { id: "a", x: 1, y: 1, w: 3, h: 2 },
      { id: "b", x: 1, y: 4, w: 3, h: 1 },
      { id: "c", x: 5, y: 4, w: 2, h: 1 },
    ]);
    expect(atlas.image.width).toBe(8);
    expect(atlas.image.height).toBe(6);
  });

  it("returns a minimal transparent atlas for an empty batch", () => {
    expect(packSpriteAtlas([], { maxWidth: 8 })).toEqual({
      image: { width: 1, height: 1, pixels: new Uint8Array(4) },
      placements: [],
    });
  });

  it("rejects invalid options, malformed sprites, and sprites wider than the atlas", () => {
    expect(() => packSpriteAtlas([], { maxWidth: 0 })).toThrow(/maxWidth/);
    expect(() => packSpriteAtlas([], { maxWidth: 8, padding: -1 })).toThrow(/padding/);
    expect(() =>
      packSpriteAtlas([{ id: "", image: image(1, 1, [0, 0, 0, 255]) }], { maxWidth: 8 }),
    ).toThrow(/id/);
    expect(() =>
      packSpriteAtlas([{ id: "too-wide", image: image(8, 1, [0, 0, 0, 255]) }], {
        maxWidth: 9,
        padding: 1,
      }),
    ).toThrow(/does not fit/);
    expect(() =>
      packSpriteAtlas([{ id: "bad", image: { width: 2, height: 2, pixels: new Uint8Array(4) } }], {
        maxWidth: 16,
      }),
    ).toThrow(/pixel buffer/);
    expect(() =>
      packSpriteAtlas(
        [
          { id: "dup", image: image(1, 1, [0, 0, 0, 255]) },
          { id: "dup", image: image(1, 1, [0, 0, 0, 255]) },
        ],
        { maxWidth: 8 },
      ),
    ).toThrow(/duplicate/);
  });

  it("does not mutate source images", () => {
    const sprite: AtlasSprite = { id: "a", image: image(1, 1, [1, 2, 3, 4]) };
    const before = Uint8Array.from(sprite.image.pixels);

    packSpriteAtlas([sprite], { maxWidth: 8 });

    expect(sprite.image.pixels).toEqual(before);
  });
});
