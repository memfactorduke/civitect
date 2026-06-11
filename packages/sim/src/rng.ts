/**
 * PCG32 (XSH RR 64/32) — the only randomness allowed in the sim (ADR-005 §3).
 *
 * One independent stream per system so systems can be re-run and tested in
 * isolation; stream selection is PCG's native sequence parameter, so streams
 * from one seed never correlate. Port of pcg_basic.c, verified against the
 * official reference vectors in rng.test.ts.
 *
 * Stream ids are append-only — reordering them changes every golden city.
 */
import { add64, mul64, type U64 } from "./math64";

// PCG32 multiplier 6364136223846793005 as u32 limbs.
const MULT_HI = 0x5851f42d;
const MULT_LO = 0x4c957f2d;

export const RngStream = {
  growth: 0,
  traffic: 1,
  agents: 2,
  services: 3,
  events: 4,
} as const;
export type RngStreamName = keyof typeof RngStream;

/** Fixed iteration order for hashing/serialization — never Object.keys (ADR-005 §4). */
export const RNG_STREAM_NAMES: readonly RngStreamName[] = [
  "growth",
  "traffic",
  "agents",
  "services",
  "events",
];

export class Pcg32 {
  #stateHi = 0;
  #stateLo = 0;
  #incHi: number;
  #incLo: number;

  private constructor(incHi: number, incLo: number) {
    this.#incHi = incHi;
    this.#incLo = incLo;
  }

  /** pcg32_srandom_r: seed (u53-safe integer) + sequence id select the stream. */
  static seeded(seed: number, sequence: number): Pcg32 {
    if (!Number.isSafeInteger(seed) || seed < 0) {
      throw new Error(`Pcg32 seed must be a non-negative safe integer, got ${seed}`);
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error(`Pcg32 sequence must be a non-negative safe integer, got ${sequence}`);
    }
    const seqHi = Math.floor(sequence / 0x1_0000_0000) >>> 0;
    const seqLo = sequence >>> 0;
    // inc = (initseq << 1) | 1 — must be odd.
    const rng = new Pcg32(((seqHi << 1) | (seqLo >>> 31)) >>> 0, ((seqLo << 1) | 1) >>> 0);
    rng.nextU32();
    const seedHi = Math.floor(seed / 0x1_0000_0000) >>> 0;
    const state = add64(rng.#stateHi, rng.#stateLo, seedHi, seed >>> 0);
    rng.#stateHi = state.hi;
    rng.#stateLo = state.lo;
    rng.nextU32();
    return rng;
  }

  /** Restore from a state tuple (save/load, state hashing). */
  static fromState(state: Readonly<Pcg32State>): Pcg32 {
    const rng = new Pcg32(state.incHi >>> 0, state.incLo >>> 0);
    rng.#stateHi = state.stateHi >>> 0;
    rng.#stateLo = state.stateLo >>> 0;
    return rng;
  }

  /** pcg32_random_r: output is computed from the PRE-advance state. */
  nextU32(): number {
    const oldHi = this.#stateHi;
    const oldLo = this.#stateLo;
    const multiplied: U64 = mul64(oldHi, oldLo, MULT_HI, MULT_LO);
    const next = add64(multiplied.hi, multiplied.lo, this.#incHi, this.#incLo);
    this.#stateHi = next.hi;
    this.#stateLo = next.lo;
    // xorshifted = (u32)(((oldstate >> 18) ^ oldstate) >> 27)
    const x18Hi = (oldHi >>> 18) ^ oldHi;
    const x18Lo = (((oldHi << 14) | (oldLo >>> 18)) ^ oldLo) >>> 0;
    const xorshifted = ((x18Hi << 5) | (x18Lo >>> 27)) >>> 0;
    const rot = oldHi >>> 27; // oldstate >> 59
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform integer in [0, bound) via rejection sampling — unbiased, reference algorithm. */
  nextBounded(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x1_0000_0000) {
      throw new Error(`nextBounded: bound must be an integer in [1, 2^32], got ${bound}`);
    }
    const threshold = (0x1_0000_0000 - bound) % bound;
    for (;;) {
      const r = this.nextU32();
      if (r >= threshold) {
        return r % bound;
      }
    }
  }

  state(): Pcg32State {
    return {
      stateHi: this.#stateHi,
      stateLo: this.#stateLo,
      incHi: this.#incHi,
      incLo: this.#incLo,
    };
  }
}

export interface Pcg32State {
  readonly stateHi: number;
  readonly stateLo: number;
  readonly incHi: number;
  readonly incLo: number;
}

/** The per-system stream factory: same world seed, disjoint PCG sequences. */
export function createRng(worldSeed: number, stream: RngStreamName): Pcg32 {
  return Pcg32.seeded(worldSeed, RngStream[stream]);
}
