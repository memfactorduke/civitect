// @vitest-environment jsdom

import type { BuildingInfo } from "@civitect/protocol";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BuildingInspector } from "./BuildingInspector";
import { createUiStore, type UiStore } from "./store";

afterEach(cleanup);

function showBuilding(store: UiStore, building: BuildingInfo) {
  act(() => {
    store.getState().applyInspectorResponse({
      requestId: 1,
      tick: 10,
      tile: null,
      road: null,
      building,
      environ: null,
    });
  });
}

function serviceBuilding(status: number, effectivenessPermille: number) {
  return {
    kind: 103,
    level: 2,
    status,
    serviceId: 1,
    capacityTotal: 12,
    capacityUsed: 3,
    queueLength: 1,
    effectivenessPermille,
  };
}

describe("BuildingInspector readouts", () => {
  it("localizes known building statuses", () => {
    const store = createUiStore();
    render(<BuildingInspector store={store} />);

    showBuilding(store, serviceBuilding(3, 1000));

    expect(screen.getByTestId("building-status").textContent).toBe("Abandoned");
    expect(screen.getByTestId("building-status").getAttribute("data-building-status")).toBe("3");
  });

  it("keeps unknown status codes visible", () => {
    const store = createUiStore();
    render(<BuildingInspector store={store} />);

    showBuilding(store, serviceBuilding(99, 1000));

    expect(screen.getByTestId("building-status").textContent).toBe("Status 99");
    expect(screen.getByTestId("building-status").getAttribute("data-building-status")).toBe("99");
  });

  it("labels service effectiveness bands without changing the raw percent", () => {
    const store = createUiStore();
    render(<BuildingInspector store={store} />);

    showBuilding(store, serviceBuilding(0, 730));

    expect(screen.getByTestId("building-effectiveness").textContent).toContain("73%");
    expect(screen.getByTestId("building-effectiveness-label").textContent).toBe("Partial coverage");
    expect(
      screen.getByTestId("building-effectiveness-readout").getAttribute("data-effectiveness-band"),
    ).toBe("partial");
  });
});
