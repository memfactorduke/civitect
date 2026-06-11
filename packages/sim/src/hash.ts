/**
 * FNV-1a 64-bit over a canonical byte serialization of world state — the
 * replay/golden comparison hash (ADR-013 §1). Limb arithmetic keeps it
 * integer-exact on every engine.
 *
 * This is the cheap structural hash for "did two replays agree". The save
 * format's per-section checksums (xxhash64, TDD §10) arrive with board PR 8.
 */
import { hex64, mul64 } from "./math64";

const FNV_OFFSET_HI = 0xcbf29ce4;
const FNV_OFFSET_LO = 0x84222325;
const FNV_PRIME_HI = 0x00000100;
const FNV_PRIME_LO = 0x000001b3;

/** Returns the hash as a 16-digit lowercase hex string. */
export function fnv1a64(bytes: Uint8Array): string {
  let hi = FNV_OFFSET_HI;
  let lo = FNV_OFFSET_LO;
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ (bytes[i] ?? 0)) >>> 0;
    const m = mul64(hi, lo, FNV_PRIME_HI, FNV_PRIME_LO);
    hi = m.hi;
    lo = m.lo;
  }
  return hex64(hi, lo);
}
