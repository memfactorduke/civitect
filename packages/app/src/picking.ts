/**
 * World-px → tile picking. The camera owns screen→world (renderer
 * handle.screenToWorld inverts the live camera transform); this module
 * owns "which tile is that, if any". Off-map returns null — never clamps
 * (no phantom selections).
 */
import { worldToTile } from "@civitect/renderer";

export function pickTileAt(
  wx: number,
  wy: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null {
  const tile = worldToTile(wx, wy);
  if (tile.x < 0 || tile.y < 0 || tile.x >= mapWidth || tile.y >= mapHeight) {
    return null;
  }
  return { x: tile.x, y: tile.y };
}
