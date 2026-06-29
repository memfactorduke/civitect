/**
 * 2:1 isometric tile metric (TDD §11 [LOCKED]: 64×32 px per tile at 1×).
 *
 * Pure integer-friendly math, shared by stage layout and input picking.
 * "World" coordinates here are unscaled 1× screen pixels relative to the
 * origin tile's top corner — camera scale/offset is the stage's business,
 * never this module's.
 */

export const TILE_W = 64;
export const TILE_H = 32;

export interface WorldPoint {
  readonly wx: number;
  readonly wy: number;
}

export interface TileCoordLike {
  readonly x: number;
  readonly y: number;
}

export interface WorldBoundsLike {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface TileBounds {
  readonly x0: number;
  readonly y0: number;
  /** Exclusive. */
  readonly x1: number;
  readonly y1: number;
}

/** Top corner (north vertex) of tile (x, y) in world px. */
export function tileToWorld(x: number, y: number): WorldPoint {
  return {
    wx: ((x - y) * TILE_W) / 2,
    wy: ((x + y) * TILE_H) / 2,
  };
}

/** Center of tile (x, y)'s diamond in world px — where highlights anchor. */
export function tileCenterToWorld(x: number, y: number): WorldPoint {
  const top = tileToWorld(x, y);
  return { wx: top.wx, wy: top.wy + TILE_H / 2 };
}

/**
 * Inverse of `tileToWorld` for picking: world px → containing tile.
 * Exact on diamond interiors; edges resolve consistently via floor (a point
 * on a shared edge belongs to exactly one tile — pickers must never flicker
 * between neighbors).
 */
export function worldToTile(wx: number, wy: number): TileCoordLike {
  const fx = wx / (TILE_W / 2);
  const fy = wy / (TILE_H / 2);
  return {
    x: Math.floor((fx + fy) / 2),
    y: Math.floor((fy - fx) / 2),
  };
}

/**
 * Conservative tile rect touched by a world-px viewport. The one-tile padding
 * keeps diamond edges from popping when camera bounds land between tile axes.
 */
export function tileBoundsForWorldBounds(
  bounds: WorldBoundsLike,
  mapWidth: number,
  mapHeight: number,
  paddingTiles = 1,
): TileBounds {
  const corners = [
    worldToTile(bounds.minX, bounds.minY),
    worldToTile(bounds.maxX, bounds.minY),
    worldToTile(bounds.minX, bounds.maxY),
    worldToTile(bounds.maxX, bounds.maxY),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x0 = Math.max(0, Math.min(...xs) - paddingTiles);
  const y0 = Math.max(0, Math.min(...ys) - paddingTiles);
  const x1 = Math.min(mapWidth, Math.max(...xs) + 1 + paddingTiles);
  const y1 = Math.min(mapHeight, Math.max(...ys) + 1 + paddingTiles);
  if (x1 <= x0 || y1 <= y0) {
    return { x0: 0, y0: 0, x1: 0, y1: 0 };
  }
  return { x0, y0, x1, y1 };
}
