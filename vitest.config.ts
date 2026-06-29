import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node-mode by default (ADR-007: no browser overhead in the hot loop).
    // Component tests opt into jsdom per-file via `// @vitest-environment
    // jsdom` (packages/ui RTL tests) — the sim/protocol hot path never pays
    // the DOM tax.
    environment: "node",
    // Heavy sim integration tests legitimately exceed Vitest's 5s default under
    // CI-runner timing variance — e.g. economy/chain.test.ts runs ~13 game-days
    // (~18k ticks of a 64×64 city) and measures ~1.8s locally but >5s on shared
    // CI runners, which silently red-gated `main` and every PR. Raise the per-test
    // budget so runner slowness is not a failure; a genuine hang still trips at 30s.
    // (Per-tick perf is gated separately by gate:perf, TDD §2/§12.4.)
    testTimeout: 30_000,
    include: ["packages/*/src/**/*.test.{ts,tsx}", "tools/*/src/**/*.test.{ts,tsx}"],
    // Gate suites run on their own ADR-013 rungs (gate:assets), not under unit.
    exclude: ["**/node_modules/**", "tools/*/src/gate.test.ts"],
  },
});
