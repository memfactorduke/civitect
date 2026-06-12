/**
 * World state + the fixed-order tick pipeline (TDD §4 [LOCKED], ADR-005).
 *
 * `world.tick` counts completed ticks; `runTick` consumes the commands
 * stamped for exactly that tick, runs the system phases in their locked
 * order, then advances the counter. The tick counter is time — there is no
 * other clock in this package, and lint enforces that.
 */
import {
  ByteWriter,
  type Command,
  type CommandRejection,
  CommandType,
  flatTerrain,
  RejectionReason,
  TERRAIN_LAYER_NAMES,
  type TerrainGrid,
} from "@civitect/protocol";
import { fnv1a64 } from "./hash";
import { createRng, type Pcg32, RNG_STREAM_NAMES, type RngStreamName } from "./rng";
import { pointOnSegment, segmentRelation, supercoverTiles } from "./roads/geometry";
import {
  addEdge,
  addNode,
  baseClass,
  canonicalGraph,
  createRoadGraph,
  edgeBetween,
  edgesOf,
  isBridgeClass,
  nodeAt,
  type RoadClass,
  type RoadGraph,
  removeEdge,
  removeNode,
  upgradeEdge,
} from "./roads/graph";

/** GDD §13: pause / 1× / 3× / 9× [TUNE]. The value IS the multiplier, not an index. */
export const SIM_SPEEDS: readonly number[] = [0, 1, 3, 9];

/** ADR-005: 10 ticks/sec at 1×; 1 tick = 1 game-minute. */
export const TICK_HZ = 10;

/** Ticks in one game-year (365 × 24 × 60 game-minutes) — the golden-city horizon. */
export const TICKS_PER_GAME_YEAR = 525_600;

const DEFAULT_MAP_SIZE = 64; // Phase 0 empty world [TUNE]; real maps land with Phase 1 terrain.

export interface World {
  readonly seed: number;
  /** Completed ticks. */
  tick: number;
  /** Current speed multiplier — one of SIM_SPEEDS. 0 = paused (the worker stops calling runTick). */
  speed: number;
  /** Flat tile index (y * mapWidth + x) of the selection; -1 = none. */
  selectedTileIdx: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  /** Integer cents, always (ADR-005). 0 until the Phase 2 economy defines starting funds. */
  fundsCents: number;
  population: number;
  /** Tile layers (TDD §5) — part of the canonical state (and the hash). */
  readonly terrain: TerrainGrid;
  /** Road network (TDD §5) — canonical state, hashed in canonical form. */
  readonly roads: RoadGraph;
  /**
   * Undo/redo stacks (LIFO inverse ops). SESSION-LOCAL by design: not
   * hashed, not saved — the exit criterion build∘undo ≡ identity on the
   * state hash requires exactly that (a redo stack would differ from
   * never-having-built).
   */
  readonly undoStack: RoadOp[];
  readonly redoStack: RoadOp[];
  readonly rng: Readonly<Record<RngStreamName, Pcg32>>;
}

/** A segment by tile pair + class — the currency of undo bookkeeping. */
export interface SegRecord {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly roadClass: RoadClass;
}

/** Inverse-operation records for undo/redo (sim-side per protocol v3). */
export type RoadOp =
  | {
      /** Generalized build: may split crossed edges and create a chain. */
      readonly kind: "build";
      readonly removedEdges: readonly SegRecord[];
      readonly createdEdges: readonly SegRecord[];
      readonly createdNodes: readonly { readonly x: number; readonly y: number }[];
    }
  | {
      readonly kind: "bulldoze";
      readonly ax: number;
      readonly ay: number;
      readonly bx: number;
      readonly by: number;
      readonly roadClass: RoadClass;
    }
  | {
      readonly kind: "upgrade";
      readonly ax: number;
      readonly ay: number;
      readonly bx: number;
      readonly by: number;
      readonly fromClass: RoadClass;
      readonly toClass: RoadClass;
    };

