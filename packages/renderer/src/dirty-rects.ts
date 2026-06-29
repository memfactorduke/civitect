import type { TileRect } from "./chunks";

export interface DirtyTile {
  readonly x: number;
  readonly y: number;
}

export interface DirtyRectBudget {
  /** Fall back to one full-map redraw when too many distinct tiles changed. */
  readonly maxDirtyTiles?: number;
  /** Fall back to one full-map redraw when the compacted plan is still noisy. */
  readonly maxRects?: number;
}

export type DirtyRectReason = "empty" | "within-budget" | "too-many-dirty-tiles" | "too-many-rects";

export interface DirtyRectPlan {
  readonly rects: readonly TileRect[];
  /** Distinct in-bounds input tiles represented by the plan. */
  readonly dirtyTiles: number;
  /** Tiles the renderer would redraw, including overdraw from coalesced rects. */
  readonly redrawTiles: number;
  readonly fallbackFullMap: boolean;
  readonly reason: DirtyRectReason;
}

const DEFAULT_MAX_DIRTY_TILES = 4096;
const DEFAULT_MAX_RECTS = 64;

export function planDirtyTileRects(
  mapWidth: number,
  mapHeight: number,
  tiles: readonly DirtyTile[],
  budget: DirtyRectBudget = {},
): DirtyRectPlan {
  assertMapSize(mapWidth, mapHeight);
  const maxDirtyTiles = budget.maxDirtyTiles ?? DEFAULT_MAX_DIRTY_TILES;
  const maxRects = budget.maxRects ?? DEFAULT_MAX_RECTS;
  if (!Number.isInteger(maxDirtyTiles) || maxDirtyTiles < 1) {
    throw new Error(`maxDirtyTiles must be a positive integer, got ${maxDirtyTiles}`);
  }
  if (!Number.isInteger(maxRects) || maxRects < 1) {
    throw new Error(`maxRects must be a positive integer, got ${maxRects}`);
  }

  const encoded = uniqueInBoundsTiles(mapWidth, mapHeight, tiles);
  if (encoded.length === 0) {
    return emptyPlan();
  }
  if (encoded.length > maxDirtyTiles) {
    return fullMapPlan(mapWidth, mapHeight, encoded.length, "too-many-dirty-tiles");
  }

  const rects = compactTileRuns(mapWidth, encoded);
  if (rects.length > maxRects) {
    return fullMapPlan(mapWidth, mapHeight, encoded.length, "too-many-rects");
  }
  return {
    rects,
    dirtyTiles: encoded.length,
    redrawTiles: rects.reduce((sum, rect) => sum + rectArea(rect), 0),
    fallbackFullMap: false,
    reason: "within-budget",
  };
}

export function rectArea(rect: TileRect): number {
  return Math.max(0, rect.x1 - rect.x0) * Math.max(0, rect.y1 - rect.y0);
}

function assertMapSize(mapWidth: number, mapHeight: number): void {
  if (!Number.isInteger(mapWidth) || mapWidth < 1) {
    throw new Error(`mapWidth must be a positive integer, got ${mapWidth}`);
  }
  if (!Number.isInteger(mapHeight) || mapHeight < 1) {
    throw new Error(`mapHeight must be a positive integer, got ${mapHeight}`);
  }
}

function uniqueInBoundsTiles(
  mapWidth: number,
  mapHeight: number,
  tiles: readonly DirtyTile[],
): number[] {
  const encoded = new Set<number>();
  for (const tile of tiles) {
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
      continue;
    }
    if (tile.x < 0 || tile.y < 0 || tile.x >= mapWidth || tile.y >= mapHeight) {
      continue;
    }
    encoded.add(tile.y * mapWidth + tile.x);
  }
  return [...encoded].sort((a, b) => a - b);
}

function compactTileRuns(mapWidth: number, encoded: readonly number[]): TileRect[] {
  const rowRuns: TileRect[] = [];
  let current: TileRect | null = null;
  for (const value of encoded) {
    const y = Math.floor(value / mapWidth);
    const x = value - y * mapWidth;
    if (current && current.y0 === y && current.x1 === x) {
      current = {
        x0: current.x0,
        y0: current.y0,
        x1: x + 1,
        y1: current.y1,
      };
      rowRuns[rowRuns.length - 1] = current;
      continue;
    }
    current = { x0: x, y0: y, x1: x + 1, y1: y + 1 };
    rowRuns.push(current);
  }

  const rects: TileRect[] = [];
  for (const run of rowRuns) {
    const match = findVerticalMergeTarget(rects, run);
    if (match === -1) {
      rects.push(run);
    } else {
      const rect = rects[match];
      if (!rect) {
        throw new Error(`dirty rect merge target ${match} disappeared`);
      }
      rects[match] = {
        x0: rect.x0,
        y0: rect.y0,
        x1: rect.x1,
        y1: run.y1,
      };
    }
  }
  return rects.sort(compareRects);
}

function findVerticalMergeTarget(rects: readonly TileRect[], run: TileRect): number {
  for (let i = rects.length - 1; i >= 0; i--) {
    const rect = rects[i];
    if (!rect) {
      continue;
    }
    if (rect.x0 === run.x0 && rect.x1 === run.x1 && rect.y1 === run.y0) {
      return i;
    }
  }
  return -1;
}

function compareRects(a: TileRect, b: TileRect): number {
  return a.y0 - b.y0 || a.x0 - b.x0 || a.y1 - b.y1 || a.x1 - b.x1;
}

function emptyPlan(): DirtyRectPlan {
  return {
    rects: [],
    dirtyTiles: 0,
    redrawTiles: 0,
    fallbackFullMap: false,
    reason: "empty",
  };
}

function fullMapPlan(
  mapWidth: number,
  mapHeight: number,
  dirtyTiles: number,
  reason: "too-many-dirty-tiles" | "too-many-rects",
): DirtyRectPlan {
  return {
    rects: [{ x0: 0, y0: 0, x1: mapWidth, y1: mapHeight }],
    dirtyTiles,
    redrawTiles: mapWidth * mapHeight,
    fallbackFullMap: true,
    reason,
  };
}
