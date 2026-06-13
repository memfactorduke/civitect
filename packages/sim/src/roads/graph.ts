/**
 * Road graph (TDD §5): nodes (intersections, dead-ends) + edges (segments
 * with class, lanes, length, speed, capacity), SEPARATE from the tile grid.
 * Structure-of-arrays with free-lists per TDD §4 — no entity objects in hot
 * paths — and incremental, VERSIONED mutations: pathfinding caches key on
 * (edgeId, version) and the global graph version (TDD §5).
 *
 * Standalone module for now: nothing in World references it yet, so state
 * hashes are untouched (phase-1 board: task 8 wires it into the tick
 * pipeline behind the task-7 bless).
 *
 * Determinism notes (ADR-005): integer coordinates, integer milli-tile
 * lengths (Math.sqrt of integers is correctly-rounded IEEE — not a
 * transcendental — then floored), explicit index iteration only.
 */

export const RoadClass = {
  street: 1,
  avenue: 2,
  highway: 3,
  path: 4,
  bridgeStreet: 11,
  bridgeAvenue: 12,
  bridgeHighway: 13,
  bridgePath: 14,
} as const;
export type RoadClass = (typeof RoadClass)[keyof typeof RoadClass];

export const BRIDGE_CLASS_OFFSET = 10;

export function isBridgeClass(roadClass: number): boolean {
  return roadClass > BRIDGE_CLASS_OFFSET;
}

/** Bridge classes share their base class's traffic character. */
export function baseClass(roadClass: RoadClass): RoadClass {
  return (isBridgeClass(roadClass) ? roadClass - BRIDGE_CLASS_OFFSET : roadClass) as RoadClass;
}

/** Per-class baselines [TUNE — real values land with Phase 3 traffic]. */
export const ROAD_CLASS_SPEC: Readonly<
  Record<RoadClass, { lanes: number; speedMilliTilesPerTick: number; capacityPerLane: number }>
> = {
  [RoadClass.street]: { lanes: 2, speedMilliTilesPerTick: 500, capacityPerLane: 400 },
  [RoadClass.avenue]: { lanes: 4, speedMilliTilesPerTick: 750, capacityPerLane: 450 },
  [RoadClass.highway]: { lanes: 6, speedMilliTilesPerTick: 1500, capacityPerLane: 600 },
  [RoadClass.path]: { lanes: 1, speedMilliTilesPerTick: 250, capacityPerLane: 150 },
  [RoadClass.bridgeStreet]: { lanes: 2, speedMilliTilesPerTick: 500, capacityPerLane: 400 },
  [RoadClass.bridgeAvenue]: { lanes: 4, speedMilliTilesPerTick: 750, capacityPerLane: 450 },
  [RoadClass.bridgeHighway]: { lanes: 6, speedMilliTilesPerTick: 1500, capacityPerLane: 600 },
  [RoadClass.bridgePath]: { lanes: 1, speedMilliTilesPerTick: 250, capacityPerLane: 150 },
};

const NO_INDEX = 0xffffffff;
const INITIAL_CAPACITY = 16;

export interface RoadGraph {
  /** Monotone counter: bumps on EVERY mutation — the cheap cache fence. */
  version: number;

  nodeCapacity: number;
  nodeCount: number;
  nodeFreeHead: number;
  nodeX: Uint16Array;
  nodeY: Uint16Array;
  nodeAlive: Uint8Array;
  /** Head of the node's adjacency list (edge index), NO_INDEX = none. */
  nodeFirstEdge: Uint32Array;
  /** Free-list link when dead (next free node index). */
  nodeNextFree: Uint32Array;

  edgeCapacity: number;
  edgeCount: number;
  edgeFreeHead: number;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  edgeClass: Uint8Array;
  edgeLanes: Uint8Array;
  edgeLengthMilliTiles: Uint32Array;
  edgeSpeedMilliTilesPerTick: Uint32Array;
  edgeCapacity_: Uint32Array;
  edgeAlive: Uint8Array;
  /** Bumps when the slot's content changes — including reuse after removal. */
  edgeSlotVersion: Uint32Array;
  /** Adjacency links: next edge in A's list / in B's list. */
  edgeNextA: Uint32Array;
  edgeNextB: Uint32Array;
  edgeNextFree: Uint32Array;

