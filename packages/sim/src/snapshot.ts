/**
 * World → protocol Snapshot mapping (the tail of the TDD §4 pipeline).
 * Pure projection: the sim decides WHAT is visible, never how it looks
 * (TDD §1: "sim never formats for display").
 */
import {
  type BuildingView,
  type RoadSegment,
  type Snapshot,
  SnapshotKind,
} from "@civitect/protocol";
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

function buildingViews(world: World): BuildingView[] {
  const b = world.buildings;
  const order: number[] = [];
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] === 1) {
      order.push(i);
    }
  }
  order.sort((p, q) => (b.tileIdx[p] as number) - (b.tileIdx[q] as number));
  return order.map((i) => ({
    x: (b.tileIdx[i] as number) % world.mapWidth,
    y: Math.floor((b.tileIdx[i] as number) / world.mapWidth),
    kind: b.kind[i] as number,
    level: b.level[i] as number,
    status: b.status[i] as number,
  }));
}

export function toSnapshot(
  world: World,
  kind: SnapshotKind = SnapshotKind.delta,
  includeRoads = kind === SnapshotKind.keyframe,
  includeBuildings = kind === SnapshotKind.keyframe,
  includeZones = kind === SnapshotKind.keyframe,
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
    advisorEvents: world.advisorQueue.splice(0), // drained per snapshot (ADR-009 chains attached)
    roadVersion: world.roads.version,
    roads: includeRoads ? roadSegments(world) : null,
    demand: world.lastDemand,
    buildingVersion: world.buildings.version,
    buildings: includeBuildings ? buildingViews(world) : null,
    zoneVersion: world.zoneVersion,
    zones: includeZones ? Uint16Array.from(world.terrain.layers.zone) : null,
  };
}
