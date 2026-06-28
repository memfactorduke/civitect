import type { RoadSegment } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { type DisplayState, initialDisplayState } from "./display";
import { createWorldStage } from "./stage";

function displayState(partial: Partial<DisplayState>): DisplayState {
  return { ...initialDisplayState(), ...partial };
}

const road: RoadSegment = { ax: 0, ay: 0, bx: 2, by: 0, roadClass: 1 };

describe("world stage rebuild stats", () => {
  it("counts initial and explicit chunk bakes without exposing mutable state", () => {
    const stage = createWorldStage({ mapWidth: 40, mapHeight: 33 });

    expect(stage.chunkCount).toBe(4);
    expect(stage.stats().terrainBakeCount).toBe(4);

    stage.rebakeChunks([0, 3, -1, 99]);
    expect(stage.stats().terrainBakeCount).toBe(6);

    const snapshot = stage.stats() as { terrainBakeCount: number };
    snapshot.terrainBakeCount = 0;
    expect(stage.stats().terrainBakeCount).toBe(6);

    stage.root.destroy({ children: true });
  });

  it("does not redraw road and building layers when versions are unchanged", () => {
    const stage = createWorldStage({ mapWidth: 8, mapHeight: 8 });
    const first = displayState({
      tick: 1,
      roadVersion: 1,
      roads: [road],
      buildingVersion: 1,
      buildings: [],
    });

    stage.update(first);
    expect(stage.stats()).toMatchObject({ roadDrawCount: 1, buildingDrawCount: 1 });

    stage.update(displayState({ ...first, tick: 2 }));
    expect(stage.stats()).toMatchObject({ roadDrawCount: 1, buildingDrawCount: 1 });

    stage.update(
      displayState({
        ...first,
        tick: 3,
        roadVersion: 2,
        buildingVersion: 2,
      }),
    );
    expect(stage.stats()).toMatchObject({ roadDrawCount: 2, buildingDrawCount: 2 });

    stage.root.destroy({ children: true });
  });
});
