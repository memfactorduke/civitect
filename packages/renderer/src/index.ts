/**
 * @civitect/renderer — PixiJS v8 world rendering (TDD §8, ADR-008).
 *
 * Boundary (TDD §1): consumes protocol snapshots, knows nothing of rules —
 * never imports @civitect/sim (dependency-cruiser enforced).
 */
export {
  attachCameraControls,
  bootRenderer,
  isDragSequence,
  type RendererBootOptions,
  type RendererHandle,
} from "./boot";
export {
  CAMERA_SMOOTHING_TAU_MS,
  type CameraState,
  clampToBounds,
  containerTransform,
  createCamera,
  frameBlend,
  LodTier,
  lodTier,
  pan,
  render as renderCamera,
  screenToWorld,
  type ViewSize,
  type WorldBounds,
  worldToScreen,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAt,
} from "./camera";
export {
  CHUNK_TILES,
  type ChunkLayout,
  chunkIdOf,
  chunkLayout,
  chunkTiles,
  dirtyChunks,
  type TileRect,
  terrainTint,
} from "./chunks";
export { applySnapshot, type DisplayState, initialDisplayState } from "./display";
export {
  TILE_H,
  TILE_W,
  type TileCoordLike,
  tileCenterToWorld,
  tileToWorld,
  type WorldPoint,
  worldToTile,
} from "./iso";
export { createWorldStage, type WorldStage, type WorldStageOptions } from "./stage";
