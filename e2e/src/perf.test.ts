/**
 * Perf gate (TDD §2 [LOCKED as gates], §12.4) — was a no-op stub until this
 * file. Replays the golden corpus with per-tick timing; tick p95 over the
 * full run must clear the §2 hard gate. Budget values are TUNE; the gate
 * being real is LOCKED.
 *
 * The timed run must reproduce the untimed run's hash — two independent
 * worlds in one process; a mismatch means the harness leaked state between
 * runs or the engine lost determinism. (Both runs share the driver in
 * runner.ts, so "the gate measures the program the golden gate verifies"
 * is structural now.)
 */
import { describe, expect, it } from "vitest";
import { loadScenarios } from "./goldens";
import { runScenario, runScenarioTimed, summarizeDurations } from "./runner";

/** TDD §2: sim tick p95 hard gate (CI fails) — 20 ms [TUNE]. */
const TICK_P95_HARD_GATE_MS = 20;

const scenarios = loadScenarios();

describe.each(scenarios.map((s) => [s.name, s] as const))("perf %s", (name, scenario) => {
  it(`tick p95 ≤ ${TICK_P95_HARD_GATE_MS} ms and timed run matches untimed`, async () => {
    const timed = await runScenarioTimed(scenario, () => performance.now());
    const reference = await runScenario(scenario);
    expect(timed.hash).toBe(reference.hash);

    const summary = summarizeDurations(timed.tickDurationsMs, TICK_P95_HARD_GATE_MS);
    // CI log line — the per-PR record reviewers compare across runs
    // (AI-WORKFLOW §4.2: flag >10% p95 regressions even under gate).
    console.log(
      `[perf] ${name}: ticks=${summary.count} ` +
        `p95=${summary.p95Ms.toFixed(4)}ms p99=${summary.p99Ms.toFixed(4)}ms ` +
        `max=${summary.maxMs.toFixed(4)}ms over${TICK_P95_HARD_GATE_MS}ms=` +
        `${summary.overBudgetCount} (${summary.overBudgetPercent.toFixed(2)}%) ` +
        `total=${(summary.totalMs / 1000).toFixed(2)}s`,
    );
    expect(summary.p95Ms).toBeLessThanOrEqual(TICK_P95_HARD_GATE_MS);
  });
});
