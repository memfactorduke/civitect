/**
 * Pixi v8 boot (ADR-008): WebGL at launch (WebGPU stays flag-gated until
 * stable across WebViews), antialias off, devicePixelRatio capped at 2.
 *
 * The renderer never decides map size — the composition root (app) knows it
 * from boot config / save header and passes it in (snapshots don't carry map
 * dimensions; TDD §7).
 */

import type { Snapshot } from "@civitect/protocol";
import { Application } from "pixi.js";
import { applySnapshot, type DisplayState, initialDisplayState } from "./display";
import { createWorldStage, type WorldStage } from "./stage";

export interface RendererBootOptions {
  /** Element the canvas mounts into; canvas tracks its size. */
  readonly host: HTMLElement;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

export interface RendererHandle {
  readonly app: Application;
  readonly stage: WorldStage;
  /** Current display state — read-only outside; advanced via consume(). */
  readonly state: () => DisplayState;
  /** Feed one protocol snapshot; stage updates immediately. */
  consume(snapshot: Snapshot): void;
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

  const stage = createWorldStage({ mapWidth: options.mapWidth, mapHeight: options.mapHeight });
  // Center the world: origin tile's top corner sits mid-screen horizontally,
  // map vertically centered. Camera proper (pan/zoom/LOD) is ROADMAP Phase 1.
  const recenter = (): void => {
    stage.root.position.set(
      app.renderer.width / app.renderer.resolution / 2,
      (app.renderer.height / app.renderer.resolution -
        ((options.mapWidth + options.mapHeight) * 16) / 2) /
        2,
    );
  };
  recenter();
  app.renderer.on("resize", recenter);
  app.stage.addChild(stage.root);

  let state = initialDisplayState();
  stage.update(state);

  return {
    app,
    stage,
    state: () => state,
    consume(snapshot: Snapshot): void {
      state = applySnapshot(state, snapshot);
      stage.update(state);
    },
    destroy(): void {
      app.destroy(true, { children: true });
    },
  };
}
