import { describe, expect, it } from "vitest";
import { loadExpectations, loadScenarios } from "./goldens";
import { scoreSessionValue, summarizeSessionValue } from "./session-value";

function corpusScores() {
  const expectations = loadExpectations();
  return loadScenarios().map((scenario) => {
    const expectation = expectations[scenario.name];
    if (expectation === undefined) {
      throw new Error(`missing golden expectation for ${scenario.name}`);
    }
    return scoreSessionValue(scenario, expectation);
  });
}

describe("session-value audit (GDD §17.2)", () => {
  it("keeps at least two playable growth sessions in the golden corpus", () => {
    const scores = corpusScores();
    const summary = summarizeSessionValue(scores);
    expect(summary.scenarioCount).toBeGreaterThanOrEqual(6);
    expect(summary.playableGrowthCount).toBeGreaterThanOrEqual(2);
    expect(scores.find((score) => score.name === "growth-city-01")?.tags).toContain(
      "playable-growth",
    );
    expect(scores.find((score) => score.name === "services-city-01")?.tags).toContain(
      "playable-growth",
    );
  });

  it("keeps one city-scale service portfolio scenario", () => {
    const scores = corpusScores();
    const summary = summarizeSessionValue(scores);
    const serviceCity = scores.find((score) => score.name === "services-city-01");
    expect(summary.cityScaleCount).toBeGreaterThanOrEqual(1);
    expect(summary.bestScore.tags).toContain("city-scale");
    expect(summary.bestScore.tags).toContain("service-portfolio");
    expect(serviceCity?.tags).toContain("city-scale");
    expect(serviceCity?.tags).toContain("service-portfolio");
    expect(serviceCity?.metrics.serviceKinds).toBeGreaterThanOrEqual(6);
  });

  it("still distinguishes structural fixtures from player-value sessions", () => {
    const scores = corpusScores();
    const emptyCity = scores.find((score) => score.name === "empty-city-01");
    const roadGrid = scores.find((score) => score.name === "road-grid-500-01");
    expect(emptyCity?.score).toBeLessThan(25);
    expect(emptyCity?.gaps).toContain("below-playable-population");
    expect(roadGrid?.tags).toContain("road-network");
    expect(roadGrid?.gaps).toContain("no-mixed-zoning");
  });
});
