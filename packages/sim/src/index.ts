/**
 * @civitect/sim — pure deterministic simulation core (TDD §3/§4, ADR-005/006).
 * Runs identically in a Web Worker (production) and Node (tests/tools).
 *
 * Hard rules (lint-enforced via the scoped ESLint config + this package's
 * DOM-free tsconfig): no Math.random, no transcendentals, no wall clock,
 * no DOM/Pixi, no object-key iteration over sim state, money in integer
 * cents. PCG32 streams via ./rng only.
 */

export {
  AGENT_POOL_CAP,
  AgentKindSim,
  type AgentPool,
  clearAgentPool,
  createAgentPool,
  MAX_PINS,
  PED_SPEED_MILLI,
  SAMPLE_EVERY_TICKS,
  updateAgents,
  VIEW_MARGIN_TILES,
  type Viewport,
} from "./agents/pool";
export {
  adultsOf,
  BuildingStatus,
  type Buildings,
  COHORT_BLOCK,
  capacityFor,
  createBuildings,
  employedOf,
  PLOPPABLE_KIND_OFFSET,
  residentsOf,
  spawnBuilding,
} from "./growth/buildings";
export { type CityAggregates, computeDemand } from "./growth/demand";
export { aggregates, TICKS_PER_DAY, TICKS_PER_HOUR } from "./growth/system";
export { computeUtilities, type UtilityState, utilityDemand } from "./growth/utilities";
export { fnv1a64 } from "./hash";
export { add64, hex64, mul64, type U64 } from "./math64";
export { type ReplayOptions, type ReplayResult, replay } from "./replay";
export {
  createRng,
  Pcg32,
  type Pcg32State,
  RNG_STREAM_NAMES,
  RngStream,
  type RngStreamName,
} from "./rng";
export {
  type Pt,
  pointOnSegment,
  type SegmentRelation,
  segmentRelation,
  supercoverTiles,
} from "./roads/geometry";
export {
  addEdge,
  addNode,
  BRIDGE_CLASS_OFFSET,
  baseClass,
  type CanonicalEdge,
  type CanonicalGraph,
  canonicalGraph,
  createRoadGraph,
  edgesOf,
  isBridgeClass,
  nodeAt,
  otherEnd,
  ROAD_CLASS_SPEC,
  RoadClass,
  type RoadGraph,
  removeEdge,
  removeNode,
} from "./roads/graph";
export {
  createPathfinder,
  dijkstraField,
  edgeCost,
  findPath,
  type Pathfinder,
  type PathResult,
} from "./roads/pathfind";
export {
  anchorNode,
  computeCoverageField,
  computeDistanceGroups,
  coverageAtTile,
  coverageFor,
  createCoverageCache,
  type DistanceGroups,
  decay,
  distancesFor,
  roadTileDistances,
  SERVICE_REACH,
  type ServiceCoverageCache,
  type ServiceFieldInputs,
} from "./services/coverage";
export {
  BASE_SICK_PERMILLE,
  CORPSES_PER_HEARSE_PER_DAY,
  EDUCATION_DAYS,
  emptyServiceFlows,
  GARBAGE_TOLERANCE,
  garbagePerDay,
  SERVICE_SLICES,
  type ServiceFlows,
  type ServicesContext,
  SICK_MORTALITY_PERMILLE,
  servicesSlice,
  sliceShare,
  TRUCK_CLEAR_PER_DAY,
} from "./services/loops";
export {
  AIR_PER_INDUSTRY_LEVEL,
  airFor,
  computeAirField,
  computeNoiseField,
  computeWaterField,
  createPollutionCache,
  crisisFor,
  fieldDigestU32,
  findPumpCrisis,
  GROUND_DECAY_DAYS,
  GROUND_PER_INDUSTRY_DAY,
  noiseFor,
  type PollutionCache,
  type PollutionInputs,
  SICK_WATER_CRISIS,
  sewageBalance,
  WATER_AT_OUTLET,
  WIND_DRIFT_X,
  waterFor,
} from "./services/pollution";
export {
  budgetScalePermille,
  SERVICE_BUILDING_SPECS,
  type ServiceBuildingSpec,
  STREET_TILE_COST,
  scaledCapacity,
  scaledRadius,
  specForTableKind,
} from "./services/registry";
export { toSnapshot } from "./snapshot";
export { bprCost, CELL_TILES, type Cell } from "./traffic/assignment";
export {
  createTraffic,
  FULL_SOLVE_HOUR,
  FULL_SOLVE_PASSES,
  MSA_K_CAP,
  ORIGINS_PER_TICK,
  refreshTrafficDerived,
  type SolveJob,
  SolveKind,
  startSolveJob,
  stepSolveJob,
  type TrafficCore,
  trafficFromSave,
  trafficToSave,
} from "./traffic/solver";
export {
  controlAt,
  createWorld,
  edgeAtTile,
  IntersectionControl,
  pollutionAt,
  pollutionField,
  type RoadOp,
  runTick,
  type SegRecord,
  SIM_SPEEDS,
  serviceCoverage,
  serviceCoverageAt,
  stateHash,
  TICK_HZ,
  TICKS_PER_GAME_YEAR,
  type World,
  worldHasBuildings,
} from "./world";
