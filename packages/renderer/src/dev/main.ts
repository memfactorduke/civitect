/**
 * Renderer dev harness (`pnpm --filter @civitect/renderer dev`).
 *
 * Boots the real Pixi stage and feeds it synthetic protocol snapshots that
 * walk the highlight around the map — proves boot + snapshot consumption +
 * highlight visually, with zero sim involvement (the wall holds even in dev
 * tooling: renderer may not import @civitect/sim). The genuine
 * worker round trip is board PR 7's job.
 */
import { attachCameraControls, bootRenderer } from "../boot";
import { createDevHarnessSnapshot, createDevHarnessTerrain, DEV_HARNESS_MAP_SIZE } from "./harness";

async function main(): Promise<void> {
  const host = document.getElementById("world");
  if (host === null) {
    throw new Error("dev page is missing #world");
  }
  // Synthetic terraced island (same formula family as the map fixture) —
  // the dev harness shows real chunk tints without touching the sim.
  const terrain = createDevHarnessTerrain();
  const renderer = await bootRenderer({
    host,
    mapWidth: DEV_HARNESS_MAP_SIZE,
    mapHeight: DEV_HARNESS_MAP_SIZE,
    terrain,
  });
  attachCameraControls(renderer, host); // drag to pan, wheel to zoom

  let tick = 0;
  renderer.app.ticker.add(() => {
    // 10 Hz-ish synthetic feed off the render ticker — dev-only shortcut.
    tick += 1;
    renderer.consume(createDevHarnessSnapshot(tick));
  });
}

void main();
