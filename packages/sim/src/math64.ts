/**
 * 64-bit unsigned integer arithmetic on (hi, lo) u32 limb pairs.
 *
 * JS numbers lose integer exactness past 2^53, so the PCG32 state walk and
 * FNV-1a hashing (both genuinely 64-bit) run on limbs with 16-bit partial
 * products — integer-exact on every engine, which is the whole point
 * (ADR-005). The multiply is the long.js formulation: carries are extracted
 * after every single addition so no intermediate exceeds 2^33.
 */

export interface U64 {
  hi: number;
  lo: number;
}

export function add64(aHi: number, aLo: number, bHi: number, bLo: number): U64 {
  const lo = (aLo >>> 0) + (bLo >>> 0); // ≤ 2^33, exact in float
  const carry = lo >= 0x1_0000_0000 ? 1 : 0;
  return { hi: (aHi + bHi + carry) >>> 0, lo: lo >>> 0 };
}

export function mul64(aHi: number, aLo: number, bHi: number, bLo: number): U64 {
  const a48 = aHi >>> 16;
  const a32 = aHi & 0xffff;
  const a16 = aLo >>> 16;
  const a00 = aLo & 0xffff;
  const b48 = bHi >>> 16;
  const b32 = bHi & 0xffff;
  const b16 = bLo >>> 16;
  const b00 = bLo & 0xffff;

  let c48 = 0;
  let c32 = 0;
  let c16 = 0;
  let c00 = 0;
  c00 += a00 * b00;
  c16 += c00 >>> 16;
  c00 &= 0xffff;
  c16 += a16 * b00;
  c32 += c16 >>> 16;
  c16 &= 0xffff;
  c16 += a00 * b16;
  c32 += c16 >>> 16;
  c16 &= 0xffff;
  c32 += a32 * b00;
  c48 += c32 >>> 16;
  c32 &= 0xffff;
  c32 += a16 * b16;
  c48 += c32 >>> 16;
  c32 &= 0xffff;
  c32 += a00 * b32;
  c48 += c32 >>> 16;
  c32 &= 0xffff;
  c48 += a48 * b00 + a32 * b16 + a16 * b32 + a00 * b48;
  c48 &= 0xffff;

  return { hi: (((c48 << 16) | c32) >>> 0) >>> 0, lo: (((c16 << 16) | c00) >>> 0) >>> 0 };
}

/** Hex rendering of a u64 limb pair (16 lowercase digits) — the state-hash output format. */
export function hex64(hi: number, lo: number): string {
  return (hi >>> 0).toString(16).padStart(8, "0") + (lo >>> 0).toString(16).padStart(8, "0");
}
