/**
 * Headless golden-city replay runner (TDD §12.1/§12.4).
 *
 * Environment-pure on purpose: no Node-only APIs assumed, no wall clock of
 * its own. The same module runs in Node (per-PR golden + perf gates) and
 * inside Chromium/WebKit pages (board PR 12 determinism cross-check). Timing
 * for the perf gate is injected (`now`) so the sim itself never sees a clock
 * (ADR-005 §5 — the ban applies to packages/sim; the harness may measure).
 */
import type { Command } from "@civitect/protocol";
import { createWorld, runTick, stateHash } from "@civitect/sim";
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

/**
 * Driver yield cadence, in ticks. Long synchronous replays starve vitest's
 * worker RPC on slow runners: the worker fires `onTaskUpdate`, back-to-back
 * synchronous tests then hold the event loop for the rest of the suite
 * (test boundaries only yield microtasks), and the call's expired timeout
 * timer fires ahead of the queued ACK once the loop finally unblocks — a
 * false `Timeout calling "onTaskUpdate"` AFTER every test passed. The timed
 * runner learned this with the balance gate; services-city-01 (a ~50 s
 * replay) pushed the golden suite over the same threshold on PR #64
 * (runs 27445091794 / 27445092588 — 6/6 tests green, job red, twice).
 */
const YIELD_EVERY_TICKS = 25_000;

/** Macrotask yield that works in Node workers and browser pages alike. */
const yieldToEventLoop: () => Promise<void> =
  typeof setImmediate === "function"
    ? () => new Promise((resolve) => setImmediate(resolve))
    : () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * THE scenario driver: canonical (tick, seq) command order, one `runTick`
 * per tick, an event-loop yield every YIELD_EVERY_TICKS — never inside a
 * measured tick. `runScenario` and `runScenarioTimed` are thin wrappers, so
 * "the timed loop replays the same program the golden gate verifies" is now
 * structural rather than asserted. `replay()` itself keeps pinned-hash
 * coverage in packages/sim's own tests.
 */
async function driveScenario(
  scenario: GoldenScenario,
  now: (() => number) | null,
): Promise<{ readonly result: GoldenResult; readonly tickDurationsMs: Float64Array | null }> {
  const log = [...scenario.commands].sort((a, b) =>
    a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick,
  );
  const world = createWorld(
    scenario.seed,
    scenario.mapWidth,
    scenario.mapHeight,
    scenarioTerrain(scenario),
  );
  if (scenario.startingFundsCents !== undefined) {
    // Compressed-script harness money (Phase 5): pre-economy scenarios pack
    // years of construction into tick-0 commands, which no difficulty's
    // starting treasury survives — the scenario states its own funds.
    world.fundsCents = scenario.startingFundsCents;
  }
  const durations = now === null ? null : new Float64Array(scenario.untilTick);
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
    if (now === null || durations === null) {
      rejectionCount += runTick(world, batch).length;
    } else {
      const start = now();
      const rejections = runTick(world, batch);
      durations[tickIndex] = now() - start;
      rejectionCount += rejections.length;
    }
    if (tickIndex % YIELD_EVERY_TICKS === 0) {
      await yieldToEventLoop();
    }
  }
  return {
    result: {
      hash: stateHash(world),
      hud: { tick: world.tick, population: world.population, fundsCents: world.fundsCents },
      rejectionCount,
    },
    tickDurationsMs: durations,
  };
}

export async function runScenario(scenario: GoldenScenario): Promise<GoldenResult> {
  return (await driveScenario(scenario, null)).result;
}

/** `runScenario`, but timing every `runTick` for the TDD §2 tick-p95 gate. */
export async function runScenarioTimed(
  scenario: GoldenScenario,
  now: () => number,
): Promise<TimedResult> {
  const { result, tickDurationsMs } = await driveScenario(scenario, now);
  return { ...result, tickDurationsMs: tickDurationsMs as Float64Array };
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
