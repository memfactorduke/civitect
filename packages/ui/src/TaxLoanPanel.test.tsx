// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandIntent } from "./dispatch";
import { DispatchProvider } from "./dispatch";
import { createUiStore } from "./store";
import { TaxLoanPanel } from "./TaxLoanPanel";

afterEach(cleanup);

function renderPanel(dispatched: CommandIntent[] = []) {
  const store = createUiStore();
  render(
    <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
      <TaxLoanPanel store={store} />
    </DispatchProvider>,
  );
}

describe("TaxLoanPanel tax pressure readout", () => {
  it("shows the default tax rate as demand-neutral", () => {
    renderPanel();

    expect(screen.getByTestId("tax-value-1").textContent).toBe("9%");
    expect(screen.getByTestId("tax-pressure-1").textContent).toBe("Demand neutral");
    expect(screen.getByTestId("tax-pressure-1").getAttribute("data-pressure")).toBe("balanced");
  });

  it("marks low taxes as a demand boost", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.change(screen.getByTestId("tax-slider-1"), { target: { value: "60" } });

    expect(screen.getByTestId("tax-value-1").textContent).toBe("6%");
    expect(screen.getByTestId("tax-pressure-1").textContent).toBe("Demand boost");
    expect(screen.getByTestId("tax-pressure-1").getAttribute("data-pressure")).toBe("stimulus");
    expect(dispatched.at(-1)).toEqual({ type: 14, zone: 1, permille: 60 });
  });

  it("marks high taxes as demand pressure", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.change(screen.getByTestId("tax-slider-1"), { target: { value: "130" } });

    expect(screen.getByTestId("tax-value-1").textContent).toBe("13%");
    expect(screen.getByTestId("tax-pressure-1").textContent).toBe("Demand pressure");
    expect(screen.getByTestId("tax-pressure-1").getAttribute("data-pressure")).toBe("pressure");
    expect(dispatched.at(-1)).toEqual({ type: 14, zone: 1, permille: 130 });
    expect(dispatched.at(-1)).not.toHaveProperty("seq");
    expect(dispatched.at(-1)).not.toHaveProperty("tick");
  });
});
