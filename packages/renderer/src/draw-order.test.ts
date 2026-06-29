import { describe, expect, it } from "vitest";
import {
  compareDrawKeys,
  DRAW_LAYERS,
  type DrawOrderItem,
  drawLayerRank,
  drawSortKey,
  planDrawBatches,
  planDrawOrder,
} from "./draw-order";

function ids(items: readonly { readonly item: DrawOrderItem }[]): string[] {
  return items.map((entry) => entry.item.id);
}

describe("renderer draw ordering", () => {
  it("orders broad layers before isometric depth", () => {
    const ordered = planDrawOrder([
      { id: "label", layer: "labels", tileX: 0, tileY: 0 },
      { id: "building", layer: "buildings", tileX: 0, tileY: 0 },
      { id: "terrain", layer: "terrain", tileX: 99, tileY: 99 },
      { id: "road", layer: "roads", tileX: 50, tileY: 50 },
    ]);

    expect(ids(ordered)).toEqual(["terrain", "road", "building", "label"]);
    expect(ordered.map((entry) => entry.drawIndex)).toEqual([0, 1, 2, 3]);
  });

  it("sorts tile anchors by isometric depth inside a layer", () => {
    const ordered = planDrawOrder([
      { id: "front", layer: "buildings", tileX: 4, tileY: 5 },
      { id: "back", layer: "buildings", tileX: 1, tileY: 1 },
      { id: "middle-west", layer: "buildings", tileX: 1, tileY: 3 },
      { id: "middle-east", layer: "buildings", tileX: 3, tileY: 1 },
    ]);

    expect(ids(ordered)).toEqual(["back", "middle-west", "middle-east", "front"]);
  });

  it("uses world anchors for moving actors between tiles", () => {
    const ordered = planDrawOrder([
      { id: "logical-front", layer: "agents", tileX: 20, tileY: 20, worldY: 10, worldX: 0 },
      { id: "world-front", layer: "agents", tileX: 0, tileY: 0, worldY: 20, worldX: 0 },
    ]);

    expect(ids(ordered)).toEqual(["logical-front", "world-front"]);
  });

  it("uses z, priority, and id as deterministic tie-breakers", () => {
    const ordered = planDrawOrder([
      { id: "b", layer: "overlays", tileX: 2, tileY: 2 },
      { id: "priority", layer: "overlays", tileX: 2, tileY: 2, priority: 1 },
      { id: "z", layer: "overlays", tileX: 2, tileY: 2, z: 1 },
      { id: "a", layer: "overlays", tileX: 2, tileY: 2 },
    ]);

    expect(ids(ordered)).toEqual(["a", "b", "priority", "z"]);
  });

  it("filters hidden entries without disturbing the visible order", () => {
    const ordered = planDrawOrder([
      { id: "visible-2", layer: "roads", tileX: 1, tileY: 1 },
      { id: "hidden", layer: "roads", tileX: 0, tileY: 0, hidden: true },
      { id: "visible-1", layer: "roads", tileX: 0, tileY: 0 },
    ]);

    expect(ids(ordered)).toEqual(["visible-1", "visible-2"]);
    expect(ordered.map((entry) => entry.drawIndex)).toEqual([0, 1]);
  });

  it("groups only adjacent ordered entries into submit batches", () => {
    const ordered = planDrawOrder([
      { id: "terrain-a", layer: "terrain", tileX: 0, tileY: 0, batchKey: "terrain" },
      { id: "road", layer: "roads", tileX: 0, tileY: 0, batchKey: "roads" },
      { id: "terrain-b", layer: "terrain", tileX: 1, tileY: 0, batchKey: "terrain" },
      { id: "label-a", layer: "labels", tileX: 0, tileY: 0, batchKey: "labels" },
      { id: "label-b", layer: "labels", tileX: 1, tileY: 0, batchKey: "labels" },
    ]);
    const batches = planDrawBatches(ordered);

    expect(batches.map((batch) => [batch.batchKey, batch.start, batch.end])).toEqual([
      ["terrain", 0, 2],
      ["roads", 2, 3],
      ["labels", 3, 5],
    ]);
    expect(batches.map((batch) => ids(batch.items))).toEqual([
      ["terrain-a", "terrain-b"],
      ["road"],
      ["label-a", "label-b"],
    ]);
  });

  it("keeps named and numeric layer ranks comparable", () => {
    expect(drawLayerRank("buildings")).toBe(DRAW_LAYERS.buildings);
    expect(drawLayerRank(35)).toBe(35);
    expect(
      compareDrawKeys(
        drawSortKey({ id: "a", layer: 35 }),
        drawSortKey({ id: "b", layer: "agents" }),
      ),
    ).toBeLessThan(0);
  });
});
