/**
 * Network-distance service coverage (GDD §7 [LOCKED]: road-network
 * distance, never euclidean — bad roads ARE bad services; pillar 2).
 *
 * Model, per service:
 *   1. Every alive station of the service anchors to its nearest road node
 *      (Chebyshev ring scan ≤ ANCHOR_REACH, deterministic tie-break). An
 *      unanchored station covers nothing — an island fire house is decor.
 *   2. Multi-source Dijkstra from all anchors over the live graph
 *      (free-flow edge costs: static coverage is about REACH; congested
 *      DISPATCH is the fire loop's job, board task 5).
 *   3. Edge interiors interpolate between endpoint distances along the
 *      supercover, so long edges carry coverage mid-span (roadDist field).
 *   4. A tile within SERVICE_REACH (Chebyshev) of a road tile takes that
 *      tile's network distance (min over the reach window, no walk cost
 *      [TUNE]); coverage decays linearly to 0 at the budget-scaled radius.
 *
 * Everything here is DERIVED (recomputed on the roads/buildings/budgets
 * fence) — never hashed, never saved. The full field exists for the
 * overlay + the exit-criterion-2 ground-truth property; the service loops
 * read single tiles via coverageAt.
 */
import { SERVICE_ID_LIST, type ServiceId } from "@civitect/protocol";
import type { Buildings } from "../growth/buildings";
import { fnv1a64 } from "../hash";
import { supercoverTiles } from "../roads/geometry";
import { nodeAt, type RoadGraph } from "../roads/graph";
import { dijkstraTree, edgeCost } from "../roads/pathfind";
import { scaledRadius, specForTableKind } from "./registry";

/** Tiles a consumer/station may sit from the network (zoning-depth kin). */
export const SERVICE_REACH = 4;
/** How far a station scans for its anchor node, in tiles. */
export const ANCHOR_REACH = 4;

const INF = 0xffffffff;

/**
 * Anchor a tile to the nearest alive road node: ring scan radius 0..reach;
 * within a radius the FIRST node in (dy, dx) scan order wins — a tie-break
 * on COORDINATES, never node index. Node indices are construction history
 * (free-list reuse, splits): an index tie-break would let two canonically
 * identical worlds (built vs loaded) anchor differently and desync every
 * canonical decision downstream — the Phase 3 tranche-2 leak class.
 */
export function anchorNode(
  g: RoadGraph,
  tileIdx: number,
  mapWidth: number,
  mapHeight: number,
  reach = ANCHOR_REACH,
): number {
  const x = tileIdx % mapWidth;
  const y = Math.floor(tileIdx / mapWidth);
  for (let radius = 0; radius <= reach; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mapWidth || ny >= mapHeight) {
          continue;
        }
        const n = nodeAt(g, nx, ny);
        if (n !== -1) {
          return n;
        }
      }
    }
  }
  return -1;
}

/**
 * Min network distance per node over all anchors: one dijkstraTree per
 * anchor, folded by min. Anchors per service are few (stations), and
 * fields are cached on the version fence, so per-anchor trees beat the
 * virtual-source construction this graph type can't express (no
 * zero-cost edges).
 */
function nodeDistances(g: RoadGraph, anchors: readonly number[]): Uint32Array {
  const dist = new Uint32Array(g.nodeCount).fill(INF);
  for (const a of anchors) {
    const tree = dijkstraTree(g, a);
    for (let n = 0; n < g.nodeCount; n++) {
      const d = tree.dist[n] as number;
      if (d < (dist[n] as number)) {
        dist[n] = d;
      }
    }
  }
  return dist;
}

/**
 * Network distance per ROAD TILE: endpoint distances interpolated along
 * each edge's supercover (a tile crossed by several edges keeps the min).
 */
