/**
 * ALT pathfinding over the road graph (TDD §5): A* with landmark lower
 * bounds (triangle inequality on precomputed Dijkstra fields), plus a
 * Euclidean-over-max-speed floor. Landmark fields are CACHED and keyed on
 * the graph version — any mutation fences them out (TDD §5: "pathfinding
 * caches invalidate by edge version").
 *
 * Costs are integer milli-ticks (length / speed in integer math); ties in
 * the priority queue and landmark selection break on node index — same
 * graph + same query ⇒ same path, bit for bit (ADR-005).
 */
import { edgesOf, otherEnd, ROAD_CLASS_SPEC, RoadClass, type RoadGraph } from "./graph";

const INF = 0xffffffff;

/** Fastest class speed — the admissible divisor for the Euclidean bound. */
const MAX_SPEED = Math.max(
  ROAD_CLASS_SPEC[RoadClass.street].speedMilliTilesPerTick,
  ROAD_CLASS_SPEC[RoadClass.avenue].speedMilliTilesPerTick,
  ROAD_CLASS_SPEC[RoadClass.highway].speedMilliTilesPerTick,
);

/** Number of landmarks [TUNE] — plenty for Phase 1 networks. */
const LANDMARK_COUNT = 4;

/** Integer traversal cost of an edge, in milli-ticks ×1000. */
export function edgeCost(g: RoadGraph, edge: number): number {
  return Math.floor(
    ((g.edgeLengthMilliTiles[edge] as number) * 1000) /
      (g.edgeSpeedMilliTilesPerTick[edge] as number),
  );
}

// ── deterministic binary heap (cost, then node index) ───────────────────────

interface Heap {
  keys: number[];
  nodes: number[];
  size: number;
}

function heapPush(h: Heap, key: number, node: number): void {
  let i = h.size++;
  h.keys[i] = key;
  h.nodes[i] = node;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const pk = h.keys[parent] as number;
    const pn = h.nodes[parent] as number;
    const ik = h.keys[i] as number;
    const inode = h.nodes[i] as number;
    if (pk < ik || (pk === ik && pn < inode)) {
      break;
    }
    h.keys[parent] = ik;
    h.nodes[parent] = inode;
    h.keys[i] = pk;
    h.nodes[i] = pn;
    i = parent;
  }
}

function heapPop(h: Heap): number {
  const top = h.nodes[0] as number;
  h.size--;
  if (h.size > 0) {
    h.keys[0] = h.keys[h.size] as number;
    h.nodes[0] = h.nodes[h.size] as number;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let best = i;
      if (
        l < h.size &&
        ((h.keys[l] as number) < (h.keys[best] as number) ||
          ((h.keys[l] as number) === (h.keys[best] as number) &&
            (h.nodes[l] as number) < (h.nodes[best] as number)))
      ) {
        best = l;
      }
      if (
        r < h.size &&
        ((h.keys[r] as number) < (h.keys[best] as number) ||
          ((h.keys[r] as number) === (h.keys[best] as number) &&
            (h.nodes[r] as number) < (h.nodes[best] as number)))
      ) {
        best = r;
      }
      if (best === i) {
        break;
      }
      const bk = h.keys[best] as number;
      const bn = h.nodes[best] as number;
      h.keys[best] = h.keys[i] as number;
      h.nodes[best] = h.nodes[i] as number;
      h.keys[i] = bk;
      h.nodes[i] = bn;
      i = best;
    }
  }
  return top;
}

// ── Dijkstra (landmark fields + the test oracle) ────────────────────────────

/** Full shortest-cost field from `source` over live nodes/edges. */
export function dijkstraField(g: RoadGraph, source: number): Uint32Array {
  const dist = new Uint32Array(g.nodeCount).fill(INF);
  dist[source] = 0;
  const heap: Heap = { keys: [], nodes: [], size: 0 };
  heapPush(heap, 0, source);
  while (heap.size > 0) {
    const node = heapPop(heap);
    for (const e of edgesOf(g, node)) {
      const next = otherEnd(g, e, node);
      const candidate = (dist[node] as number) + edgeCost(g, e);
      if (candidate < (dist[next] as number)) {
        dist[next] = candidate;
        heapPush(heap, candidate, next);
      }
    }
  }
  return dist;
}

/**
 * Single-source shortest-path TREE (Dijkstra with predecessor edges) over
 * optional per-edge costs — the assignment primitive at scale: one tree
 * serves every destination of an origin cell, where per-pair A* explodes
 * quadratically in OD cells. Deterministic: heap ties break on node index
 * (callers route on the canonical twin, where indices are canonical).
 */
export function dijkstraTree(
  g: RoadGraph,
  source: number,
  costOf?: (edge: number) => number,
): { dist: Uint32Array; cameFromEdge: Int32Array } {
  const dist = new Uint32Array(g.nodeCount).fill(INF);
  const cameFromEdge = new Int32Array(g.nodeCount).fill(-1);
  const settled = new Uint8Array(g.nodeCount);
  dist[source] = 0;
  const heap: Heap = { keys: [], nodes: [], size: 0 };
  heapPush(heap, 0, source);
  while (heap.size > 0) {
    const node = heapPop(heap);
    if (settled[node] === 1) {
      continue;
    }
    settled[node] = 1;
    for (const e of edgesOf(g, node)) {
      const next = otherEnd(g, e, node);
      if (settled[next] === 1) {
        continue;
      }
      const candidate =
        (dist[node] as number) + (costOf === undefined ? edgeCost(g, e) : costOf(e));
      if (candidate < (dist[next] as number)) {
        dist[next] = candidate;
        cameFromEdge[next] = e;
        heapPush(heap, candidate, next);
      }
    }
  }
  return { dist, cameFromEdge };
}

