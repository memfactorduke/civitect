/**
 * @civitect/sim — pure deterministic simulation core (TDD §3/§4, ADR-005/006).
 * Runs identically in a Web Worker (production) and Node (tests/tools).
 *
 * Hard rules (lint-enforced via the scoped ESLint config + this package's
 * DOM-free tsconfig): no Math.random, no transcendentals, no wall clock,
 * no DOM/Pixi, no object-key iteration over sim state, money in integer
 * cents. PCG32 streams via ./rng only.
 */
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
  addEdge,
  addNode,
  type CanonicalEdge,
  type CanonicalGraph,
  canonicalGraph,
  createRoadGraph,
  edgesOf,
  nodeAt,
  otherEnd,
  ROAD_CLASS_SPEC,
  RoadClass,
  type RoadGraph,
  removeEdge,
  removeNode,
} from "./roads/graph";
export { toSnapshot } from "./snapshot";
export {
  createWorld,
  runTick,
  SIM_SPEEDS,
  stateHash,
  TICK_HZ,
  TICKS_PER_GAME_YEAR,
  type World,
} from "./world";
