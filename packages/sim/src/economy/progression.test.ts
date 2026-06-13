/**
 * Progression verification (board phase-5 task 4, GDD §13): milestones never
 * skip or regress, unlock-gated commands reject pre-milestone, achievements
 * trip exactly once, tourism tracks attractiveness, and difficulty multipliers
 * differ per mode.
 */
import { CommandType, RejectionReason } from "@civitect/protocol";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createWorld, runTick } from "../world";
import { createEconomy } from "./budget";
import {
  Achievement,
  type AchievementCounters,
  advanceMilestones,
  checkAchievements,
  demandSensitivityPermille,
  hasAchievement,
  isUnlocked,
  loanInterestScalePermille,
  MILESTONE_POPULATIONS,
  nextMilestonePopulation,
  setAchievement,
  tourismArrivals,
  tourismAttractiveness,
  Unlock,
  unlockedMask,
} from "./progression";

describe("milestones (GDD §13): monotone, never skip, never regress", () => {
  it("index equals the count of thresholds the peak population has passed", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 400_000 }), { maxLength: 40 }), (pops) => {
        const econ = createEconomy();
        let peak = 0;
        let prevIndex = 0;
        for (const pop of pops) {
          peak = Math.max(peak, pop);
          const crossed = advanceMilestones(econ, pop);
          // Monotone: index never decreases even when population drops.
          expect(econ.milestoneIndex).toBeGreaterThanOrEqual(prevIndex);
          // Never skips: each crossed milestone is exactly the next index.
          for (let k = 0; k < crossed.length; k++) {
            expect(crossed[k]).toBe(prevIndex + k + 1);
          }
          prevIndex = econ.milestoneIndex;
        }
        // Index == number of thresholds the PEAK population has reached.
        const expected = MILESTONE_POPULATIONS.filter((p) => peak >= p).length;
        expect(econ.milestoneIndex).toBe(expected);
      }),
      { numRuns: 200 },
    );
  });

  it("the next-target and unlock mask move with the index", () => {
    const econ = createEconomy();
    expect(nextMilestonePopulation(econ.milestoneIndex)).toBe(MILESTONE_POPULATIONS[0]);
    expect(isUnlocked(econ, Unlock.loans)).toBe(false); // not yet
    advanceMilestones(econ, MILESTONE_POPULATIONS[0] as number);
    expect(econ.milestoneIndex).toBe(1);
    expect(isUnlocked(econ, Unlock.loans)).toBe(true); // loans @ milestone 1
    // The mask is cumulative and monotone.
    expect(unlockedMask(2) & unlockedMask(1)).toBe(unlockedMask(1));
  });
});

describe("unlock-gated commands reject pre-milestone (GDD §13)", () => {
  it("takeLoan rejects notUnlocked at founding, succeeds once loans unlock", () => {
    const world = createWorld(3);
    const take = () =>
      runTick(world, [{ seq: 1, tick: world.tick, type: CommandType.takeLoan, tier: 1 } as never]);
    // Founding: milestoneIndex 0 → loans locked → rejected, no loan booked.
    expect(take().map((r) => r.reason)).toEqual([RejectionReason.notUnlocked]);
    expect(world.economy.loans.length).toBe(0);
    // Reach the first milestone: loans unlock, the command lands.
    world.economy.milestoneIndex = 1;
    expect(take()).toEqual([]);
    expect(world.economy.loans.length).toBe(1);
    expect(hasAchievement(world.economy, Achievement.firstLoan)).toBe(true);
  });
});

describe("achievements: trigger-once over fuzzed counters", () => {
  it("setAchievement returns true exactly once per bit", () => {
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 9 }), { maxLength: 60 }), (bits) => {
        const econ = createEconomy();
        const everTrue = new Set<number>();
        for (const bit of bits) {
          const first = setAchievement(econ, bit);
          if (first) {
            expect(everTrue.has(bit)).toBe(false); // first time only
            everTrue.add(bit);
          }
          expect(hasAchievement(econ, bit)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("checkAchievements trips growth bits as counters cross, never re-fires", () => {
    const econ = createEconomy();
    const base: AchievementCounters = {
      population: 0,
      loansActive: 0,
      fundsCents: 0,
      parks: 0,
      industrial: 0,
      tourismArrivals: 0,
      bailoutUsed: 0,
    };
    expect(checkAchievements(econ, { ...base, population: 50 })).toEqual([]);
    expect(checkAchievements(econ, { ...base, population: 100 })).toContain(
      Achievement.firstHundred,
    );
    // Crossing the SAME threshold again earns nothing new.
    expect(checkAchievements(econ, { ...base, population: 100 })).toEqual([]);
    expect(checkAchievements(econ, { ...base, population: 1000 })).toContain(
      Achievement.firstThousand,
    );
  });
});

describe("tourism v1 (GDD §8): arrivals track attractiveness + need a connection", () => {
  it("attractiveness rises with parks/uniques, falls with crime; arrivals need outside", () => {
    expect(tourismAttractiveness(0, 0, 0)).toBe(0);
    expect(tourismAttractiveness(10, 2, 0)).toBeGreaterThan(tourismAttractiveness(2, 0, 0));
    expect(tourismAttractiveness(10, 0, 0)).toBeGreaterThan(tourismAttractiveness(10, 0, 500));
    // No outside connection ⇒ no tourists no matter how pretty the city.
    expect(tourismArrivals(1000, false, 1)).toBe(0);
    expect(tourismArrivals(1000, true, 1)).toBeGreaterThan(0);
    // More attractive ⇒ more arrivals (monotone at fixed difficulty).
    expect(tourismArrivals(2000, true, 1)).toBeGreaterThan(tourismArrivals(1000, true, 1));
  });
});

describe("difficulty multipliers differ per mode (GDD §13)", () => {
  it("demand/tourism sensitivity and loan interest order Relaxed < Mayor < Ironclad", () => {
    // Relaxed booms, Ironclad bites: demand sensitivity decreases with mode.
    expect(demandSensitivityPermille(0)).toBeGreaterThan(demandSensitivityPermille(1));
    expect(demandSensitivityPermille(1)).toBeGreaterThan(demandSensitivityPermille(2));
    // Loan interest is cheaper on Relaxed, dearer on Ironclad.
    expect(loanInterestScalePermille(0)).toBeLessThan(loanInterestScalePermille(1));
    expect(loanInterestScalePermille(1)).toBeLessThan(loanInterestScalePermille(2));
    // Mayor (the default) is the identity for loan interest.
    expect(loanInterestScalePermille(1)).toBe(1000);
  });
});
