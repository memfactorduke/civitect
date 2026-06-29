// @vitest-environment jsdom
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Hud } from "./Hud";
import { createUiStore, type UiStore } from "./store";

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

function feed(store: UiStore, snap: Snapshot): void {
  act(() => store.getState().applySnapshot(snap));
}

describe("Hud game clock", () => {
  it("renders a readable Month/Day clock beside the raw tick", () => {
    const store = createUiStore();
    render(<Hud store={store} />);

    feed(store, snapshot({ tick: 0 }));
    expect(screen.getByTestId("hud-tick").textContent).toBe("0");
    expect(screen.getByTestId("hud-game-time").textContent).toBe("Month 1, Day 1, 00:00");

    feed(store, snapshot({ tick: 1501 }));
    expect(screen.getByTestId("hud-tick").textContent).toBe("1501");
    expect(screen.getByTestId("hud-game-time").textContent).toBe("Month 1, Day 2, 01:01");
  });

  it("advances to the next month at the monthly budget boundary", () => {
    const store = createUiStore();
    render(<Hud store={store} />);

    feed(store, snapshot({ tick: 43_199 }));
    expect(screen.getByTestId("hud-game-time").textContent).toBe("Month 1, Day 30, 23:59");

    feed(store, snapshot({ tick: 43_200 }));
    expect(screen.getByTestId("hud-game-time").textContent).toBe("Month 2, Day 1, 00:00");
  });
});
