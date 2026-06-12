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
import { canonicalEdgeOrder, canonicalGraph } from "./roads/graph";
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
  includeCongestion = kind === SnapshotKind.keyframe,
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
    // The transform rider attaches at the worker boundary (app builds the
    // Float32Array from the pool's SoA mirrors).
    agentCount: world.agents.liveCount,
    // A CONTENT digest, not a session counter: a loaded world must present
    // the same version as the live world it was saved from (the saveload
    // e2e compares display states across a rewind). The cost-field hash
    // re-derives from canonical volumes on both sides.
    congestionVersion: Number.parseInt(world.traffic.costHash.slice(0, 8), 16),
    congestion: includeCongestion ? congestionPermille(world) : null,
    // Coverage layers join with the Phase 4 services core (board task 2);
    // until then no overlay is ever active.
    coverageService: 0,
    coverageVersion: 0,
    coverage: null,
  };
}

/** v/c permille per canonical road segment — aligns with snapshot.roads. */
function congestionPermille(world: World): Uint16Array {
  const order = canonicalEdgeOrder(world.roads);
  const out = new Uint16Array(order.length);
  for (let i = 0; i < order.length; i++) {
    const e = order[i] as number;
    const cap = world.roads.edgeCapacity_[e] as number;
    out[i] =
      cap === 0
        ? 0
        : Math.min(3000, Math.floor(((world.traffic.volumes[e] as number) * 1000) / cap));
  }
  return out;
}
