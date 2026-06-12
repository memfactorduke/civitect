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

function nearestDistance(palette: readonly Rgb[], r: number, g: number, b: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const swatch of palette) {
    const dr = r - swatch.r;
    const dg = g - swatch.g;
    const db = b - swatch.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < best) {
      best = d;
    }
  }
  return Math.sqrt(best);
}

/** Lint opaque pixels (alpha ≥ 128) against the master ramps. */
export function checkPalette(image: RawImage, palette: readonly Rgb[]): PaletteCheckResult {
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
