import type { Rgb } from "./palette";
import type { RawImage } from "./png";

export interface ShadowNormalizeOptions {
  /** Pixels at or below this alpha are treated as transparent and left as-is. */
  readonly transparentAlphaMax?: number;
  /** Semi-transparent pixels up to this alpha can be classified as shadow. */
  readonly detectAlphaMax?: number;
  /** Shadow alpha is capped to this value after classification. */
  readonly outputAlphaMax?: number;
  /** Maximum perceived brightness for shadow classification. */
  readonly lumaMax?: number;
  /** Maximum channel spread, so saturated dark object colors stay untouched. */
  readonly chromaMax?: number;
  /** Canonical shadow tint used by the cel-shaded sprite pipeline. */
  readonly target?: Rgb;
}

export interface ShadowNormalizeResult {
  readonly image: RawImage;
  readonly normalizedPixels: number;
}

interface NormalizedShadowOptions {
  readonly transparentAlphaMax: number;
  readonly detectAlphaMax: number;
  readonly outputAlphaMax: number;
  readonly lumaMax: number;
  readonly chromaMax: number;
  readonly target: Rgb;
}

const DEFAULT_SHADOW: NormalizedShadowOptions = {
  transparentAlphaMax: 8,
  detectAlphaMax: 180,
  outputAlphaMax: 96,
  lumaMax: 96,
  chromaMax: 32,
  target: { r: 24, g: 26, b: 25 },
};

function requireByte(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error(`${name} must be an integer in [0, 255], got ${value}`);
  }
}

function normalizeOptions(options: ShadowNormalizeOptions): NormalizedShadowOptions {
  const out = { ...DEFAULT_SHADOW, ...options };
  requireByte("transparentAlphaMax", out.transparentAlphaMax);
  requireByte("detectAlphaMax", out.detectAlphaMax);
  requireByte("outputAlphaMax", out.outputAlphaMax);
  requireByte("lumaMax", out.lumaMax);
  requireByte("chromaMax", out.chromaMax);
  requireByte("target.r", out.target.r);
  requireByte("target.g", out.target.g);
  requireByte("target.b", out.target.b);
  if (out.transparentAlphaMax > out.detectAlphaMax) {
    throw new Error("transparentAlphaMax must be <= detectAlphaMax");
  }
  return out;
}

function requireImage(image: RawImage): void {
  if (image.width <= 0 || image.height <= 0) {
    throw new Error("shadow normalization requires a non-empty image");
  }
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new Error(
      `pixel buffer is ${image.pixels.length} bytes, want ${image.width * image.height * 4}`,
    );
  }
}

function luma(r: number, g: number, b: number): number {
  return Math.round((299 * r + 587 * g + 114 * b) / 1000);
}

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function isShadowPixel(
  r: number,
  g: number,
  b: number,
  a: number,
  options: NormalizedShadowOptions,
): boolean {
  if (a <= options.transparentAlphaMax || a > options.detectAlphaMax) {
    return false;
  }
  return luma(r, g, b) <= options.lumaMax && chroma(r, g, b) <= options.chromaMax;
}

/**
 * Normalize existing semi-transparent shadow pixels without inventing new art.
 * Fully transparent pixels keep their hidden RGB bytes, which keeps background
 * removal diagnostics stable across the intake chain.
 */
export function normalizeShadow(
  image: RawImage,
  options: ShadowNormalizeOptions = {},
): ShadowNormalizeResult {
  requireImage(image);
  const normalizedOptions = normalizeOptions(options);
  const pixels = Uint8Array.from(image.pixels);
  let normalizedPixels = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] as number;
    const g = pixels[i + 1] as number;
    const b = pixels[i + 2] as number;
    const a = pixels[i + 3] as number;
    if (!isShadowPixel(r, g, b, a, normalizedOptions)) {
      continue;
    }
    pixels[i] = normalizedOptions.target.r;
    pixels[i + 1] = normalizedOptions.target.g;
    pixels[i + 2] = normalizedOptions.target.b;
    pixels[i + 3] = Math.min(a, normalizedOptions.outputAlphaMax);
    normalizedPixels++;
  }

  return {
    image: { width: image.width, height: image.height, pixels },
    normalizedPixels,
  };
}
