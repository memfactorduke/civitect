/**
 * World → protocol Snapshot mapping (the tail of the TDD §4 pipeline).
 * Pure projection: the sim decides WHAT is visible, never how it looks
 * (TDD §1: "sim never formats for display").
 */
import { type RoadSegment, type Snapshot, SnapshotKind } from "@civitect/protocol";
import { canonicalGraph } from "./roads/graph";
import type { World } from "./world";

/** Canonical road segments in renderer form — stable order, id-free. */
function roadSegments(world: World): RoadSegment[] {
  return canonicalGraph(world.roads).edges.map((e) => ({
    ax: e.ax,
    ay: e.ay,
    bx: e.bx,
    by: e.by,
    roadClass: e.roadClass,
  }));
}

export function toSnapshot(
  world: World,
  kind: SnapshotKind = SnapshotKind.delta,
  includeRoads = kind === SnapshotKind.keyframe,
): Snapshot {
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
    roadVersion: world.roads.version,
    roads: includeRoads ? roadSegments(world) : null,
    // Real demand/buildings land with the Phase 2 sim systems PR; the
    // explicit empty truth rides until then (same pattern roads used).
    demand: { r: 0, c: 0, i: 0, o: 0, factors: [] },
    buildingVersion: 0,
    buildings: kind === SnapshotKind.keyframe ? [] : null,
  };
}
