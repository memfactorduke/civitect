// @vitest-environment jsdom
import { CommandType, type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type CommandIntent, DispatchProvider } from "./dispatch";
import { SpeedControls } from "./SpeedControls";
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

describe("SpeedControls", () => {
  it("marks the current tier as pressed and disables its no-op command", () => {
    const store = createUiStore();
    const dispatched: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
        <SpeedControls store={store} />
      </DispatchProvider>,
    );

    const normal = screen.getByRole("button", { name: "1×" });
    expect(normal.getAttribute("aria-pressed")).toBe("true");
    expect(normal.hasAttribute("disabled")).toBe(true);

    fireEvent.click(normal);
    expect(dispatched).toHaveLength(0);
  });

  it("dispatches only protocol speed intents when changing tiers", () => {
    const store = createUiStore();
    const dispatched: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
        <SpeedControls store={store} />
      </DispatchProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "9×" }));
    expect(dispatched).toEqual([{ type: CommandType.setSpeed, speed: 9 }]);
    expect(dispatched[0]).not.toHaveProperty("seq");
    expect(dispatched[0]).not.toHaveProperty("tick");

    act(() => {
      store.getState().applySnapshot(snapshot({ tick: 4, speed: 9 }));
    });

    const fastest = screen.getByRole("button", { name: "9×" });
    expect(fastest.getAttribute("aria-pressed")).toBe("true");
    expect(fastest.hasAttribute("disabled")).toBe(true);
    expect(fastest.getAttribute("data-speed")).toBe("9");
  });
});
