/**
 * Pixi v8 boot (ADR-008): WebGL at launch (WebGPU stays flag-gated until
 * stable across WebViews), antialias off, devicePixelRatio capped at 2.
 *
 * The renderer never decides map size — the composition root (app) knows it
 * from boot config / save header and passes it in (snapshots don't carry map
 * dimensions; TDD §7). The camera (phase-1 task 2) owns the stage transform;
 * its rendered position advances on the ticker (the 120 Hz hook).
 */

import type { Snapshot, TerrainGrid } from "@civitect/protocol";
import { Application } from "pixi.js";
import {
  type CameraState,
  clampToBounds,
  containerTransform,
  createCamera,
  frameBlend,
  lodTier,
  pan,
  render as renderCamera,
  screenToWorld,
  type ViewSize,
  zoomAt,
} from "./camera";
import { applySnapshot, type DisplayState, initialDisplayState } from "./display";
import { TILE_H, TILE_W, tileCenterToWorld } from "./iso";
import { createWorldStage, type WorldStage } from "./stage";

export interface RendererBootOptions {
  /** Element the canvas mounts into; canvas tracks its size. */
  readonly host: HTMLElement;
  readonly mapWidth: number;
  readonly mapHeight: number;
  /** Tile layers from the map file; omitted = Phase 0 placeholder grid. */
  readonly terrain?: TerrainGrid;
}

export interface RendererHandle {
  readonly app: Application;
  readonly stage: WorldStage;
  readonly camera: CameraState;
  /** Current display state — read-only outside; advanced via consume(). */
  readonly state: () => DisplayState;
  /** Feed one protocol snapshot (+ agent transform rider); stage updates immediately. */
  consume(snapshot: Snapshot, agents?: Float32Array | null): void;
  /** Pan by a screen-px drag delta. */
  panBy(dxPx: number, dyPx: number): void;
  /** Zoom by `factor`, anchored at canvas-local (sx, sy). */
  zoomAt(sx: number, sy: number, factor: number): void;
  /** Canvas-local px → world px (picking inverts this with worldToTile). */
  screenToWorld(sx: number, sy: number): { wx: number; wy: number };
  destroy(): void;
}

const DPR_CAP = 2; // ADR-008 [TUNE]

export async function bootRenderer(options: RendererBootOptions): Promise<RendererHandle> {
  const app = new Application();
  await app.init({
    preference: "webgl",
    antialias: false,
    resolution: Math.min(globalThis.devicePixelRatio ?? 1, DPR_CAP),
    autoDensity: true,
    background: 0x1b2420,
    resizeTo: options.host,
  });
  options.host.appendChild(app.canvas);

  const stage = createWorldStage({
    mapWidth: options.mapWidth,
    mapHeight: options.mapHeight,
    terrain: options.terrain,
  });
  app.stage.addChild(stage.root);

  const view = (): ViewSize => ({
    width: app.renderer.width / app.renderer.resolution,
    height: app.renderer.height / app.renderer.resolution,
  });
  const mapCenter = tileCenterToWorld(
    Math.floor(options.mapWidth / 2),
    Math.floor(options.mapHeight / 2),
  );
  const camera = createCamera(mapCenter.wx, mapCenter.wy, 1);
  // The map's world-space bounding box: camera centers stay inside it.
  const bounds = {
    minX: (-options.mapHeight * TILE_W) / 2,
    minY: 0,
    maxX: (options.mapWidth * TILE_W) / 2,
    maxY: ((options.mapWidth + options.mapHeight) * TILE_H) / 2,
  };

  const applyCamera = (): void => {
    const t = containerTransform(camera, view());
    stage.root.position.set(t.x, t.y);
    stage.root.scale.set(t.scale);
  };
  // Rendered transform glides toward the target with a wall-clock-true
  // blend: identical trajectories at 60 and 120 Hz (ADR-008 ProMotion —
  // camera-only interpolation; the sim view stays at its own rate).
  app.ticker.add((ticker) => {
    renderCamera(camera, frameBlend(ticker.deltaMS));
    stage.setLodTier(lodTier(camera.renderedZoom));
    applyCamera();
  });
  applyCamera();

  let state = initialDisplayState();
  stage.update(state);

  return {
    app,
    stage,
    camera,
    state: () => state,
    consume(snapshot: Snapshot, agents: Float32Array | null = null): void {
      state = applySnapshot(state, snapshot);
      stage.update(state);
      stage.setAgents(agents);
      if (snapshot.dirtyChunkIds.length > 0) {
        stage.rebakeChunks([...snapshot.dirtyChunkIds]);
      }
    },
    panBy(dxPx: number, dyPx: number): void {
      pan(camera, dxPx, dyPx);
      clampToBounds(camera, bounds);
    },
    zoomAt(sx: number, sy: number, factor: number): void {
      zoomAt(camera, view(), sx, sy, factor);
      clampToBounds(camera, bounds);
    },
    screenToWorld(sx: number, sy: number): { wx: number; wy: number } {
      return screenToWorld(camera, view(), sx, sy);
    },
    destroy(): void {
      app.destroy(true, { children: true });
    },
  };
}

/**
 * Standard pointer/wheel camera controls: drag to pan, wheel to zoom.
 * Used by the dev harness and the app shell alike. Returns a detach fn.
 * Tap-vs-drag discrimination is the CALLER's job (a small movement
 * threshold) — this helper only moves the camera once dragging starts.
 */
export function attachCameraControls(
  handle: RendererHandle,
  element: HTMLElement,
  options: {
    readonly dragThresholdPx?: number;
    /** Drag-pan only while true (tool modes own the drag); wheel zoom is unconditional. */
    readonly panEnabled?: () => boolean;
  } = {},
): () => void {
  const threshold = options.dragThresholdPx ?? 4;
  const panEnabled = options.panEnabled ?? ((): boolean => true);
  let pointerDown = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: PointerEvent): void => {
    pointerDown = true;
    dragging = false;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onMove = (e: PointerEvent): void => {
    if (!pointerDown || !panEnabled()) {
      return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (!dragging && dx * dx + dy * dy < threshold * threshold) {
      return;
    }
    dragging = true;
    handle.panBy(dx, dy);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (): void => {
    pointerDown = false;
  };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = element.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    handle.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onUp);
  element.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointermove", onMove);
    element.removeEventListener("pointerup", onUp);
    element.removeEventListener("pointercancel", onUp);
    element.removeEventListener("wheel", onWheel);
  };
}

/** True when the last pointer sequence was a drag (camera move), not a tap. */
export function isDragSequence(
  downX: number,
  downY: number,
  upX: number,
  upY: number,
  thresholdPx = 4,
): boolean {
  const dx = upX - downX;
  const dy = upY - downY;
  return dx * dx + dy * dy >= thresholdPx * thresholdPx;
}
