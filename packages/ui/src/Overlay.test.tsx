// @vitest-environment jsdom
/**
 * RTL component tests (board PR 6 verification): snapshot scalars → rendered
 * HUD, and button → dispatched protocol intent. The store is fed exactly the
 * way the app shell will feed it — via applySnapshot with protocol objects.
 */
import { type Snapshot, SnapshotKind } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
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