  /** (x << 16 | y) → node index, for picking and dedup. Never iterated. */
  readonly nodeByTile: Map<number, number>;
}

export function createRoadGraph(): RoadGraph {
  return {
    version: 0,
    nodeCapacity: INITIAL_CAPACITY,
    nodeCount: 0,
    nodeFreeHead: NO_INDEX,
    nodeX: new Uint16Array(INITIAL_CAPACITY),
    nodeY: new Uint16Array(INITIAL_CAPACITY),
    nodeAlive: new Uint8Array(INITIAL_CAPACITY),
    nodeFirstEdge: new Uint32Array(INITIAL_CAPACITY).fill(NO_INDEX),
    nodeNextFree: new Uint32Array(INITIAL_CAPACITY).fill(NO_INDEX),
    edgeCapacity: INITIAL_CAPACITY,
    edgeCount: 0,
    edgeFreeHead: NO_INDEX,
    edgeA: new Uint32Array(INITIAL_CAPACITY),
    edgeB: new Uint32Array(INITIAL_CAPACITY),
    edgeClass: new Uint8Array(INITIAL_CAPACITY),
    edgeLanes: new Uint8Array(INITIAL_CAPACITY),
    edgeLengthMilliTiles: new Uint32Array(INITIAL_CAPACITY),
    edgeSpeedMilliTilesPerTick: new Uint32Array(INITIAL_CAPACITY),
    edgeCapacity_: new Uint32Array(INITIAL_CAPACITY),
    edgeAlive: new Uint8Array(INITIAL_CAPACITY),
    edgeSlotVersion: new Uint32Array(INITIAL_CAPACITY),
    edgeNextA: new Uint32Array(INITIAL_CAPACITY).fill(NO_INDEX),
    edgeNextB: new Uint32Array(INITIAL_CAPACITY).fill(NO_INDEX),
    edgeNextFree: new Uint32Array(INITIAL_CAPACITY).fill(NO_INDEX),
    nodeByTile: new Map(),
  };
}

function growU16(a: Uint16Array, capacity: number): Uint16Array {
  const next = new Uint16Array(capacity);
  next.set(a);
  return next;
}
function growU8(a: Uint8Array, capacity: number): Uint8Array {
  const next = new Uint8Array(capacity);
  next.set(a);
  return next;
}
function growU32(a: Uint32Array, capacity: number, fill: number): Uint32Array {
  const next = new Uint32Array(capacity).fill(fill);
  next.set(a);
  return next;
}

function tileKey(x: number, y: number): number {
  return x * 0x10000 + y;
}

/** Node index at (x, y), or NO_NODE (-1) if none. */
export function nodeAt(g: RoadGraph, x: number, y: number): number {
  return g.nodeByTile.get(tileKey(x, y)) ?? -1;
}

/** Add (or return the existing) node at tile (x, y). */
export function addNode(g: RoadGraph, x: number, y: number): number {
  const existing = g.nodeByTile.get(tileKey(x, y));
  if (existing !== undefined) {
    return existing;
  }
  let index: number;
  if (g.nodeFreeHead !== NO_INDEX) {
    index = g.nodeFreeHead;
    g.nodeFreeHead = g.nodeNextFree[index] as number;
  } else {
    if (g.nodeCount === g.nodeCapacity) {
      const cap = g.nodeCapacity * 2;
      g.nodeX = growU16(g.nodeX, cap);
      g.nodeY = growU16(g.nodeY, cap);
      g.nodeAlive = growU8(g.nodeAlive, cap);
      g.nodeFirstEdge = growU32(g.nodeFirstEdge, cap, NO_INDEX);
      g.nodeNextFree = growU32(g.nodeNextFree, cap, NO_INDEX);
      g.nodeCapacity = cap;
    }
    index = g.nodeCount;
  }
  g.nodeCount = Math.max(g.nodeCount, index + 1);
  g.nodeX[index] = x;
  g.nodeY[index] = y;
  g.nodeAlive[index] = 1;
  g.nodeFirstEdge[index] = NO_INDEX;
  g.nodeByTile.set(tileKey(x, y), index);
  g.version++;
  return index;
}

