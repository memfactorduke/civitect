/**
 * Perf gate (TDD §2 [LOCKED as gates], §12.4) — was a no-op stub until this
 * file. Replays the golden corpus with per-tick timing; tick p95 over the
 * full run must clear the §2 hard gate. Budget values are TUNE; the gate
 * being real is LOCKED.
 *
 * The timed loop must produce the exact replay() hash — otherwise the gate
 * would be measuring a different program than the one the golden gate
 * verifies.
 */
import { describe, expect, it } from "vitest";
import { loadScenarios } from "./goldens";
import { percentile, runScenario, runScenarioTimed } from "./runner";

/** TDD §2: sim tick p95 hard gate (CI fails) — 20 ms [TUNE]. */
const TICK_P95_HARD_GATE_MS = 20;

const scenarios = loadScenarios();

describe.each(scenarios.map((s) => [s.name, s] as const))("perf %s", (name, scenario) => {
  it(`tick p95 ≤ ${TICK_P95_HARD_GATE_MS} ms and timed loop matches replay()`, async () => {
    const timed = await runScenarioTimed(scenario, () => performance.now());
    const reference = runScenario(scenario);
    expect(timed.hash).toBe(reference.hash);

    const p95 = percentile(timed.tickDurationsMs, 0.95);
    const p99 = percentile(timed.tickDurationsMs, 0.99);
    let max = 0;
    let sum = 0;
    for (const d of timed.tickDurationsMs) {
      if (d > max) max = d;
      sum += d;
    }
    // CI log line — the per-PR record reviewers compare across runs
    // (AI-WORKFLOW §4.2: flag >10% p95 regressions even under gate).
    console.log(
      `[perf] ${name}: ticks=${timed.tickDurationsMs.length} ` +
        `p95=${p95.toFixed(4)}ms p99=${p99.toFixed(4)}ms max=${max.toFixed(4)}ms ` +
        `total=${(sum / 1000).toFixed(2)}s`,
    );
    expect(p95).toBeLessThanOrEqual(TICK_P95_HARD_GATE_MS);
  });
});
