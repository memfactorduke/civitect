/**
 * Headless golden-city replay runner (TDD §12.1/§12.4).
 *
 * Environment-pure on purpose: no Node APIs, no wall clock of its own. The
 * same module runs in Node (per-PR golden + perf gates) and inside
 * Chromium/WebKit pages (board PR 12 determinism cross-check). Timing for
 * the perf gate is injected (`now`) so the sim itself never sees a clock
 * (ADR-005 §5 — the ban applies to packages/sim; the harness may measure).
 */
import type { Command } from "@civitect/protocol";
import { createWorld, replay, runTick, stateHash } from "@civitect/sim";
import { type GoldenScenario, scenarioTerrain } from "./scenario";

/** HUD-scalar baseline recorded next to each golden hash — the balance-diff input. */
export interface HudBaseline {
  readonly tick: number;
  readonly population: number;
  readonly fundsCents: number;
}

export interface GoldenResult {
  readonly hash: string;
  readonly hud: HudBaseline;
  readonly rejectionCount: number;
}

export interface TimedResult extends GoldenResult {
  /** Per-tick durations in ms, in tick order. Length === scenario.untilTick. */
  readonly tickDurationsMs: Float64Array;
}

export function runScenario(scenario: GoldenScenario): GoldenResult {
  const { world, rejections } = replay(scenario.seed, scenario.commands, scenario.untilTick, {
    mapWidth: scenario.mapWidth,
    mapHeight: scenario.mapHeight,
    terrain: scenarioTerrain(scenario),
  });
  return {
    hash: stateHash(world),
    hud: { tick: world.tick, population: world.population, fundsCents: world.fundsCents },
    rejectionCount: rejections.length,
  };
}

/**
 * Same replay semantics as `runScenario` (the perf test asserts the hashes
 * agree — a timed loop that drifted from `replay` would measure fiction),
 * but timing every `runTick` for the TDD §2 tick-p95 gate.
 */
export async function runScenarioTimed(
  scenario: GoldenScenario,
  now: () => number,
): Promise<TimedResult> {
  const log = [...scenario.commands].sort((a, b) =>
    a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick,
  );
  const world = createWorld(
    scenario.seed,
    scenario.mapWidth,
    scenario.mapHeight,
    scenarioTerrain(scenario),
  );
  const durations = new Float64Array(scenario.untilTick);
  let rejectionCount = 0;
  let cursor = 0;
  const batch: Command[] = [];
  while (world.tick < scenario.untilTick) {
    batch.length = 0;
    while (cursor < log.length && (log[cursor] as Command).tick === world.tick) {
      batch.push(log[cursor] as Command);
      cursor++;
    }
    const tickIndex = world.tick;
    const start = now();
    const rejections = runTick(world, batch);
    durations[tickIndex] = now() - start;
    rejectionCount += rejections.length;
    // Yield the event loop between ticks — long synchronous replays starve
    // vitest's worker RPC on slow runners (the balance gate's lesson).
    // Yields never land inside a measured tick.
    if (tickIndex % 25_000 === 0) {
      await new Promise(setImmediate);
    }
  }
  return {
    hash: stateHash(world),
    hud: { tick: world.tick, population: world.population, fundsCents: world.fundsCents },
    rejectionCount,
    tickDurationsMs: durations,
  };
}

/** p-th percentile (0 < p ≤ 1) by nearest-rank over a copy — input untouched. */
export function percentile(samples: Float64Array, p: number): number {
  if (samples.length === 0) {
    throw new Error("percentile of zero samples");
  }
  if (!(p > 0 && p <= 1)) {
    throw new Error(`percentile p must be in (0, 1], got ${p}`);
  }
  const sorted = Float64Array.from(samples).sort();
  return sorted[Math.ceil(p * sorted.length) - 1] as number;
}