/** Remove an isolated node (degree 0 — bulldozing edges first is the tool's job). */
export function removeNode(g: RoadGraph, node: number): void {
  if (g.nodeAlive[node] !== 1) {
    throw new Error(`removeNode: node ${node} is not alive`);
  }
  if (g.nodeFirstEdge[node] !== NO_INDEX) {
    throw new Error(`removeNode: node ${node} still has edges`);
  }
  g.nodeAlive[node] = 0;
  g.nodeByTile.delete(tileKey(g.nodeX[node] as number, g.nodeY[node] as number));
  g.nodeNextFree[node] = g.nodeFreeHead;
  g.nodeFreeHead = node;
  g.version++;
}

export function edgeBetween(g: RoadGraph, a: number, b: number): number {
  for (let e = g.nodeFirstEdge[a] as number; e !== NO_INDEX; ) {
    if ((g.edgeA[e] === a && g.edgeB[e] === b) || (g.edgeA[e] === b && g.edgeB[e] === a)) {
      return e;
    }
    e = g.edgeA[e] === a ? (g.edgeNextA[e] as number) : (g.edgeNextB[e] as number);
  }
  return -1;
}

/** Integer milli-tile distance between two live nodes. */
function milliTileLength(g: RoadGraph, a: number, b: number): number {
  const dx = (g.nodeX[a] as number) - (g.nodeX[b] as number);
  const dy = (g.nodeY[a] as number) - (g.nodeY[b] as number);
  // sqrt of an integer is correctly-rounded IEEE (not transcendental);
  // flooring the scaled result keeps the stored value integer.
  return Math.floor(Math.sqrt(dx * dx + dy * dy) * 1000);
}

export function addEdge(g: RoadGraph, a: number, b: number, roadClass: RoadClass): number {
  if (a === b) {
    throw new Error("addEdge: self-loops are not roads");
  }
  if (g.nodeAlive[a] !== 1 || g.nodeAlive[b] !== 1) {
    throw new Error("addEdge: both endpoints must be alive");
  }
  if (edgeBetween(g, a, b) !== -1) {
    throw new Error(`addEdge: nodes ${a} and ${b} are already connected`);
  }
  let index: number;
  if (g.edgeFreeHead !== NO_INDEX) {
    index = g.edgeFreeHead;
    g.edgeFreeHead = g.edgeNextFree[index] as number;
  } else {
    if (g.edgeCount === g.edgeCapacity) {
      const cap = g.edgeCapacity * 2;
      g.edgeA = growU32(g.edgeA, cap, 0);
      g.edgeB = growU32(g.edgeB, cap, 0);
      g.edgeClass = growU8(g.edgeClass, cap);
      g.edgeLanes = growU8(g.edgeLanes, cap);
      g.edgeLengthMilliTiles = growU32(g.edgeLengthMilliTiles, cap, 0);
      g.edgeSpeedMilliTilesPerTick = growU32(g.edgeSpeedMilliTilesPerTick, cap, 0);
      g.edgeCapacity_ = growU32(g.edgeCapacity_, cap, 0);
      g.edgeAlive = growU8(g.edgeAlive, cap);
      g.edgeSlotVersion = growU32(g.edgeSlotVersion, cap, 0);
      g.edgeNextA = growU32(g.edgeNextA, cap, NO_INDEX);
      g.edgeNextB = growU32(g.edgeNextB, cap, NO_INDEX);
      g.edgeNextFree = growU32(g.edgeNextFree, cap, NO_INDEX);
      g.edgeCapacity = cap;
    }
    index = g.edgeCount;
  }
  g.edgeCount = Math.max(g.edgeCount, index + 1);
  const spec = ROAD_CLASS_SPEC[roadClass];
  g.edgeA[index] = a;
  g.edgeB[index] = b;
  g.edgeClass[index] = roadClass;
  g.edgeLanes[index] = spec.lanes;
  g.edgeLengthMilliTiles[index] = milliTileLength(g, a, b);
  g.edgeSpeedMilliTilesPerTick[index] = spec.speedMilliTilesPerTick;
  g.edgeCapacity_[index] = spec.lanes * spec.capacityPerLane;
  g.edgeAlive[index] = 1;
  g.edgeSlotVersion[index] = (g.edgeSlotVersion[index] as number) + 1;
  // Push onto both adjacency lists.
  g.edgeNextA[index] = g.nodeFirstEdge[a] as number;
  g.edgeNextB[index] = g.nodeFirstEdge[b] as number;
  g.nodeFirstEdge[a] = index;
  g.nodeFirstEdge[b] = index;
  g.version++;
  return index;
}

