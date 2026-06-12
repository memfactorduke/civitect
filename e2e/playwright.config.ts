import { defineConfig } from "@playwright/test";

/**
 * Boot smoke (TDD §12.5): drives the real app — Vite dev server, sim worker,
 * Pixi stage, React overlay — in a real browser. The golden/perf gates stay
 * pure-Node (vitest configs); only the smoke pays the browser tax.
 */
export default defineConfig({
  testDir: "./smoke",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: [
    {
      command: "pnpm --filter @civitect/app dev --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Serves the render-perf harness (same Vite root as the cross-check).
      command: "pnpm exec vite",
      url: "http://localhost:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
