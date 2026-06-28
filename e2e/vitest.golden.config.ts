import { defineConfig } from "vitest/config";

// Golden gate runs separately from `pnpm test` (unit) — gates are slower and
// have their own CI rung in the ADR-013 ladder.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/golden.test.ts", "src/scenario.test.ts"],
    testTimeout: 120_000,
  },
});
