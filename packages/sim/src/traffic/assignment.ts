/**
 * Traffic core v1 (GDD §9, TDD §6, ADR-002 hybrid): hourly OD from cohort
 * aggregates over 8×8 zone-cells, table-driven mode choice (the ADR-005-
 * legal logit stand-in), and a STATELESS hourly assignment — recomputed
 * from world state at each hour boundary (and after load), so congestion
 * is DERIVED state: nothing here is hashed or saved, yet replay and
 * save/load stay bit-deterministic.
 *
 * Deviations from TDD §6.3, recorded on the phase-3 board for tranche 2:
 * single-shot 2-pass BPR feedback instead of MSA-with-memory; computed in
 * one hour-boundary tick instead of sliced (p95 unaffected — 1/60 ticks).
 *
 * BPR: t = t0 · (1 + 0.15·(v/c)^4), α=0.15 β=4 [TUNE] — integer math:
 * (v/c)^4 via repeated multiplication in permille space; no Math.pow.
 */
import { ZoneKind } from "@civitect/protocol";
import {
  adultsOf,
  BuildingStatus,
  type Buildings,
  capacityFor,
  employedOf,
  PLOPPABLE_KIND_OFFSET,
} from "../growth/buildings";
import { edgesOf, otherEnd, type RoadGraph } from "../roads/graph";
import { createPathfinder, edgeCost, findPath, type Pathfinder } from "../roads/pathfind";

export const CELL_TILES = 8;

/** Walk wins short trips [TUNE] — the v1 mode table (GDD §9.2). */
const WALK_MAX_CELL_DISTANCE = 1; // Chebyshev cells (≤ ~8-16 tiles)

export interface TrafficState {
  /** Per-edge assigned vehicle trips this hour (edge slot indexed). */
  readonly volumes: Uint32Array;
  /** Congested travel time per edge, micro-units (same scale as edgeCost). */
  readonly congestedCost: Uint32Array;
  /** Conservation ledger (exit criterion: generated ≡ assigned + walked + unroutable). */
  readonly generated: number;
  readonly assigned: number;
  readonly walked: number;
  readonly unroutable: number;
}

export function emptyTraffic(): TrafficState {
  return {
    volumes: new Uint32Array(0),
    congestedCost: new Uint32Array(0),
    generated: 0,
    assigned: 0,
    walked: 0,
    unroutable: 0,
  };
}

interface Cell {
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
  workers: number;
  jobs: number;
  /** Road-graph node anchoring this cell (nearest alive node), -1 = none. */
  anchor: number;
}

function buildCells(
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

/**
 * The hourly solve. Deterministic order everywhere: cells ascending,
 * destination cells ascending, largest-remainder trip rounding.
 */
export function assignTraffic(
  buildings: Buildings,
  g: RoadGraph,
  mapWidth: number,
  mapHeight: number,
): TrafficState {
  const cells = buildCells(buildings, g, mapWidth, mapHeight);
  const totalJobs = cells.reduce((sum, c) => sum + c.jobs, 0);
  const volumes = new Uint32Array(g.edgeCount);
  const congestedCost = new Uint32Array(g.edgeCount);
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] === 1) {
      congestedCost[e] = edgeCost(g, e);
    }
  }
  let generated = 0;
  let assigned = 0;
  let walked = 0;
  let unroutable = 0;
  if (totalJobs === 0) {
    return { volumes, congestedCost, generated, assigned, walked, unroutable };
  }

  // Two BPR feedback passes [TUNE]: assign on free-flow, re-time, re-assign.
  for (let pass = 0; pass < 2; pass++) {
    volumes.fill(0);
    generated = 0;
    assigned = 0;
    walked = 0;
    unroutable = 0;
    const pf: Pathfinder = createPathfinder();
    const costOf = (e: number): number => congestedCost[e] as number;

    for (const origin of cells) {
      if (origin.workers === 0) {
        continue;
      }
      // Proportional split to job cells, largest-remainder rounding.
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

      for (const share of shares) {
        if (share.trips === 0) {
          continue;
        }
        generated += share.trips;
        const dest = share.cell;
        const cellDist = Math.max(Math.abs(origin.cx - dest.cx), Math.abs(origin.cy - dest.cy));
        if (cellDist <= WALK_MAX_CELL_DISTANCE) {
          walked += share.trips; // mode table: short trips walk (GDD §9.2)
          continue;
        }
        if (origin.anchor === -1 || dest.anchor === -1) {
          unroutable += share.trips;
          continue;
        }
        const path = findPathWithCosts(g, pf, origin.anchor, dest.anchor, costOf);
        if (path === null) {
          unroutable += share.trips;
          continue;
        }
        assigned += share.trips;
        for (const e of path) {
          volumes[e] = (volumes[e] as number) + share.trips;
        }
      }
    }
    // Re-time edges from this pass's volumes for the next pass / output.
    for (let e = 0; e < g.edgeCount; e++) {
      if (g.edgeAlive[e] === 1) {
        congestedCost[e] = bprCost(
          edgeCost(g, e),
          volumes[e] as number,
          g.edgeCapacity_[e] as number,
        );
      }
    }
  }
  return { volumes, congestedCost, generated, assigned, walked, unroutable };
}

/**
 * Per-graph path cache, keyed on graph version — anchor pairs repeat every
 * hour; without this, year-long balance replays recompute millions of
 * identical A* runs. Derived, deterministic, never iterated.
 */
const pathCaches = new WeakMap<
  RoadGraph,
  { version: number; paths: Map<number, number[] | null> }
>();

/** A* over supplied edge costs, returning the EDGE list (free-flow ALT bound stays admissible under congestion). */
function findPathWithCosts(
  g: RoadGraph,
  pf: Pathfinder,
  from: number,
  to: number,
  costOf: (e: number) => number,
): number[] | null {
  let cache = pathCaches.get(g);
  if (cache === undefined || cache.version !== g.version) {
    cache = { version: g.version, paths: new Map() };
    pathCaches.set(g, cache);
  }
  const key = from * 0x100000 + to;
  const hit = cache.paths.get(key);
  if (hit !== undefined) {
    return hit;
  }
  // v1: reuse free-flow shortest NODE path, then map to edges with the
  // congested cost only influencing the SECOND pass via re-timing.
  // True congested routing joins with MSA in tranche 2 [TUNE].
  const result = findPath(g, pf, from, to);
  if (result === null) {
    cache.paths.set(key, null);
    return null;
  }
  const edges: number[] = [];
  for (let i = 0; i + 1 < result.nodes.length; i++) {
    const a = result.nodes[i] as number;
    const b = result.nodes[i + 1] as number;
    let found = -1;
    for (const e of edgesOf(g, a)) {
      if (otherEnd(g, e, a) === b) {
        found = e;
        break;
      }
    }
    if (found === -1) {
      return null;
    }
    edges.push(found);
  }
  void costOf;
  cache.paths.set(key, edges);
  return edges;
}
