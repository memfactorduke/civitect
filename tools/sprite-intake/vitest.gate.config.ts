import { defineConfig } from "vitest/config";

// The asset CI gate (ADR-013 ladder rung) — separate from `pnpm test` like
// the golden/perf gates: gates get their own rungs. Keep the gate self-contained:
// it scans committed sprites and runs the intake validator/PNG regression proofs.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/gate.test.ts", "src/png.test.ts", "src/validate.test.ts"],
    testTimeout: 120_000,
  },
});
