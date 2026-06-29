// @vitest-environment jsdom
/**
 * Economy UI verification (board phase-5 task 5): the report's lines sum to the
 * net it shows, tax sliders dispatch setTaxRate, the milestone toast renders
 * from the snapshot block, loan controls gate on the unlock mask, the funds HUD
 * goes red in debt, and the bankruptcy dialog surfaces on the advisor.
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BankruptcyDialog } from "./BankruptcyDialog";
import type { CommandIntent } from "./dispatch";
import { DispatchProvider } from "./dispatch";
import { Hud } from "./Hud";
import { MilestoneToast } from "./MilestoneToast";
import { ReportPanel } from "./ReportPanel";
import { createUiStore, type UiStore } from "./store";
import { TaxLoanPanel } from "./TaxLoanPanel";

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

describe("ReportPanel (the report explains itself, GDD §12)", () => {
  it("the displayed net equals the sum of the displayed line amounts", () => {
    const store = createUiStore();
    render(<ReportPanel store={store} />);
    expect(screen.queryByTestId("report-panel")).toBeNull(); // nothing before a close
    feed(
      store,
      snapshot({
        report: {
          month: 3,
          lines: [
            { kind: 1, amountCents: 120_000, deltaCents: 10_000 }, // R tax
            { kind: 5, amountCents: -45_000, deltaCents: -2_000 }, // upkeep
            { kind: 6, amountCents: -8_000, deltaCents: 500 }, // roads
            { kind: 9, amountCents: -30_000, deltaCents: -30_000 }, // imports
          ],
        },
      }),
    );
    const lines = screen.getAllByTestId(/^report-amount-/);
    const sum = lines.reduce((acc, el) => acc + Number(el.getAttribute("data-cents")), 0);
    const net = Number(screen.getByTestId("report-net").getAttribute("data-cents"));
    expect(net).toBe(sum); // what the player sees adds up, exactly
    expect(net).toBe(120_000 - 45_000 - 8_000 - 30_000);
  });

  it("splits report lines into income, expenses, and net change", () => {
    const store = createUiStore();
    render(<ReportPanel store={store} />);
    feed(
      store,
      snapshot({
        report: {
          month: 4,
          lines: [
            { kind: 1, amountCents: 250_000, deltaCents: 25_000 },
            { kind: 10, amountCents: 40_000, deltaCents: 40_000 },
            { kind: 5, amountCents: -72_500, deltaCents: -12_500 },
            { kind: 13, amountCents: -180_000, deltaCents: 20_000 },
            { kind: 7, amountCents: 0, deltaCents: -2_500 },
          ],
        },
      }),
    );
    expect(screen.getByTestId("report-income-total").getAttribute("data-cents")).toBe("290000");
    expect(screen.getByTestId("report-expense-total").getAttribute("data-cents")).toBe("-252500");
    expect(screen.getByTestId("report-net").getAttribute("data-cents")).toBe("37500");
    expect(screen.getByTestId("report-net-delta").getAttribute("data-cents")).toBe("70000");
  });

  it("keeps showing the last report after the close tick passes", () => {
    const store = createUiStore();
    render(<ReportPanel store={store} />);
    feed(
      store,
      snapshot({
        tick: 100,
        report: { month: 1, lines: [{ kind: 1, amountCents: 5, deltaCents: 5 }] },
      }),
    );
    feed(store, snapshot({ tick: 101, report: null })); // a non-close tick
    expect(screen.getByTestId("report-panel")).toBeTruthy(); // still shown
  });
});

describe("TaxLoanPanel (commands with optimistic ghosts, GDD §8/§13)", () => {
  it("the tax slider dispatches setTaxRate for its zone", () => {
    const store = createUiStore();
    const dispatched: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(i) => dispatched.push(i)}>
        <TaxLoanPanel store={store} />
      </DispatchProvider>,
    );
    const slider = screen.getByTestId("tax-slider-1");
    act(() => {
      fireEvent.change(slider, { target: { value: "150" } });
    });
    expect(dispatched.at(-1)).toEqual({ type: 14, zone: 1, permille: 150 }); // setTaxRate
  });

  it("loan controls are hidden until loans unlock, then dispatch takeLoan", () => {
    const store = createUiStore();
    const dispatched: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(i) => dispatched.push(i)}>
        <TaxLoanPanel store={store} />
      </DispatchProvider>,
    );
    feed(store, snapshot({ milestone: { index: 0, populationTarget: 240, unlockedMask: 1 } }));
    expect(screen.queryByTestId("loan-controls")).toBeNull(); // loans bit not set
    feed(store, snapshot({ milestone: { index: 1, populationTarget: 500, unlockedMask: 0b11 } }));
    expect(screen.getByTestId("loan-controls")).toBeTruthy();
    act(() => screen.getByTestId("loan-take-1").click());
    expect(dispatched.at(-1)).toEqual({ type: 15, tier: 1 }); // takeLoan tier 1
  });
});

describe("MilestoneToast renders from the snapshot block (task 4 wire)", () => {
  it("shows the index and the next population gate", () => {
    const store = createUiStore();
    render(<MilestoneToast store={store} />);
    feed(
      store,
      snapshot({ milestone: { index: 5, populationTarget: 9000, unlockedMask: 0b101111 } }),
    );
    expect(screen.getByTestId("milestone-index").textContent).toContain("5");
    expect(screen.getByTestId("milestone-next").textContent).toContain("9,000");
    expect(screen.getByTestId("milestone-unlocks").textContent).toBe("5"); // popcount
  });
});

describe("funds HUD + bankruptcy dialog (GDD §2)", () => {
  it("the funds readout goes red in debt", () => {
    const store = createUiStore();
    render(<Hud store={store} />);
    feed(store, snapshot({ hud: { population: 10, fundsCents: 5000 } }));
    expect(screen.getByTestId("hud-funds").getAttribute("data-debt")).toBe("false");
    feed(store, snapshot({ tick: 2, hud: { population: 10, fundsCents: -100 } }));
    expect(screen.getByTestId("hud-funds").getAttribute("data-debt")).toBe("true");
  });

  it("the dialog surfaces the bailout, then escalates to receivership", () => {
    const store = createUiStore();
    render(<BankruptcyDialog store={store} />);
    expect(screen.queryByTestId("bankruptcy-dialog")).toBeNull();
    const advisor = (messageKey: string) => ({
      id: 1,
      tick: 1,
      severity: 3 as const,
      messageKey,
      cause: { summaryKey: "cause.bankruptcy", links: [] },
    });
    feed(store, snapshot({ advisorEvents: [advisor("advisor.bailout")] }));
    expect(screen.getByTestId("bankruptcy-dialog").getAttribute("data-state")).toBe("bailout");
    feed(store, snapshot({ tick: 2, advisorEvents: [advisor("advisor.receivership")] }));
    expect(screen.getByTestId("bankruptcy-dialog").getAttribute("data-state")).toBe("receivership");
  });
});
