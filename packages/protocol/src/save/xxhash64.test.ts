import { describe, expect, it } from "vitest";
import { utf8Encode } from "../bytes/utf8";
import { xxh64Hex } from "./xxhash64";

/**
 * Reference vectors generated with python-xxhash (canonical bindings) —
 * seed 0 and seed 2654435761 (Knuth's u32, exercises seeded init):
 * inputs chosen to cover every code path: empty, <4, <8 tail, ≥32 stripe
 * loop with 4+8-byte tails (62 bytes), and all byte values (256 bytes).
 */
const ALPHANUM = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SEED = 2654435761n;

describe("xxh64 against reference vectors (python-xxhash)", () => {
  const vectors: [Uint8Array, string, string][] = [
    [new Uint8Array(0), "ef46db3751d8e999", "ac75fda2929b17ef"],
    [utf8Encode("a"), "d24ec4f1a98c6e5b", "393da8b78992279b"],
    [utf8Encode("abc"), "44bc2cf5ad770999", "1318df30094a85fd"],
    [utf8Encode(ALPHANUM), "7639d419de614eed", "82fb2cae7e35c906"],
    [Uint8Array.from({ length: 256 }, (_, i) => i), "1facbe8406cd904b", "d48195f45908996c"],
  ];

  it.each(
    vectors.map(([input, s0, s1], i) => [i, input, s0, s1] as const),
  )("vector %d", (_i, input, expectedSeed0, expectedSeeded) => {
    expect(xxh64Hex(input)).toBe(expectedSeed0);
    expect(xxh64Hex(input, SEED)).toBe(expectedSeeded);
  });

  it("single-bit flips move the hash (checksum sensitivity)", () => {
    const base = Uint8Array.from({ length: 64 }, (_, i) => i);
    const flipped = Uint8Array.from(base);
    flipped[40] = (flipped[40] as number) ^ 0x01;
    expect(xxh64Hex(flipped)).not.toBe(xxh64Hex(base));
  });
});
