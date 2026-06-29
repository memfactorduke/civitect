import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type LabelCandidate,
  type LabelPlacement,
  planLabelLayout,
  rectsIntersect,
} from "./label-layout";

const VIEWPORT = { x0: 0, y0: 0, x1: 800, y1: 600 };

describe("label layout planner", () => {
  it("places higher-priority labels first and stays deterministic across input order", () => {
    const labels: LabelCandidate[] = [
      { id: "clinic", x: 200, y: 200, width: 120, height: 28, priority: 10 },
      { id: "fire", x: 205, y: 200, width: 120, height: 28, priority: 30 },
      { id: "school", x: 440, y: 220, width: 120, height: 28, priority: 20 },
      { id: "water", x: 120, y: 120, width: 100, height: 24, priority: 20 },
    ];

    const forward = planLabelLayout(labels, { viewport: VIEWPORT, zoom: 1 });
    const reversed = planLabelLayout([...labels].reverse(), { viewport: VIEWPORT, zoom: 1 });

    expect(forward).toEqual(reversed);
    expect(forward.placed.map((label) => label.id)).toEqual(["fire", "water", "school"]);
    expect(forward.rejected).toContainEqual({ id: "clinic", reason: "overlap" });
  });

  it("respects zoom windows, viewport margin, hard budgets, and critical overlaps", () => {
    const plan = planLabelLayout(
      [
        { id: "far-detail", x: 50, y: 50, width: 80, height: 20, priority: 90, minZoom: 2 },
        { id: "off-map", x: 900, y: 100, width: 80, height: 20, priority: 80 },
        { id: "near-edge", x: 812, y: 100, width: 40, height: 20, priority: 70 },
        { id: "hospital", x: 200, y: 200, width: 110, height: 24, priority: 60 },
        {
          id: "selected-building",
          x: 205,
          y: 200,
          width: 120,
          height: 24,
          priority: 50,
          allowOverlap: true,
        },
        { id: "park", x: 400, y: 300, width: 80, height: 20, priority: 40 },
      ],
      { viewport: VIEWPORT, zoom: 1, maxLabels: 3, viewportMarginPx: 20 },
    );

    expect(plan.placed.map((label) => label.id)).toEqual([
      "near-edge",
      "hospital",
      "selected-building",
    ]);
    expect(plan.rejected).toEqual([
      { id: "far-detail", reason: "zoom" },
      { id: "off-map", reason: "offscreen" },
      { id: "park", reason: "budget" },
    ]);
    expect(plan.visibleCandidates).toBe(4);
  });

  it("rejects malformed candidates and impossible options", () => {
    const plan = planLabelLayout(
      [
        { id: "", x: 0, y: 0, width: 10, height: 10, priority: 1 },
        { id: "wide", x: 0, y: 0, width: 0, height: 10, priority: 1 },
        { id: "nan", x: Number.NaN, y: 0, width: 10, height: 10, priority: 1 },
      ],
      { viewport: VIEWPORT, zoom: 1 },
    );

    expect(plan.placed).toEqual([]);
    expect(plan.rejected).toEqual([
      { id: "", reason: "invalid" },
      { id: "nan", reason: "invalid" },
      { id: "wide", reason: "invalid" },
    ]);
    expect(() =>
      planLabelLayout([], { viewport: { x0: 0, y0: 0, x1: 0, y1: 1 }, zoom: 1 }),
    ).toThrow(/viewport/);
    expect(() =>
      planLabelLayout([], { viewport: VIEWPORT, zoom: Number.POSITIVE_INFINITY }),
    ).toThrow(/zoom/);
    expect(() => planLabelLayout([], { viewport: VIEWPORT, zoom: 1, maxLabels: 1.5 })).toThrow(
      /maxLabels/,
    );
    expect(() => planLabelLayout([], { viewport: VIEWPORT, zoom: 1, paddingPx: -1 })).toThrow(
      /paddingPx/,
    );
  });

  it("never overlaps ordinary accepted labels under the configured padding (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            x: fc.integer({ min: -100, max: 900 }),
            y: fc.integer({ min: -100, max: 700 }),
            width: fc.integer({ min: 1, max: 180 }),
            height: fc.integer({ min: 1, max: 64 }),
            priority: fc.integer({ min: -10, max: 100 }),
            allowOverlap: fc.constant(false),
          }),
          { maxLength: 120 },
        ),
        fc.integer({ min: 0, max: 16 }),
        (labels, paddingPx) => {
          const plan = planLabelLayout(labels, {
            viewport: VIEWPORT,
            zoom: 1,
            maxLabels: 80,
            paddingPx,
          });

          for (const pair of pairs(plan.placed)) {
            expect(rectsIntersect(inflate(pair[0], paddingPx), pair[1].rect)).toBe(false);
          }
          expect(plan.placed.length).toBeLessThanOrEqual(80);
          expect(plan.totalCandidates).toBe(labels.length);
        },
      ),
    );
  });
});

function pairs<T>(items: readonly T[]): Array<readonly [T, T]> {
  const result: Array<readonly [T, T]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a !== undefined && b !== undefined) {
        result.push([a, b]);
      }
    }
  }
  return result;
}

function inflate(label: LabelPlacement, padding: number) {
  return {
    x0: label.rect.x0 - padding,
    y0: label.rect.y0 - padding,
    x1: label.rect.x1 + padding,
    y1: label.rect.y1 + padding,
  };
}
