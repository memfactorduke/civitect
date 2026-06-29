import { describe, expect, it } from "vitest";
import {
  BOOT,
  createBootConfig,
  MAX_BOOT_MAP_AREA,
  MAX_BOOT_MAP_TILES,
  MIN_BOOT_MAP_TILES,
} from "./boot-config";

describe("boot config validation", () => {
  it("keeps the current default city stable", () => {
    expect(BOOT).toEqual({ seed: 1234, mapWidth: 64, mapHeight: 64 });
    expect(Object.isFrozen(BOOT)).toBe(true);
  });

  it("accepts the launch catalog map size envelope", () => {
    expect(
      createBootConfig({
        seed: 42,
        mapWidth: MAX_BOOT_MAP_TILES,
        mapHeight: MAX_BOOT_MAP_TILES,
      }),
    ).toEqual({
      seed: 42,
      mapWidth: MAX_BOOT_MAP_TILES,
      mapHeight: MAX_BOOT_MAP_TILES,
    });
  });

  it("rejects invalid seeds before the worker starts", () => {
    expect(() => createBootConfig({ seed: -1, mapWidth: 64, mapHeight: 64 })).toThrow(
      /seed must be non-negative/,
    );
    expect(() => createBootConfig({ seed: 1.5, mapWidth: 64, mapHeight: 64 })).toThrow(
      /seed must be a safe integer/,
    );
  });

  it("rejects impossible map dimensions before renderer allocation", () => {
    expect(() =>
      createBootConfig({ seed: 1, mapWidth: MIN_BOOT_MAP_TILES - 1, mapHeight: 64 }),
    ).toThrow(/at least/);
    expect(() =>
      createBootConfig({ seed: 1, mapWidth: 64, mapHeight: MAX_BOOT_MAP_TILES + 1 }),
    ).toThrow(/at most/);
    expect(() => createBootConfig({ seed: 1, mapWidth: 64.5, mapHeight: 64 })).toThrow(
      /mapWidth must be a safe integer/,
    );
  });

  it("keeps the area budget aligned with the largest supported square map", () => {
    expect(MAX_BOOT_MAP_AREA).toBe(MAX_BOOT_MAP_TILES * MAX_BOOT_MAP_TILES);
  });
});
