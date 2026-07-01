import { describe, expect, it } from "vitest";
import { makeContactSheet, type Rgba } from "./contact-sheet";
import { decodePng, encodePng, type RawImage } from "./png";

function solidImage(width: number, height: number, color: Rgba): RawImage {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = color.r;
    pixels[i + 1] = color.g;
    pixels[i + 2] = color.b;
    pixels[i + 3] = color.a;
  }
  return { width, height, pixels };
}

function pixel(image: RawImage, x: number, y: number): readonly number[] {
  const i = (y * image.width + x) * 4;
  return [
    image.pixels[i] as number,
    image.pixels[i + 1] as number,
    image.pixels[i + 2] as number,
    image.pixels[i + 3] as number,
  ];
}

describe("contact sheets", () => {
  it("lays sprites out in stable order with bottom-centered alignment", () => {
    const sheet = makeContactSheet(
      [
        { id: "small-red", image: solidImage(2, 2, { r: 200, g: 0, b: 0, a: 255 }) },
        { id: "wide-green", image: solidImage(4, 1, { r: 0, g: 180, b: 0, a: 255 }) },
        { id: "tall-blue", image: solidImage(1, 3, { r: 0, g: 0, b: 220, a: 255 }) },
      ],
      {
        columns: 2,
        paddingPx: 2,
        gapPx: 1,
        background: { r: 10, g: 11, b: 12, a: 255 },
        cellBackground: { r: 40, g: 41, b: 42, a: 255 },
      },
    );

    expect(sheet.image.width).toBe(13);
    expect(sheet.image.height).toBe(11);
    expect(sheet.cells).toEqual([
      {
        id: "small-red",
        index: 0,
        cellX: 2,
        cellY: 2,
        cellW: 4,
        cellH: 3,
        imageX: 3,
        imageY: 3,
        imageW: 2,
        imageH: 2,
      },
      {
        id: "wide-green",
        index: 1,
        cellX: 7,
        cellY: 2,
        cellW: 4,
        cellH: 3,
        imageX: 7,
        imageY: 4,
        imageW: 4,
        imageH: 1,
      },
      {
        id: "tall-blue",
        index: 2,
        cellX: 2,
        cellY: 6,
        cellW: 4,
        cellH: 3,
        imageX: 3,
        imageY: 6,
        imageW: 1,
        imageH: 3,
      },
    ]);
    expect(pixel(sheet.image, 0, 0)).toEqual([10, 11, 12, 255]);
    expect(pixel(sheet.image, 2, 2)).toEqual([40, 41, 42, 255]);
    expect(pixel(sheet.image, 3, 3)).toEqual([200, 0, 0, 255]);
    expect(pixel(sheet.image, 7, 4)).toEqual([0, 180, 0, 255]);
    expect(pixel(sheet.image, 3, 6)).toEqual([0, 0, 220, 255]);
  });

  it("alpha-composites sprites over the review cell background", () => {
    const sheet = makeContactSheet(
      [{ id: "half-red", image: solidImage(1, 1, { r: 255, g: 0, b: 0, a: 128 }) }],
      {
        columns: 1,
        paddingPx: 0,
        gapPx: 0,
        background: { r: 0, g: 0, b: 0, a: 255 },
        cellBackground: { r: 0, g: 0, b: 255, a: 255 },
      },
    );

    expect(pixel(sheet.image, 0, 0)).toEqual([128, 0, 127, 255]);
  });

  it("produces PNGs that round-trip through the intake codec", async () => {
    const sheet = makeContactSheet([
      { id: "a", state: "normal", image: solidImage(3, 2, { r: 12, g: 34, b: 56, a: 255 }) },
      { id: "b", state: "abandoned", image: solidImage(2, 3, { r: 80, g: 90, b: 100, a: 255 }) },
    ]);

    const decoded = await decodePng(await encodePng(sheet.image), "contact-sheet.png");

    expect(decoded).toEqual(sheet.image);
    expect(sheet.cells.map((cell) => `${cell.id}:${cell.state ?? "normal"}`)).toEqual([
      "a:normal",
      "b:abandoned",
    ]);
  });

  it("rejects empty sheets and malformed image buffers", () => {
    expect(() => makeContactSheet([])).toThrow(/at least one/);
    expect(() =>
      makeContactSheet([
        {
          id: "bad",
          image: { width: 2, height: 2, pixels: new Uint8Array(4) },
        },
      ]),
    ).toThrow(/want 16/);
  });
});
