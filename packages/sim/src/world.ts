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
  RejectionReason,
} from "@civitect/protocol";
import { fnv1a64 } from "./hash";
import { createRng, type Pcg32, RNG_STREAM_NAMES, type RngStreamName } from "./rng";

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
  readonly rng: Readonly<Record<RngStreamName, Pcg32>>;
}

export function createWorld(
  seed: number,
  mapWidth = DEFAULT_MAP_SIZE,
  mapHeight = DEFAULT_MAP_SIZE,
): World {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new Error(`world seed must be a non-negative safe integer, got ${seed}`);
  }
  if (!isU16Dim(mapWidth) || !isU16Dim(mapHeight)) {
    throw new Error(`map dimensions must be in [1, 65535], got ${mapWidth}×${mapHeight}`);
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
    rng,
  };
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
  return fnv1a64(w.finish());
}
