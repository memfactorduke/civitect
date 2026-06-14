/**
 * World state + the fixed-order tick pipeline (TDD §4 [LOCKED], ADR-005).
 *
 * `world.tick` counts completed ticks; `runTick` consumes the commands
 * stamped for exactly that tick, runs the system phases in their locked
 * order, then advances the counter. The tick counter is time — there is no
 * other clock in this package, and lint enforces that.
 */
import {
  type AdvisorEvent,
  AdvisorSeverity,
  BuildingKind,
  ByteWriter,
  type Command,
  type CommandRejection,
  CommandType,
  type DemandBlock,
  EntityKind,
  flatTerrain,
  MAX_DISTRICTS,
  type MonthlyReport,
  POLICY_BITS,
  RejectionReason,
  ReportLineKind,
  SERVICE_BUDGET_MAX_PERMILLE,
  SERVICE_BUDGET_MIN_PERMILLE,
  SERVICE_COUNT,
  SERVICE_ID_LIST,
  type ServiceId,
  TERRAIN_LAYER_NAMES,
  type TerrainGrid,
  ZoneKind,
} from "@civitect/protocol";
import {
  type AgentPool,
  createAgentPool,
  MAX_PINS,
  updateAgents,
  type Viewport,
} from "./agents/pool";
import { createDistricts, type DistrictState, ensureDistrict } from "./districts/districts";
import {
  accumulate,
  accumulateClose,
  BAILOUT_TERMS,
  createEconomy,
  type EconomyState,
  finalizeReport,
  LOAN_TERMS,
  monthlyPaymentCents,
  PLOPPABLE_COST_CENTS,
  REPORT_KINDS,
  roadCostPerTileCents,
  STARTING_FUNDS_CENTS,
  TICKS_PER_MONTH,
  zoneIndex,
} from "./economy/budget";
import {
  type ChainState,
  chainDailyPass,
  chainHourlyPass,
  createChain,
  edgeAnchors,
  reconcileLost,
  trucksFor,
} from "./economy/chain";
import {
  Achievement,
  type AchievementCounters,
  advanceMilestones,
  checkAchievements,
  isUnlocked,
  loanInterestScalePermille,
  setAchievement,
  TOURIST_SPEND_CENTS,
  tourismArrivals,
  tourismAttractiveness,
  Unlock,
} from "./economy/progression";
import {
  BuildingStatus,
  type Buildings,
  COHORT_BLOCK,
  createBuildings,
  PLOPPABLE_KIND_OFFSET,
  spawnBuilding,
} from "./growth/buildings";
import { computeDemand } from "./growth/demand";
import {
  aggregates,
  emptyFlows,
  type GrowthFlows,
  growthSlice,
  lifecycleSlice,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
} from "./growth/system";
import { computeUtilities, type UtilityState } from "./growth/utilities";
import { fnv1a64 } from "./hash";
import { createRng, type Pcg32, RNG_STREAM_NAMES, type RngStreamName } from "./rng";
import { pointOnSegment, segmentRelation, supercoverTiles } from "./roads/geometry";
import {
  addEdge,
  addNode,
  baseClass,
  canonicalEdgeOrder,
  canonicalGraph,
  createRoadGraph,
  edgeBetween,
  edgesOf,
  isBridgeClass,
  nearestNode,
  nodeAt,
  type RoadClass,
  type RoadGraph,
  removeEdge,
  removeNode,
  upgradeEdge,
} from "./roads/graph";
import {
  coverageAtTile,
  coverageFor,
  createCoverageCache,
  distancesFor,
  type ServiceCoverageCache,
  type ServiceFieldInputs,
} from "./services/coverage";
import { emptyFireFlows, type FireFlows, fireSlice } from "./services/fire";
import {
  createLandValueCache,
  type LandValueCache,
  type LandValueInputs,
  landValueFor,
} from "./services/landvalue";
import { emptyServiceFlows, type ServiceFlows, servicesSlice } from "./services/loops";
import {
  airFor,
  createPollutionCache,
  crisisFor,
  fieldDigestU32,
  GROUND_DECAY_DAYS,
  noiseFor,
  type PollutionCache,
  type PollutionInputs,
  SICK_PER_64_AIR,
  SICK_PER_64_GROUND,
  SICK_WATER_CRISIS,
  sewageBalance,
  waterFor,
} from "./services/pollution";
import {
  applyFreight,
  createTraffic,
  type FreightTrip,
  FULL_SOLVE_HOUR,
  refreshTrafficDerived,
  SolveKind,
  startSolveJob,
  stepSolveJob,
  type TrafficCore,
  trafficToSave,
} from "./traffic/solver";

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
  /** Buildings + cohorts (TDD §4) — canonical state, hashed canonically. */
  readonly buildings: Buildings;
  /** Latest demand block (recomputed each tick — derived, not hashed). */
  lastDemand: DemandBlock;
  /** Per-tick population flows (diagnostics for conservation tests). */
  readonly flows: GrowthFlows;
  /** Pending advisor events, drained by toSnapshot (transient). */
  readonly advisorQueue: AdvisorEvent[];
  /** Derived utility state + the versions it was computed for (not hashed). */
  utilities: UtilityState;
  utilitiesRoadVersion: number;
  utilitiesBuildingVersion: number;
  advisorIdCounter: number;
  /** Bumps on every zone paint (incl. undo/redo) — snapshot change key. */
  zoneVersion: number;
  /**
   * Persistent MSA traffic state (TDD §6.3) — canonical: hashed and saved,
   * including any in-flight sliced solver job. congestedCost is derived.
   */
  traffic: TrafficCore;
  /** Pinned cims (GDD §17.5) — CANONICAL: hashed and saved, sorted. */
  pins: { tileIdx: number; slot: number }[];
  /**
   * Service budget sliders, permille in SERVICE_ID_LIST order (GDD §7) —
   * CANONICAL: hashed and saved (v7 SERVICES). `version` is a session
   * cache fence only (never hashed — the congestionVersion lesson).
   */
  readonly services: { budgetsPermille: Uint16Array; version: number };
  /**
   * Persistent ground pollution, 0–255 per tile (GDD §10) — CANONICAL:
   * hashed and saved. Zero until the pollution loop (board task 4).
   */
  readonly groundPollution: Uint8Array;
  /** Coverage fields per service — derived, fenced, never hashed/saved. */
  readonly coverageCache: ServiceCoverageCache;
  /** Service-loop diagnostics ledger (GrowthFlows pattern, not hashed). */
  readonly serviceFlows: ServiceFlows;
  /** Derived air/noise/water fields + pump crisis — fenced, never hashed. */
  readonly pollutionCache: PollutionCache;
  /** Fire diagnostics ledger (not hashed). */
  readonly fireFlows: FireFlows;
  /** Land-value field cache (GDD §6) — derived, fenced, never hashed. */
  readonly landValueCache: LandValueCache;
  /** The money cycle (GDD §8) — CANONICAL: hashed and saved (v8 ECONOMY). */
  readonly economy: EconomyState;
  /** The goods chain (GDD §8) — CANONICAL ledgers + shipments, hashed and
   *  saved (v9 SHIPMENTS); processed/goods counts are derived (recounted). */
  chain: ChainState;
  /** Districts (GDD §11) — per-district metadata, CANONICAL (v10 DISTRICTS);
   *  the per-tile paint rides the terrain district layer. */
  districts: DistrictState;
  /** Last close's report, drained by toSnapshot (transient, like advisors). */
  pendingReport: MonthlyReport | null;
  /** Live-agent projection (ADR-002) — derived, never hashed or saved. */
  agents: AgentPool;
  /** Camera bounds from the viewportHint message — sampler input ONLY. */
  viewport: Viewport | null;
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
      readonly kind: "zone";
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      /** Previous zone values, row-major over the rect (for undo). */
      readonly prev: Uint16Array;
      /** New zone value; 0 for dezone. */
      readonly zone: number;
    }
  | {
      readonly kind: "place";
      readonly x: number;
      readonly y: number;
      readonly building: number;
      /** Construction cost charged (undo refunds it exactly). */
      readonly costCents: number;
    }
  | {
      /** Generalized build: may split crossed edges and create a chain. */
      readonly kind: "build";
      readonly removedEdges: readonly SegRecord[];
      readonly createdEdges: readonly SegRecord[];
      readonly createdNodes: readonly { readonly x: number; readonly y: number }[];
      /** Construction cost charged (undo refunds it exactly). */
      readonly costCents: number;
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
  const roads = createRoadGraph();
  return {
    seed,
    tick: 0,
    speed: 1,
    selectedTileIdx: -1,
    mapWidth,
    mapHeight,
    // Starting funds by difficulty (GDD §13); Mayor for fresh worlds.
    fundsCents: STARTING_FUNDS_CENTS[1] as number,
    population: 0,
    terrain: terrain ?? flatTerrain(mapWidth, mapHeight),
    roads,
    undoStack: [],
    redoStack: [],
    buildings: createBuildings(),
    lastDemand: { r: 0, c: 0, i: 0, o: 0, factors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    flows: emptyFlows(),
    advisorQueue: [],
    utilities: {
      componentOf: new Int32Array(0),
      powered: new Uint8Array(0),
      watered: new Uint8Array(0),
    },
    utilitiesRoadVersion: -1,
    utilitiesBuildingVersion: -1,
    advisorIdCounter: 0,
    zoneVersion: 0,
    traffic: createTraffic(roads),
    pins: [],
    services: { budgetsPermille: new Uint16Array(SERVICE_COUNT).fill(1000), version: 0 },
    groundPollution: new Uint8Array(mapWidth * mapHeight),
    coverageCache: createCoverageCache(),
    serviceFlows: emptyServiceFlows(),
    pollutionCache: createPollutionCache(),
    fireFlows: emptyFireFlows(),
    landValueCache: createLandValueCache(),
    economy: createEconomy(),
    chain: createChain(),
    districts: createDistricts(),
    pendingReport: null,
    agents: createAgentPool(seed),
    viewport: null,
    rng,
  };
}

function coverageInputs(world: World): { inputs: ServiceFieldInputs; fenceKey: string } {
  return {
    inputs: {
      roads: world.roads,
      buildings: world.buildings,
      budgetsPermille: world.services.budgetsPermille,
      mapWidth: world.mapWidth,
      mapHeight: world.mapHeight,
    },
    fenceKey: `${world.roads.version},${world.buildings.version},${world.services.version}`,
  };
}

/**
 * FULL coverage field + content digest for one service — the overlay and
 * exit-criterion surface (derived; recomputes when roads/buildings/
 * budgets move). The loops use serviceCoverageAt instead.
 */
export function serviceCoverage(
  world: World,
  service: ServiceId,
): { coverage: Uint8Array; digestU32: number } {
  const { inputs, fenceKey } = coverageInputs(world);
  return coverageFor(world.coverageCache, service, inputs, fenceKey);
}

/** Spot-read coverage at one tile (loops/inspector; no full-field cost). */
export function serviceCoverageAt(world: World, service: ServiceId, tileIdx: number): number {
  const { inputs, fenceKey } = coverageInputs(world);
  const dist = distancesFor(world.coverageCache, service, inputs, fenceKey);
  return coverageAtTile(dist, tileIdx, world.mapWidth, world.mapHeight);
}

function pollutionInputs(world: World): { inputs: PollutionInputs; fence: string } {
  return {
    inputs: {
      buildings: world.buildings,
      roads: world.roads,
      traffic: world.traffic,
      waterLayer: world.terrain.layers.water,
      elevation: world.terrain.layers.elevation,
      mapWidth: world.mapWidth,
      mapHeight: world.mapHeight,
    },
    fence: `${world.buildings.version},${world.roads.version},${world.traffic.costHash}`,
  };
}

/** All four pollution samples at a tile (inspector environ block). */
export function pollutionAt(
  world: World,
  tileIdx: number,
): { air: number; ground: number; noise: number; water: number } {
  const { inputs, fence } = pollutionInputs(world);
  return {
    air: airFor(world.pollutionCache, inputs, fence)[tileIdx] as number,
    ground: world.groundPollution[tileIdx] as number,
    noise: noiseFor(world.pollutionCache, inputs, fence)[tileIdx] as number,
    water: waterFor(world.pollutionCache, inputs, fence)[tileIdx] as number,
  };
}

/**
 * Land-value field + digest (GDD §6): derived from coverage + pollution +
 * water view; its fence is the union of theirs (coverage fence already
 * includes budgets; pollution fence includes traffic costs).
 */
export function landValueField(world: World): { field: Uint8Array; digestU32: number } {
  const { fenceKey } = coverageInputs(world);
  const { fence: pollFence } = pollutionInputs(world);
  const inputs: LandValueInputs = {
    coverageAt: (service, tileIdx) => serviceCoverageAt(world, service, tileIdx),
    airAt: (tileIdx) => pollutionAt(world, tileIdx).air,
    groundAt: (tileIdx) => world.groundPollution[tileIdx] as number,
    noiseAt: (tileIdx) => pollutionAt(world, tileIdx).noise,
    waterLayer: world.terrain.layers.water,
    mapWidth: world.mapWidth,
    mapHeight: world.mapHeight,
  };
  return landValueFor(world.landValueCache, inputs, `${fenceKey}|${pollFence}`);
}

/** Spot-read land value at one tile (taxes task 2, inspector). */
export function landValueAtTile(world: World, tileIdx: number): number {
  return landValueField(world).field[tileIdx] as number;
}

/** Full derived pollution field + digest (overlay surface, task 6). */
export function pollutionField(
  world: World,
  kind: "air" | "noise" | "water",
): { field: Uint8Array; digestU32: number } {
  const { inputs, fence } = pollutionInputs(world);
  const field =
    kind === "air"
      ? airFor(world.pollutionCache, inputs, fence)
      : kind === "noise"
        ? noiseFor(world.pollutionCache, inputs, fence)
        : waterFor(world.pollutionCache, inputs, fence);
  return { field, digestU32: fieldDigestU32(world.pollutionCache, kind, field) };
}

const ZONE_ROAD_DEPTH = 4; // GDD §6: zoning depth along roads

function tileIsLand(world: World, tileIdx: number): boolean {
  return (world.terrain.layers.water[tileIdx] as number) === 0;
}

/** Within zoning depth of any road tile (the component map IS the road set). */
function tileNearRoad(world: World, tileIdx: number): boolean {
  if (world.utilities.componentOf.length === 0) {
    return false;
  }
  const x = tileIdx % world.mapWidth;
  const y = Math.floor(tileIdx / world.mapWidth);
  for (let dy = -ZONE_ROAD_DEPTH; dy <= ZONE_ROAD_DEPTH; dy++) {
    for (let dx = -ZONE_ROAD_DEPTH; dx <= ZONE_ROAD_DEPTH; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= world.mapWidth || ny >= world.mapHeight) {
        continue;
      }
      if ((world.utilities.componentOf[ny * world.mapWidth + nx] as number) !== -1) {
        return true;
      }
    }
  }
  return false;
}

