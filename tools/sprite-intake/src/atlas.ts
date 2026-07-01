import type { RawImage } from "./png";

export interface AtlasSprite {
  readonly id: string;
  readonly image: RawImage;
}

export interface AtlasOptions {
  readonly maxWidth: number;
  readonly padding?: number;
}

export interface AtlasPlacement {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface AtlasResult {
  readonly image: RawImage;
  readonly placements: readonly AtlasPlacement[];
}

interface Shelf {
  x: number;
  y: number;
  h: number;
}

function requireByteImage(id: string, image: RawImage): void {
  if (image.width <= 0 || image.height <= 0) {
    throw new Error(`${id}: atlas sprites must be non-empty`);
  }
  if (image.pixels.length !== image.width * image.height * 4) {
    throw new Error(
      `${id}: pixel buffer is ${image.pixels.length} bytes, want ${image.width * image.height * 4}`,
    );
  }
}

function normalizeOptions(options: AtlasOptions): Required<AtlasOptions> {
  const { maxWidth, padding = 2 } = options;
  if (!Number.isInteger(maxWidth) || maxWidth <= 0) {
    throw new Error(`maxWidth must be a positive integer, got ${maxWidth}`);
  }
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error(`padding must be a non-negative integer, got ${padding}`);
  }
  return { maxWidth, padding };
}

function blit(src: RawImage, dst: Uint8Array, dstWidth: number, atX: number, atY: number): void {
  for (let y = 0; y < src.height; y++) {
    const srcStart = y * src.width * 4;
    const dstStart = ((atY + y) * dstWidth + atX) * 4;
    dst.set(src.pixels.subarray(srcStart, srcStart + src.width * 4), dstStart);
  }
}

function compareId(a: AtlasSprite, b: AtlasSprite): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * Pack sprite review/runtime derivatives into one transparent RGBA atlas.
 * The packer is intentionally simple and deterministic: sprites are sorted by
 * id, shelves are filled left-to-right, and the resulting placements are
 * stable metadata for later manifest/renderer handoff work.
 */
export function packSpriteAtlas(
  sprites: readonly AtlasSprite[],
  options: AtlasOptions,
): AtlasResult {
  const { maxWidth, padding } = normalizeOptions(options);
  const ordered = [...sprites].sort(compareId);
  const seen = new Set<string>();
  for (const sprite of ordered) {
    if (sprite.id.length === 0) {
      throw new Error("atlas sprite id must be non-empty");
    }
    if (seen.has(sprite.id)) {
      throw new Error(`duplicate atlas sprite id ${JSON.stringify(sprite.id)}`);
    }
    seen.add(sprite.id);
  }
  const placements: AtlasPlacement[] = [];
  const packed: { sprite: AtlasSprite; placement: AtlasPlacement }[] = [];
  let shelf: Shelf = { x: padding, y: padding, h: 0 };
  let atlasWidth = 0;
  let atlasHeight = padding;

  for (const sprite of ordered) {
    requireByteImage(sprite.id, sprite.image);
    if (sprite.image.width + padding * 2 > maxWidth) {
      throw new Error(
        `${sprite.id}: ${sprite.image.width}px sprite does not fit maxWidth ${maxWidth}`,
      );
    }
    if (shelf.x !== padding && shelf.x + sprite.image.width + padding > maxWidth) {
      shelf = { x: padding, y: shelf.y + shelf.h + padding, h: 0 };
    }
    const placement = {
      id: sprite.id,
      x: shelf.x,
      y: shelf.y,
      w: sprite.image.width,
      h: sprite.image.height,
    };
    placements.push(placement);
    packed.push({ sprite, placement });
    shelf.x += sprite.image.width + padding;
    shelf.h = Math.max(shelf.h, sprite.image.height);
    atlasWidth = Math.max(atlasWidth, shelf.x);
    atlasHeight = Math.max(atlasHeight, shelf.y + shelf.h + padding);
  }

  const width = sprites.length === 0 ? 1 : Math.min(maxWidth, Math.max(1, atlasWidth));
  const height = sprites.length === 0 ? 1 : Math.max(1, atlasHeight);
  const pixels = new Uint8Array(width * height * 4);
  for (const { sprite, placement } of packed) {
    blit(sprite.image, pixels, width, placement.x, placement.y);
  }

  return { image: { width, height, pixels }, placements };
}