function unlinkFromNode(g: RoadGraph, node: number, edge: number): void {
  let prev = NO_INDEX;
  for (let e = g.nodeFirstEdge[node] as number; e !== NO_INDEX; ) {
    const next = g.edgeA[e] === node ? (g.edgeNextA[e] as number) : (g.edgeNextB[e] as number);
    if (e === edge) {
      if (prev === NO_INDEX) {
        g.nodeFirstEdge[node] = next;
      } else if (g.edgeA[prev] === node) {
        g.edgeNextA[prev] = next;
      } else {
        g.edgeNextB[prev] = next;
      }
      return;
    }
    prev = e;
    e = next;
  }
  throw new Error(`unlinkFromNode: edge ${edge} not in node ${node}'s list`);
}

export function removeEdge(g: RoadGraph, edge: number): void {
  if (g.edgeAlive[edge] !== 1) {
    throw new Error(`removeEdge: edge ${edge} is not alive`);
  }
  unlinkFromNode(g, g.edgeA[edge] as number, edge);
  unlinkFromNode(g, g.edgeB[edge] as number, edge);
  g.edgeAlive[edge] = 0;
  g.edgeSlotVersion[edge] = (g.edgeSlotVersion[edge] as number) + 1;
  g.edgeNextFree[edge] = g.edgeFreeHead;
  g.edgeFreeHead = edge;
  g.version++;
}

/** Re-class a live edge in place: lanes/speed/capacity follow; versions bump. */
export function upgradeEdge(g: RoadGraph, edge: number, roadClass: RoadClass): void {
  if (g.edgeAlive[edge] !== 1) {
    throw new Error(`upgradeEdge: edge ${edge} is not alive`);
  }
  const spec = ROAD_CLASS_SPEC[roadClass];
  g.edgeClass[edge] = roadClass;
  g.edgeLanes[edge] = spec.lanes;
  g.edgeSpeedMilliTilesPerTick[edge] = spec.speedMilliTilesPerTick;
  g.edgeCapacity_[edge] = spec.lanes * spec.capacityPerLane;
  g.edgeSlotVersion[edge] = (g.edgeSlotVersion[edge] as number) + 1;
  g.version++;
}

/** Live edges of a node, in adjacency-list order (deterministic by construction). */
export function edgesOf(g: RoadGraph, node: number): number[] {
  const out: number[] = [];
  for (let e = g.nodeFirstEdge[node] as number; e !== NO_INDEX; ) {
    out.push(e);
    e = g.edgeA[e] === node ? (g.edgeNextA[e] as number) : (g.edgeNextB[e] as number);
  }
  return out;
}

/** The far endpoint of `edge` from `node`. */
export function otherEnd(g: RoadGraph, edge: number, node: number): number {
  return g.edgeA[edge] === node ? (g.edgeB[edge] as number) : (g.edgeA[edge] as number);
}

