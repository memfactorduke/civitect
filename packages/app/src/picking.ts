/**
 * Pointer → tile picking. Pure: takes the stage's screen transform and a
 * client point, returns the tile or null when off-map. The renderer owns the
 * iso math (worldToTile); this module owns "where is the stage on screen".
 */
import { worldToTile } from "@civitect/renderer";

export interface StageTransform {
  /** Stage root position in CSS px within the canvas. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Uniform stage scale — 1 until Phase 1 camera zoom. */
  readonly scale: number;
}

export function pickTile(
  transform: StageTransform,
  clientX: number,
  clientY: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null {
  const wx = (clientX - transform.offsetX) / transform.scale;
  const wy = (clientY - transform.offsetY) / transform.scale;
  const tile = worldToTile(wx, wy);
  if (tile.x < 0 || tile.y < 0 || tile.x >= mapWidth || tile.y >= mapHeight) {
    return null;
  }
  return { x: tile.x, y: tile.y };
}
