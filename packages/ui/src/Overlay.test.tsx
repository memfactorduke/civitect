// @vitest-environment jsdom
/**
 * RTL component tests (board PR 6 verification): snapshot scalars → rendered
 * HUD, and button → dispatched protocol intent. The store is fed exactly the
 * way the app shell will feed it — via applySnapshot with protocol objects.
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandIntent } from "./dispatch";
import { Overlay } from "./Overlay";
import { createUiStore } from "./store";

// RTL auto-cleanup needs test globals, which stay off (vitest.config.ts);
// without this, renders accumulate across tests and queries find duplicates.
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
    ...partial,
  };
}

describe("Overlay (HUD + speed controls)", () => {
  it("renders snapshot scalars after applySnapshot", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);

    expect(screen.getByTestId("hud-population").textContent).toBe("0");

    act(() => {
      store
        .getState()
        .applySnapshot(snapshot({ tick: 42, hud: { population: 1500, fundsCents: 2_500_000_00 } }));
    });

    expect(screen.getByTestId("hud-population").textContent).toBe("1,500");
    expect(screen.getByTestId("hud-funds").textContent).toBe("$2,500,000");
    expect(screen.getByTestId("hud-tick").textContent).toBe("42");
  });

  it("shows the selected tile and clears it on null", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);

    expect(screen.getByTestId("hud-selected-tile").textContent).toBe("No tile selected");

    act(() => {
      store.getState().applySnapshot(snapshot({ tick: 1, selectedTile: { x: 7, y: 11 } }));
    });
    expect(screen.getByTestId("hud-selected-tile").textContent).toBe("Selected tile: 7, 11");
  });

  it("speed buttons dispatch setSpeed intents (UI never stamps seq/tick)", () => {
    const store = createUiStore();
    const dispatched: CommandIntent[] = [];
    render(<Overlay store={store} dispatch={(intent) => dispatched.push(intent)} />);

    act(() => {
      screen.getByRole("button", { name: "9×" }).click();
    });
    expect(dispatched).toEqual([{ type: 2, speed: 9 }]); // CommandType.setSpeed = 2

    act(() => {
      screen.getByRole("button", { name: "Pause" }).click();
    });
    expect(dispatched).toHaveLength(2);
    expect(dispatched[1]).toEqual({ type: 2, speed: 0 });
    for (const intent of dispatched) {
      expect(intent).not.toHaveProperty("seq");
      expect(intent).not.toHaveProperty("tick");
    }
  });

  it("marks the active speed via aria-pressed from store state", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);

    expect(screen.getByRole("button", { name: "1×" }).getAttribute("aria-pressed")).toBe("true");

    act(() => {
      store.getState().applySnapshot(snapshot({ tick: 5, speed: 3 }));
    });
    expect(screen.getByRole("button", { name: "3×" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "1×" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("ignores stale DELTAS (older tick) — last-tick-wins", () => {
    const store = createUiStore();
    act(() => {
      store
        .getState()
        .applySnapshot(snapshot({ tick: 10, hud: { population: 100, fundsCents: 0 } }));
      store.getState().applySnapshot(snapshot({ tick: 3, hud: { population: 7, fundsCents: 0 } }));
    });
    expect(store.getState().population).toBe(100);
    expect(store.getState().tick).toBe(10);
  });

  it("accepts KEYFRAMES at older ticks — save-load rewinds time (TDD §7)", () => {
    const store = createUiStore();
    act(() => {
      store.getState().applySnapshot(snapshot({ tick: 100, speed: 9 }));
      store.getState().applySnapshot(snapshot({ kind: SnapshotKind.keyframe, tick: 7, speed: 0 }));
    });
    expect(store.getState().tick).toBe(7);
    expect(store.getState().speed).toBe(0);
  });
});

describe("DemandPanel (exit criterion 3: factors sum to displayed demand)", () => {
  it("displayed factor values sum to the displayed net, for arbitrary blocks (property)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -500, max: 500 }), { minLength: 12, maxLength: 12 }),
        (factors) => {
          cleanup();
          const store = createUiStore();
          const demand = {
            r: factors[0]! + factors[1]! + factors[2]!,
            c: factors[3]! + factors[4]! + factors[5]!,
            i: factors[6]! + factors[7]! + factors[8]!,
            o: factors[9]! + factors[10]! + factors[11]!,
            factors,
          };
          render(<Overlay store={store} dispatch={() => {}} />);
          act(() => {
            store.getState().applySnapshot(snapshot({ tick: 1, demand }));
          });
          for (const [key] of [
            ["r", 0],
            ["c", 3],
            ["i", 6],
            ["o", 9],
          ] as const) {
            const net = Number(screen.getByTestId(`demand-${key}`).textContent);
            const sum =
              Number(screen.getByTestId(`demand-${key}-f0`).textContent) +
              Number(screen.getByTestId(`demand-${key}-f1`).textContent) +
              Number(screen.getByTestId(`demand-${key}-f2`).textContent);
            expect(sum).toBe(net);
            expect(net).toBe(demand[key]);
          }
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe("AdvisorFeed (cause chains rendered with resolvable refs)", () => {
  it("renders events with subject kind/id data attributes", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);
    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 9,
          advisorEvents: [
            {
              id: 1,
              tick: 9,
              severity: 2,
              messageKey: "advisor.abandonment",
              cause: {
                summaryKey: "cause.utilityFailure",
                links: [
                  {
                    subject: { kind: 2, id: 1234 },
                    labelKey: "cause.noUtilities",
                    weightPermille: 1000,
                  },
                ],
              },
            },
          ],
        }),
      );
    });
    const link = screen.getByTestId("cause-link");
    expect(link.getAttribute("data-subject-kind")).toBe("building");
    expect(link.getAttribute("data-subject-id")).toBe("1234");
  });

  it("accumulates events across snapshots (feed, not last-frame)", () => {
    const store = createUiStore();
    const event = (id: number) => ({
      id,
      tick: id,
      severity: 1 as const,
      messageKey: "advisor.abandonment",
      cause: { summaryKey: "s", links: [] },
    });
    act(() => {
      store.getState().applySnapshot(snapshot({ tick: 1, advisorEvents: [event(1)] }));
      store.getState().applySnapshot(snapshot({ tick: 2, advisorEvents: [event(2)] }));
    });
    expect(store.getState().advisorEvents.map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("budget panel (GDD §7 sliders)", () => {
  it("a slider move dispatches setServiceBudget with the service + permille", () => {
    const store = createUiStore();
    const intents: object[] = [];
    render(<Overlay store={store} dispatch={(i) => intents.push(i)} />);
    fireEvent.click(screen.getByText("Service budgets"));
    const slider = screen.getByTestId("budget-slider-8"); // garbage
    fireEvent.change(slider, { target: { value: "1300" } });
    expect(intents).toContainEqual({ type: 13, service: 8, permille: 1300 });
    expect(screen.getByTestId("budget-value-8").textContent).toBe("130%");
  });
});

describe("advisor feed groups by cause (GDD §15 [LOCKED])", () => {
  it("three same-cause events render one row with a ×3 badge", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);
    const event = (id: number): Snapshot["advisorEvents"][number] => ({
      id,
      tick: id,
      severity: 2 as Snapshot["advisorEvents"][number]["severity"],
      messageKey: "advisor.garbage",
      cause: {
        summaryKey: "cause.noGarbageService",
        links: [{ subject: { kind: 2, id: 100 + id }, labelKey: "cause.x", weightPermille: 1000 }],
      },
    });
    act(() => {
      store.getState().applySnapshot(
        snapshot({
          tick: 5,
          advisorEvents: [event(1), event(2), event(3)],
        }),
      );
    });
    const rows = screen.getAllByTestId("advisor-event");
    expect(rows.length).toBe(1);
    expect(screen.getByTestId("advisor-count").textContent).toBe("×3");
  });
});

describe("building inspector (pillar 1)", () => {
  it("renders service capacity/effectiveness and the environment block", () => {
    const store = createUiStore();
    render(<Overlay store={store} dispatch={() => {}} />);
    act(() => {
      store.getState().applyInspectorResponse({
        requestId: 1,
        tick: 10,
        tile: null,
        road: null,
        building: {
          kind: 103,
          level: 1,
          status: 0,
          serviceId: 1,
          capacityTotal: 4,
          capacityUsed: 0,
          queueLength: 0,
          effectivenessPermille: 730,
        },
        environ: { airPollution: 12, groundPollution: 3, noise: 40, waterPollution: 0 },
      });
    });
    expect(screen.getByTestId("building-capacity").textContent).toBe("4");
    expect(screen.getByTestId("building-effectiveness").textContent).toBe("73%");
    expect(screen.getByTestId("environ-air").textContent).toBe("12");
  });
});
