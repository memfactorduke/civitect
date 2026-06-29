import { describe, expect, it } from "vitest";
import { type AgentTrailSample, planAgentTrails } from "./agent-trails";

describe("agent trail planner", () => {
  it("creates deterministic trail segments from unsorted samples", () => {
    const samples: AgentTrailSample[] = [
      { agentId: "freight-1", tick: 8, wx: 32, wy: 16, mode: "truck" },
      { agentId: "citizen-2", tick: 10, wx: 16, wy: 8, mode: "walk" },
      { agentId: "freight-1", tick: 0, wx: 0, wy: 0, mode: "truck" },
      { agentId: "citizen-2", tick: 4, wx: 8, wy: 4, mode: "walk" },
      { agentId: "freight-1", tick: 4, wx: 16, wy: 8, mode: "truck" },
    ];

    expect(
      planAgentTrails(samples, {
        nowTick: 10,
        maxAgeTicks: 10,
        maxSegmentsPerAgent: 8,
        minAlpha: 0.2,
        maxAlpha: 0.9,
        widthPx: 4,
      }),
    ).toEqual([
      {
        agentId: "citizen-2",
        from: { wx: 8, wy: 4 },
        to: { wx: 16, wy: 8 },
        startTick: 4,
        endTick: 10,
        ageTicks: 0,
        alpha: 0.9,
        widthPx: 4,
        mode: "walk",
        drawOrder: 0,
      },
      {
        agentId: "freight-1",
        from: { wx: 0, wy: 0 },
        to: { wx: 16, wy: 8 },
        startTick: 0,
        endTick: 4,
        ageTicks: 6,
        alpha: 0.48,
        widthPx: 3.4,
        mode: "truck",
        drawOrder: 1,
      },
      {
        agentId: "freight-1",
        from: { wx: 16, wy: 8 },
        to: { wx: 32, wy: 16 },
        startTick: 4,
        endTick: 8,
        ageTicks: 2,
        alpha: 0.76,
        widthPx: 3.8,
        mode: "truck",
        drawOrder: 2,
      },
    ]);
  });

  it("keeps only each agent's newest bounded trail segments", () => {
    const samples: AgentTrailSample[] = [
      { agentId: "a", tick: 0, wx: 0, wy: 0 },
      { agentId: "a", tick: 1, wx: 1, wy: 0 },
      { agentId: "a", tick: 2, wx: 2, wy: 0 },
      { agentId: "a", tick: 3, wx: 3, wy: 0 },
      { agentId: "a", tick: 4, wx: 4, wy: 0 },
    ];

    expect(
      planAgentTrails(samples, {
        nowTick: 4,
        maxAgeTicks: 4,
        maxSegmentsPerAgent: 2,
      }).map((segment) => [segment.startTick, segment.endTick]),
    ).toEqual([
      [2, 3],
      [3, 4],
    ]);
  });

  it("filters unusable, future, stale, and too-short samples", () => {
    const samples: AgentTrailSample[] = [
      { agentId: "", tick: 1, wx: 0, wy: 0 },
      { agentId: "a", tick: Number.NaN, wx: 0, wy: 0 },
      { agentId: "a", tick: 1, wx: Number.POSITIVE_INFINITY, wy: 0 },
      { agentId: "a", tick: 2, wx: 0, wy: 0 },
      { agentId: "a", tick: 3, wx: 0.25, wy: 0 },
      { agentId: "a", tick: 4, wx: 4, wy: 0 },
      { agentId: "a", tick: 99, wx: 9, wy: 0 },
      { agentId: "b", tick: 0, wx: 0, wy: 0 },
      { agentId: "b", tick: 1, wx: 8, wy: 0 },
    ];

    const segments = planAgentTrails(samples, {
      nowTick: 4,
      maxAgeTicks: 2,
      maxSegmentsPerAgent: 8,
      minSegmentLengthPx: 1,
    });

    expect(segments.map((segment) => segment.agentId)).toEqual(["a"]);
    expect(segments.map((segment) => [segment.startTick, segment.endTick])).toEqual([[3, 4]]);
  });

  it("deduplicates same-tick samples without depending on input order", () => {
    const firstOrder: AgentTrailSample[] = [
      { agentId: "a", tick: 0, wx: 0, wy: 0 },
      { agentId: "a", tick: 1, wx: 2, wy: 0 },
      { agentId: "a", tick: 1, wx: 4, wy: 0 },
      { agentId: "a", tick: 2, wx: 8, wy: 0 },
    ];
    const secondOrder: AgentTrailSample[] = [
      { agentId: "a", tick: 2, wx: 8, wy: 0 },
      { agentId: "a", tick: 1, wx: 4, wy: 0 },
      { agentId: "a", tick: 0, wx: 0, wy: 0 },
      { agentId: "a", tick: 1, wx: 2, wy: 0 },
    ];

    expect(
      planAgentTrails(firstOrder, { nowTick: 2, maxAgeTicks: 4, maxSegmentsPerAgent: 8 }),
    ).toEqual(planAgentTrails(secondOrder, { nowTick: 2, maxAgeTicks: 4, maxSegmentsPerAgent: 8 }));
    expect(
      planAgentTrails(firstOrder, { nowTick: 2, maxAgeTicks: 4, maxSegmentsPerAgent: 8 }).map(
        (segment) => segment.from.wx,
      ),
    ).toEqual([0, 4]);
  });

  it("returns no segments when there is no drawable budget", () => {
    const samples: AgentTrailSample[] = [
      { agentId: "a", tick: 0, wx: 0, wy: 0 },
      { agentId: "a", tick: 1, wx: 1, wy: 0 },
    ];

    expect(
      planAgentTrails(samples, { nowTick: 1, maxAgeTicks: 4, maxSegmentsPerAgent: 0 }),
    ).toEqual([]);
    expect(
      planAgentTrails(samples, { nowTick: Number.NaN, maxAgeTicks: 4, maxSegmentsPerAgent: 1 }),
    ).toEqual([]);
    expect(
      planAgentTrails(samples, { nowTick: 1, maxAgeTicks: 4, maxSegmentsPerAgent: Number.NaN }),
    ).toEqual([]);
  });
});
