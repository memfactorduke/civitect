/**
 * Traffic assignment primitives (GDD §9, TDD §6, ADR-002 hybrid): hourly
 * OD from cohort aggregates over 8×8 zone-cells, table-driven mode choice
 * (the ADR-005-legal logit stand-in), integer BPR volume-delay, and the
 * per-origin-cell all-or-nothing assignment step the sliced MSA solver
 * (solver.ts, TDD §6.3) drives across ticks.
 *
 * Routing is CONGESTED: A* runs over the solver's frozen cost field
 * (free-flow ALT bounds stay admissible — BPR ≥ free-flow). Paths are
 * cached per (graph version, cost-field hash): uncongested hours share one
 * identical free-flow field, so the year-long balance replay still hits
 * cache; congested fields legitimately re-route.
 *
 * BPR: t = t0 · (1 + 0.15·(v/c)^4), α=0.15 β=4 [TUNE] — integer math:
 * (v/c)^4 via repeated multiplication in permille space; no Math.pow.
 */
import { ZoneKind } from "@civitect/protocol";
import {
  BuildingStatus,
  type Buildings,
  capacityFor,
  employedOf,
  PLOPPABLE_KIND_OFFSET,
} from "../growth/buildings";
import { fnv1a64 } from "../hash";
import { edgesOf, otherEnd, type RoadGraph } from "../roads/graph";
import { createPathfinder, edgeCost, findPath, type Pathfinder } from "../roads/pathfind";

export const CELL_TILES = 8;

/** Walk wins short trips [TUNE] — the v1 mode table (GDD §9.2). */
export const WALK_MAX_CELL_DISTANCE = 1; // Chebyshev cells (≤ ~8-16 tiles)

export interface Cell {
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
  workers: number;
  jobs: number;
  /** Road-graph node anchoring this cell (nearest alive node), -1 = none. */
  anchor: number;
}

export function buildCells(
  buildings: Buildings,
  g: RoadGraph,
  mapWidth: number,
  mapHeight: number,
): Cell[] {
  const cellsX = Math.ceil(mapWidth / CELL_TILES);
  const cellsY = Math.ceil(mapHeight / CELL_TILES);
  const cells: Cell[] = [];
  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      cells.push({ index: cy * cellsX + cx, cx, cy, workers: 0, jobs: 0, anchor: -1 });
    }
  }
  for (let i = 0; i < buildings.count; i++) {
    if (buildings.alive[i] !== 1 || (buildings.status[i] as number) === BuildingStatus.abandoned) {
      continue;
    }
    const tile = buildings.tileIdx[i] as number;
    const cx = Math.floor((tile % mapWidth) / CELL_TILES);
    const cy = Math.floor(Math.floor(tile / mapWidth) / CELL_TILES);
    const cell = cells[cy * cellsX + cx] as Cell;
    const kind = buildings.kind[i] as number;
    if (kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh) {
      cell.workers += employedOf(buildings, i);
    } else if (kind < PLOPPABLE_KIND_OFFSET) {
      cell.jobs += Math.min(
        capacityFor(kind, buildings.level[i] as number),
        // jobs filled city-wide; per-cell exact matching joins with job-
        // matching feedback (board task: travel-time ↔ matching) [TUNE]
        capacityFor(kind, buildings.level[i] as number),
      );
    }
  }
  // Anchor cells to the lowest-index alive node in the cell, else the
  // nearest within a 2-cell ring (long edges have no interior nodes — the
  // conservation test found whole corridors going "unroutable").
  const nodeOfCell = new Int32Array(cells.length).fill(-1);
  for (let n = 0; n < g.nodeCount; n++) {
    if (g.nodeAlive[n] !== 1) {
      continue;
    }
    const cx = Math.floor((g.nodeX[n] as number) / CELL_TILES);
    const cy = Math.floor((g.nodeY[n] as number) / CELL_TILES);
    const at = cy * cellsX + cx;
    if (nodeOfCell[at] === -1) {
      nodeOfCell[at] = n;
    }
  }
  for (const cell of cells) {
    for (let radius = 0; radius <= 2 && cell.anchor === -1; radius++) {
      for (let dy = -radius; dy <= radius && cell.anchor === -1; dy++) {
        for (let dx = -radius; dx <= radius && cell.anchor === -1; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
            continue;
          }
          const ny = cell.cy + dy;
          const nx = cell.cx + dx;
          if (nx < 0 || ny < 0 || nx >= cellsX || ny * cellsX + nx >= cells.length) {
            continue;
          }
          const n = nodeOfCell[ny * cellsX + nx] as number;
          if (n !== -1) {
            cell.anchor = n;
          }
        }
      }
    }
  }
  return cells;
}

/** Integer BPR: congested = t0 · (1000 + 150·(v/c)⁴·) / 1000, permille-exact. */
export function bprCost(freeFlow: number, volume: number, capacity: number): number {
  if (capacity === 0) {
    return freeFlow;
  }
  const ratioPermille = Math.min(3000, Math.floor((volume * 1000) / capacity)); // cap 3× [TUNE]
  const r2 = Math.floor((ratioPermille * ratioPermille) / 1000);
  const r4 = Math.floor((r2 * r2) / 1000);
  return Math.floor((freeFlow * (1000 + Math.floor((150 * r4) / 1000))) / 1000);
}