// ── landmark cache ──────────────────────────────────────────────────────────

export interface Pathfinder {
  /** Graph version the landmark fields were computed for; -1 = never. */
  cachedVersion: number;
  landmarks: number[];
  fields: Uint32Array[];
  /** Refresh count — observable cache behavior for tests/profiling. */
  refreshes: number;
}

export function createPathfinder(): Pathfinder {
  return { cachedVersion: -1, landmarks: [], fields: [], refreshes: 0 };
}

/** Farthest-point landmark selection — deterministic (ties → lowest index). */
function selectLandmarks(g: RoadGraph, count: number): number[] {
  let first = -1;
  for (let n = 0; n < g.nodeCount; n++) {
    if (g.nodeAlive[n] === 1) {
      first = n;
      break;
    }
  }
  if (first === -1) {
    return [];
  }
  const landmarks = [first];
  while (landmarks.length < count) {
    // Min cost to any chosen landmark, per node; pick the farthest reachable.
    const fields = landmarks.map((l) => dijkstraField(g, l));
    let bestNode = -1;
    let bestScore = -1;
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.nodeAlive[n] !== 1 || landmarks.includes(n)) {
        continue;
      }
      let minToChosen = INF;
      for (const field of fields) {
        const d = field[n] as number;
        if (d < minToChosen) {
          minToChosen = d;
        }
      }
      if (minToChosen === INF) {
        continue; // disconnected from every landmark — useless as one
      }
      if (minToChosen > bestScore) {
        bestScore = minToChosen;
        bestNode = n;
      }
    }
    if (bestNode === -1) {
      break;
    }
    landmarks.push(bestNode);
  }
  return landmarks;
}

function refresh(g: RoadGraph, pf: Pathfinder): void {
  if (pf.cachedVersion === g.version) {
    return;
  }
  pf.landmarks = selectLandmarks(g, LANDMARK_COUNT);
  pf.fields = pf.landmarks.map((l) => dijkstraField(g, l));
  pf.cachedVersion = g.version;
  pf.refreshes++;
}

// ── A* with ALT + Euclidean lower bounds ────────────────────────────────────

function euclidCostFloor(g: RoadGraph, from: number, to: number): number {
  const dx = (g.nodeX[from] as number) - (g.nodeX[to] as number);
  const dy = (g.nodeY[from] as number) - (g.nodeY[to] as number);
  const milli = Math.floor(Math.sqrt(dx * dx + dy * dy) * 1000);
  return Math.floor((milli * 1000) / MAX_SPEED);
}

export interface PathResult {
  /** Total cost in milli-tick×1000 units (same scale as edgeCost). */
  readonly cost: number;
  /** Node indices from `from` to `to` inclusive. */
  readonly nodes: readonly number[];
}

/**
 * Shortest path by travel time, or null when unreachable. Refreshes the
 * landmark cache iff the graph version moved since the last query.
 *
 * `costOf` overrides per-edge costs (congested routing, TDD §6.3). It MUST
 * dominate free-flow (costOf(e) ≥ edgeCost(g, e)) — the ALT/Euclidean
 * lower bounds are computed on free-flow costs and stay admissible only
 * under that domination (BPR's multiplier ≥ 1 guarantees it).
 */
export function findPath(
  g: RoadGraph,
  pf: Pathfinder,
  from: number,
  to: number,
  costOf?: (edge: number) => number,
): PathResult | null {
  if (g.nodeAlive[from] !== 1 || g.nodeAlive[to] !== 1) {
    throw new Error("findPath: endpoints must be alive nodes");
  }
  refresh(g, pf);

  const h = (n: number): number => {
    let bound = euclidCostFloor(g, n, to);
    for (const field of pf.fields) {
      const dn = field[n] as number;
      const dt = field[to] as number;
      if (dn === INF || dt === INF) {
        continue;
      }
      const alt = dn > dt ? dn - dt : dt - dn; // |d(L,n) − d(L,to)|
      if (alt > bound) {
        bound = alt;
      }
    }
    return bound;
  };

  const dist = new Uint32Array(g.nodeCount).fill(INF);
  const cameFrom = new Int32Array(g.nodeCount).fill(-1);
  dist[from] = 0;
  const heap: Heap = { keys: [], nodes: [], size: 0 };
  heapPush(heap, h(from), from);
  const settled = new Uint8Array(g.nodeCount);

  while (heap.size > 0) {
    const node = heapPop(heap);
    if (settled[node] === 1) {
      continue;
    }
    settled[node] = 1;
    if (node === to) {
      const nodes: number[] = [];
      for (let n = to; n !== -1; n = cameFrom[n] as number) {
        nodes.push(n);
      }
      nodes.reverse();
      return { cost: dist[to] as number, nodes };
    }
    for (const e of edgesOf(g, node)) {
      const next = otherEnd(g, e, node);
      if (settled[next] === 1) {
        continue;
      }
      const candidate =
        (dist[node] as number) + (costOf === undefined ? edgeCost(g, e) : costOf(e));
      if (candidate < (dist[next] as number)) {
        dist[next] = candidate;
        cameFrom[next] = node;
        heapPush(heap, candidate + h(next), next);
      }
    }
  }
  return null;
}