export function createWorld(
  seed: number,
  mapWidth = DEFAULT_MAP_SIZE,
  mapHeight = DEFAULT_MAP_SIZE,
  terrain?: TerrainGrid,
): World {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(`world seed must be a non-negative safe integer, got ${seed}`);
  }
  if (!isU16Dim(mapWidth) || !isU16Dim(mapHeight)) {
    throw new Error(`map dimensions must be in [1, 65535], got ${mapWidth}×${mapHeight}`);
  }
  if (terrain !== undefined && (terrain.width !== mapWidth || terrain.height !== mapHeight)) {
    throw new Error(
      `terrain is ${terrain.width}×${terrain.height}, world wants ${mapWidth}×${mapHeight}`,
    );
  }
  const rng = {} as Record<RngStreamName, Pcg32>;
  for (const name of RNG_STREAM_NAMES) {
    rng[name] = createRng(seed, name);
  }
  return {
    seed,
    tick: 0,
    speed: 1,
    selectedTileIdx: -1,
    mapWidth,
    mapHeight,
    fundsCents: 0,
    population: 0,
    terrain: terrain ?? flatTerrain(mapWidth, mapHeight),
    roads: createRoadGraph(),
    undoStack: [],
    redoStack: [],
    rng,
  };
}

function inBounds(world: World, x: number, y: number): boolean {
  return x < world.mapWidth && y < world.mapHeight;
}

function water(world: World, x: number, y: number): boolean {
  return (world.terrain.layers.water[y * world.mapWidth + x] as number) !== 0;
}

function terrace(world: World, x: number, y: number): number {
  return world.terrain.layers.elevation[y * world.mapWidth + x] as number;
}

const MAX_TERRACE_STEP = 1; // [TUNE] steeper crossings need tunnels (deferred)

/**
 * Apply a build with the full 12d/12e semantics. Plans first, mutates only
 * when every rule passes — a rejected build leaves no fingerprints.
 *
 * - Crossing an existing non-bridge edge at an integer point splits it and
 *   threads the new road through (auto-intersections); T-junctions split
 *   the touched edge; existing nodes on the line join the chain.
 * - Non-integer crossings and collinear overlaps reject.
 * - Bridges (class > BRIDGE_CLASS_OFFSET) are grade-separated: they neither
 *   split nor connect mid-span, and they must cross water (which non-bridge
 *   roads may never touch). Bridge endpoints anchor on land.
 * - Adjacent walked tiles climbing > MAX_TERRACE_STEP terraces reject
 *   (tunnels are a later slice).
 */
