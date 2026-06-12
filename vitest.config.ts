import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node-mode for everything for now (ADR-007: no browser overhead in the hot
    // loop). Renderer/UI packages add their own browser-ish environments when
    // their real implementations land (docs/board/phase-0.md PR 5/6).
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
  },
});