function refreshUtilities(world: World): void {
  if (
    world.utilitiesRoadVersion === world.roads.version &&
    world.utilitiesBuildingVersion === world.buildings.version
  ) {
    return;
  }
  world.utilities = computeUtilities(world.roads, world.buildings, world.mapWidth, world.mapHeight);
  world.utilitiesRoadVersion = world.roads.version;
  world.utilitiesBuildingVersion = world.buildings.version;
}

function emitAdvisor(
  world: World,
  severity: AdvisorEvent["severity"],
  messageKey: string,
  summaryKey: string,
  links: AdvisorEvent["cause"]["links"],
): void {
  world.advisorQueue.push({
    id: world.advisorIdCounter++,
    tick: world.tick,
    severity,
    messageKey,
    cause: { summaryKey, links },
  });
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

  return { kind: "build", removedEdges, createdEdges, createdNodes, costCents: 0 };
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
    case "zone": {
      world.zoneVersion++;
      const w = op.x1 - op.x0 + 1;
      for (let y = op.y0; y <= op.y1; y++) {
        for (let x = op.x0; x <= op.x1; x++) {
          world.terrain.layers.zone[y * world.mapWidth + x] = op.prev[
            (y - op.y0) * w + (x - op.x0)
          ] as number;
        }
      }
      return;
    }
    case "place": {
      const tileIdx = op.y * world.mapWidth + op.x;
      const idx = world.buildings.byTile.get(tileIdx);
      if (idx !== undefined) {
        // demolish via the table (free-list) — LIFO guarantees it exists
        world.buildings.alive[idx] = 0;
        world.buildings.byTile.delete(tileIdx);
        world.buildings.nextFree[idx] = world.buildings.freeHead;
        world.buildings.freeHead = idx;
        world.buildings.version++;
      }
      world.fundsCents += op.costCents; // undo refunds in full
      accumulate(world.economy, ReportLineKind.construction, op.costCents);
      return;
    }
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
      world.fundsCents += op.costCents; // undo refunds in full
      accumulate(world.economy, ReportLineKind.construction, op.costCents);
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
    case "zone": {
      world.zoneVersion++;
      for (let y = op.y0; y <= op.y1; y++) {
        for (let x = op.x0; x <= op.x1; x++) {
          const tileIdx = y * world.mapWidth + x;
          if (op.zone === 0) {
            world.terrain.layers.zone[tileIdx] = 0;
          } else if (tileIsLand(world, tileIdx) && !world.buildings.byTile.has(tileIdx)) {
            world.terrain.layers.zone[tileIdx] = op.zone;
          }
        }
      }
      return;
    }
    case "place": {
      const tileIdx = op.y * world.mapWidth + op.x;
      if (!world.buildings.byTile.has(tileIdx)) {
        spawnBuilding(world.buildings, tileIdx, PLOPPABLE_KIND_OFFSET + op.building);
      }
      world.fundsCents -= op.costCents; // redo pays again
      accumulate(world.economy, ReportLineKind.construction, -op.costCents);
      return;
    }
    case "build": {
      for (const seg of op.removedEdges) {
        removeSeg(world.roads, seg);
      }
      for (const seg of op.createdEdges) {
        addSeg(world.roads, seg);
      }
      world.fundsCents -= op.costCents; // redo pays again
      accumulate(world.economy, ReportLineKind.construction, -op.costCents);
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
      // Cost gate BEFORE mutation (GDD §8): supercover tiles × class rate.
      const tiles = supercoverTiles(cmd.ax, cmd.ay, cmd.bx, cmd.by).length;
      const cost = tiles * roadCostPerTileCents(cmd.roadClass as RoadClass);
      if (world.fundsCents < cost) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.insufficientFunds };
      }
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
      world.fundsCents -= cost;
      accumulate(world.economy, ReportLineKind.construction, -cost);
      // applyBuild only ever returns the build variant on success.
      const op = result as Extract<RoadOp, { kind: "build" }>;
      world.undoStack.push({ ...op, costCents: cost });
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
    case CommandType.zoneRect:
    case CommandType.dezoneRect: {
      const zone = cmd.type === CommandType.zoneRect ? cmd.zone : ZoneKind.none;
      // NOTE: high density is an UNLOCK BIT the UI gates its tool on (GDD §13),
      // but the sim does NOT hard-reject high-density zoning in v1 — enforcing
      // it would rewrite every pre-progression scenario that zones R/C-high at
      // founding. Loans are the sim-enforced gate (see takeLoan). [TUNE: make
      // high-density a hard gate once the scenario corpus expects it.]
      const x0 = Math.min(cmd.x0, cmd.x1);
      const y0 = Math.min(cmd.y0, cmd.y1);
      const x1 = Math.max(cmd.x0, cmd.x1);
      const y1 = Math.max(cmd.y0, cmd.y1);
      if (!inBounds(world, x0, y0) || !inBounds(world, x1, y1)) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.outOfBounds };
      }
      refreshUtilities(world); // road set must be current for depth checks
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      const prev = new Uint16Array(w * h);
      let changed = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const tileIdx = y * world.mapWidth + x;
          prev[(y - y0) * w + (x - x0)] = world.terrain.layers.zone[tileIdx] as number;
          // Paint only legal tiles: land, within road depth (GDD §6) — for
          // dezone, clear unconditionally. Occupied tiles keep their zone.
          if (zone === ZoneKind.none) {
            if ((world.terrain.layers.zone[tileIdx] as number) !== ZoneKind.none) {
              world.terrain.layers.zone[tileIdx] = ZoneKind.none;
              changed++;
            }
          } else if (
            tileIsLand(world, tileIdx) &&
            tileNearRoad(world, tileIdx) &&
            !world.buildings.byTile.has(tileIdx)
          ) {
            if ((world.terrain.layers.zone[tileIdx] as number) !== zone) {
              world.terrain.layers.zone[tileIdx] = zone;
              changed++;
            }
          }
        }
      }
      if (changed === 0) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      world.zoneVersion++;
      world.undoStack.push({ kind: "zone", x0, y0, x1, y1, prev, zone });
      world.redoStack.length = 0;
      return null;
    }
    case CommandType.pinCim: {
      const building = world.buildings.byTile.get(cmd.tileIdx);
      const exists = world.pins.some((p) => p.tileIdx === cmd.tileIdx && p.slot === cmd.slot);
      if (
        building === undefined ||
        world.buildings.alive[building] !== 1 ||
        cmd.slot >= 32 || // persona slots per building [TUNE]
        exists ||
        world.pins.length >= MAX_PINS
      ) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      world.pins.push({ tileIdx: cmd.tileIdx, slot: cmd.slot });
      // Sorted order is the canonical (and serialized) order.
      world.pins.sort((p, q) => p.tileIdx - q.tileIdx || p.slot - q.slot);
      return null;
    }
    case CommandType.unpinCim: {
      const at = world.pins.findIndex((p) => p.tileIdx === cmd.tileIdx && p.slot === cmd.slot);
      if (at === -1) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      world.pins.splice(at, 1);
      return null;
    }
    case CommandType.setServiceBudget: {
      // Decode already enforces the domain; the sim re-checks because IT
      // is the authority (TDD §7) — a foreign encoder is not trusted.
      const at = SERVICE_ID_LIST.indexOf(cmd.service);
      if (
        at === -1 ||
        cmd.permille < SERVICE_BUDGET_MIN_PERMILLE ||
        cmd.permille > SERVICE_BUDGET_MAX_PERMILLE
      ) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      world.services.budgetsPermille[at] = cmd.permille;
      world.services.version++;
      return null;
    }
    case CommandType.setTaxRate: {
      // Decode enforced the domain; the sim re-checks (it is the authority).
      if (cmd.zone < 1 || cmd.zone > 6 || cmd.permille < 10 || cmd.permille > 290) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      world.economy.taxRatesPermille[zoneIndex(cmd.zone)] = cmd.permille;
      return null;
    }
    case CommandType.takeLoan: {
      // Loans are milestone-gated (GDD §13): the budget panel comes first,
      // loans unlock at the first population milestone.
      if (!isUnlocked(world.economy, Unlock.loans)) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.notUnlocked };
      }
      const terms = LOAN_TERMS[cmd.tier - 1];
      if (
        terms === undefined ||
        world.economy.loans.length >= 3 ||
        world.economy.receivership === 1
      ) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      // Interest scales with difficulty (Relaxed easy, Ironclad dear): a
      // dearer payment over the same term, same principal up front.
      const scaledPayment = Math.floor(
        (monthlyPaymentCents(terms) * loanInterestScalePermille(world.economy.difficulty)) / 1000,
      );
      world.economy.loans.push({
        principalCents: terms.principalCents,
        monthlyPaymentCents: scaledPayment,
        monthsLeft: terms.months,
      });
      world.fundsCents += terms.principalCents;
      // Proceeds are cash the report must explain (GDD §12): every
      // principal flow — take, monthly share, early repay — shares the
      // loanPrincipal line, so Σ lines ≡ funds delta holds with loans
      // moving mid-month (the conservation property exercises this).
      accumulate(world.economy, ReportLineKind.loanPrincipal, terms.principalCents);
      setAchievement(world.economy, Achievement.firstLoan); // remembers "ever borrowed"
      return null;
    }
    case CommandType.repayLoan: {
      // Tier addresses the Nth active loan (1-based, canonical order).
      const loan = world.economy.loans[cmd.tier - 1];
      if (loan === undefined) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      if (world.fundsCents < loan.principalCents) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.insufficientFunds };
      }
      world.fundsCents -= loan.principalCents;
      accumulate(world.economy, ReportLineKind.loanPrincipal, -loan.principalCents);
      world.economy.loans.splice(cmd.tier - 1, 1);
      return null;
    }
    case CommandType.paintDistrict: {
      // Paint the district id over the rect (the canonical per-tile layer);
      // ensure its metadata row exists. Aggregation/effects land in task 2/3.
      if (cmd.districtId > MAX_DISTRICTS) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      const x0 = Math.min(cmd.x0, cmd.x1);
      const y0 = Math.min(cmd.y0, cmd.y1);
      const x1 = Math.max(cmd.x0, cmd.x1);
      const y1 = Math.max(cmd.y0, cmd.y1);
      if (!inBounds(world, x0, y0) || !inBounds(world, x1, y1)) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.outOfBounds };
      }
      if (cmd.districtId > 0) {
        ensureDistrict(world.districts, cmd.districtId);
      }
      const layer = world.terrain.layers.district;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          layer[y * world.mapWidth + x] = cmd.districtId;
        }
      }
      return null;
    }
    case CommandType.nameDistrict: {
      if (cmd.districtId < 1 || cmd.districtId > MAX_DISTRICTS) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      ensureDistrict(world.districts, cmd.districtId);
      (world.districts.rows[cmd.districtId - 1] as { name: string }).name = cmd.name;
      return null;
    }
    case CommandType.setPolicy: {
      if (cmd.districtId < 1 || cmd.districtId > MAX_DISTRICTS || cmd.policy >= POLICY_BITS) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      ensureDistrict(world.districts, cmd.districtId);
      const row = world.districts.rows[cmd.districtId - 1] as { policyMask: number };
      const bit = 1 << cmd.policy;
      row.policyMask = cmd.on ? row.policyMask | bit : row.policyMask & ~bit;
      return null;
    }
    case CommandType.setOrdinance: {
      if (cmd.ordinance >= POLICY_BITS) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      const bit = 1 << cmd.ordinance;
      world.districts.ordinanceMask = cmd.on
        ? world.districts.ordinanceMask | bit
        : world.districts.ordinanceMask & ~bit;
      return null;
    }
    case CommandType.placeBuilding: {
      if (!inBounds(world, cmd.x, cmd.y)) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.outOfBounds };
      }
      const tileIdx = cmd.y * world.mapWidth + cmd.x;
      refreshUtilities(world);
      if (
        !tileIsLand(world, tileIdx) ||
        !tileNearRoad(world, tileIdx) ||
        world.buildings.byTile.has(tileIdx)
      ) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.invalidTarget };
      }
      const cost = PLOPPABLE_COST_CENTS.get(cmd.building) ?? 0;
      if (world.fundsCents < cost) {
        return { seq: cmd.seq, tick: world.tick, reason: RejectionReason.insufficientFunds };
      }
      spawnBuilding(world.buildings, tileIdx, PLOPPABLE_KIND_OFFSET + cmd.building);
      world.fundsCents -= cost;
      accumulate(world.economy, ReportLineKind.construction, -cost);
      world.undoStack.push({
        kind: "place",
        x: cmd.x,
        y: cmd.y,
        building: cmd.building,
        costCents: cost,
      });
      world.redoStack.length = 0;
      return null;
    }
  }
}