export function roadTileDistances(
  g: RoadGraph,
  anchors: readonly number[],
  mapWidth: number,
  mapHeight: number,
): Uint32Array {
  const nodeDist = nodeDistances(g, anchors);
  const roadDist = new Uint32Array(mapWidth * mapHeight).fill(INF);
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const a = g.edgeA[e] as number;
    const b = g.edgeB[e] as number;
    const da = nodeDist[a] as number;
    const db = nodeDist[b] as number;
    if (da === INF && db === INF) {
      continue;
    }
    const cost = edgeCost(g, e);
    const walk = supercoverTiles(
      g.nodeX[a] as number,
      g.nodeY[a] as number,
      g.nodeX[b] as number,
      g.nodeY[b] as number,
    );
    const steps = walk.length - 1;
    for (let i = 0; i < walk.length; i++) {
      const t = walk[i] as { x: number; y: number };
      const idx = t.y * mapWidth + t.x;
      const fromA = da === INF ? INF : da + (steps === 0 ? 0 : Math.floor((cost * i) / steps));
      const fromB =
        db === INF ? INF : db + (steps === 0 ? 0 : Math.floor((cost * (steps - i)) / steps));
      const d = Math.min(fromA, fromB);
      if (d < (roadDist[idx] as number)) {
        roadDist[idx] = d;
      }
    }
  }
  return roadDist;
}

/** Linear decay: 255 at distance 0 → 0 at radius (and beyond). */
export function decay(dist: number, radius: number): number {
  if (radius <= 0 || dist >= radius) {
    return 0;
  }
  return 255 - Math.floor((dist * 255) / radius);
}

export interface ServiceFieldInputs {
  readonly roads: RoadGraph;
  readonly buildings: Buildings;
  /** budgetsPermille in SERVICE_ID_LIST order (canonical state). */
  readonly budgetsPermille: Uint16Array;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

/**
 * Stations of one service with their budget-scaled radii. Kind variants
 * differ in radius, so the field is the MAX over per-station decays; we
 * group stations by radius and run one distance field per radius group
 * (groups are tiny: ≤ kinds per service).
 */
function stationsOf(
  service: ServiceId,
  inputs: ServiceFieldInputs,
): { anchors: Map<number, number[]> } {
  const { buildings, roads, budgetsPermille, mapWidth, mapHeight } = inputs;
  const budget = budgetsPermille[SERVICE_ID_LIST.indexOf(service)] as number;
  const anchors = new Map<number, number[]>(); // radius → anchor nodes
  for (let i = 0; i < buildings.count; i++) {
    if (buildings.alive[i] !== 1) {
      continue;
    }
    const spec = specForTableKind(buildings.kind[i] as number);
    if (spec === null || spec.service !== service) {
      continue;
    }
    const anchor = anchorNode(roads, buildings.tileIdx[i] as number, mapWidth, mapHeight);
    if (anchor === -1) {
      continue; // off-network station covers nothing (pillar 2)
    }
    const radius = scaledRadius(spec, budget);
    const list = anchors.get(radius);
    if (list === undefined) {
      anchors.set(radius, [anchor]);
    } else {
      list.push(anchor);
    }
  }
  return { anchors };
}

/** Distance groups for one service: (budget-scaled radius, roadDist field). */
export interface DistanceGroups {
  readonly groups: readonly { radius: number; roadDist: Uint32Array }[];
}

/** Per-radius-group road-distance fields — the spot-read substrate. */
export function computeDistanceGroups(
  service: ServiceId,
  inputs: ServiceFieldInputs,
): DistanceGroups {
  const groups: { radius: number; roadDist: Uint32Array }[] = [];
  const stations = stationsOf(service, inputs);
  for (const [radius, anchorList] of [...stations.anchors.entries()].sort((p, q) => p[0] - q[0])) {
    groups.push({
      radius,
      roadDist: roadTileDistances(inputs.roads, anchorList, inputs.mapWidth, inputs.mapHeight),
    });
  }
  return { groups };
}

/** Coverage at ONE tile: max over groups of decayed window-min distance. */
export function coverageAtTile(
  dist: DistanceGroups,
  tileIdx: number,
  mapWidth: number,
  mapHeight: number,
): number {
  const x = tileIdx % mapWidth;
  const y = Math.floor(tileIdx / mapWidth);
  let best = 0;
  for (const { radius, roadDist } of dist.groups) {
    let min = INF;
    for (let dy = -SERVICE_REACH; dy <= SERVICE_REACH; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= mapHeight) {
        continue;
      }
      for (let dx = -SERVICE_REACH; dx <= SERVICE_REACH; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= mapWidth) {
          continue;
        }
        const d = roadDist[ny * mapWidth + nx] as number;
        if (d < min) {
          min = d;
        }
      }
    }
    if (min !== INF) {
      const c = decay(min, radius);
      if (c > best) {
        best = c;
      }
    }
  }
  return best;
}

