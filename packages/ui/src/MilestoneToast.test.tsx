// @vitest-environment jsdom
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MilestoneToast } from "./MilestoneToast";
import { createUiStore, type UiStore } from "./store";

afterEach(cleanup);

function snapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    kind: SnapshotKind.delta,
    tick: 1,
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

function feed(store: UiStore, snap: Snapshot): void {
  act(() => store.getState().applySnapshot(snap));
}

describe("MilestoneToast", () => {
  it("stays hidden until the snapshot has milestone state", () => {
    const store = createUiStore();
    render(<MilestoneToast store={store} />);

    expect(screen.queryByTestId("milestone-toast")).toBeNull();
  });

  it("names known unlocked mechanics while preserving the exact popcount", () => {
    const store = createUiStore();
    render(<MilestoneToast store={store} />);

    feed(
      store,
      snapshot({
        milestone: {
          index: 5,
          populationTarget: 9000,
          unlockedMask: (1 << 10) | (1 << 8) | (1 << 1) | 1,
        },
      }),
    );

    expect(screen.getByTestId("milestone-unlocks").textContent).toBe("4");
    expect(screen.getByTestId("milestone-unlock-budget-panel").textContent).toBe("Service budgets");
    expect(screen.getByTestId("milestone-unlock-loans").textContent).toBe("Loans");
    expect(screen.getByTestId("milestone-unlock-transit").textContent).toBe("Transit");
  });

  it("does not invent labels for future unknown bits", () => {
    const store = createUiStore();
    render(<MilestoneToast store={store} />);

    feed(
      store,
      snapshot({ milestone: { index: 2, populationTarget: 1200, unlockedMask: 1 << 20 } }),
    );

    expect(screen.getByTestId("milestone-unlocks").textContent).toBe("1");
    expect(screen.queryByTestId("milestone-unlock-list")).toBeNull();
  });

  it("omits the next population line when the ladder is complete", () => {
    const store = createUiStore();
    render(<MilestoneToast store={store} />);

    feed(
      store,
      snapshot({ milestone: { index: 13, populationTarget: 0, unlockedMask: 0b111111111 } }),
    );

    expect(screen.queryByTestId("milestone-next")).toBeNull();
    expect(screen.getByTestId("milestone-unlocks").textContent).toBe("9");
  });
});
