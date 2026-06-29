import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ClusterItem,
  type MarkerCandidate,
  type MarkerClusterItem,
  planMarkerClusters,
} from "./marker-cluster";

const VIEWPORT = { x0: 0, y0: 0, x1: 800, y1: 600 };

describe("marker cluster planner", () => {
  it("clusters dense cells deterministically across input order", () => {
    const markers: MarkerCandidate[] = [
      { id: "clinic", x: 104, y: 100, priority: 20 },
      { id: "fire", x: 110, y: 105, priority: 90, weight: 2 },
      { id: "school", x: 121, y: 110, priority: 30 },
      { id: "park", x: 420, y: 320, priority: 40 },
      { id: "water", x: 430, y: 330, priority: 10 },
    ];

    const forward = planMarkerClusters(markers, { viewport: VIEWPORT, zoom: 1, cellSizePx: 64 });
    const reversed = planMarkerClusters([...markers].reverse(), {
      viewport: VIEWPORT,
      zoom: 1,
      cellSizePx: 64,
    });

    expect(forward).toEqual(reversed);
    expect(forward.items.map((item) => item.id)).toEqual([
      "cluster:1:1:clinic",
      "cluster:6:5:park",
    ]);

    const first = forward.items[0] as ClusterItem;
    expect(first.kind).toBe("cluster");
    expect(first.markerIds).toEqual(["clinic", "fire", "school"]);
    expect(first.count).toBe(3);
    expect(first.priority).toBe(90);
    expect(first.x).toBeCloseTo(111.25);
    expect(first.y).toBeCloseTo(105);
    expect(first.bounds).toEqual({ x0: 104, y0: 100, x1: 121, y1: 110 });
    expect(forward.clusteredMarkerCount).toBe(5);
  });

  it("respects zoom windows, viewport margin, selected markers, duplicates, and budgets", () => {
    const plan = planMarkerClusters(
      [
        { id: "far-detail", x: 50, y: 50, priority: 100, minZoom: 2 },
        { id: "off-map", x: 900, y: 100, priority: 95 },
        { id: "near-edge", x: 812, y: 100, priority: 90 },
        { id: "selected:hospital", x: 120, y: 120, priority: 80 },
        { id: "clinic", x: 125, y: 122, priority: 70 },
        { id: "school", x: 130, y: 124, priority: 60 },
        { id: "clinic", x: 400, y: 300, priority: 50 },
        { id: "park", x: 420, y: 320, priority: 40 },
      ],
      {
        viewport: VIEWPORT,
        zoom: 1,
        cellSizePx: 64,
        maxItems: 2,
        viewportMarginPx: 20,
      },
    );

    expect(plan.items.map((item) => item.id)).toEqual(["near-edge", "selected:hospital"]);
    expect(plan.rejected).toEqual([
      { id: "clinic", reason: "duplicate" },
      { id: "clinic", reason: "budget" },
      { id: "far-detail", reason: "zoom" },
      { id: "off-map", reason: "offscreen" },
      { id: "park", reason: "budget" },
      { id: "school", reason: "budget" },
    ]);
    expect(plan.visibleCandidates).toBe(5);
    expect(plan.clusteredMarkerCount).toBe(0);
  });

  it("rejects malformed candidates and impossible options", () => {
    const plan = planMarkerClusters(
      [
        { id: "", x: 0, y: 0, priority: 1 },
        { id: "nan", x: Number.NaN, y: 0, priority: 1 },
        { id: "heavy", x: 10, y: 10, priority: 1, weight: 0 },
      ],
      { viewport: VIEWPORT, zoom: 1 },
    );

    expect(plan.items).toEqual([]);
    expect(plan.rejected).toEqual([
      { id: "", reason: "invalid" },
      { id: "heavy", reason: "invalid" },
      { id: "nan", reason: "invalid" },
    ]);
    expect(() =>
      planMarkerClusters([], { viewport: { x0: 0, y0: 0, x1: 0, y1: 1 }, zoom: 1 }),
    ).toThrow(/viewport/);
    expect(() =>
      planMarkerClusters([], { viewport: VIEWPORT, zoom: Number.POSITIVE_INFINITY }),
    ).toThrow(/zoom/);
    expect(() => planMarkerClusters([], { viewport: VIEWPORT, zoom: 1, cellSizePx: 0 })).toThrow(
      /cellSizePx/,
    );
    expect(() => planMarkerClusters([], { viewport: VIEWPORT, zoom: 1, maxItems: 1.5 })).toThrow(
      /maxItems/,
    );
    expect(() =>
      planMarkerClusters([], { viewport: VIEWPORT, zoom: 1, minClusterSize: 1 }),
    ).toThrow(/minClusterSize/);
  });

  it("preserves visible marker ids exactly once under clustering and budgets (property)", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            x: fc.integer({ min: -100, max: 900 }),
            y: fc.integer({ min: -100, max: 700 }),
            priority: fc.integer({ min: -20, max: 100 }),
            weight: fc.integer({ min: 1, max: 5 }),
          }),
          { maxLength: 100 },
        ),
        fc.integer({ min: 16, max: 96 }),
        fc.integer({ min: 0, max: 40 }),
        (rawMarkers, cellSizePx, maxItems) => {
          const markers = rawMarkers.map((marker, index) => ({
            ...marker,
            id: `m-${index}`,
          }));
          const plan = planMarkerClusters(markers, {
            viewport: VIEWPORT,
            zoom: 1,
            cellSizePx,
            maxItems,
          });

          expect(plan.items.length).toBeLessThanOrEqual(maxItems);
          expect(representedIds(plan.items).sort()).toEqual(
            markers
              .filter(
                (marker) => marker.x >= 0 && marker.x <= 800 && marker.y >= 0 && marker.y <= 600,
              )
              .map((marker) => marker.id)
              .filter((id) => plan.rejected.every((rejection) => rejection.id !== id))
              .sort(),
          );
          expect(
            representedIds(plan.items).length +
              plan.rejected.filter((rejection) => rejection.reason !== "invalid").length,
          ).toBe(markers.length);
        },
      ),
    );
  });
});

function representedIds(items: readonly MarkerClusterItem[]): string[] {
  return items.flatMap((item) => (item.kind === "cluster" ? item.markerIds : [item.id]));
}
