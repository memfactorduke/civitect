/**
 * World-px → tile picking. The camera owns screen→world (renderer
 * handle.screenToWorld inverts the live camera transform); this module
 * owns "which tile is that, if any". Off-map returns null — never clamps
 * (no phantom selections).
 */
import { worldToTile } from "@civitect/renderer";

function isValidMapSize(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function pickTileAt(
  wx: number,
  wy: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null {
  if (
    !Number.isFinite(wx) ||
    !Number.isFinite(wy) ||
    !isValidMapSize(mapWidth) ||
    !isValidMapSize(mapHeight)
  ) {
    return null;
  }
  const tile = worldToTile(wx, wy);
  if (!Number.isSafeInteger(tile.x) || !Number.isSafeInteger(tile.y)) {
    return null;
  }
  if (tile.x < 0 || tile.y < 0 || tile.x >= mapWidth || tile.y >= mapHeight) {
    return null;
  }
  return { x: tile.x, y: tile.y };
}
