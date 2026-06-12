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
import {
  addEdge,
  addNode,
  canonicalGraph,
  createRoadGraph,
  edgeBetween,
  edgesOf,
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

/** Inverse-operation records for undo/redo (sim-side per protocol v3). */
export type RoadOp =
  | {
      readonly kind: "build";
      readonly ax: number;
      readonly ay: number;
      readonly bx: number;
      readonly by: number;
      readonly roadClass: RoadClass;
      readonly createdA: boolean;
      readonly createdB: boolean;
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

/** Apply a build (forward or via redo). Returns the op for the undo stack, or a rejection. */
function applyBuild(
  world: World,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  roadClass: RoadClass,
  seq: number,
): RoadOp | CommandRejection {
  if (!inBounds(world, ax, ay) || !inBounds(world, bx, by)) {
    return { seq, tick: world.tick, reason: RejectionReason.outOfBounds };
  }
  if (ax === bx && ay === by) {
    return { seq, tick: world.tick, reason: RejectionReason.invalidSegment };
  }
  const existingA = nodeAt(world.roads, ax, ay);
  const existingB = nodeAt(world.roads, bx, by);
  if (
    existingA !== -1 &&
    existingB !== -1 &&
    edgeBetween(world.roads, existingA, existingB) !== -1
  ) {
    return { seq, tick: world.tick, reason: RejectionReason.invalidSegment };
  }
  const a = addNode(world.roads, ax, ay);
  const b = addNode(world.roads, bx, by);
  addEdge(world.roads, a, b, roadClass);
  return {
    kind: "build",
    ax,
    ay,
    bx,
    by,
    roadClass,
    createdA: existingA === -1,
    createdB: existingB === -1,
  };
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

/** Invert one op (undo). Never records onto stacks itself. */
function applyInverse(world: World, op: RoadOp): void {
  switch (op.kind) {
    case "build": {
      // Inverse of build = bulldoze. LIFO discipline guarantees the edge
      // exists and created nodes are isolated again by the time we get here.
      const a = nodeAt(world.roads, op.ax, op.ay);
      const b = nodeAt(world.roads, op.bx, op.by);
      removeEdge(world.roads, edgeBetween(world.roads, a, b));
      if (op.createdA && edgesOf(world.roads, a).length === 0) {
        removeNode(world.roads, a);
      }
      if (op.createdB && edgesOf(world.roads, b).length === 0) {
        removeNode(world.roads, b);
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
      const a = addNode(world.roads, op.ax, op.ay);
      const b = addNode(world.roads, op.bx, op.by);
      addEdge(world.roads, a, b, op.roadClass);
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
