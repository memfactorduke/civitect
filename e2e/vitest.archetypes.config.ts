import { defineConfig } from "vitest/config";

// Archetype balance harness (ADR-013 §3, board phase-5 task 6) — its own
// ladder rung. The per-PR run holds 2-game-year bands; the weekly/dispatchable
// run sets GAME_YEARS=20 for the full exit-criterion horizon. testTimeout is
// generous because the long-horizon dispatch reuses this same config.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/archetypes.test.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
});
