import { defineConfig } from "@playwright/test";

/**
 * Determinism cross-check (TDD §12.6, board task 12): the same golden
 * replays, in Chromium AND WebKit, must reproduce the committed Node
 * hashes. Weekly + on-demand (too slow for per-PR once the corpus grows;
 * the workflow_dispatch hook exists for "I just touched something scary").
 */
export default defineConfig({
  testDir: "./cross-check",
  fullyParallel: false,
  retries: 0, // a flaky determinism check is a broken determinism check
  reporter: process.env.CI ? "github" : "list",
  timeout: 120_000,
  use: {
    baseURL: "http://localhost:4174",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "pnpm exec vite",
    url: "http://localhost:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
