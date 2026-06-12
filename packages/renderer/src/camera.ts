/**
 * Camera (TDD §8, ADR-008; phase-1 board task 2): pan/zoom as a pure
 * world↔screen transform plus the zoom-tier LOD skeleton and the
 * render-frame interpolation hook the 120 Hz pan mode will drive.
 *
 * Pure module: no Pixi, no DOM — the stage applies `containerTransform`,
 * input handlers call pan/zoomAt, picking inverts with screenToWorld.
 */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;

/** Zoom-tier thresholds [TUNE] — behavior per tier arrives with task 9+. */
export const LodTier = {
  far: 0,
  mid: 1,
  near: 2,
} as const;
export type LodTier = (typeof LodTier)[keyof typeof LodTier];

export interface CameraState {
  /** World-px point at the view center (the camera's TARGET — see render()). */
  x: number;
  y: number;
  zoom: number;
  /** Rendered position — approaches the target each frame (120 Hz hook). */
  renderedX: number;
  renderedY: number;
  renderedZoom: number;
}

export interface ViewSize {
  readonly width: number;
  readonly height: number;
}

export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function createCamera(centerX: number, centerY: number, zoom = 1): CameraState {
  const z = clampZoom(zoom);
  return {
    x: centerX,
    y: centerY,
    zoom: z,
    renderedX: centerX,
    renderedY: centerY,
    renderedZoom: z,
  };
}

function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function lodTier(zoom: number): LodTier {
  if (zoom < 0.5) {
    return LodTier.far;
  }
  if (zoom < 1.5) {
    return LodTier.mid;
  }
  return LodTier.near;
}

export function worldToScreen(
  cam: CameraState,
  view: ViewSize,
  wx: number,
  wy: number,
): { sx: number; sy: number } {
  return {
    sx: (wx - cam.renderedX) * cam.renderedZoom + view.width / 2,
    sy: (wy - cam.renderedY) * cam.renderedZoom + view.height / 2,
  };
}

export function screenToWorld(
  cam: CameraState,
  view: ViewSize,
  sx: number,
  sy: number,
): { wx: number; wy: number } {
  return {
    wx: (sx - view.width / 2) / cam.renderedZoom + cam.renderedX,
    wy: (sy - view.height / 2) / cam.renderedZoom + cam.renderedY,
  };
}

/** Pan by a SCREEN-px delta (drag): world moves opposite, scaled by zoom. */
export function pan(cam: CameraState, dxPx: number, dyPx: number): void {
  cam.x -= dxPx / cam.zoom;
  cam.y -= dyPx / cam.zoom;
}

/**
 * Multiply zoom by `factor`, keeping the world point under the screen
 * anchor (sx, sy) fixed — the wheel/pinch contract users expect.
 */
export function zoomAt(
  cam: CameraState,
  view: ViewSize,
  sx: number,
  sy: number,
  factor: number,
): void {
  const before = screenToWorld(
    { ...cam, renderedX: cam.x, renderedY: cam.y, renderedZoom: cam.zoom },
    view,
    sx,
    sy,
  );
  cam.zoom = clampZoom(cam.zoom * factor);
  // Re-solve the center so `before` sits at (sx, sy) under the new zoom.
  cam.x = before.wx - (sx - view.width / 2) / cam.zoom;
  cam.y = before.wy - (sy - view.height / 2) / cam.zoom;
}

/** Keep the camera center inside the world rect (no void-staring). */
export function clampToBounds(cam: CameraState, bounds: WorldBounds): void {
  cam.x = Math.min(bounds.maxX, Math.max(bounds.minX, cam.x));
  cam.y = Math.min(bounds.maxY, Math.max(bounds.minY, cam.y));
}

/**
 * Advance the rendered transform toward the target — the 120 Hz pan-mode
 * hook (ADR-008: camera-only interpolation; sim view stays at its rate).
 * `blend` 1 = snap (today's behavior); the ProMotion mode will pass the
 * frame-rate-aware factor.
 */
export function render(cam: CameraState, blend = 1): void {
  cam.renderedX += (cam.x - cam.renderedX) * blend;
  cam.renderedY += (cam.y - cam.renderedY) * blend;
  cam.renderedZoom += (cam.zoom - cam.renderedZoom) * blend;
}

/** Container transform the stage applies: position + uniform scale. */
export function containerTransform(
  cam: CameraState,
  view: ViewSize,
): { x: number; y: number; scale: number } {
  return {
    x: view.width / 2 - cam.renderedX * cam.renderedZoom,
    y: view.height / 2 - cam.renderedY * cam.renderedZoom,
    scale: cam.renderedZoom,
  };
}
