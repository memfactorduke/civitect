/**
 * Palette governance (TDD §11, ADR-012): the master 64-swatch ramp set +
 * the deviation linter that keeps mixed AI batches coherent. The gate
 * quantizes every opaque pixel to its nearest swatch and rejects sprites
 * whose deviation exceeds thresholds — style drift fails the BUILD.
 *
 * The committed swatch values are PROVISIONAL until Mem blesses the style
 * bible's palette (Codex round in flight); swapping the JSON is the bless.
 * Thresholds are [TUNE] — tighten as the bible firms up.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawImage } from "./png";

const MASTER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "palette",
  "master-64.json",
);

export interface PaletteCheckResult {
  readonly ok: boolean;
  /** Mean nearest-swatch distance over opaque pixels. */
  readonly meanDistance: number;
  /** Share of opaque pixels farther than PIXEL_DISTANCE_MAX from every swatch. */
  readonly offenderRatio: number;
  readonly opaquePixels: number;
}

export interface PaletteSnapOptions {
  /** Pixels with alpha <= this value keep their hidden RGB bytes unchanged. */
  readonly transparentAlphaMax?: number;
}

export interface PaletteSnapResult {
  readonly image: RawImage;
  readonly mappedPixels: number;
  readonly changedPixels: number;
  readonly transparentPixels: number;
}

/** [TUNE] Gate thresholds — calibrated loosely until the style bible lands. */
export const PALETTE_MEAN_DISTANCE_MAX = 24;
export const PALETTE_PIXEL_DISTANCE_MAX = 64;
export const PALETTE_OFFENDER_RATIO_MAX = 0.02;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function loadMasterPalette(): readonly Rgb[] {
  const doc = JSON.parse(readFileSync(MASTER_PATH, "utf8")) as { swatches: string[] };
  if (!Array.isArray(doc.swatches) || doc.swatches.length !== 64) {
    throw new Error(`master palette must carry exactly 64 swatches, has ${doc.swatches?.length}`);
  }
  return doc.swatches.map((hex) => {
    const m = /^#([0-9a-f]{6})$/.exec(hex);
    if (m === null) {
      throw new Error(`master palette swatch ${JSON.stringify(hex)} is not #rrggbb`);
    }
    const v = Number.parseInt(m[1] as string, 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  });
}

function requirePalette(palette: readonly Rgb[]): void {
  if (palette.length === 0) {
    throw new Error("palette must contain at least one swatch");
  }
}

function nearestSwatch(
  palette: readonly Rgb[],
  r: number,
  g: number,
  b: number,
): { swatch: Rgb; distance: number } {
  requirePalette(palette);
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestSwatch = palette[0] as Rgb;
  for (const swatch of palette) {
    const dr = r - swatch.r;
    const dg = g - swatch.g;
    const db = b - swatch.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDistance) {
      bestDistance = d;
      bestSwatch = swatch;
    }
  }
  return { swatch: bestSwatch, distance: Math.sqrt(bestDistance) };
}

function normalizeAlphaMax(value: number | undefined): number {
  const out = value ?? 0;
  if (!Number.isInteger(out) || out < 0 || out > 255) {
    throw new Error(`transparentAlphaMax must be an integer byte, got ${out}`);
  }
  return out;
}

/** Lint opaque pixels (alpha ≥ 128) against the master ramps. */
export function checkPalette(image: RawImage, palette: readonly Rgb[]): PaletteCheckResult {
  requirePalette(palette);
  let opaque = 0;
  let sum = 0;
  let offenders = 0;
  const { pixels } = image;
  for (let i = 0; i < pixels.length; i += 4) {
    if ((pixels[i + 3] as number) < 128) {
      continue;
    }
    opaque++;
    const d = nearestDistance(
      palette,
      pixels[i] as number,
      pixels[i + 1] as number,
      pixels[i + 2] as number,
    );
    sum += d;
    if (d > PALETTE_PIXEL_DISTANCE_MAX) {
      offenders++;
    }
  }
  const meanDistance = opaque === 0 ? 0 : sum / opaque;
  const offenderRatio = opaque === 0 ? 0 : offenders / opaque;
  return {
    ok: meanDistance <= PALETTE_MEAN_DISTANCE_MAX && offenderRatio <= PALETTE_OFFENDER_RATIO_MAX,
    meanDistance,
    offenderRatio,
    opaquePixels: opaque,
  };
}

function nearestDistance(palette: readonly Rgb[], r: number, g: number, b: number): number {
  return nearestSwatch(palette, r, g, b).distance;
}

/**
 * Snap visible sprite pixels to the master ramps while preserving alpha.
 * Fully transparent hidden RGB bytes stay untouched by default, which keeps
 * background-removal diagnostics stable and avoids creating false color drift.
 */
export function snapPalette(
  image: RawImage,
  palette: readonly Rgb[],
  options: PaletteSnapOptions = {},
): PaletteSnapResult {
  requirePalette(palette);
  const transparentAlphaMax = normalizeAlphaMax(options.transparentAlphaMax);
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new Error(
      `snapPalette: pixel buffer is ${image.pixels.length} bytes, want ${image.width * image.height * 4}`,
    );
  }

  const pixels = Uint8Array.from(image.pixels);
  let mappedPixels = 0;
  let changedPixels = 0;
  let transparentPixels = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] as number;
    if (alpha <= transparentAlphaMax) {
      transparentPixels++;
      continue;
    }
    const { swatch } = nearestSwatch(
      palette,
      pixels[i] as number,
      pixels[i + 1] as number,
      pixels[i + 2] as number,
    );
    mappedPixels++;
    if (pixels[i] !== swatch.r || pixels[i + 1] !== swatch.g || pixels[i + 2] !== swatch.b) {
      changedPixels++;
    }
    pixels[i] = swatch.r;
    pixels[i + 1] = swatch.g;
    pixels[i + 2] = swatch.b;
  }

  return {
    image: { width: image.width, height: image.height, pixels },
    mappedPixels,
    changedPixels,
    transparentPixels,
  };
}
