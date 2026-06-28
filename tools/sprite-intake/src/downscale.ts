import type { RawImage } from "./png";

export type SpriteTargetScale = 1 | 2;

export interface DownscaleSpriteOptions {
  readonly targetScale: SpriteTargetScale;
}

interface Accumulator {
  r: number;
  g: number;
  b: number;
  a: number;
}

const SOURCE_SCALE = 3;

function require3xGrid(image: RawImage, targetScale: SpriteTargetScale): void {
  if (image.width % SOURCE_SCALE !== 0 || image.height % SOURCE_SCALE !== 0) {
    throw new Error(
      `downscaleSprite3x: ${image.width}x${image.height} is not aligned to the 3x sprite grid`,
    );
  }
  const width = (image.width * targetScale) / SOURCE_SCALE;
  const height = (image.height * targetScale) / SOURCE_SCALE;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(
      `downscaleSprite3x: ${image.width}x${image.height} cannot produce an exact ${targetScale}x image`,
    );
  }
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new Error(
      `downscaleSprite3x: pixel buffer is ${image.pixels.length} bytes, want ${image.width * image.height * 4}`,
    );
  }
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function samplePremultiplied(image: RawImage, x0: number, x1: number, y0: number, y1: number) {
  const acc: Accumulator = { r: 0, g: 0, b: 0, a: 0 };
  let area = 0;
  const sx0 = Math.floor(x0);
  const sx1 = Math.ceil(x1);
  const sy0 = Math.floor(y0);
  const sy1 = Math.ceil(y1);
  for (let sy = sy0; sy < sy1; sy++) {
    const wy = overlap(y0, y1, sy, sy + 1);
    if (wy === 0) continue;
    for (let sx = sx0; sx < sx1; sx++) {
      const wx = overlap(x0, x1, sx, sx + 1);
      if (wx === 0) continue;
      const weight = wx * wy;
      const at = (sy * image.width + sx) * 4;
      const alpha = (image.pixels[at + 3] as number) / 255;
      acc.r += (image.pixels[at] as number) * alpha * weight;
      acc.g += (image.pixels[at + 1] as number) * alpha * weight;
      acc.b += (image.pixels[at + 2] as number) * alpha * weight;
      acc.a += alpha * weight;
      area += weight;
    }
  }
  return { acc, area };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Build deterministic 2x/1x derivatives from the approved 3x source sprite.
 * Uses an exact area kernel with premultiplied alpha so transparent edges do
 * not bleed black into rooflines, trees, signs, or emissive masks.
 */
export function downscaleSprite3x(image: RawImage, options: DownscaleSpriteOptions): RawImage {
  const { targetScale } = options;
  require3xGrid(image, targetScale);
  const width = (image.width * targetScale) / SOURCE_SCALE;
  const height = (image.height * targetScale) / SOURCE_SCALE;
  const pixels = new Uint8Array(width * height * 4);
  const sourcePerTarget = SOURCE_SCALE / targetScale;

  for (let y = 0; y < height; y++) {
    const y0 = y * sourcePerTarget;
    const y1 = (y + 1) * sourcePerTarget;
    for (let x = 0; x < width; x++) {
      const x0 = x * sourcePerTarget;
      const x1 = (x + 1) * sourcePerTarget;
      const { acc, area } = samplePremultiplied(image, x0, x1, y0, y1);
      const dst = (y * width + x) * 4;
      const alpha = area === 0 ? 0 : acc.a / area;
      pixels[dst + 3] = clampByte(alpha * 255);
      if (alpha === 0) {
        pixels[dst] = 0;
        pixels[dst + 1] = 0;
        pixels[dst + 2] = 0;
      } else {
        pixels[dst] = clampByte(acc.r / acc.a);
        pixels[dst + 1] = clampByte(acc.g / acc.a);
        pixels[dst + 2] = clampByte(acc.b / acc.a);
      }
    }
  }

  return { width, height, pixels };
}
