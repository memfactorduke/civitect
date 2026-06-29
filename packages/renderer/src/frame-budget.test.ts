import { describe, expect, it } from "vitest";
import { FrameLod, frameLodForZoom, planFrameBudget } from "./frame-budget";

describe("renderer frame-budget planning", () => {
  it("maps zoom to deterministic dynamic-detail tiers", () => {
    expect(frameLodForZoom(0.25)).toBe(FrameLod.far);
    expect(frameLodForZoom(0.5)).toBe(FrameLod.mid);
    expect(frameLodForZoom(1)).toBe(FrameLod.mid);
    expect(frameLodForZoom(1.25)).toBe(FrameLod.near);
  });

  it("keeps full dynamic detail for a small near-zoom scene", () => {
    const plan = planFrameBudget({
      zoom: 2,
      agentCount: 400,
      roadSegmentCount: 300,
      buildingCount: 80,
    });

    expect(plan).toMatchObject({
      lod: FrameLod.near,
      agentStride: 1,
      drawPedestrians: true,
      trafficSegmentStride: 1,
      buildingLabelStride: 1,
    });
  });

  it("samples expensive layers in a far-zoom large city", () => {
    const plan = planFrameBudget({
      zoom: 0.25,
      agentCount: 25_000,
      roadSegmentCount: 12_000,
      buildingCount: 8_000,
    });

    expect(plan.lod).toBe(FrameLod.far);
    expect(plan.agentStride).toBeGreaterThan(1);
    expect(plan.trafficSegmentStride).toBeGreaterThan(1);
    expect(plan.buildingLabelBudget).toBe(0);
    expect(plan.drawPedestrians).toBe(false);
  });

  it("tightens budgets for 120 Hz targets without changing policy shape", () => {
    const load = {
      zoom: 1,
      agentCount: 2_000,
      roadSegmentCount: 2_000,
      buildingCount: 300,
    };
    const sixtyHz = planFrameBudget({ ...load, targetFrameMs: 1000 / 60 });
    const oneTwentyHz = planFrameBudget({ ...load, targetFrameMs: 1000 / 120 });

    expect(oneTwentyHz.lod).toBe(sixtyHz.lod);
    expect(oneTwentyHz.agentSpriteBudget).toBeLessThan(sixtyHz.agentSpriteBudget);
    expect(oneTwentyHz.agentStride).toBeGreaterThanOrEqual(sixtyHz.agentStride);
    expect(oneTwentyHz.trafficSegmentStride).toBeGreaterThanOrEqual(sixtyHz.trafficSegmentStride);
  });

  it("normalizes invalid loads to a harmless minimum plan", () => {
    const plan = planFrameBudget({
      zoom: Number.NaN,
      agentCount: -1,
      roadSegmentCount: Number.POSITIVE_INFINITY,
      buildingCount: Number.NaN,
      targetFrameMs: -5,
    });

    expect(plan.lod).toBe(FrameLod.far);
    expect(plan.agentSpriteBudget).toBeGreaterThan(0);
    expect(plan.agentStride).toBe(1);
    expect(plan.trafficSegmentStride).toBe(1);
    expect(plan.buildingLabelStride).toBe(1);
  });
});
