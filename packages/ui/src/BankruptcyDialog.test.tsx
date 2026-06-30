// @vitest-environment jsdom
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BankruptcyDialog } from "./BankruptcyDialog";
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
    milestone: { index: 0, populationTarget: 240, unlockedMask: 1 },
    ...partial,
  };
}

function feed(store: UiStore, snap: Snapshot): void {
  act(() => store.getState().applySnapshot(snap));
}

function advisor(messageKey: string): Snapshot["advisorEvents"][number] {
  return {
    id: 1,
    tick: 1,
    severity: 3,
    messageKey,
    cause: { summaryKey: "cause.bankruptcy", links: [] },
  };
}

describe("BankruptcyDialog", () => {
  it("stays hidden until bailout or receivership advice arrives", () => {
    const store = createUiStore();
    render(<BankruptcyDialog store={store} />);
    expect(screen.queryByTestId("bankruptcy-dialog")).toBeNull();
    feed(store, snapshot({ advisorEvents: [advisor("advisor.bailout")] }));
    expect(screen.getByTestId("bankruptcy-dialog").getAttribute("data-state")).toBe("bailout");
    feed(store, snapshot({ tick: 2, advisorEvents: [advisor("advisor.receivership")] }));
    expect(screen.getByTestId("bankruptcy-dialog").getAttribute("data-state")).toBe("receivership");
  });

  it("summarizes the latest monthly net and largest drains", () => {
    const store = createUiStore();
    render(<BankruptcyDialog store={store} />);
    feed(
      store,
      snapshot({
        advisorEvents: [advisor("advisor.bailout")],
        report: {
          month: 8,
          lines: [
            { kind: 1, amountCents: 200_000, deltaCents: 25_000 },
            { kind: 5, amountCents: -80_000, deltaCents: -10_000 },
            { kind: 6, amountCents: -30_000, deltaCents: -5_000 },
            { kind: 9, amountCents: -120_000, deltaCents: -70_000 },
          ],
        },
      }),
    );

    expect(screen.getByTestId("bankruptcy-report").textContent).toContain("Latest report 8");
    expect(screen.getByTestId("bankruptcy-net").getAttribute("data-cents")).toBe("-30000");
    expect(screen.getByTestId("bankruptcy-net").textContent).toContain("$300");
    expect(
      screen.getAllByTestId(/^bankruptcy-driver-/).map((el) => el.getAttribute("data-kind")),
    ).toEqual(["9", "5", "6"]);
    expect(screen.getByTestId("bankruptcy-driver-9").textContent).toContain("Imports");
    expect(screen.getByTestId("bankruptcy-driver-5").textContent).toContain("Service upkeep");
  });
});
