import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node-mode by default (ADR-007: no browser overhead in the hot loop).
    // Component tests opt into jsdom per-file via `// @vitest-environment
    // jsdom` (packages/ui RTL tests) — the sim/protocol hot path never pays
    // the DOM tax.
    environment: "node",
    include: ["packages/*/src/**/*.test.{ts,tsx}", "tools/*/src/**/*.test.{ts,tsx}"],
    // Gate suites run on their own ADR-013 rungs (gate:assets), not under unit.
    exclude: ["**/node_modules/**", "tools/*/src/gate.test.ts"],
  },
});
