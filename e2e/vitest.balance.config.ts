import { defineConfig } from "vitest/config";

// Balance simulations (ADR-013 §3) — their own ladder rung, like golden/perf.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/balance.test.ts"],
    testTimeout: 600_000,
  },
});
