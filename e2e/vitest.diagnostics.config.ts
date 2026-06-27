import { defineConfig } from "vitest/config";

// GDD §17.1/§17.4: advisor warnings must be diagnosable from current world data.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/diagnosability.test.ts"],
    testTimeout: 240_000,
  },
});