/**
 * The full coverage field for one service — the overlay and the
 * exit-criterion-2 ground-truth property's surface. The service LOOPS
 * never materialize this: they spot-read via coverageAtTile, because the
 * fence moves with every building spawn and a full O(tiles × reach²)
 * rebuild inside the hourly tick would blow the TDD §2 tick gate on L
 * maps.
 */
export function computeCoverageField(service: ServiceId, inputs: ServiceFieldInputs): Uint8Array {
  const { mapWidth, mapHeight } = inputs;
  const out = new Uint8Array(mapWidth * mapHeight);
  const dist = computeDistanceGroups(service, inputs);
  for (let idx = 0; idx < out.length; idx++) {
    out[idx] = coverageAtTile(dist, idx, mapWidth, mapHeight);
  }
  return out;
}

/**
 * Derived caches, fenced on (roads.version, buildings.version, budgets
 * version) like utilities — version counters are session-local CACHE KEYS
 * only; the wire carries the content DIGEST (the congestionVersion
 * lesson: display state must match across save/load). Distance groups
 * cache independently of full fields: loops touch only the former.
 */
export interface ServiceCoverageCache {
  fenceKey: string;
  distances: Map<ServiceId, DistanceGroups>;
  fields: Map<ServiceId, { coverage: Uint8Array; digestU32: number }>;
}

export function createCoverageCache(): ServiceCoverageCache {
  return { fenceKey: "", distances: new Map(), fields: new Map() };
}

function refreshFence(cache: ServiceCoverageCache, fenceKey: string): void {
  if (cache.fenceKey !== fenceKey) {
    cache.fenceKey = fenceKey;
    cache.distances.clear();
    cache.fields.clear();
  }
}

/** Spot-read substrate for one service (cached on the fence). */
export function distancesFor(
  cache: ServiceCoverageCache,
  service: ServiceId,
  inputs: ServiceFieldInputs,
  fenceKey: string,
): DistanceGroups {
  refreshFence(cache, fenceKey);
  let dist = cache.distances.get(service);
  if (dist === undefined) {
    dist = computeDistanceGroups(service, inputs);
    cache.distances.set(service, dist);
  }
  return dist;
}

/** Full field + digest for one service (overlay surface; cached on fence). */
export function coverageFor(
  cache: ServiceCoverageCache,
  service: ServiceId,
  inputs: ServiceFieldInputs,
  fenceKey: string,
): { coverage: Uint8Array; digestU32: number } {
  refreshFence(cache, fenceKey);
  let field = cache.fields.get(service);
  if (field === undefined) {
    const dist = distancesFor(cache, service, inputs, fenceKey);
    const coverage = new Uint8Array(inputs.mapWidth * inputs.mapHeight);
    for (let idx = 0; idx < coverage.length; idx++) {
      coverage[idx] = coverageAtTile(dist, idx, inputs.mapWidth, inputs.mapHeight);
    }
    const digestU32 = Number.parseInt(fnv1a64(coverage).slice(0, 8), 16);
    field = { coverage, digestU32 };
    cache.fields.set(service, field);
  }
  return field;
}
