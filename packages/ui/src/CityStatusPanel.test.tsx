// @vitest-environment jsdom
/**
 * City status verification: the panel summarizes existing snapshot signals
 * without dispatching commands or reading sim internals.
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CityStatusPanel } from "./CityStatusPanel";
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

describe("CityStatusPanel", () => {
  it("summarizes deficit, strongest demand, milestone progress, and advisor risk", () => {
    const store = createUiStore();
    render(<CityStatusPanel store={store} />);

    feed(
      store,
      snapshot({
        hud: { population: 75, fundsCents: 1_000_000 },
        demand: { r: 12, c: -3, i: 44, o: 7, factors: [] },
        report: {
          month: 2,
          lines: [
            { kind: 1, amountCents: 20_000, deltaCents: 0 },
            { kind: 5, amountCents: -50_000, deltaCents: 0 },
          ],
        },
        milestone: { index: 1, populationTarget: 100, unlockedMask: 0b11 },
        advisorEvents: [
          {
            id: 1,
            tick: 1,
            severity: 2,
            messageKey: "advisor.garbage",
            cause: { summaryKey: "a", links: [] },
          },
          {
            id: 2,
            tick: 1,
            severity: 3,
            messageKey: "advisor.bankruptcy",
            cause: { summaryKey: "b", links: [] },
          },
        ],
      }),
    );

    expect(screen.getByTestId("city-status-cash").getAttribute("data-state")).toBe("deficit");
    expect(screen.getByTestId("city-status-net").getAttribute("data-cents")).toBe("-30000");
    expect(screen.getByTestId("city-status-demand-sector").textContent).toBe("Industrial");
    expect(screen.getByTestId("city-status-demand-value").textContent).toBe("44");
    expect(screen.getByTestId("city-status-demand-pressure").textContent).toBe("66");
    expect(screen.getByTestId("city-status-milestone-progress").getAttribute("data-percent")).toBe(
      "75",
    );
    expect(screen.getByTestId("city-status-advisors").getAttribute("data-severity")).toBe("3");
    expect(screen.getByTestId("city-status-advisor-count").textContent).toBe("2");
  });

  it("renders quiet defaults before reports, targets, or advisors arrive", () => {
    const store = createUiStore();
    render(<CityStatusPanel store={store} />);
    feed(store, snapshot({ tick: 2 }));

    expect(screen.getByTestId("city-status-cash").getAttribute("data-state")).toBe("no-report");
    expect(screen.queryByTestId("city-status-net")).toBeNull();
    expect(screen.getByTestId("city-status-demand").getAttribute("data-pressure")).toBe("0");
    expect(screen.getByTestId("city-status-demand").textContent).toContain("Quiet");
    expect(screen.getByTestId("city-status-milestone").textContent).toContain("No active target");
    expect(screen.getByTestId("city-status-advisors").getAttribute("data-severity")).toBe("0");
    expect(screen.getByTestId("city-status-advisor-count").textContent).toBe("0");
  });
});
