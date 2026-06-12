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
