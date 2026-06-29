import { describe, expect, it } from "vitest";
import { fractalNoise, latticeHash, valueNoise } from "./noise";

describe("deterministic map noise", () => {
  it("keeps pinned lattice hash outputs stable", () => {
    expect(latticeHash(12345, 10, 20)).toBe(2441668967);
    expect(latticeHash(0xdecafbad, -13, 91)).toBe(1218492781);
  });

  it("keeps value and fractal noise in the byte range", () => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const value = valueNoise(12345, x, y, 8);
        const fractal = fractalNoise(12345, x, y, 32, 4);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(255);
        expect(fractal).toBeGreaterThanOrEqual(0);
        expect(fractal).toBeLessThanOrEqual(255);
      }
    }
  });

  it("pins representative interpolated outputs", () => {
    expect(valueNoise(12345, 11, 23, 16)).toBe(166);
    expect(valueNoise(12345, 32, 48, 16)).toBe(23);
    expect(fractalNoise(12345, 40, 77, 64, 4)).toBe(150);
    expect(fractalNoise(0xdecafbad, 255, 0, 128, 5)).toBe(174);
  });

  it("rejects invalid noise scales before generating map data", () => {
    expect(() => valueNoise(1, 0, 0, 0)).toThrow(RangeError);
    expect(() => valueNoise(1, 0, 0, 1.5)).toThrow(RangeError);
    expect(() => fractalNoise(1, 0, 0, 1, 4)).toThrow(RangeError);
    expect(() => fractalNoise(1, 0, 0, 32, 0)).toThrow(RangeError);
  });
});
