/**
 * Renderer dev harness (`pnpm --filter @civitect/renderer dev`).
 *
 * Boots the real Pixi stage and feeds it synthetic protocol snapshots that
 * walk the highlight around the map — proves boot + snapshot consumption +
 * highlight visually, with zero sim involvement (the wall holds even in dev
 * tooling: renderer may not import @civitect/sim). The genuine
 * worker round trip is board PR 7's job.
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { bootRenderer } from "../boot";

const MAP = 64;

function syntheticSnapshot(tick: number): Snapshot {
  const step = Math.floor(tick / 5); // crawl one tile per half second
  return {
    kind: SnapshotKind.delta,
    tick,
    speed: 1,
    selectedTile: { x: step % MAP, y: Math.floor(step / MAP) % MAP },
    dirtyChunkIds: new Uint32Array(0),
    hud: { population: 0, fundsCents: 0 },
    advisorEvents: [],
  };
}

async function main(): Promise<void> {
  const host = document.getElementById("world");
  if (host === null) {
    throw new Error("dev page is missing #world");
  }
  const renderer = await bootRenderer({ host, mapWidth: MAP, mapHeight: MAP });

  let tick = 0;
  renderer.app.ticker.add(() => {
    // 10 Hz-ish synthetic feed off the render ticker — dev-only shortcut.
    tick += 1;
    renderer.consume(syntheticSnapshot(tick));
  });
}

void main();
