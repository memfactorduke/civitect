/**
 * XXH64 (canonical xxHash, 64-bit variant) — the per-section checksum of the
 * .civ save format (TDD §10, ADR-010). BigInt arithmetic: saves are encoded
 * once per autosave interval, not per tick, so clarity beats micro-speed
 * here (and this module never runs inside the sim tick path).
 *
 * Verified against the reference implementation (python-xxhash) for empty /
 * short / multi-stripe / all-byte-values inputs, seeded and unseeded — see
 * xxhash64.test.ts.
 */

const P1 = 0x9e3779b185ebca87n;
const P2 = 0xc2b2ae3d27d4eb4fn;
const P3 = 0x165667b19e3779f9n;
const P4 = 0x85ebca77c2b2ae63n;
const P5 = 0x27d4eb2f165667c5n;
const MASK = 0xffffffffffffffffn;

function rotl(x: bigint, r: bigint): bigint {
  return ((x << r) | (x >> (64n - r))) & MASK;
}

function round(acc: bigint, input: bigint): bigint {
  return (rotl((acc + input * P2) & MASK, 31n) * P1) & MASK;
}

function mergeRound(acc: bigint, val: bigint): bigint {
  return ((acc ^ round(0n, val)) * P1 + P4) & MASK;
}

function readU64(bytes: Uint8Array, i: number): bigint {
  // Little-endian, as the reference implementation reads stripes.
  let v = 0n;
  for (let b = 7; b >= 0; b--) {
    v = (v << 8n) | BigInt(bytes[i + b] as number);
  }
  return v;
}

function readU32(bytes: Uint8Array, i: number): bigint {
  return BigInt(
    ((bytes[i] as number) | ((bytes[i + 1] as number) << 8) | ((bytes[i + 2] as number) << 16)) +
      (bytes[i + 3] as number) * 0x1000000,
  );
}

/** XXH64 of `bytes` with optional seed; returns the unsigned 64-bit hash. */
export function xxh64(bytes: Uint8Array, seed = 0n): bigint {
  const len = bytes.length;
  let i = 0;
  let h: bigint;

  if (len >= 32) {
    let v1 = (seed + P1 + P2) & MASK;
    let v2 = (seed + P2) & MASK;
    let v3 = seed & MASK;
    let v4 = (seed - P1) & MASK;
    for (; i + 32 <= len; i += 32) {
      v1 = round(v1, readU64(bytes, i));
      v2 = round(v2, readU64(bytes, i + 8));
      v3 = round(v3, readU64(bytes, i + 16));
      v4 = round(v4, readU64(bytes, i + 24));
    }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & MASK;
    h = mergeRound(h, v1);
    h = mergeRound(h, v2);
    h = mergeRound(h, v3);
    h = mergeRound(h, v4);
  } else {
    h = (seed + P5) & MASK;
  }

  h = (h + BigInt(len)) & MASK;

  for (; i + 8 <= len; i += 8) {
    h = (rotl(h ^ round(0n, readU64(bytes, i)), 27n) * P1 + P4) & MASK;
  }
  if (i + 4 <= len) {
    h = (rotl(h ^ ((readU32(bytes, i) * P1) & MASK), 23n) * P2 + P3) & MASK;
    i += 4;
  }
  for (; i < len; i++) {
    h = (rotl(h ^ ((BigInt(bytes[i] as number) * P5) & MASK), 11n) * P1) & MASK;
  }

  h ^= h >> 33n;
  h = (h * P2) & MASK;
  h ^= h >> 29n;
  h = (h * P3) & MASK;
  h ^= h >> 32n;
  return h;
}

/** Hash as fixed-width lowercase hex — the form pinned in tests and tooling. */
export function xxh64Hex(bytes: Uint8Array, seed = 0n): string {
  return xxh64(bytes, seed).toString(16).padStart(16, "0");
}