/**
 * Nearest alive node to a tile by Chebyshev distance, lowest node index on
 * ties, or -1 if the graph has no alive node. Deterministic w.r.t. node
 * order — callers must pass a construction-history-free graph (the canonical
 * twin) when the result feeds hashed state (Phase 5 freight + chain routing).
 */
export function nearestNode(g: RoadGraph, tile: number, mapWidth: number): number {
  const tx = tile % mapWidth;
  const ty = Math.floor(tile / mapWidth);
  let best = -1;
  let bestD = 0x7fffffff;
  for (let n = 0; n < g.nodeCount; n++) {
    if (g.nodeAlive[n] !== 1) {
      continue;
    }
    const d = Math.max(
      Math.abs((g.nodeX[n] as number) - tx),
      Math.abs((g.nodeY[n] as number) - ty),
    );
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

export interface CanonicalEdge {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly roadClass: number;
  readonly lanes: number;
  readonly lengthMilliTiles: number;
}

export interface CanonicalGraph {
  readonly nodes: readonly { x: number; y: number }[];
  readonly edges: readonly CanonicalEdge[];
}

/**
 * Alive edge SLOTS in canonical edge order (the same sort canonicalGraph
 * applies). Per-edge state (traffic volumes) is hashed/saved through this
 * order so identical networks serialize identically however they were
 * built, and loads remap back to the rebuilt graph's slots.
 */
export function canonicalEdgeOrder(g: RoadGraph): number[] {
  const slots: number[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] === 1) {
      slots.push(e);
    }
  }
  const keyOf = (e: number): [number, number, number, number] => {
    const a = g.edgeA[e] as number;
    const b = g.edgeB[e] as number;
    let ax = g.nodeX[a] as number;
    let ay = g.nodeY[a] as number;
    let bx = g.nodeX[b] as number;
    let by = g.nodeY[b] as number;
    if (ax > bx || (ax === bx && ay > by)) {
      [ax, ay, bx, by] = [bx, by, ax, ay];
    }
    return [ax, ay, bx, by];
  };
  slots.sort((p, q) => {
    const kp = keyOf(p);
    const kq = keyOf(q);
    return (
      kp[0] - kq[0] ||
      kp[1] - kq[1] ||
      kp[2] - kq[2] ||
      kp[3] - kq[3] ||
      (g.edgeClass[p] as number) - (g.edgeClass[q] as number)
    );
  });
  return slots;
}

/**
 * Id- and history-independent form: alive content only, endpoint-normalized,
 * sorted. Two graphs with the same canonical form ARE the same road network
 * — the serialization substrate (task 8) and the add∘remove identity oracle.
 */
export function canonicalGraph(g: RoadGraph): CanonicalGraph {
  const nodes: { x: number; y: number }[] = [];
  for (let n = 0; n < g.nodeCount; n++) {
    if (g.nodeAlive[n] === 1) {
      nodes.push({ x: g.nodeX[n] as number, y: g.nodeY[n] as number });
    }
  }
  nodes.sort((p, q) => p.x - q.x || p.y - q.y);

  const edges: CanonicalEdge[] = [];
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const a = g.edgeA[e] as number;
    const b = g.edgeB[e] as number;
    let ax = g.nodeX[a] as number;
    let ay = g.nodeY[a] as number;
    let bx = g.nodeX[b] as number;
    let by = g.nodeY[b] as number;
    if (ax > bx || (ax === bx && ay > by)) {
      [ax, ay, bx, by] = [bx, by, ax, ay];
    }
    edges.push({
      ax,
      ay,
      bx,
      by,
      roadClass: g.edgeClass[e] as number,
      lanes: g.edgeLanes[e] as number,
      lengthMilliTiles: g.edgeLengthMilliTiles[e] as number,
    });
  }
  edges.sort(
    (p, q) => p.ax - q.ax || p.ay - q.ay || p.bx - q.bx || p.by - q.by || p.roadClass - q.roadClass,
  );
  return { nodes, edges };
}
