import { defineConfig } from "vite";

// Serves the determinism cross-check harness page (TDD §12.6) — the only
// browser-served thing in e2e; golden/perf gates stay pure Node.
export default defineConfig({
  root: "cross-check",
  server: {
    port: 4174,
    strictPort: true,
  },
});