/** FNV-1a over a cost field's alive entries — the path-cache key component. */
export function costFieldHash(g: RoadGraph, costs: Uint32Array): string {
  const bytes = new Uint8Array(g.edgeCount * 4);
  let at = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    const c = g.edgeAlive[e] === 1 ? (costs[e] as number) : 0;
    bytes[at++] = c & 0xff;
    bytes[at++] = (c >>> 8) & 0xff;
    bytes[at++] = (c >>> 16) & 0xff;
    bytes[at++] = (c >>> 24) & 0xff;
  }
  return fnv1a64(bytes);
}

export interface ConservationLedger {
  generated: number;
  assigned: number;
  walked: number;
  unroutable: number;
}

/**
 * Assign ONE origin cell's commute trips against a frozen cost field:
 * proportional split to job cells (largest-remainder rounding), mode table
 * (short trips walk), congested A* routing, AON volume accumulation.
 * Deterministic order everywhere — this is the solver's slice unit.
 */
export function assignOriginCell(
  g: RoadGraph,
  pf: Pathfinder,
  paths: Map<number, number[] | null>,
  cells: readonly Cell[],
  origin: Cell,
  totalJobs: number,
  costs: Uint32Array,
  addVolume: (edgeSlot: number, trips: number) => void,
  ledger: ConservationLedger,
): void {
  if (origin.workers === 0 || totalJobs === 0) {
    return;
  }
  let allocated = 0;
  const shares: { cell: Cell; trips: number; rem: number }[] = [];
  for (const dest of cells) {
    if (dest.jobs === 0) {
      continue;
    }
    const exact = origin.workers * dest.jobs;
    const trips = Math.floor(exact / totalJobs);
    shares.push({ cell: dest, trips, rem: exact % totalJobs });
    allocated += trips;
  }
  shares.sort((a, b) => b.rem - a.rem || a.cell.index - b.cell.index);
  for (let k = 0; k < origin.workers - allocated && k < shares.length; k++) {
    (shares[k] as { trips: number }).trips++;
  }

  const costOf = (e: number): number => costs[e] as number;
  for (const share of shares) {
    if (share.trips === 0) {
      continue;
    }
    ledger.generated += share.trips;
    const dest = share.cell;
    const cellDist = Math.max(Math.abs(origin.cx - dest.cx), Math.abs(origin.cy - dest.cy));
    if (cellDist <= WALK_MAX_CELL_DISTANCE) {
      ledger.walked += share.trips; // mode table: short trips walk (GDD §9.2)
      continue;
    }
    if (origin.anchor === -1 || dest.anchor === -1) {
      ledger.unroutable += share.trips;
      continue;
    }
    const path = findEdgePath(g, pf, paths, origin.anchor, dest.anchor, costOf);
    if (path === null) {
      ledger.unroutable += share.trips;
      continue;
    }
    ledger.assigned += share.trips;
    for (const e of path) {
      addVolume(e, share.trips);
    }
  }
}

/**
 * Path caches: per graph (WeakMap), per cost field (FNV hash, last 4 fields
 * kept), per anchor pair. Derived, deterministic, never iterated as state.
 * Uncongested hours all share the free-flow field's hash — the balance
 * replay's hit rate survives congested routing.
 */
const pathCaches = new WeakMap<
  RoadGraph,
  { version: number; byCost: Map<string, Map<number, number[] | null>> }
>();

const COST_FIELDS_KEPT = 4;

export function pathsForCostField(g: RoadGraph, costHash: string): Map<number, number[] | null> {
  let cache = pathCaches.get(g);
  if (cache === undefined || cache.version !== g.version) {
    cache = { version: g.version, byCost: new Map() };
    pathCaches.set(g, cache);
  }
  let paths = cache.byCost.get(costHash);
  if (paths === undefined) {
    if (cache.byCost.size >= COST_FIELDS_KEPT) {
      const oldest = cache.byCost.keys().next().value as string;
      cache.byCost.delete(oldest);
    }
    paths = new Map();
    cache.byCost.set(costHash, paths);
  }
  return paths;
}

/** Shared pathfinder (landmark fields) per graph — refreshed on version. */
const pathfinders = new WeakMap<RoadGraph, Pathfinder>();

export function pathfinderFor(g: RoadGraph): Pathfinder {
  let pf = pathfinders.get(g);
  if (pf === undefined) {
    pf = createPathfinder();
    pathfinders.set(g, pf);
  }
  return pf;
}

/** Congested A* returning the EDGE list, memoized in `paths`. */
export function findEdgePath(
  g: RoadGraph,
  pf: Pathfinder,
  paths: Map<number, number[] | null>,
  from: number,
  to: number,
  costOf: (e: number) => number,
): number[] | null {
  const key = from * 0x100000 + to;
  const hit = paths.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const result = findPath(g, pf, from, to, costOf);
  if (result === null) {
    paths.set(key, null);
    return null;
  }
  const edges: number[] = [];
  for (let i = 0; i + 1 < result.nodes.length; i++) {
    const a = result.nodes[i] as number;
    const b = result.nodes[i + 1] as number;
    let found = -1;
    let foundCost = -1;
    for (const e of edgesOf(g, a)) {
      // Parallel a↔b edges: take the cheapest, tie → lowest slot (A* only
      // fixes the node sequence; the edge pick must be deterministic too).
      if (otherEnd(g, e, a) === b) {
        const c = costOf(e);
        if (found === -1 || c < foundCost) {
          found = e;
          foundCost = c;
        }
      }
    }
    if (found === -1) {
      return null;
    }
    edges.push(found);
  }
  paths.set(key, edges);
  return edges;
}

export { edgeCost };
