import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Pcg32 } from "./rng";

describe("Pcg32", () => {
  it("matches the official PCG32 reference vectors (seed 42, sequence 54)", () => {
    // First outputs of pcg32_random_r after pcg32_srandom_r(42, 54) — the
    // canonical pcg_basic demo values. If these pass, the 64-bit limb math
    // is correct on this engine; the weekly cross-engine run (TDD §12.6)
    // extends that to "on every engine".
    const rng = Pcg32.seeded(42, 54);
    const expected = [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e];
    for (const value of expected) {
      expect(rng.nextU32()).toBe(value);
    }
  });

  it("same seed + same stream ⇒ identical sequence (property)", () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.nat({ max: 1000 }), (seed, stream) => {
        const a = Pcg32.seeded(seed, stream);
        const b = Pcg32.seeded(seed, stream);
        for (let i = 0; i < 50; i++) {
          expect(b.nextU32()).toBe(a.nextU32());
        }
      }),
    );
  });

  it("same seed, different streams ⇒ different sequences", () => {
    const a = Pcg32.seeded(42, 0);
    const b = Pcg32.seeded(42, 1);
    const aOut = Array.from({ length: 10 }, () => a.nextU32());
    const bOut = Array.from({ length: 10 }, () => b.nextU32());
    expect(aOut).not.toEqual(bOut);
  });

  it("state round-trips through fromState (save/load path)", () => {
    const original = Pcg32.seeded(7, 3);
    original.nextU32();
    original.nextU32();
    const restored = Pcg32.fromState(original.state());
    for (let i = 0; i < 20; i++) {
      expect(restored.nextU32()).toBe(original.nextU32());
    }
  });

  it("nextBounded stays in range and is deterministic (property)", () => {
    fc.assert(
      fc.property(fc.maxSafeNat(), fc.integer({ min: 1, max: 0xffffffff }), (seed, bound) => {
        const a = Pcg32.seeded(seed, 0);
        const b = Pcg32.seeded(seed, 0);
        for (let i = 0; i < 20; i++) {
          const v = a.nextBounded(bound);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(bound);
          expect(b.nextBounded(bound)).toBe(v);
        }
      }),
    );
  });

  it("rejects invalid seeds and bounds", () => {
    expect(() => Pcg32.seeded(-1, 0)).toThrow();
    expect(() => Pcg32.seeded(1.5, 0)).toThrow();
    expect(() => Pcg32.seeded(Number.MAX_SAFE_INTEGER + 2, 0)).toThrow();
    const rng = Pcg32.seeded(1, 0);
    expect(() => rng.nextBounded(0)).toThrow();
    expect(() => rng.nextBounded(0x1_0000_0001)).toThrow();
    expect(() => rng.nextBounded(1.5)).toThrow();
  });
});
