import { defineConfig } from "vitest/config";

// Perf gate: single-threaded, isolated file, generous timeout — timing noise
// from sibling workers would show up as fake regressions.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/perf.test.ts", "src/metro-perf.test.ts"],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
