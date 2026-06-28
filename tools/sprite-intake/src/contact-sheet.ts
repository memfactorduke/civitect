import type { RawImage } from "./png";

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface ContactSheetEntry {
  readonly id: string;
  readonly state?: string;
  readonly image: RawImage;
}

export interface ContactSheetOptions {
  readonly columns?: number;
  readonly paddingPx?: number;
  readonly gapPx?: number;
  readonly background?: Rgba;
  readonly cellBackground?: Rgba;
}

export interface ContactSheetCell {
  readonly id: string;
  readonly state?: string;
  readonly index: number;
  readonly cellX: number;
  readonly cellY: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly imageX: number;
  readonly imageY: number;
  readonly imageW: number;
  readonly imageH: number;
}

export interface ContactSheet {
  readonly image: RawImage;
  readonly cells: readonly ContactSheetCell[];
}

const DEFAULT_BACKGROUND: Rgba = { r: 31, g: 35, b: 39, a: 255 };
const DEFAULT_CELL_BACKGROUND: Rgba = { r: 47, g: 52, b: 58, a: 255 };

function assertByte(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${label} must be an integer byte, got ${value}`);
  }
}

function assertColor(color: Rgba, label: string): void {
  assertByte(color.r, `${label}.r`);
  assertByte(color.g, `${label}.g`);
  assertByte(color.b, `${label}.b`);
  assertByte(color.a, `${label}.a`);
}

function assertImage(image: RawImage, label: string): void {
  if (!Number.isInteger(image.width) || image.width <= 0) {
    throw new Error(`${label}.width must be a positive integer, got ${image.width}`);
  }
  if (!Number.isInteger(image.height) || image.height <= 0) {
    throw new Error(`${label}.height must be a positive integer, got ${image.height}`);
  }
  const want = image.width * image.height * 4;
  if (image.pixels.length !== want) {
    throw new Error(`${label}.pixels is ${image.pixels.length} bytes, want ${want}`);
  }
}

function fillRect(image: RawImage, x: number, y: number, w: number, h: number, color: Rgba): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const i = (row * image.width + col) * 4;
      image.pixels[i] = color.r;
      image.pixels[i + 1] = color.g;
      image.pixels[i + 2] = color.b;
      image.pixels[i + 3] = color.a;
    }
  }
}

function blendByte(src: number, srcA: number, dst: number, dstA: number, outA: number): number {
  if (outA === 0) {
    return 0;
  }
  return Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
}

function compositeOver(dst: RawImage, src: RawImage, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++) {
    for (let sx = 0; sx < src.width; sx++) {
      const srcI = (sy * src.width + sx) * 4;
      const alpha = (src.pixels[srcI + 3] as number) / 255;
      if (alpha === 0) {
        continue;
      }
      const dstI = ((y + sy) * dst.width + (x + sx)) * 4;
      const dstAlpha = (dst.pixels[dstI + 3] as number) / 255;
      const outAlpha = alpha + dstAlpha * (1 - alpha);
      dst.pixels[dstI] = blendByte(
        src.pixels[srcI] as number,
        alpha,
        dst.pixels[dstI] as number,
        dstAlpha,
        outAlpha,
      );
      dst.pixels[dstI + 1] = blendByte(
        src.pixels[srcI + 1] as number,
        alpha,
        dst.pixels[dstI + 1] as number,
        dstAlpha,
        outAlpha,
      );
      dst.pixels[dstI + 2] = blendByte(
        src.pixels[srcI + 2] as number,
        alpha,
        dst.pixels[dstI + 2] as number,
        dstAlpha,
        outAlpha,
      );
      dst.pixels[dstI + 3] = Math.round(outAlpha * 255);
    }
  }
}

function optionInt(value: number | undefined, label: string, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${resolved}`);
  }
  return resolved;
}

export function makeContactSheet(
  entries: readonly ContactSheetEntry[],
  options: ContactSheetOptions = {},
): ContactSheet {
  if (entries.length === 0) {
    throw new Error("contact sheet needs at least one sprite entry");
  }

  const columns = optionInt(options.columns, "columns", Math.ceil(Math.sqrt(entries.length)));
  if (columns === 0) {
    throw new Error("columns must be at least 1");
  }
  const paddingPx = optionInt(options.paddingPx, "paddingPx", 24);
  const gapPx = optionInt(options.gapPx, "gapPx", 16);
  const background = options.background ?? DEFAULT_BACKGROUND;
  const cellBackground = options.cellBackground ?? DEFAULT_CELL_BACKGROUND;
  assertColor(background, "background");
  assertColor(cellBackground, "cellBackground");

  let cellW = 0;
  let cellH = 0;
  for (const [index, entry] of entries.entries()) {
    if (entry.id.length === 0) {
      throw new Error(`entry ${index} id must not be empty`);
    }
    assertImage(entry.image, `entry ${index} image`);
    cellW = Math.max(cellW, entry.image.width);
    cellH = Math.max(cellH, entry.image.height);
  }

  const rows = Math.ceil(entries.length / columns);
  const width = paddingPx * 2 + columns * cellW + Math.max(0, columns - 1) * gapPx;
  const height = paddingPx * 2 + rows * cellH + Math.max(0, rows - 1) * gapPx;
  const image: RawImage = { width, height, pixels: new Uint8Array(width * height * 4) };
  fillRect(image, 0, 0, width, height, background);

  const cells: ContactSheetCell[] = [];
  for (const [index, entry] of entries.entries()) {
    const row = Math.floor(index / columns);
    const col = index % columns;
    const cellX = paddingPx + col * (cellW + gapPx);
    const cellY = paddingPx + row * (cellH + gapPx);
    fillRect(image, cellX, cellY, cellW, cellH, cellBackground);
    const imageX = cellX + Math.floor((cellW - entry.image.width) / 2);
    const imageY = cellY + (cellH - entry.image.height);
    compositeOver(image, entry.image, imageX, imageY);
    cells.push({
      id: entry.id,
      state: entry.state,
      index,
      cellX,
      cellY,
      cellW,
      cellH,
      imageX,
      imageY,
      imageW: entry.image.width,
      imageH: entry.image.height,
    });
  }

  return { image, cells };
}
