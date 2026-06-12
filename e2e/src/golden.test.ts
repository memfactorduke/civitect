/**
 * THE golden-master gate (ADR-013 §1, TDD §12.1) — was a no-op stub until
 * this file. Every golden city replays headlessly; its final state hash must
 * match `goldens/hashes.json` bit-exactly.
 *
 * `pnpm bless` (BLESS=1) re-pins hashes + HUD baselines and regenerates
 * `reports/balance-diff.md`. Blessing changed behavior is Mem's call, never
 * an agent's (AI-WORKFLOW §1) — agents may only bless brand-new goldens.
 */
import { describe, expect, it } from "vitest";
import { bless, isBlessRun, loadExpectations, loadScenarios } from "./goldens";
import { type GoldenResult, runScenario } from "./runner";

const scenarios = loadScenarios();
const blessing = isBlessRun();
const expectations = blessing
  ? (() => {
      try {
        return loadExpectations();
      } catch {
        return null; // first bless of a fresh corpus
      }
    })()
  : loadExpectations();

const results = new Map<string, GoldenResult>();

describe.each(scenarios.map((s) => [s.name, s] as const))("golden %s", (name, scenario) => {
  it(
    blessing ? "replays (blessing — hash will be pinned)" : "replays to the committed hash",
    async () => {
      const result = await runScenario(scenario);
      results.set(name, result);
      expect(result.hud.tick).toBe(scenario.untilTick);
      if (!blessing) {
        const expected = expectations?.[name];
        if (expected === undefined) {
          throw new Error(`golden "${name}" has no committed hash — run pnpm bless and commit`);
        }
        // Bit-exact or bust: a mismatch is either a real behavior change
        // (re-bless with Mem's sign-off) or broken determinism (stop the line).
        expect(result.hash).toBe(expected.hash);
        expect(result.hud).toEqual(expected.hud);
      }
    },
  );
});

if (blessing) {
  describe("bless", () => {
    it("pins observed hashes and writes the balance-diff report", () => {
      expect(results.size).toBe(scenarios.length);
      bless(results, expectations);
    });
  });
}
