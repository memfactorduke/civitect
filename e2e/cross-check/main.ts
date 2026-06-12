/**
 * Browser side of the determinism cross-check (TDD §12.6, ADR-005): the
 * IDENTICAL runner module the Node golden gate executes, loaded into
 * Chromium/WebKit pages. The spec feeds scenarios in and compares hashes
 * against the committed corpus — engine float/JIT surprises have nowhere
 * to hide.
 */
import { type GoldenResult, runScenario } from "../src/runner";
import { parseScenario } from "../src/scenario";

declare global {
  interface Window {
    __runGolden?: (doc: unknown) => GoldenResult;
  }
}

window.__runGolden = (doc: unknown): GoldenResult => {
  const scenario = parseScenario(doc, "cross-check");
  return runScenario(scenario);
};