/** Population count of set bits in a u32 (uniques mask → unique count). */
function popcount32(n: number): number {
  let v = n >>> 0;
  let count = 0;
  while (v !== 0) {
    count += v & 1;
    v >>>= 1;
  }
  return count;
}

/** A per-call cached nearest-TWIN-node resolver (the chain + freight share it). */
function twinNodeResolver(world: World): (tile: number) => number {
  const twin = world.traffic.twin;
  const cache = new Map<number, number>();
  return (tile: number): number => {
    const hit = cache.get(tile);
    if (hit !== undefined) {
      return hit;
    }
    const n = nearestNode(twin, tile, world.mapWidth);
    cache.set(tile, n);
    return n;
  };
}

/**
 * Rebuild the DERIVED freight load from the canonical in-flight shipments and
 * fold it into the traffic cost field. Called each hourly solve AND once on
 * load (save-codec) — freightVolumes is never saved, so a loaded world must
 * re-derive it BEFORE its first hourly chain pass, or the cost field the
 * commute solve and the shipment pricing read would differ from the
 * never-stopped run and the (hashed) arrival ticks would diverge. (Found by
 * adversarial review; the goldens have a dormant chain and missed it.)
 */
export function recomputeFreight(world: World): void {
  const nodeForTile = twinNodeResolver(world);
  const freight: FreightTrip[] = world.chain.shipments.map((s) => ({
    fromTile: s.fromTile,
    toTile: s.toTile,
    trucks: trucksFor(s.units),
  }));
  applyFreight(world.traffic, freight, world.roads, nodeForTile);
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
  // networks(power, water) — recompute on road/building change (Phase 2).
  refreshUtilities(world);
  const growthCtx = {
    buildings: world.buildings,
    utilities: world.utilities,
    zoneAt: (tileIdx: number) => world.terrain.layers.zone[tileIdx] as number,
    landAt: (tileIdx: number) => tileIsLand(world, tileIdx),
    nearRoad: (tileIdx: number) => tileNearRoad(world, tileIdx),
    mapTiles: world.mapWidth * world.mapHeight,
    rng: world.rng.growth,
    flows: world.flows,
    taxRatesPermille: world.economy.taxRatesPermille,
    resourceAt: (tileIdx: number) => world.terrain.layers.resource[tileIdx] as number,
    chain: world.chain,
  };
  // buildings(growth/decay, staggered 1/60th per tick) — rng.growth.
  // ONE aggregate scan per tick (the balance gate's year-long replay made
  // the 3-scan version a 5-minute CI rung).
  const agg = aggregates(world.buildings);
  const flowsAtScan = { ...world.flows };
  growthSlice(growthCtx, world.tick, agg);
  // Utilities must see THIS tick's spawns before lifecycle judges them —
  // a stale served-array abandons newborn buildings (found by the growth
  // test: population flatlined at 3).
  refreshUtilities(world);
  const lifecycleCtx = { ...growthCtx, utilities: world.utilities };
  // cohorts(lifecycle hourly slice).
  if (world.tick % TICKS_PER_HOUR === 0) {
    const hourOfDay = Math.floor(world.tick / TICKS_PER_HOUR) % 24;
    const newlyAbandoned = lifecycleSlice(lifecycleCtx, hourOfDay, world.tick, agg);
    // events/advisors — every warning carries its CauseChain pointing at the
    // ACTUAL building (ADR-009; the e2e resolves these links). Cap 3/slice.
    for (const tileIdx of newlyAbandoned.slice(0, 3)) {
      emitAdvisor(world, AdvisorSeverity.warning, "advisor.abandonment", "cause.utilityFailure", [
        {
          subject: { kind: EntityKind.building, id: tileIdx },
          labelKey: "cause.noUtilities",
          weightPermille: 1000,
        },
      ]);
    }
  }
  // economy(accrual; monthly close on tick boundary) — GDD §8/§12.
  if (world.tick > 0 && world.tick % TICKS_PER_MONTH === 0) {
    const net = accumulateClose(world.economy, {
      buildings: world.buildings,
      roads: world.roads,
      serviceBudgetsPermille: world.services.budgetsPermille,
      landValueAt: (tileIdx) => landValueAtTile(world, tileIdx),
    });
    world.fundsCents += net;
    // Failure pressure (GDD §2): one bailout per city, then receivership.
    // The check runs BEFORE the report freezes, so a granted bailout shows
    // up in the month that needed it (pillar 2: the report explains).
    if (world.fundsCents < 0 && world.economy.receivership === 0) {
      if (world.economy.bailoutUsed === 0) {
        world.economy.bailoutUsed = 1;
        world.economy.loans.push({
          principalCents: BAILOUT_TERMS.principalCents,
          monthlyPaymentCents: monthlyPaymentCents(BAILOUT_TERMS),
          monthsLeft: BAILOUT_TERMS.months,
        });
        world.fundsCents += BAILOUT_TERMS.principalCents;
        accumulate(world.economy, ReportLineKind.bailout, BAILOUT_TERMS.principalCents);
        emitAdvisor(world, AdvisorSeverity.alert, "advisor.bailout", "cause.bankruptcy", [
          {
            subject: { kind: EntityKind.system, id: 0 },
            labelKey: "cause.cityInsolvent",
            weightPermille: 1000,
          },
        ]);
      } else {
        world.economy.receivership = 1;
        emitAdvisor(world, AdvisorSeverity.alert, "advisor.receivership", "cause.bankruptcyFinal", [
          {
            subject: { kind: EntityKind.system, id: 0 },
            labelKey: "cause.bailoutExhausted",
            weightPermille: 1000,
          },
        ]);
      }
    }
    world.pendingReport = {
      month: Math.floor(world.tick / TICKS_PER_MONTH),
      lines: finalizeReport(world.economy),
    };
  }
  // trafficIncremental (TDD §6.3, tranche 2): persistent MSA volumes
  // (canonical-edge-keyed — hashed and saved, in-flight job included)
  // evolved by a SLICED solver job: full equilibrium daily at 04:00,
  // incremental step hourly; a fixed count of origin cells per tick
  // (work-based slicing, no clocks — ADR-005). Network edits re-derive
  // costs NOW and join demand at the next hourly step — no mid-hour
  // restart (it would break build∘undo ≡ identity; note in TDD §6.3).
  if (world.traffic.graphVersion !== world.roads.version) {
    refreshTrafficDerived(world.traffic, world.roads);
  }
  // goods chain (GDD §8, board task 3) — runs on the hour, on the canonical
  // TWIN so its money/arrival decisions reproduce after load. Daily
  // produce/transform/sell at midnight first (new stock can ship the same
  // hour), then arrivals + dispatch, then freight loads the network for the
  // commute solve that follows (the deferred Phase-3/4 volume injection).
  if (world.tick % TICKS_PER_HOUR === 0) {
    const twin = world.traffic.twin;
    const nodeForTile = twinNodeResolver(world);
    if (world.tick % TICKS_PER_DAY === 0) {
      // De-level pressure only bites a city that COULD be supplied (has an
      // outside connection at a map-edge road node); isolated test grids
      // level industry on occupancy alone, as before the chain.
      const chainActive = edgeAnchors(twin, world.mapWidth, world.mapHeight).length > 0;
      chainDailyPass(world.chain, world.buildings, chainActive);
    }
    chainHourlyPass(world.chain, {
      buildings: world.buildings,
      graph: twin,
      mapWidth: world.mapWidth,
      mapHeight: world.mapHeight,
      tick: world.tick,
      costField: world.traffic.twinCosts,
      nodeForTile,
      economy: world.economy,
      moveFunds: (cents) => {
        world.fundsCents += cents;
      },
    });
    // Freight loads the cost field the commute solve below reads.
    recomputeFreight(world);
  }
  if (world.tick % TICKS_PER_HOUR === 0 && world.traffic.job === null) {
    const hourOfDay = Math.floor(world.tick / TICKS_PER_HOUR) % 24;
    startSolveJob(
      world.traffic,
      hourOfDay === FULL_SOLVE_HOUR ? SolveKind.full : SolveKind.incremental,
    );
  }
  if (
    stepSolveJob(
      world.traffic,
      world.buildings,
      world.roads,
      world.mapWidth,
      world.mapHeight,
      Math.floor(world.tick / TICKS_PER_HOUR) % 24,
    )
  ) {
    // Congestion consequences are never just red lines (GDD §9 [LOCKED]):
    // the worst saturated edge gets a diagnosable advisor whose cause
    // chain names the EDGE and its midpoint TILE [TUNE threshold 150%].
    let worstEdge = -1;
    let worstRatio = 1500;
    for (let e = 0; e < world.roads.edgeCount; e++) {
      if (world.roads.edgeAlive[e] !== 1 || (world.roads.edgeCapacity_[e] as number) === 0) {
        continue;
      }
      const ratio = Math.floor(
        ((world.traffic.volumes[e] as number) * 1000) / (world.roads.edgeCapacity_[e] as number),
      );
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstEdge = e;
      }
    }
    if (worstEdge !== -1) {
      const g = world.roads;
      const midX =
        ((g.nodeX[g.edgeA[worstEdge] as number] as number) +
          (g.nodeX[g.edgeB[worstEdge] as number] as number)) >>
        1;
      const midY =
        ((g.nodeY[g.edgeA[worstEdge] as number] as number) +
          (g.nodeY[g.edgeB[worstEdge] as number] as number)) >>
        1;
      emitAdvisor(world, AdvisorSeverity.alert, "advisor.congestion", "cause.edgeSaturated", [
        {
          subject: { kind: EntityKind.edge, id: worstEdge },
          labelKey: "cause.volumeOverCapacity",
          weightPermille: Math.min(1000, worstRatio - 1000),
        },
        {
          subject: { kind: EntityKind.tile, id: midY * world.mapWidth + midX },
          labelKey: "cause.jamLocation",
          weightPermille: 1000,
        },
      ]);
    }
  }
  // agents(move, spawn/recycle): a sampled PROJECTION (ADR-002) — its own
  // UNHASHED rng; reads canonical state, writes none (projection-purity
  // test). The hashed rng.agents stream stays reserved for future
  // canonical agent decisions.
  updateAgents(world);
  // services(queues): hourly staggered slice (board phase-4 task 3) —
  // garbage, health/sickness, deathcare, education on rng.services.
  if (world.tick % TICKS_PER_HOUR === 0) {
    const { inputs: pollInputs, fence: pollFence } = pollutionInputs(world);
    const crisis = crisisFor(world.pollutionCache, pollInputs, pollFence);
    const airField = airFor(world.pollutionCache, pollInputs, pollFence);
    const deathsBefore = world.serviceFlows.deaths;
    servicesSlice(
      {
        buildings: world.buildings,
        budgetsPermille: world.services.budgetsPermille,
        coverageAt: (service, tileIdx) => serviceCoverageAt(world, service, tileIdx),
        // Pollution → sickness (GDD §10): air + persistent ground + the
        // citywide pump-crisis multiplier, permille/day.
        extraSickPermille: (tileIdx) =>
          Math.floor(((airField[tileIdx] as number) * SICK_PER_64_AIR) / 64) +
          Math.floor(((world.groundPollution[tileIdx] as number) * SICK_PER_64_GROUND) / 64) +
          (crisis !== null ? SICK_WATER_CRISIS : 0),
        groundPollution: world.groundPollution,
        rng: world.rng.services,
        flows: world.serviceFlows,
        emit: (messageKey, summaryKey, subjectTile, weightPermille) =>
          emitAdvisor(world, AdvisorSeverity.warning, messageKey, summaryKey, [
            {
              subject: { kind: EntityKind.building, id: subjectTile },
              labelKey: summaryKey,
              weightPermille,
            },
          ]),
      },
      world.tick,
    );
    // Deaths are population outflows — the conservation identity (pop =
    // in − out, exact every tick) routes them through GrowthFlows.
    world.flows.deaths += world.serviceFlows.deaths - deathsBefore;

    // Fire (board task 5, rng.events): ignition/burn/response/spread.
    // The congested twin cost field is the dispatcher's map — jams
    // literally push fires out of a station's reach (GDD §9 [LOCKED]).
    fireSlice(
      {
        buildings: world.buildings,
        roads: world.roads,
        traffic: world.traffic,
        budgetsPermille: world.services.budgetsPermille,
        mapWidth: world.mapWidth,
        mapHeight: world.mapHeight,
        rng: world.rng.events,
        flows: world.fireFlows,
        onFlee: (count) => {
          world.flows.emigrants += count;
        },
        emit: (severity, messageKey, summaryKey, links) =>
          emitAdvisor(
            world,
            severity === "alert" ? AdvisorSeverity.alert : AdvisorSeverity.warning,
            messageKey,
            summaryKey,
            links.map((l) => ({
              subject: {
                kind: l.kind as AdvisorEvent["cause"]["links"][number]["subject"]["kind"],
                id: l.id,
              },
              labelKey: l.labelKey,
              weightPermille: l.weightPermille,
            })),
          ),
      },
      world.tick,
    );

    const hourOfDay = Math.floor(world.tick / TICKS_PER_HOUR) % 24;
    const day = Math.floor(world.tick / 1440);
    // Ground pollution decays 1 point per GROUND_DECAY_DAYS — row-sliced
    // so no single tick pays the full-field pass (TDD §4 stagger).
    if (day % GROUND_DECAY_DAYS === 0) {
      for (let y = hourOfDay; y < world.mapHeight; y += 24) {
        const row = y * world.mapWidth;
        for (let x = 0; x < world.mapWidth; x++) {
          const v = world.groundPollution[row + x] as number;
          if (v > 0) {
            world.groundPollution[row + x] = v - 1;
          }
        }
      }
    }
    // The pump crisis (GDD §10): dramatic, diagnosable, daily check —
    // outlet → polluted intake → pump, every link resolvable (ADR-009).
    if (crisis !== null && hourOfDay === 6) {
      emitAdvisor(world, AdvisorSeverity.alert, "advisor.waterCrisis", "cause.pollutedIntake", [
        {
          subject: { kind: EntityKind.building, id: crisis.pumpTile },
          labelKey: "cause.pumpDrinksPollution",
          weightPermille: 1000,
        },
        {
          subject: { kind: EntityKind.tile, id: crisis.intakeTile },
          labelKey: "cause.pollutedWater",
          weightPermille: 1000,
        },
      ]);
    }
    // Sewage adequacy (GDD §7): a daily city-level balance check. Young
    // towns with no sewage infrastructure at all get grace until real
    // scale (demand > 500) — otherwise every hamlet nags from day one.
    if (hourOfDay === 7) {
      const sewage = sewageBalance(world.buildings);
      if (sewage.demand > sewage.capacity && (sewage.capacity > 0 || sewage.demand > 500)) {
        emitAdvisor(world, AdvisorSeverity.warning, "advisor.sewage", "cause.sewageDeficit", [
          {
            subject: { kind: EntityKind.system, id: 0 },
            labelKey: "cause.sewageOverCapacity",
            weightPermille: Math.min(
              1000,
              Math.floor(((sewage.demand - sewage.capacity) * 1000) / sewage.demand),
            ),
          },
        ]);
      }
    }
  }
  // pollution/landValue(dirty regions)— land value v1 derives on demand
  // HUD/demand reuse the same scan (one tick of staleness on spawn counts
  // is deterministic and invisible at city scale).
  world.lastDemand = computeDemand(agg, world.economy.taxRatesPermille);
  // Population must be EXACT (the conservation exit criterion holds at
  // every tick): the aggregate scan ran before growth, so add this tick's
  // flow deltas — flows are the only paths residents enter or leave by.
  world.population =
    agg.residents +
    (world.flows.births - flowsAtScan.births) +
    (world.flows.immigrants - flowsAtScan.immigrants) -
    (world.flows.deaths - flowsAtScan.deaths) -
    (world.flows.emigrants - flowsAtScan.emigrants);

  // progression(daily) — GDD §13: milestones advance on population (monotone,
  // never skips), tourism brings off-map spend, achievements trip once. All
  // canonical functions of city counters → replays + save/loads exactly.
  if (world.tick > 0 && world.tick % TICKS_PER_DAY === 0) {
    for (const ms of advanceMilestones(world.economy, world.population)) {
      emitAdvisor(world, AdvisorSeverity.info, "advisor.milestone", "cause.milestoneReached", [
        {
          subject: { kind: EntityKind.system, id: ms },
          labelKey: "cause.populationGrowth",
          weightPermille: 1000,
        },
      ]);
    }
    // Tourism: attractiveness (parks + uniques − crime[0 until Phase 6]) →
    // arrivals via an outside connection → daily spend at Commercial.
    let parks = 0;
    for (let i = 0; i < world.buildings.count; i++) {
      if (world.buildings.alive[i] !== 1) {
        continue;
      }
      const k = world.buildings.kind[i] as number;
      if (
        k === PLOPPABLE_KIND_OFFSET + BuildingKind.parkSmall ||
        k === PLOPPABLE_KIND_OFFSET + BuildingKind.plaza
      ) {
        parks++;
      }
    }
    const uniques = popcount32(world.economy.uniquesMask);
    const hasOutside = edgeAnchors(world.traffic.twin, world.mapWidth, world.mapHeight).length > 0;
    const arrivals = tourismArrivals(
      tourismAttractiveness(parks, uniques, 0),
      hasOutside,
      world.economy.difficulty,
    );
    if (arrivals > 0) {
      const revenue = arrivals * TOURIST_SPEND_CENTS;
      world.fundsCents += revenue;
      accumulate(world.economy, ReportLineKind.tourism, revenue);
    }
    const counters: AchievementCounters = {
      population: world.population,
      loansActive: world.economy.loans.length,
      fundsCents: world.fundsCents,
      parks,
      industrial: agg.countI,
      tourismArrivals: arrivals,
      bailoutUsed: world.economy.bailoutUsed,
    };
    for (const bit of checkAchievements(world.economy, counters)) {
      emitAdvisor(world, AdvisorSeverity.info, "advisor.achievement", "cause.achievementEarned", [
        {
          subject: { kind: EntityKind.system, id: bit },
          labelKey: "cause.cityMilestone",
          weightPermille: 1000,
        },
      ]);
    }
  }

  // Chain conservation: fold cargo demolished THIS tick (lifecycle, services,
  // and the fire ruin-clear — all run ABOVE the chain pass) into `lost`, so
  // the per-commodity identity holds at every hour boundary no matter when in
  // the tick a stocked producer died. Runs last, after every demolish site.
  if (world.tick % TICKS_PER_HOUR === 0) {
    reconcileLost(world.chain, world.buildings);
  }

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
 * The alive edge whose supercover contains the tile, lowest canonical
 * first; -1 = no road here. The road inspector's resolver (GDD §9.5).
 */