function applyBuild(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  roadClass: RoadClass,
  seq: number,
): RoadOp | CommandRejection {
  const reject = (reason: RejectionReason = RejectionReason.invalidSegment): CommandRejection => ({
    seq,
    tick: world.tick,
    reason,
  });
  if (!inBounds(world, ax, ay) || !inBounds(world, bx, by)) {
    return reject(RejectionReason.outOfBounds);
  }
  if (ax === bx && ay === by) {
    return reject();
  }
  const g = world.roads;
  const bridge = isBridgeClass(roadClass);

  // Terrain rules over the walked tiles.
  const walk = supercoverTiles(ax, ay, bx, by);
  let wetInterior = 0;
  for (let i = 0; i < walk.length; i++) {
    const t = walk[i] as { x: number; y: number };
    if (!inBounds(world, t.x, t.y)) {
      return reject(RejectionReason.outOfBounds);
    }
    const wet = water(world, t.x, t.y);
    const isEndpoint = i === 0 || i === walk.length - 1;
    if (wet && isEndpoint) {
      return reject(); // both bridge and road must anchor/stand on land
    }
    if (wet && !bridge) {
      return reject(); // water needs a bridge
    }
    if (wet) {
      wetInterior++;
    }
    if (i > 0) {
      const prev = walk[i - 1] as { x: number; y: number };
      const dryPair = !wet && !water(world, prev.x, prev.y);
      if (
        dryPair &&
        Math.abs(terrace(world, t.x, t.y) - terrace(world, prev.x, prev.y)) > MAX_TERRACE_STEP
      ) {
        return reject(); // cliff: tunnel territory (later slice)
      }
    }
  }
  if (bridge && wetInterior === 0) {
    return reject(); // bridges exist to cross water
  }

  // Plan splits and chain points against every alive edge.
  interface Split {
    readonly edge: number;
    readonly x: number;
    readonly y: number;
  }
  const splits: Split[] = [];
  const chainPts: { x: number; y: number }[] = [];
  const isEndpointOfNew = (x: number, y: number): boolean =>
    (x === ax && y === ay) || (x === bx && y === by);

  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const eax = g.nodeX[g.edgeA[e] as number] as number;
    const eay = g.nodeY[g.edgeA[e] as number] as number;
    const ebx = g.nodeX[g.edgeB[e] as number] as number;
    const eby = g.nodeY[g.edgeB[e] as number] as number;
    const rel = segmentRelation(ax, ay, bx, by, eax, eay, ebx, eby);
    if (rel.kind === "none") {
      continue;
    }
    const otherIsBridge = isBridgeClass(g.edgeClass[e] as number);
    if (rel.kind === "collinearOverlap") {
      return reject(); // even bridges may not stack on a collinear road
    }
    if (bridge || otherIsBridge) {
      continue; // grade separation: over/under-pass, no junction, no split
    }
    if (rel.kind === "nonInteger") {
      return reject();
    }
    const onNewInterior =
      pointOnSegment(rel.x, rel.y, ax, ay, bx, by) && !isEndpointOfNew(rel.x, rel.y);
    const isExistingEndpoint = (rel.x === eax && rel.y === eay) || (rel.x === ebx && rel.y === eby);
    if (!isExistingEndpoint) {
      splits.push({ edge: e, x: rel.x, y: rel.y });
    }
    if (onNewInterior) {
      chainPts.push({ x: rel.x, y: rel.y });
    }
    if (isExistingEndpoint && !onNewInterior && !isEndpointOfNew(rel.x, rel.y)) {
    }
  }

  if (!bridge) {
    // Existing nodes sitting on the new line connect through it.
    for (let n = 0; n < g.nodeCount; n++) {
      if (g.nodeAlive[n] !== 1) {
        continue;
      }
      const nx = g.nodeX[n] as number;
      const ny = g.nodeY[n] as number;
      if (!isEndpointOfNew(nx, ny) && pointOnSegment(nx, ny, ax, ay, bx, by)) {
        chainPts.push({ x: nx, y: ny });
      }
    }
  }

  // Duplicate guard for the splitless whole-segment case (collinear checks
  // make sub-segment duplicates impossible otherwise).
  const a0 = nodeAt(g, ax, ay);
  const b0 = nodeAt(g, bx, by);
  if (a0 !== -1 && b0 !== -1 && edgeBetween(g, a0, b0) !== -1) {
    return reject();
  }

  // ── Mutate ────────────────────────────────────────────────────────────
  const removedEdges: SegRecord[] = [];
  const createdEdges: SegRecord[] = [];
  const createdNodes: { x: number; y: number }[] = [];
  const noteNode = (x: number, y: number): number => {
    const existing = nodeAt(g, x, y);
    if (existing !== -1) {
      return existing;
    }
    createdNodes.push({ x, y });
    return addNode(g, x, y);
  };

  for (const split of splits) {
    const e = split.edge;
    const na = g.edgeA[e] as number;
    const nb = g.edgeB[e] as number;
    const cls = g.edgeClass[e] as RoadClass;
    removedEdges.push({
      ax: g.nodeX[na] as number,
      ay: g.nodeY[na] as number,
      bx: g.nodeX[nb] as number,
      by: g.nodeY[nb] as number,
      roadClass: cls,
    });
    removeEdge(g, e);
    const mid = noteNode(split.x, split.y);
    addEdge(g, na, mid, cls);
    addEdge(g, mid, nb, cls);
    createdEdges.push(
      {
        ax: g.nodeX[na] as number,
        ay: g.nodeY[na] as number,
        bx: split.x,
        by: split.y,
        roadClass: cls,
      },
      {
        ax: split.x,
        ay: split.y,
        bx: g.nodeX[nb] as number,
        by: g.nodeY[nb] as number,
        roadClass: cls,
      },
    );
  }

  // Chain through sorted unique interior points.
  const dirX = bx - ax;
  const dirY = by - ay;
  const seen = new Set<number>();
  const points = [{ x: ax, y: ay }, ...chainPts, { x: bx, y: by }]
    .filter((pt) => {
      const key = pt.x * 0x10000 + pt.y;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort(
      (p, q) => (p.x - ax) * dirX + (p.y - ay) * dirY - ((q.x - ax) * dirX + (q.y - ay) * dirY),
    );
  for (let i = 0; i + 1 < points.length; i++) {
    const pa = points[i] as { x: number; y: number };
    const pb = points[i + 1] as { x: number; y: number };
    const na = noteNode(pa.x, pa.y);
    const nb = noteNode(pb.x, pb.y);
    addEdge(g, na, nb, roadClass);
    createdEdges.push({ ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, roadClass });
  }

  return { kind: "build", removedEdges, createdEdges, createdNodes };
}

/** Apply a bulldoze. Returns the op (with the removed class) or a rejection. */
function applyBulldoze(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  seq: number,
): RoadOp | CommandRejection {
  const a = nodeAt(world.roads, ax, ay);
  const b = nodeAt(world.roads, bx, by);
  const edge = a !== -1 && b !== -1 ? edgeBetween(world.roads, a, b) : -1;
  if (edge === -1) {
    return { seq, tick: world.tick, reason: RejectionReason.noSuchRoad };
  }
  const roadClass = world.roads.edgeClass[edge] as RoadClass;
  removeEdge(world.roads, edge);
  if (edgesOf(world.roads, a).length === 0) {
    removeNode(world.roads, a);
  }
  if (edgesOf(world.roads, b).length === 0) {
    removeNode(world.roads, b);
  }
  return { kind: "bulldoze", ax, ay, bx, by, roadClass };
}

function removeSeg(g: RoadGraph, seg: SegRecord): void {
  const a = nodeAt(g, seg.ax, seg.ay);
  const b = nodeAt(g, seg.bx, seg.by);
  removeEdge(g, edgeBetween(g, a, b));
}

function addSeg(g: RoadGraph, seg: SegRecord): void {
  addEdge(g, addNode(g, seg.ax, seg.ay), addNode(g, seg.bx, seg.by), seg.roadClass);
}

/** Invert one op (undo). Never records onto stacks itself. */
function applyInverse(world: World, op: RoadOp): void {
  switch (op.kind) {
    case "build": {
      // LIFO discipline guarantees every created edge still exists and
      // every created node ends isolated once they're gone.
      for (const seg of op.createdEdges) {
        removeSeg(world.roads, seg);
      }
      for (const pt of op.createdNodes) {
        const n = nodeAt(world.roads, pt.x, pt.y);
        if (n !== -1 && edgesOf(world.roads, n).length === 0) {
          removeNode(world.roads, n);
        }
      }
      for (const seg of op.removedEdges) {
        addSeg(world.roads, seg);
      }
      return;
    }
    case "bulldoze": {
      const a = addNode(world.roads, op.ax, op.ay);
      const b = addNode(world.roads, op.bx, op.by);
      addEdge(world.roads, a, b, op.roadClass);
      return;
    }
    case "upgrade": {
      const a = nodeAt(world.roads, op.ax, op.ay);
      const b = nodeAt(world.roads, op.bx, op.by);
      upgradeEdge(world.roads, edgeBetween(world.roads, a, b), op.fromClass);
      return;
    }
  }
}

/** Re-apply one op (redo). */
function applyForward(world: World, op: RoadOp): void {
  switch (op.kind) {
    case "build": {
      for (const seg of op.removedEdges) {
        removeSeg(world.roads, seg);
      }
      for (const seg of op.createdEdges) {
        addSeg(world.roads, seg);
      }
      return;
    }
    case "bulldoze": {
      const a = nodeAt(world.roads, op.ax, op.ay);
      const b = nodeAt(world.roads, op.bx, op.by);
      removeEdge(world.roads, edgeBetween(world.roads, a, b));
      if (edgesOf(world.roads, a).length === 0) {
        removeNode(world.roads, a);
      }
      if (edgesOf(world.roads, b).length === 0) {
        removeNode(world.roads, b);
      }
      return;
    }
    case "upgrade": {
      const a = nodeAt(world.roads, op.ax, op.ay);
      const b = nodeAt(world.roads, op.bx, op.by);
      upgradeEdge(world.roads, edgeBetween(world.roads, a, b), op.toClass);
      return;
    }
  }
}

function isU16Dim(v: number): boolean {
  return Number.isInteger(v) && v >= 1 && v <= 0xffff;
}

function applyCommand(world: World, cmd: Command): CommandRejection | null {
  switch (cmd.type) {
    case CommandType.selectTile: {
      if (cmd.x >= world.mapWidth || cmd.y >= world.mapHeight) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.outOfBounds };
      }
      world.selectedTileIdx = cmd.y * world.mapWidth + cmd.x;
      return null;
    }
    case CommandType.setSpeed: {
      if (!SIM_SPEEDS.includes(cmd.speed)) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      world.speed = cmd.speed;
      return null;
    }
    case CommandType.buildRoad: {
      const result = applyBuild(
        world,
        cmd.ax,
        cmd.ay,
        cmd.bx,
        cmd.by,
        cmd.roadClass as RoadClass,
        cmd.seq,
      );
      if ("reason" in result) {
        return result;
      }
      world.undoStack.push(result);
      world.redoStack.length = 0;
      return null;
    }
    case CommandType.bulldozeRoad: {
      const result = applyBulldoze(world, cmd.ax, cmd.ay, cmd.bx, cmd.by, cmd.seq);
      if ("reason" in result) {
        return result;
      }
      world.undoStack.push(result);
      world.redoStack.length = 0;
      return null;
    }
    case CommandType.upgradeRoad: {
      const a = nodeAt(world.roads, cmd.ax, cmd.ay);
      const b = nodeAt(world.roads, cmd.bx, cmd.by);
      const edge = a !== -1 && b !== -1 ? edgeBetween(world.roads, a, b) : -1;
      if (edge === -1) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.noSuchRoad };
      }
      const fromClass = world.roads.edgeClass[edge] as RoadClass;
      const toClass = cmd.roadClass as RoadClass;
      upgradeEdge(world.roads, edge, toClass);
      world.undoStack.push({
        kind: "upgrade",
        ax: cmd.ax,
        ay: cmd.ay,
        bx: cmd.bx,
        by: cmd.by,
        fromClass,
        toClass,
      });
      world.redoStack.length = 0;
      return null;
    }
    case CommandType.undo: {
      const op = world.undoStack.pop();
      if (op === undefined) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.nothingToUndo };
      }
      applyInverse(world, op);
      world.redoStack.push(op);
      return null;
    }
    case CommandType.redo: {
      const op = world.redoStack.pop();
      if (op === undefined) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.nothingToRedo };
      }
      applyForward(world, op);
      world.undoStack.push(op);
      return null;
    }
    default:
      // v6 zoning/building commands reject loudly until the Phase 2 sim
      // systems PR lands them (same staging as the road commands used).
      return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.unknownCommand };
  }
}

