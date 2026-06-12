/**
 * World → protocol Snapshot mapping (the tail of the TDD §4 pipeline).
 * Pure projection: the sim decides WHAT is visible, never how it looks
 * (TDD §1: "sim never formats for display").
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import type { World } from "./world";

export function toSnapshot(world: World, kind: SnapshotKind = SnapshotKind.delta): Snapshot {
  return {
    kind,
    tick: world.tick,
    speed: world.speed,
    selectedTile:
      world.selectedTileIdx < 0
        ? null
        : {
            x: world.selectedTileIdx % world.mapWidth,
            y: Math.floor(world.selectedTileIdx / world.mapWidth),
          },
    dirtyChunkIds: new Uint32Array(0), // chunk re-bake hints arrive with Phase 1 terrain
    hud: { population: world.population, fundsCents: world.fundsCents },
    advisorEvents: [], // first emitters arrive with Phase 2 (cause chains required, ADR-009)
  };
}
