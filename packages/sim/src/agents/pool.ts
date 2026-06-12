/**
 * Live agents v1 (GDD §9.4, TDD §6.5, Phase 3 tranche 3): a SAMPLED
 * PROJECTION of the assigned flows — never canonical state (ADR-002).
 * Nothing here is hashed or saved, and nothing here may write back into
 * canonical state; the projection-purity test (world.test) proves a world
 * with an active sampler hashes identically to one without.
 *
 * The sampler is the ADR-002 chokepoint: it draws journeys ∝ OD demand
 * with ORIGINS inside the (expanded) camera viewport — the only consumer
 * of the viewportHint message — from its own UNHASHED rng stream (a
 * camera-dependent draw on a hashed stream would leak the camera into the
 * hash). Pinned cims (GDD §17.5) are always materialized, camera or not.
 *
 * Movement is integer milli-tiles along TWIN edges (the canonical twin the
 * solver routes on, packages/sim/src/traffic/solver.ts): cars at edge
 * speed, pedestrians at PED_SPEED [TUNE]. Car-following spacing is
 * deferred [TUNE — visual only, TDD §6.5]. A network edit rebuilds the
 * twin; agents on the old twin clear (visual blip, deterministic).
 */
import type { Buildings } from "../growth/buildings";
import { Pcg32 } from "../rng";
import { otherEnd, type RoadGraph } from "../roads/graph";
import {
  buildCells,
  CELL_TILES,
  type Cell,
  findEdgePath,
  pathfinderFor,
  pathsForCostField,
} from "../traffic/assignment";
import type { TrafficCore } from "../traffic/solver";

export const AGENT_POOL_CAP = 2048; // [TUNE — device-scaled in tranche 6]
export const VIEW_MARGIN_TILES = 16; // sampler bounds = viewport + margin [TUNE]
export const SAMPLE_EVERY_TICKS = 5;
export const SPAWNS_PER_SAMPLE = 8; // [TUNE]
export const PED_SPEED_MILLI = 60; // milli-tiles per tick [TUNE]
export const MAX_PINS = 64; // [TUNE]
const WALK_MAX_CELLS = 1; // mirrors the mode table (GDD §9.2)
const CELLS_REFRESH_TICKS = 60;
const VISUAL_STREAM = 0xa9e17; // NOT one of the hashed world streams

export const AgentKindSim = {
  pedestrian: 1,
  car: 2,
} as const;
export type AgentKindSim = (typeof AgentKindSim)[keyof typeof AgentKindSim];