/**
 * Run one tick. `commands` must all be stamped for the current tick — the
 * caller (worker shell / replay) owns routing-by-tick; the sim owns order
 * WITHIN the tick (seq ascending, so input arrival order never matters).
 * Returns rejections for the shell to relay (TDD §7 reason codes).
 */
export function runTick(world: World, commands: readonly Command[]): CommandRejection[] {
  for (const cmd of commands) {
    if (cmd.tick !== world.tick) {
      throw new Error(
        `command seq=${cmd.seq} stamped for tick ${cmd.tick}, world is at ${world.tick}`,
      );
    }
  }
  const ordered = [...commands].sort((a, b) => a.seq - b.seq);

  // ── TDD §4 tick pipeline [LOCKED ORDER] ──────────────────────────────────
  // applyCommands → networks → buildings → cohorts → economy → traffic
  // → agents → services → pollution/landValue → events/advisors.
  // Phase bodies arrive with their roadmap phases; the order is structural
  // from day one and never reshuffles. Each consumes only its own RNG stream.
  const rejections: CommandRejection[] = [];
  for (const cmd of ordered) {
    const rejection = applyCommand(world, cmd);
    if (rejection !== null) {
      rejections.push(rejection);
    }
  }
  // networks(power, water)            — TODO(ROADMAP Phase 2)
  // buildings(growth/decay, 1/60th)   — TODO(ROADMAP Phase 2), rng.growth
  // cohorts(lifecycle hourly slice)   — TODO(ROADMAP Phase 2)
  // economy(accrual, monthly close)   — TODO(ROADMAP Phase 5)
  // trafficIncremental                — TODO(ROADMAP Phase 3), rng.traffic
  // agents(move, spawn/recycle)       — TODO(ROADMAP Phase 3), rng.agents
  // services(queues)                  — TODO(ROADMAP Phase 4), rng.services
  // pollution/landValue(dirty regions)— TODO(ROADMAP Phase 2)
  // events/advisors                   — TODO(ROADMAP Phase 2+), rng.events

  world.tick += 1;
  return rejections;
}

