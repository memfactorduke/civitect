// @vitest-environment jsdom
import { AdvisorSeverity, type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Overlay } from "./Overlay";
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

describe("ActionPriorityPanel", () => {
  it("ranks cash, advisor, report, demand, and milestone signals", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);

    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 12,
          hud: { population: 200, fundsCents: -50_000_00 },
          advisorEvents: [
            {
              id: 10,
              tick: 12,
              severity: AdvisorSeverity.alert,
              messageKey: "advisor.garbage",
              cause: {
                summaryKey: "cause.noGarbageService",
                links: [
                  {
                    subject: { kind: 2, id: 301 },
                    labelKey: "cause.uncollectedWaste",
                    weightPermille: 900,
                  },
                ],
              },
            },
          ],
          demand: { r: 120, c: 720, i: 210, o: 40, factors: [] },
          report: {
            month: 2,
            lines: [
              { kind: 1, amountCents: 20_000_00, deltaCents: 0 },
              { kind: 5, amountCents: -80_000_00, deltaCents: -5_000_00 },
              { kind: 6, amountCents: -10_000_00, deltaCents: 0 },
            ],
          },
          milestone: { index: 0, populationTarget: 500, unlockedMask: 0 },
        }),
      );
    });

    const priorities = screen.getAllByTestId("action-priority");
    expect(priorities.map((node) => node.getAttribute("data-priority-id"))).toEqual([
      "cash",
      "advisor",
      "report",
      "demand",
      "milestone",
    ]);
    expect(priorities[0]?.getAttribute("data-severity")).toBe("alert");
    expect(screen.getByTestId("action-demand-sector").textContent).toBe("Commercial");
    expect(screen.getByTestId("action-report-worst").textContent).toContain("Service upkeep");
    expect(screen.getByTestId("action-milestone-needed").textContent).toBe("300");

    const advisorPriority = priorities.find(
      (node) => node.getAttribute("data-priority-id") === "advisor",
    );
    if (advisorPriority === undefined) {
      throw new Error("advisor priority not rendered");
    }
    expect(
      within(advisorPriority).getByTestId("cause-link").getAttribute("data-subject-kind"),
    ).toBe("building");
    expect(within(advisorPriority).getByTestId("cause-link").getAttribute("data-subject-id")).toBe(
      "301",
    );
  });

  it("shows a stable fallback when no urgent signals are present", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);
    expect(screen.getByTestId("action-empty").textContent).toContain("City stable.");

    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 1,
          hud: { population: 1000, fundsCents: 5_000_000_00 },
          demand: { r: 120, c: 80, i: -20, o: 10, factors: [] },
          report: {
            month: 1,
            lines: [
              { kind: 1, amountCents: 50_000_00, deltaCents: 0 },
              { kind: 5, amountCents: -25_000_00, deltaCents: 0 },
            ],
          },
          milestone: { index: 2, populationTarget: 0, unlockedMask: 0 },
        }),
      );
    });

    expect(screen.getByTestId("action-empty").textContent).toContain("No urgent issues");
  });
});
