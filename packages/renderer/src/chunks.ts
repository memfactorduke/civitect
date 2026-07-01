/**
 * Chunk math + terrain tinting (TDD §8, ADR-008; phase-1 board task 9) —
 * the pure half of chunked terrain rendering. 32×32-tile chunks; the stage
 * bakes one container per chunk and re-bakes only dirty ones.
 *
 * Tint values are PLACEHOLDER ramps [TUNE] until style-bible terrain art
 * exists — what's structural is chunk addressing and dirty propagation.
 */
import type { TerrainGrid } from "@civitect/protocol";

/** Chunk edge in tiles (TDD §8 [LOCKED]: 32×32-tile chunks). */
export const CHUNK_TILES = 32;

export interface ChunkLayout {
  readonly chunksX: number;
  readonly chunksY: number;
  readonly count: number;
}

export function chunkLayout(mapWidth: number, mapHeight: number): ChunkLayout {
  const chunksX = Math.ceil(mapWidth / CHUNK_TILES);
  const chunksY = Math.ceil(mapHeight / CHUNK_TILES);
  return { chunksX, chunksY, count: chunksX * chunksY };
}

/** Chunk id containing tile (x, y). Ids are row-major over the chunk grid. */
export function chunkIdOf(layout: ChunkLayout, tileX: number, tileY: number): number {
  return Math.floor(tileY / CHUNK_TILES) * layout.chunksX + Math.floor(tileX / CHUNK_TILES);
}

export interface TileRect {
  readonly x0: number;
  readonly y0: number;
  /** Exclusive. */
  readonly x1: number;
  readonly y1: number;
}

/** Tile rect covered by a chunk, clipped to the map. */
export function chunkTiles(
  layout: ChunkLayout,
  chunkId: number,
  mapWidth: number,
  mapHeight: number,
): TileRect {
  const cx = chunkId % layout.chunksX;
  const cy = Math.floor(chunkId / layout.chunksX);
  return {
    x0: cx * CHUNK_TILES,
    y0: cy * CHUNK_TILES,
    x1: Math.min(mapWidth, (cx + 1) * CHUNK_TILES),
    y1: Math.min(mapHeight, (cy + 1) * CHUNK_TILES),
  };
}

/** Distinct chunk ids touched by a set of changed tiles — the re-bake list. */
export function dirtyChunks(
  layout: ChunkLayout,
  tiles: readonly { readonly x: number; readonly y: number }[],
): number[] {
  const ids = new Set<number>();
  for (const tile of tiles) {
    ids.add(chunkIdOf(layout, tile.x, tile.y));
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Distinct chunk ids overlapping a visible tile rect. The rect may be
 * fractional or spill outside the map; culling clips it before addressing
 * chunks so off-map camera space never schedules chunk work.
 */
export function visibleChunks(
  layout: ChunkLayout,
  mapWidth: number,
  mapHeight: number,
  rect: TileRect,
): number[] {
  const x0 = Math.max(0, Math.floor(rect.x0));
  const y0 = Math.max(0, Math.floor(rect.y0));
  const x1 = Math.min(mapWidth, Math.ceil(rect.x1));
  const y1 = Math.min(mapHeight, Math.ceil(rect.y1));
  if (x1 <= x0 || y1 <= y0 || layout.count === 0) {
    return [];
  }

  const minChunkX = Math.floor(x0 / CHUNK_TILES);
  const minChunkY = Math.floor(y0 / CHUNK_TILES);
  const maxChunkX = Math.floor((x1 - 1) / CHUNK_TILES);
  const maxChunkY = Math.floor((y1 - 1) / CHUNK_TILES);
  const ids: number[] = [];
  for (let cy = minChunkY; cy <= maxChunkY; cy++) {
    for (let cx = minChunkX; cx <= maxChunkX; cx++) {
      ids.push(cy * layout.chunksX + cx);
    }
  }
  return ids;
}

/** Elevation ramp, low→high [TUNE placeholder until terrain art]. */
const ELEVATION_RAMP = [0x2e4639, 0x3a5743, 0x49684c, 0x5b7a55, 0x70885c, 0x869a66, 0x9cab72];
const WATER = 0x2b4a66;
const RESOURCE_TINT = 0x8a6f3c;

/** Flat tint for tile (x, y) of a terrain grid — the v0 "art". */
export function terrainTint(terrain: TerrainGrid, x: number, y: number): number {
  const i = y * terrain.width + x;
  if ((terrain.layers.water[i] as number) !== 0) {
    return WATER;
  }
  if ((terrain.layers.resource[i] as number) !== 0) {
    return RESOURCE_TINT;
  }
  const elevation = Math.min(ELEVATION_RAMP.length - 1, terrain.layers.elevation[i] as number);
  return ELEVATION_RAMP[elevation] as number;
}