export interface Viewport {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface AgentPool {
  /** High-water slot count; slots recycle through the free list. */
  count: number;
  liveCount: number;
  nextId: number;
  freeHead: number;
  // SoA per slot:
  id: Uint32Array;
  alive: Uint8Array;
  kind: Uint8Array;
  pinned: Uint8Array;
  /** Persona ref (GDD §17.5): home building tile + cohort slot. */
  cohortTile: Uint32Array;
  cohortSlot: Uint8Array;
  /** Path through TWIN edges; node is the edge-entry node (direction). */
  paths: (number[] | null)[];
  pathIndex: Uint16Array;
  node: Int32Array;
  progressMilli: Uint32Array;
  /** Position + direction in milli-tiles (boundary converts to floats). */
  xMilli: Int32Array;
  yMilli: Int32Array;
  dxMilli: Int32Array;
  dyMilli: Int32Array;
  nextFree: Int32Array;
  /** Spawn budget per sample pass (device-scaled; perf harness raises it). */
  spawnsPerSample: number;
  /** Visual-only rng — camera-dependent draws stay out of the hash. */
  rng: Pcg32;
  /** The twin these agents' paths live on; a new twin clears the pool. */
  twin: RoadGraph | null;
  /** Cached OD cells for sampling (derived; refreshed on a cadence). */
  cells: Cell[] | null;
  cellsTick: number;
  cellsBuildingVersion: number;
}

const NO_INDEX = -1;

export function createAgentPool(worldSeed: number, cap = AGENT_POOL_CAP): AgentPool {
  return {
    count: 0,
    liveCount: 0,
    nextId: 1,
    freeHead: NO_INDEX,
    id: new Uint32Array(cap),
    alive: new Uint8Array(cap),
    kind: new Uint8Array(cap),
    pinned: new Uint8Array(cap),
    cohortTile: new Uint32Array(cap),
    cohortSlot: new Uint8Array(cap),
    paths: new Array<number[] | null>(cap).fill(null),
    pathIndex: new Uint16Array(cap),
    node: new Int32Array(cap).fill(NO_INDEX),
    progressMilli: new Uint32Array(cap),
    xMilli: new Int32Array(cap),
    yMilli: new Int32Array(cap),
    dxMilli: new Int32Array(cap),
    dyMilli: new Int32Array(cap),
    nextFree: new Int32Array(cap).fill(NO_INDEX),
    spawnsPerSample: SPAWNS_PER_SAMPLE,
    rng: Pcg32.seeded(worldSeed, VISUAL_STREAM),
    twin: null,
    cells: null,
    cellsTick: -1,
    cellsBuildingVersion: -1,
  };
}

export function clearAgentPool(pool: AgentPool): void {
  pool.alive.fill(0);
  pool.paths.fill(null);
  pool.count = 0;
  pool.liveCount = 0;
  pool.freeHead = NO_INDEX;
  pool.cells = null;
  pool.cellsTick = -1;
}

function recycle(pool: AgentPool, slot: number): void {
  pool.alive[slot] = 0;
  pool.paths[slot] = null;
  pool.nextFree[slot] = pool.freeHead;
  pool.freeHead = slot;
  pool.liveCount--;
}

function spawnSlot(pool: AgentPool): number {
  let slot: number;
  if (pool.freeHead !== NO_INDEX) {
    slot = pool.freeHead;
    pool.freeHead = pool.nextFree[slot] as number;
  } else {
    if (pool.count >= pool.alive.length) {
      return NO_INDEX;
    }
    slot = pool.count;
  }
  pool.count = Math.max(pool.count, slot + 1);
  pool.alive[slot] = 1;
  pool.id[slot] = pool.nextId++;
  pool.liveCount++;
  return slot;
}

interface AgentWorld {
  readonly tick: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly buildings: Buildings;
  readonly traffic: TrafficCore;
  readonly viewport: Viewport | null;
  readonly pins: readonly { tileIdx: number; slot: number }[];
  readonly agents: AgentPool;
}

function refreshCells(pool: AgentPool, world: AgentWorld, twin: RoadGraph): Cell[] {
  if (
    pool.cells === null ||
    world.tick - pool.cellsTick >= CELLS_REFRESH_TICKS ||
    pool.cellsBuildingVersion !== world.buildings.version
  ) {
    pool.cells = buildCells(world.buildings, twin, world.mapWidth, world.mapHeight);
    pool.cellsTick = world.tick;
    pool.cellsBuildingVersion = world.buildings.version;
  }
  return pool.cells;
}

function placeOnPath(pool: AgentPool, slot: number, twin: RoadGraph): void {
  const path = pool.paths[slot] ?? null;
  const node = pool.node[slot] as number;
  if (path === null || path.length === 0 || node === NO_INDEX) {
    return;
  }
  const e = path[pool.pathIndex[slot] as number] as number;
  const next = otherEnd(twin, e, node);
  const ax = (twin.nodeX[node] as number) * 1000;
  const ay = (twin.nodeY[node] as number) * 1000;
  const bx = (twin.nodeX[next] as number) * 1000;
  const by = (twin.nodeY[next] as number) * 1000;
  const len = Math.max(1, twin.edgeLengthMilliTiles[e] as number);
  const p = Math.min(len, pool.progressMilli[slot] as number);
  pool.xMilli[slot] = ax + Math.floor(((bx - ax) * p) / len);
  pool.yMilli[slot] = ay + Math.floor(((by - ay) * p) / len);
  pool.dxMilli[slot] = bx - ax;
  pool.dyMilli[slot] = by - ay;
}

function spawnJourney(
  pool: AgentPool,
  twin: RoadGraph,
  origin: Cell,
  dest: Cell,
  pinned: boolean,
  cohortTile: number,
  cohortSlot: number,
): boolean {
  if (origin.anchor === NO_INDEX || dest.anchor === NO_INDEX || origin.anchor === dest.anchor) {
    return false;
  }
  const pf = pathfinderFor(twin);
  const paths = pathsForCostField(twin, `agents:${twin.version}`);
  const path = findEdgePath(twin, pf, paths, origin.anchor, dest.anchor, (e) =>
    Math.max(1, twin.edgeSpeedMilliTilesPerTick[e] as number),
  );
  if (path === null || path.length === 0) {
    return false;
  }
  const slot = spawnSlot(pool);
  if (slot === NO_INDEX) {
    return false;
  }
  const cellDist = Math.max(Math.abs(origin.cx - dest.cx), Math.abs(origin.cy - dest.cy));
  pool.kind[slot] = cellDist <= WALK_MAX_CELLS ? AgentKindSim.pedestrian : AgentKindSim.car;
  pool.pinned[slot] = pinned ? 1 : 0;
  pool.cohortTile[slot] = cohortTile;
  pool.cohortSlot[slot] = cohortSlot;
  pool.paths[slot] = path;
  pool.pathIndex[slot] = 0;
  pool.node[slot] = origin.anchor;
  pool.progressMilli[slot] = 0;
  placeOnPath(pool, slot, twin);
  return true;
}

/** Weighted cell pick over a cumulative field; -1 when the field is empty. */
function pickWeighted(
  pool: AgentPool,
  cells: readonly Cell[],
  weightOf: (c: Cell) => number,
): number {
  let total = 0;
  for (const cell of cells) {
    total += weightOf(cell);
  }
  if (total === 0) {
    return NO_INDEX;
  }
  let roll = pool.rng.nextBounded(total);
  for (let i = 0; i < cells.length; i++) {
    roll -= weightOf(cells[i] as Cell);
    if (roll < 0) {
      return i;
    }
  }
  return NO_INDEX;
}

function firstResidentialTile(world: AgentWorld, cell: Cell): number {
  const b = world.buildings;
  const x0 = cell.cx * CELL_TILES;
  const y0 = cell.cy * CELL_TILES;
  for (let dy = 0; dy < CELL_TILES; dy++) {
    for (let dx = 0; dx < CELL_TILES; dx++) {
      const tile = (y0 + dy) * world.mapWidth + (x0 + dx);
      const slot = b.byTile.get(tile);
      if (slot !== undefined && b.alive[slot] === 1) {
        return tile;
      }
    }
  }
  return 0;
}

function cellOfTile(cells: readonly Cell[], tile: number, mapWidth: number): Cell | null {
  const cellsX = Math.ceil(mapWidth / CELL_TILES);
  const cx = Math.floor((tile % mapWidth) / CELL_TILES);
  const cy = Math.floor(Math.floor(tile / mapWidth) / CELL_TILES);
  return (cells[cy * cellsX + cx] as Cell | undefined) ?? null;
}

function samplePool(world: AgentWorld, twin: RoadGraph): void {
  const pool = world.agents;
  const cells = refreshCells(pool, world, twin);

  // Pinned cims first — always live, camera or not (GDD §17.5).
  for (const pin of world.pins) {
    let isLive = false;
    for (let s = 0; s < pool.count; s++) {
      if (
        pool.alive[s] === 1 &&
        pool.pinned[s] === 1 &&
        (pool.cohortTile[s] as number) === pin.tileIdx &&
        (pool.cohortSlot[s] as number) === pin.slot
      ) {
        isLive = true;
        break;
      }
    }
    if (isLive) {
      continue;
    }
    const home = cellOfTile(cells, pin.tileIdx, world.mapWidth);
    if (home === null) {
      continue;
    }
    // Commute target: the busiest job cell (deterministic; richer matching
    // joins with travel-time job matching) [TUNE].
    let work: Cell | null = null;
    for (const cell of cells) {
      if (cell.jobs > 0 && (work === null || cell.jobs > work.jobs)) {
        work = cell;
      }
    }
    if (work !== null) {
      spawnJourney(pool, twin, home, work, true, pin.tileIdx, pin.slot);
    }
  }

  const view = world.viewport;
  if (view === null) {
    return;
  }
  const x0 = view.x0 - VIEW_MARGIN_TILES;
  const y0 = view.y0 - VIEW_MARGIN_TILES;
  const x1 = view.x1 + VIEW_MARGIN_TILES;
  const y1 = view.y1 + VIEW_MARGIN_TILES;
  const visible = cells.filter((c) => {
    const cx = c.cx * CELL_TILES + CELL_TILES / 2;
    const cy = c.cy * CELL_TILES + CELL_TILES / 2;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
  for (let n = 0; n < pool.spawnsPerSample && pool.liveCount < pool.alive.length; n++) {
    const oi = pickWeighted(pool, visible, (c) => c.workers);
    const di = pickWeighted(pool, cells, (c) => c.jobs);
    if (oi === NO_INDEX || di === NO_INDEX) {
      return;
    }
    const origin = visible[oi] as Cell;
    const homeTile = firstResidentialTile(world, origin);
    spawnJourney(pool, twin, origin, cells[di] as Cell, false, homeTile, pool.rng.nextBounded(16));
  }
}

function stepPool(pool: AgentPool, twin: RoadGraph): void {
  for (let s = 0; s < pool.count; s++) {
    if (pool.alive[s] !== 1) {
      continue;
    }
    const path = pool.paths[s] ?? null;
    if (path === null) {
      recycle(pool, s);
      continue;
    }
    const e = path[pool.pathIndex[s] as number] as number;
    const speed =
      pool.kind[s] === AgentKindSim.car
        ? Math.max(1, twin.edgeSpeedMilliTilesPerTick[e] as number)
        : PED_SPEED_MILLI;
    let progress = (pool.progressMilli[s] as number) + speed;
    let advanced = false;
    while (
      progress >= (twin.edgeLengthMilliTiles[path[pool.pathIndex[s] as number] as number] as number)
    ) {
      const cur = path[pool.pathIndex[s] as number] as number;
      progress -= twin.edgeLengthMilliTiles[cur] as number;
      pool.node[s] = otherEnd(twin, cur, pool.node[s] as number);
      pool.pathIndex[s] = (pool.pathIndex[s] as number) + 1;
      advanced = true;
      if ((pool.pathIndex[s] as number) >= path.length) {
        recycle(pool, s); // journey complete; pinned cims respawn next sample
        break;
      }
    }
    if (pool.alive[s] !== 1) {
      continue;
    }
    pool.progressMilli[s] = progress;
    if (advanced || speed > 0) {
      placeOnPath(pool, s, twin);
    }
  }
}

/**
 * The per-tick agents stage (tick pipeline, after traffic): clears on twin
 * change, samples on cadence, advances motion. Pure projection — touches
 * NOTHING canonical (the projection-purity test holds it to that).
 */
export function updateAgents(world: AgentWorld): void {
  const pool = world.agents;
  const twin = world.traffic.twin;
  if (pool.twin !== twin) {
    clearAgentPool(pool);
    pool.twin = twin;
  }
  if (twin.edgeCount === 0) {
    return;
  }
  if (world.tick % SAMPLE_EVERY_TICKS === 0 && (world.viewport !== null || world.pins.length > 0)) {
    samplePool(world, twin);
  }
  stepPool(pool, twin);
}
