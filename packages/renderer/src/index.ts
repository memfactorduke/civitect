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
  type CameraState,
  clampToBounds,
  containerTransform,
  createCamera,
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
