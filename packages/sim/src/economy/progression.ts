/**
 * Progression: milestones, unlocks, achievements, tourism, difficulty
 * (GDD §13, board phase-5 task 4). The canonical state lives on EconomyState
 * (milestoneIndex / unlock is derived from it / achievements bitset /
 * uniquesMask / difficulty — all hashed + saved v8). Pure integer logic, no
 * RNG: progression is a deterministic function of the city's canonical
 * counters, so it replays and save/loads bit-exactly (ADR-005).
 *
 * The milestone ladder is the tutorialization spine: each step introduces one
 * new problem class by UNLOCKING a mechanic. Phase 6 mechanics (districts,
 * policies, transit) keep reserved milestone slots but their unlock bits are
 * inert until those systems land — the bit is set, nothing reads it yet.
 */
import type { EconomyState } from "./budget";

/** Population thresholds for milestones 1..13 (GDD §13 [TUNE]). Index i of
 *  the economy is "milestones reached"; the NEXT needs POP[index]. */
export const MILESTONE_POPULATIONS: readonly number[] = [
  240, 500, 1200, 2500, 5000, 9000, 16000, 30000, 55000, 90000, 140000, 220000, 350000,
];

/** Unlock bits (append-only). Phase 5 reads budgetPanel/loans/highDensity/
 *  uniques; congestionPricing/airport are stubs; district/policy/transit slots
 *  are reserved for Phase 6 (set here, read there). */
export const Unlock = {
  budgetPanel: 1 << 0,
  loans: 1 << 1,
  highDensity: 1 << 2,
  uniques: 1 << 3,
  congestionPricing: 1 << 4,
  airport: 1 << 5,
  districts: 1 << 6, // Phase 6 slot
  policies: 1 << 7, // Phase 6 slot
  transit: 1 << 8, // Phase 6 slot
} as const;
export type Unlock = (typeof Unlock)[keyof typeof Unlock];

/** What each milestone (1-based: milestone N is reached at POP[N-1]) grants.
 *  Index 0 = the at-founding unlocks (budget panel is always available). */
const MILESTONE_GRANTS: readonly number[] = [
  Unlock.budgetPanel, // founding
  Unlock.loans, // ms 1 @ 240
  Unlock.budgetPanel, // ms 2 @ 500 (problem class: services budget pressure)
  Unlock.districts, // ms 3 @ 1.2k (Phase 6 slot)
  Unlock.policies, // ms 4 @ 2.5k (Phase 6 slot)
  Unlock.highDensity, // ms 5 @ 5k
  Unlock.transit, // ms 6 @ 9k (Phase 6 slot)
  Unlock.uniques, // ms 7 @ 16k
  Unlock.congestionPricing, // ms 8 @ 30k (stub)
  Unlock.airport, // ms 9 @ 55k (stub)
  Unlock.uniques, // ms 10 @ 90k
  Unlock.uniques, // ms 11 @ 140k
  Unlock.uniques, // ms 12 @ 220k
  Unlock.uniques, // ms 13 @ 350k
];

/** The unlock mask earned by reaching `milestoneIndex` milestones (cumulative,
 *  monotone — a derived pure function of the index, never stored separately). */
export function unlockedMask(milestoneIndex: number): number {
  let mask = 0;
  for (let i = 0; i <= milestoneIndex && i < MILESTONE_GRANTS.length; i++) {
    mask |= MILESTONE_GRANTS[i] as number;
  }
  return mask;
}

export function isUnlocked(economy: EconomyState, bit: number): boolean {
  return (unlockedMask(economy.milestoneIndex) & bit) !== 0;
}

/** Population needed for the NEXT milestone (0 = ladder complete). */
export function nextMilestonePopulation(milestoneIndex: number): number {
  return milestoneIndex < MILESTONE_POPULATIONS.length
    ? (MILESTONE_POPULATIONS[milestoneIndex] as number)
    : 0;
}

/**
 * Advance the milestone index to match the population. MONOTONE — the index
 * only ever rises (a city that shrinks keeps its unlocks; GDD §13: milestones
 * are achievements, not a reversible gauge). Returns the indices newly crossed
 * (for milestone-toast advisors). Never skips: the loop steps one at a time.
 */
export function advanceMilestones(economy: EconomyState, population: number): number[] {
  const crossed: number[] = [];
  while (
    economy.milestoneIndex < MILESTONE_POPULATIONS.length &&
    population >= (MILESTONE_POPULATIONS[economy.milestoneIndex] as number)
  ) {
    economy.milestoneIndex += 1;
    crossed.push(economy.milestoneIndex);
  }
  return crossed;
}

