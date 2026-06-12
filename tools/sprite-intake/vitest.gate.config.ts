import { defineConfig } from "vitest/config";

// The asset CI gate (ADR-013 ladder rung) — separate from `pnpm test` like
// the golden/perf gates: gates get their own rungs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/gate.test.ts"],
    testTimeout: 120_000,
  },
});
