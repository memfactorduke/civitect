import { describe, expect, it } from "vitest";
import {
  analyzeRuntimeAssetManifest,
  RuntimeAssetCategory,
  type RuntimeAssetManifestEntry,
  RuntimeAssetState,
  RuntimeAssetStatus,
} from "./manifest";

function asset(overrides: Partial<RuntimeAssetManifestEntry> = {}): RuntimeAssetManifestEntry {
  return {
    id: "res-low-01",
    category: RuntimeAssetCategory.residential,
    status: RuntimeAssetStatus.accepted,
    sidecar: "res-low-01.json",
    footprint: { w: 2, d: 2 },
    anchor: { x: 192, y: 256 },
    states: {
      [RuntimeAssetState.normal]: "res-low-01.png",
      [RuntimeAssetState.construction]: "res-low-01-construction.png",
      [RuntimeAssetState.abandoned]: "res-low-01-abandoned.png",
      [RuntimeAssetState.emissiveMask]: "res-low-01-emissive.png",
    },
    ...overrides,
  };
}

describe("runtime asset manifest analysis", () => {
  it("summarizes accepted assets without warnings when required categories are covered", () => {
    const report = analyzeRuntimeAssetManifest(
      [
        asset(),
        asset({
          id: "street-straight-01",
          category: RuntimeAssetCategory.terrainRoads,
          footprint: { w: 1, d: 1 },
          sidecar: "street-straight-01.json",
          states: {
            [RuntimeAssetState.normal]: "street-straight-01.png",
          },
        }),
      ],
      {
        requiredCategories: [RuntimeAssetCategory.residential, RuntimeAssetCategory.terrainRoads],
      },
    );

    expect(report.readyForRuntime).toBe(true);
    expect(report.hasBlockingErrors).toBe(false);
    expect(report.issues).toEqual([]);
    expect(report.summary.accepted).toBe(2);
    expect(report.summary.categories[RuntimeAssetCategory.residential]).toBe(1);
    expect(report.summary.states[RuntimeAssetState.normal]).toBe(2);
  });

  it("flags duplicate ids and malformed source paths as blocking errors", () => {
    const report = analyzeRuntimeAssetManifest(
      [
        asset(),
        asset({
          sidecar: "res-low-01.txt",
          states: {
            [RuntimeAssetState.normal]: "res-low-01.jpg",
          },
        }),
      ],
      { requiredCategories: [RuntimeAssetCategory.residential] },
    );

    expect(report.readyForRuntime).toBe(false);
    expect(report.hasBlockingErrors).toBe(true);
    expect(report.issues.map((issue) => issue.rule)).toEqual(
      expect.arrayContaining(["duplicate-id", "sidecar", "state-file", "state-missing"]),
    );
  });

  it("keeps placeholders and category gaps visible without making them schema errors", () => {
    const report = analyzeRuntimeAssetManifest(
      [
        asset({
          id: "road-placeholder",
          category: RuntimeAssetCategory.terrainRoads,
          status: RuntimeAssetStatus.placeholder,
          sidecar: "road-placeholder.json",
          states: {
            [RuntimeAssetState.normal]: "road-placeholder.png",
          },
        }),
      ],
      {
        requiredCategories: [RuntimeAssetCategory.terrainRoads, RuntimeAssetCategory.residential],
      },
    );

    expect(report.readyForRuntime).toBe(false);
    expect(report.hasBlockingErrors).toBe(false);
    expect(report.summary.placeholder).toBe(1);
    expect(report.issues.map((issue) => issue.rule)).toEqual(
      expect.arrayContaining(["placeholder", "category-coverage"]),
    );
  });

  it("requires accepted building assets to carry all ADR-012 runtime states", () => {
    const report = analyzeRuntimeAssetManifest(
      [
        asset({
          states: {
            [RuntimeAssetState.normal]: "res-low-01.png",
            [RuntimeAssetState.construction]: "res-low-01-construction.png",
          },
        }),
      ],
      { requiredCategories: [RuntimeAssetCategory.residential] },
    );

    expect(report.readyForRuntime).toBe(false);
    expect(report.hasBlockingErrors).toBe(true);
    expect(report.issues.filter((issue) => issue.rule === "state-missing")).toHaveLength(2);
  });
});
