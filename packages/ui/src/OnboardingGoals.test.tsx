// @vitest-environment jsdom
import {
  type BuildingView,
  type RoadSegment,
  type Snapshot,
  SnapshotKind,
} from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OnboardingGoals } from "./OnboardingGoals";
import { createUiStore } from "./store";

afterEach(cleanup);

function snapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    kind: SnapshotKind.delta,
    tick: 0,
    speed: 1,
    selectedTile: null,
    dirtyChunkIds: new Uint32Array(0),
    hud: { population: 0, fundsCents: 0 },
    advisorEvents: [],
    roadVersion: 0,
    roads: null,
    demand: { r: 0, c: 0, i: 0, o: 0, factors: [] },
    buildingVersion: 0,
    buildings: null,
    zoneVersion: 0,
    zones: null,
    agentCount: 0,
    congestionVersion: 0,
    congestion: null,
    coverageService: 0,
    coverageVersion: 0,
    coverage: null,
    report: null,
    milestone: null,
    ...partial,
  };
}

const road: RoadSegment = { ax: 0, ay: 0, bx: 4, by: 0, roadClass: 1 };
const building: BuildingView = { x: 1, y: 1, kind: 1, level: 1, status: 0 };

describe("OnboardingGoals", () => {
  it("starts with the road-grid goal as current", () => {
    const store = createUiStore();
    render(<OnboardingGoals store={store} />);

    expect(screen.getByTestId("onboarding-progress").getAttribute("value")).toBe("1");
    expect(screen.getByTestId("onboarding-current-onboarding.goal.roads").textContent).toContain(
      "Start the road grid",
    );
  });

  it("derives first-city progress from carried snapshot lists", () => {
    const store = createUiStore();
    render(<OnboardingGoals store={store} />);

    const zones = new Uint16Array([0, 1, 0, 2, 0, 0]);
    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 1,
          hud: { population: 275, fundsCents: 12_000_000 },
          roads: [road],
          buildings: [building],
          zones,
          milestone: { index: 1, populationTarget: 500, unlockedMask: 1 },
          report: { month: 1, lines: [] },
        }),
      );
    });

    expect(screen.getByTestId("onboarding-progress").getAttribute("value")).toBe("6");
    expect(screen.getAllByText("Done")).toHaveLength(6);
    expect(store.getState().roadCount).toBe(1);
    expect(store.getState().buildingCount).toBe(1);
    expect(store.getState().zonedTileCount).toBe(2);
  });

  it("preserves counts on deltas that omit unchanged lists", () => {
    const store = createUiStore();
    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 1,
          roads: [road],
          buildings: [building],
          zones: new Uint16Array([1, 1, 0]),
        }),
      );
      store.getState().applySnapshot(snapshot({ tick: 2, hud: { population: 10, fundsCents: 1 } }));
    });

    expect(store.getState().roadCount).toBe(1);
    expect(store.getState().buildingCount).toBe(1);
    expect(store.getState().zonedTileCount).toBe(2);
  });

  it("resets derived counts on keyframe rewinds with empty lists", () => {
    const store = createUiStore();
    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 9,
          roads: [road],
          buildings: [building],
          zones: new Uint16Array([1, 1, 1]),
        }),
      );
      store.getState().applySnapshot(snapshot({ kind: SnapshotKind.keyframe, tick: 0 }));
    });

    expect(store.getState().roadCount).toBe(0);
    expect(store.getState().buildingCount).toBe(0);
    expect(store.getState().zonedTileCount).toBe(0);
  });
});