// ── Achievements (GDD §13: ~60, canonical 64-bit set in achievements[8]) ──────
// Bit indices; growth/mastery/absurd. v1 ships a representative spread; the
// engine (setAchievement + checkAchievements) is the contract — adding bits is
// append-only and needs no migration (the byte array already holds 64).
export const Achievement = {
  firstHundred: 0,
  firstThousand: 1,
  tenThousand: 2,
  hundredThousand: 3,
  firstLoan: 4,
  debtFree: 5, // repaid all loans while in the black
  greenCity: 6, // 5+ parks
  industrialist: 7, // 20+ industrial buildings
  tourismMagnet: 8, // tourism arrivals over a threshold
  survivedBankruptcy: 9, // took the bailout and recovered to the black
  // ... room to 63.
} as const;
export type Achievement = (typeof Achievement)[keyof typeof Achievement];

/** Trip an achievement bit once. Returns true the FIRST time only. */
export function setAchievement(economy: EconomyState, bit: number): boolean {
  const byte = bit >> 3;
  const mask = 1 << (bit & 7);
  if (((economy.achievements[byte] as number) & mask) !== 0) {
    return false;
  }
  economy.achievements[byte] = (economy.achievements[byte] as number) | mask;
  return true;
}

export function hasAchievement(economy: EconomyState, bit: number): boolean {
  return (((economy.achievements[bit >> 3] as number) >> (bit & 7)) & 1) === 1;
}

/** Counters the achievement engine reads (all canonical city facts). The
 *  "ever took a loan" fact is remembered by the firstLoan achievement bit
 *  itself (tripped in the takeLoan handler) — no extra saved counter. */
export interface AchievementCounters {
  readonly population: number;
  readonly loansActive: number;
  readonly fundsCents: number;
  readonly parks: number;
  readonly industrial: number;
  readonly tourismArrivals: number;
  readonly bailoutUsed: number;
}

/** Trip every newly-earned achievement; returns the bits newly set (for toasts). */
export function checkAchievements(economy: EconomyState, c: AchievementCounters): number[] {
  const newly: number[] = [];
  const trip = (cond: boolean, bit: number): void => {
    if (cond && setAchievement(economy, bit)) {
      newly.push(bit);
    }
  };
  trip(c.population >= 100, Achievement.firstHundred);
  trip(c.population >= 1000, Achievement.firstThousand);
  trip(c.population >= 10_000, Achievement.tenThousand);
  trip(c.population >= 100_000, Achievement.hundredThousand);
  // debtFree: a loan was taken (firstLoan bit set), none remain, books black.
  trip(
    hasAchievement(economy, Achievement.firstLoan) && c.loansActive === 0 && c.fundsCents >= 0,
    Achievement.debtFree,
  );
  trip(c.parks >= 5, Achievement.greenCity);
  trip(c.industrial >= 20, Achievement.industrialist);
  trip(c.tourismArrivals >= 500, Achievement.tourismMagnet);
  trip(c.bailoutUsed === 1 && c.fundsCents >= 0, Achievement.survivedBankruptcy);
  return newly;
}

// ── Tourism v1 (GDD §8/§13) ───────────────────────────────────────────────
/** Attractiveness from parks + uniques − crime [TUNE]; clamped ≥ 0. */
export function tourismAttractiveness(
  parks: number,
  uniques: number,
  crimePermille: number,
): number {
  const raw = parks * 8 + uniques * 40 - Math.floor(crimePermille / 10);
  return raw < 0 ? 0 : raw;
}

/** Daily tourist arrivals: ∝ attractiveness, but ONLY with an outside
 *  connection (tourists arrive from off-map; GDD §8). Difficulty scales it. */
export function tourismArrivals(
  attractiveness: number,
  hasOutsideConnection: boolean,
  difficulty: number,
): number {
  if (!hasOutsideConnection) {
    return 0;
  }
  return Math.floor((attractiveness * demandSensitivityPermille(difficulty)) / 1000);
}

/** Per-tourist daily spend at Commercial, cents [TUNE]. */
export const TOURIST_SPEND_CENTS = 50;

// ── Difficulty (GDD §13) ──────────────────────────────────────────────────
export const Difficulty = { relaxed: 0, mayor: 1, ironclad: 2 } as const;
export type Difficulty = (typeof Difficulty)[keyof typeof Difficulty];

/** Demand + tourism sensitivity by difficulty, permille (Relaxed booms,
 *  Ironclad bites) [TUNE]. */
export function demandSensitivityPermille(difficulty: number): number {
  return [1200, 1000, 800][difficulty] ?? 1000;
}

/** Loan interest multiplier by difficulty, permille of the base terms [TUNE]. */
export function loanInterestScalePermille(difficulty: number): number {
  return [800, 1000, 1500][difficulty] ?? 1000;
}
