import { describe, expect, it } from "vitest";
import { percentile, summarizeDurations } from "./runner";

describe("percentile", () => {
  it("uses nearest rank and leaves the input order untouched", () => {
    const samples = new Float64Array([4, 1, 3, 2]);

    expect(percentile(samples, 0.5)).toBe(2);
    expect(percentile(samples, 1)).toBe(4);
    expect(Array.from(samples)).toEqual([4, 1, 3, 2]);
  });

  it("rejects empty samples and invalid percentiles", () => {
    expect(() => percentile(new Float64Array(), 0.95)).toThrow("zero samples");
    expect(() => percentile(new Float64Array([1]), 0)).toThrow("must be in");
    expect(() => percentile(new Float64Array([1]), 1.1)).toThrow("must be in");
  });
});

describe("summarizeDurations", () => {
  it("reports percentile, max, total, and over-budget density", () => {
    const summary = summarizeDurations(new Float64Array([1, 2, 3, 4, 25]), 20);

    expect(summary).toEqual({
      count: 5,
      p95Ms: 25,
      p99Ms: 25,
      maxMs: 25,
      totalMs: 35,
      overBudgetCount: 1,
      overBudgetPercent: 20,
    });
  });

  it("allows samples exactly on the budget line", () => {
    const summary = summarizeDurations(new Float64Array([10, 20, 20]), 20);

    expect(summary.overBudgetCount).toBe(0);
    expect(summary.maxMs).toBe(20);
  });

  it("rejects invalid inputs before printing misleading diagnostics", () => {
    expect(() => summarizeDurations(new Float64Array(), 20)).toThrow("zero samples");
    expect(() => summarizeDurations(new Float64Array([1]), Number.POSITIVE_INFINITY)).toThrow(
      "finite non-negative",
    );
    expect(() => summarizeDurations(new Float64Array([1, -1]), 20)).toThrow("finite non-negative");
  });
});
