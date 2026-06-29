import { MILESTONE_POPULATIONS, Unlock } from "@civitect/sim";
import { describe, expect, it } from "vitest";
import {
  buildProgressionReport,
  renderProgressionReport,
  scoreProgression,
  summarizeProgression,
  UNLOCK_METADATA,
} from ".";

describe("progression report", () => {
  it("summarizes the full milestone ladder from the sim exports", () => {
    const steps = summarizeProgression();

    expect(steps).toHaveLength(MILESTONE_POPULATIONS.length + 1);
    expect(steps[0]).toMatchObject({
      milestoneIndex: 0,
      label: "Founding",
      population: 0,
      nextPopulation: MILESTONE_POPULATIONS[0],
    });
    expect(steps.at(-1)).toMatchObject({
      milestoneIndex: MILESTONE_POPULATIONS.length,
      population: MILESTONE_POPULATIONS.at(-1),
      nextPopulation: 0,
    });
    expect(steps.map((step) => step.population)).toEqual([0, ...MILESTONE_POPULATIONS]);
  });

  it("labels every public unlock bit and flags pacing review points", () => {
    const bitsFromMetadata = UNLOCK_METADATA.map((unlock) => unlock.bit).sort((a, b) => a - b);
    const publicBits = Object.values(Unlock).sort((a, b) => a - b);

    expect(bitsFromMetadata).toEqual(publicBits);

    const report = buildProgressionReport();
    const warningCodes = report.warnings.map((warning) => warning.code);

    expect(warningCodes).toContain("no-new-unlock");
    expect(warningCodes).toContain("reserved-unlock");
    expect(warningCodes).toContain("stub-unlock");
    expect(report.steps[1]?.newlyUnlocked.map((unlock) => unlock.key)).toEqual(["loans"]);
    expect(report.steps[6]?.newlyUnlocked.map((unlock) => unlock.key)).toEqual(["transit"]);
  });

  it("can tighten population-gap thresholds for tuning reports", () => {
    const warnings = scoreProgression(summarizeProgression(), { maxGapPermille: 2000 });

    expect(warnings.some((warning) => warning.code === "large-population-gap")).toBe(true);
  });

  it("renders stable markdown for playtest review artifacts", () => {
    const markdown = renderProgressionReport(buildProgressionReport());

    expect(markdown).toContain("# Progression Report");
    expect(markdown).toContain("| Founding | 0 | 240 | Budget panel (active)");
    expect(markdown).toContain("| Milestone 6 | 9000 | 16000 | Transit (reserved)");
    expect(markdown).toContain("watch reserved-unlock at milestone 6");
    expect(markdown).toContain("watch no-new-unlock at milestone 13");
  });
});
