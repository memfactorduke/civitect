// @vitest-environment jsdom
/**
 * Focused demand-panel coverage (GDD §6): the player gets both a quick scan
 * meter and the exact factor arithmetic that explains each RCIO demand value.
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemandPanel } from "./DemandPanel";
import { createUiStore } from "./store";

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

describe("DemandPanel", () => {
  it("renders signed demand meters without hiding exact net values", () => {
    const store = createUiStore();
    render(<DemandPanel store={store} />);

    act(() => {
      store.getState().applySnapshot(
        snapshot({
          demand: {
            r: 725,
            c: -340,
            i: 0,
            o: 125,
            factors: [300, 250, 175, -200, -90, -50, 0, 0, 0, 50, 45, 30],
          },
        }),
      );
    });

    expect(screen.getByTestId("demand-r").textContent).toBe("725");
    expect(screen.getByTestId("demand-r-meter").getAttribute("value")).toBe("725");
    expect(screen.getByTestId("demand-r-meter").getAttribute("data-demand-sign")).toBe("positive");
    expect(screen.getByTestId("demand-c").textContent).toBe("-340");
    expect(screen.getByTestId("demand-c-meter").getAttribute("value")).toBe("-340");
    expect(screen.getByTestId("demand-c-meter").getAttribute("data-demand-sign")).toBe("negative");
    expect(screen.getByTestId("demand-i-meter").getAttribute("data-demand-sign")).toBe("neutral");
  });

  it("keeps meters clamped to protocol bounds while exposing raw demand", () => {
    const store = createUiStore();
    render(<DemandPanel store={store} />);

    act(() => {
      store.getState().applySnapshot(
        snapshot({
          demand: { r: 1300, c: -1600, i: 1000, o: -1000, factors: [] },
        }),
      );
    });

    expect(screen.getByTestId("demand-r").textContent).toBe("1300");
    expect(screen.getByTestId("demand-r-meter").getAttribute("value")).toBe("1000");
    expect(screen.getByTestId("demand-r-meter").getAttribute("data-raw-value")).toBe("1300");
    expect(screen.getByTestId("demand-c").textContent).toBe("-1600");
    expect(screen.getByTestId("demand-c-meter").getAttribute("value")).toBe("-1000");
    expect(screen.getByTestId("demand-c-meter").getAttribute("data-raw-value")).toBe("-1600");
  });

  it("shows missing factor contributions as zero so every sector stays explainable", () => {
    const store = createUiStore();
    render(<DemandPanel store={store} />);

    act(() => {
      store
        .getState()
        .applySnapshot(snapshot({ demand: { r: 9, c: 0, i: 0, o: 0, factors: [4, 5] } }));
    });

    expect(screen.getByTestId("demand-r-f0").textContent).toBe("4");
    expect(screen.getByTestId("demand-r-f1").textContent).toBe("5");
    expect(screen.getByTestId("demand-r-f2").textContent).toBe("0");
    expect(screen.getByTestId("demand-o-f2").textContent).toBe("0");
  });
});
