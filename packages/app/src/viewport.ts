/**
 * Camera viewport hinting for the worker's live-agent sampler (ADR-002).
 * The renderer owns screen -> world; the app converts visible world corners
 * into clamped tile bounds before sending a protocol viewportHint message.
 */
import { type WorldPoint, worldToTile } from "@civitect/renderer";

export interface ViewportTileBounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function viewportHintFromWorldCorners(
  corners: readonly WorldPoint[],
  mapWidth: number,
  mapHeight: number,
): ViewportTileBounds {
  if (corners.length === 0) {
    throw new Error("viewport hint needs at least one world corner");
  }
  if (mapWidth <= 0 || mapHeight <= 0) {
    throw new Error("viewport hint needs positive map dimensions");
  }

  let x0 = mapWidth - 1;
  let y0 = mapHeight - 1;
  let x1 = 0;
  let y1 = 0;
  for (const corner of corners) {
    const tile = worldToTile(corner.wx, corner.wy);
    const x = clampInt(tile.x, 0, mapWidth - 1);
    const y = clampInt(tile.y, 0, mapHeight - 1);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