export const IntersectionControl = {
  none: 0,
  stop: 1,
  signal: 2,
} as const;
export type IntersectionControl = (typeof IntersectionControl)[keyof typeof IntersectionControl];

/**
 * Auto signals/stops (12d): DERIVED from the graph, never stored — no hash
 * or save impact. Degree ≥ 3 makes an intersection; any avenue/highway leg
 * warrants a signal, all-street/path corners get stops [TUNE].
 */
export function controlAt(world: World, node: number): IntersectionControl {
  const legs = edgesOf(world.roads, node);
  if (legs.length < 3) {
    return IntersectionControl.none;
  }
  for (const e of legs) {
    const cls = baseClass(world.roads.edgeClass[e] as RoadClass);
    if (cls === 2 || cls === 3) {
      return IntersectionControl.signal;
    }
  }
  return IntersectionControl.stop;
}

/**
 * Canonical state serialization → FNV-1a 64 hex. THE replay-equality oracle
 * (ADR-013 §1). Field order is part of the contract: append new fields at
 * the end and re-bless goldens; never reorder.
 */
export function stateHash(world: World): string {
  const w = new ByteWriter();
  w.u64(world.seed)
    .u64(world.tick)
    .u8(world.speed)
    .i64(world.selectedTileIdx)
    .u16(world.mapWidth)
    .u16(world.mapHeight)
    .i64(world.fundsCents)
    .u32(world.population);
  for (const name of RNG_STREAM_NAMES) {
    const s = world.rng[name].state();
    w.u32(s.stateHi).u32(s.stateLo).u32(s.incHi).u32(s.incLo);
  }
  // Appended fields (re-bless points). Terrain joined with phase-1 task 7b.
  for (const name of TERRAIN_LAYER_NAMES) {
    const layer = world.terrain.layers[name];
    for (let i = 0; i < layer.length; i++) {
      w.u16(layer[i] as number);
    }
  }
  // Roads joined with phase-1 task 8 — canonical (id/history-free) form, so
  // identical networks hash identically however they were built.
  const roads = canonicalGraph(world.roads);
  w.u32(roads.nodes.length);
  for (const node of roads.nodes) {
    w.u16(node.x).u16(node.y);
  }
  w.u32(roads.edges.length);
  for (const edge of roads.edges) {
    w.u16(edge.ax).u16(edge.ay).u16(edge.bx).u16(edge.by).u8(edge.roadClass).u8(edge.lanes);
  }
  return fnv1a64(w.finish());
}
