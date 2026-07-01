import { describe, expect, it } from "vitest";
import { formatCount, formatFundsCents, formatSignedCents } from "./format";

describe("display formatting", () => {
  it("formats HUD funds from integer cents without overstating fractional dollars", () => {
    expect(formatFundsCents(0)).toBe("$0");
    expect(formatFundsCents(99)).toBe("$0");
    expect(formatFundsCents(123_456)).toBe("$1,234");
    expect(formatFundsCents(-123_456)).toBe("-$1,234");
  });

  it("formats signed monthly report lines with explicit plus/minus markers", () => {
    expect(formatSignedCents(0)).toBe("+$0");
    expect(formatSignedCents(99)).toBe("+$0");
    expect(formatSignedCents(123_456)).toBe("+$1,234");
    expect(formatSignedCents(-123_456)).toBe("−$1,234");
  });

  it("formats population and milestone counts with stable grouping", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1_234)).toBe("1,234");
    expect(formatCount(350_000)).toBe("350,000");
  });
});
