import { describe, expect, it } from "vitest";
import {
  DAY_NIGHT_CLEAR_TINT,
  DAY_NIGHT_MAX_ALPHA,
  DAY_NIGHT_TINT,
  dayNightTintForTick,
  minuteOfDay,
  TICKS_PER_DAY,
} from "./day-night";

describe("day/night renderer tint", () => {
  it("wraps any tick into a stable minute of day", () => {
    expect(minuteOfDay(0)).toBe(0);
    expect(minuteOfDay(TICKS_PER_DAY + 15)).toBe(15);
    expect(minuteOfDay(-1)).toBe(TICKS_PER_DAY - 1);
  });

  it("is dark at midnight and clear at noon", () => {
    const midnight = dayNightTintForTick(0);
    const noon = dayNightTintForTick(12 * 60);

    expect(midnight.alpha).toBe(DAY_NIGHT_MAX_ALPHA);
    expect(midnight.color).toBe(DAY_NIGHT_TINT);
    expect(noon.alpha).toBe(0);
    expect(noon.color).toBe(DAY_NIGHT_CLEAR_TINT);
    expect(noon.phasePermille).toBe(500);
  });

  it("fades out through dawn", () => {
    expect(dayNightTintForTick(5 * 60).alpha).toBe(DAY_NIGHT_MAX_ALPHA);
    expect(dayNightTintForTick(6 * 60).alpha).toBeCloseTo(DAY_NIGHT_MAX_ALPHA / 2);
    expect(dayNightTintForTick(7 * 60).alpha).toBe(0);
  });

  it("fades in through evening", () => {
    expect(dayNightTintForTick(18 * 60).alpha).toBe(0);
    expect(dayNightTintForTick(19 * 60 + 30).alpha).toBeCloseTo(DAY_NIGHT_MAX_ALPHA / 2);
    expect(dayNightTintForTick(21 * 60).alpha).toBe(DAY_NIGHT_MAX_ALPHA);
  });
});
