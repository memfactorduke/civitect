import { Achievement } from "@civitect/sim";
import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_METADATA, buildAchievementReport, renderAchievementReport } from ".";

describe("achievement report", () => {
  it("maps every public sim achievement bit exactly once", () => {
    const publicBits = Object.values(Achievement).sort((a, b) => a - b);
    const metadataBits = ACHIEVEMENT_METADATA.map((achievement) => achievement.bit).sort(
      (a, b) => a - b,
    );

    expect(metadataBits).toEqual(publicBits);
    expect(new Set(metadataBits).size).toBe(metadataBits.length);
  });

  it("summarizes implementation count, free slots, and category mix", () => {
    const report = buildAchievementReport();

    expect(report.implementedCount).toBe(10);
    expect(report.targetCount).toBe(60);
    expect(report.remainingToTarget).toBe(50);
    expect(report.freeSlots).toBe(54);
    expect(report.categorySummary.find((summary) => summary.category === "growth")).toMatchObject({
      count: 4,
      bits: [0, 1, 2, 3],
    });
  });

  it("flags content gaps without claiming the bitset is exhausted", () => {
    const report = buildAchievementReport();
    const warningCodes = report.warnings.map((warning) => warning.code);

    expect(warningCodes).toContain("catalog-shortfall");
    expect(warningCodes).toContain("category-gap");
    expect(warningCodes).not.toContain("slot-pressure");
    expect(report.warnings.some((warning) => warning.message.includes("absurd"))).toBe(true);
  });

  it("renders stable markdown for design review artifacts", () => {
    const markdown = renderAchievementReport(buildAchievementReport());

    expect(markdown).toContain("# Achievement Report");
    expect(markdown).toContain("Implemented: 10/60; free bit slots: 54/64.");
    expect(markdown).toContain("| 8 | tourismMagnet | tourism | Reach 500 tourism arrivals. |");
    expect(markdown).toContain("| absurd | 0 | none |");
    expect(markdown).toContain("watch catalog-shortfall");
  });
});