export function edgeAtTile(world: World, tileIdx: number): number {
  const g = world.roads;
  const x = tileIdx % world.mapWidth;
  const y = Math.floor(tileIdx / world.mapWidth);
  for (const e of canonicalEdgeOrder(g)) {
    const a = g.edgeA[e] as number;
    const b = g.edgeB[e] as number;
    for (const t of supercoverTiles(
      g.nodeX[a] as number,
      g.nodeY[a] as number,
      g.nodeX[b] as number,
      g.nodeY[b] as number,
    )) {
      if (t.x === x && t.y === y) {
        return e;
      }
    }
  }
  return -1;
}

/** True when any building (grown or ploppable) is alive — save guard. */
export function worldHasBuildings(world: World): boolean {
  for (let i = 0; i < world.buildings.count; i++) {
    if (world.buildings.alive[i] === 1) {
      return true;
    }
  }
  return false;
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
  // Buildings joined with Phase 2 — canonical: sorted by tile, full row +
  // cohort block (the demography IS canonical state, GDD §8).
  const order: number[] = [];
  for (let i = 0; i < world.buildings.count; i++) {
    if (world.buildings.alive[i] === 1) {
      order.push(i);
    }
  }
  order.sort(
    (p, q) => (world.buildings.tileIdx[p] as number) - (world.buildings.tileIdx[q] as number),
  );
  w.u32(order.length);
  for (const i of order) {
    w.u32(world.buildings.tileIdx[i] as number)
      .u16(world.buildings.kind[i] as number)
      .u8(world.buildings.level[i] as number)
      .u8(world.buildings.status[i] as number)
      .u8(world.buildings.failDays[i] as number)
      .u8(world.buildings.thriveDays[i] as number)
      // Phase 4 service fields (appended with the v7 layout bless).
      .u32(world.buildings.stock[i] as number)
      .u16(world.buildings.sick[i] as number)
      .u16(world.buildings.corpses[i] as number)
      .u8(world.buildings.fireTicks[i] as number)
      // Phase 5 chain fields (appended with the v9 layout bless).
      .u8(world.buildings.chainRole[i] as number)
      .u16(world.buildings.stockIn[i] as number)
      .u16(world.buildings.stockOut[i] as number);
    const base = i * COHORT_BLOCK;
    for (let c = 0; c < COHORT_BLOCK; c++) {
      w.u16(world.buildings.cohorts[base + c] as number);
    }
  }
  // Traffic joined with Phase 3 tranche 2 — hashed through the SAME
  // canonical form the save codec writes (trafficToSave), so hash and save
  // can never disagree about what traffic state is.
  const traffic = trafficToSave(world.traffic, world.roads);
  w.u8(traffic.msaK)
    .u32(traffic.generated)
    .u32(traffic.assigned)
    .u32(traffic.walked)
    .u32(traffic.unroutable)
    .u32(traffic.volumes.length);
  for (const v of traffic.volumes) {
    w.u32(v);
  }
  if (traffic.job === null) {
    w.u8(0);
  } else {
    const job = traffic.job;
    w.u8(job.kind)
      .u8(job.passIndex)
      .u32(job.cursor)
      .u32(job.generated)
      .u32(job.assigned)
      .u32(job.walked)
      .u32(job.unroutable);
    for (const v of job.aon) {
      w.u32(v);
    }
  }
  // Pins joined with Phase 3 tranche 3 — canonical player state (sorted).
  w.u32(world.pins.length);
  for (const pin of world.pins) {
    w.u32(pin.tileIdx).u8(pin.slot);
  }
  // Services joined with Phase 4 task 2: budgets in SERVICE_ID_LIST order
  // + the persistent ground-pollution field (GDD §7/§10).
  for (let s = 0; s < SERVICE_COUNT; s++) {
    w.u16(world.services.budgetsPermille[s] as number);
  }
  for (let i = 0; i < world.groundPollution.length; i++) {
    w.u8(world.groundPollution[i] as number);
  }
  // Economy joined with Phase 5 task 2 (the funds bless).
  for (let z = 0; z < 6; z++) {
    w.u16(world.economy.taxRatesPermille[z] as number);
  }
  w.u8(world.economy.loans.length);
  for (const loan of world.economy.loans) {
    w.i64(loan.principalCents).i64(loan.monthlyPaymentCents).u16(loan.monthsLeft);
  }
  for (let k = 0; k < REPORT_KINDS; k++) {
    w.i64(world.economy.monthAccumCents[k] as number);
  }
  for (let k = 0; k < REPORT_KINDS; k++) {
    w.i64(world.economy.lastMonthCents[k] as number);
  }
  w.u8(world.economy.milestoneIndex);
  for (let b = 0; b < 8; b++) {
    w.u8(world.economy.achievements[b] as number);
  }
  w.u32(world.economy.uniquesMask)
    .u8(world.economy.difficulty)
    .u8(world.economy.receivership)
    .u8(world.economy.bailoutUsed);
  // Chain joined with Phase 5 task 3 (the freight bless). Shipments in their
  // canonical dispatch order; per-commodity ledgers. The processed/goods
  // COUNTS are derived (recounted on load) and deliberately NOT hashed; the
  // freight volumes are derived too. Building chain fields are hashed above.
  w.u32(world.chain.shipments.length);
  for (const s of world.chain.shipments) {
    w.u8(s.fromKind)
      .u32(s.fromTile)
      .u8(s.toKind)
      .u32(s.toTile)
      .u8(s.commodity)
      .u16(s.units)
      .u32(s.dispatchTick)
      .u32(s.arriveTick);
  }
  for (const ledger of [
    world.chain.produced,
    world.chain.consumed,
    world.chain.imported,
    world.chain.exported,
    world.chain.lost,
  ]) {
    for (let c = 0; c < 6; c++) {
      w.u32(ledger[c] as number);
    }
  }
  // Districts joined with Phase 6 task 1. Per-tile paint is already hashed via
  // the terrain district layer; this is the per-district metadata + ordinance.
  w.u32(world.districts.ordinanceMask).u16(world.districts.rows.length);
  for (const row of world.districts.rows) {
    w.str(row.name).u32(row.policyMask);
    for (let z = 0; z < 6; z++) {
      w.u16(row.taxOverridePermille[z] as number);
    }
  }
  return fnv1a64(w.finish());
}
