// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetPanel } from "./BudgetPanel";
import type { CommandIntent } from "./dispatch";
import { DispatchProvider } from "./dispatch";

afterEach(cleanup);

function renderPanel(dispatched: CommandIntent[] = []) {
  render(
    <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
      <BudgetPanel />
    </DispatchProvider>,
  );
}

describe("BudgetPanel service budget posture", () => {
  it("marks the default service budget as standard service", () => {
    renderPanel();

    expect(screen.getByTestId("budget-value-1").textContent).toBe("100%");
    expect(screen.getByTestId("budget-posture-1").textContent).toBe("Standard service");
    expect(screen.getByTestId("budget-posture-1").getAttribute("data-budget-posture")).toBe(
      "standard",
    );
  });

  it("marks a reduced service budget as a cutback", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.change(screen.getByTestId("budget-slider-1"), { target: { value: "500" } });

    expect(screen.getByTestId("budget-value-1").textContent).toBe("50%");
    expect(screen.getByTestId("budget-posture-1").textContent).toBe("Cutback");
    expect(screen.getByTestId("budget-posture-1").getAttribute("data-budget-posture")).toBe(
      "cutback",
    );
    expect(dispatched.at(-1)).toEqual({ type: 13, service: 1, permille: 500 });
  });

  it("marks an increased service budget as overtime service", () => {
    const dispatched: CommandIntent[] = [];
    renderPanel(dispatched);

    fireEvent.change(screen.getByTestId("budget-slider-1"), { target: { value: "1500" } });

    expect(screen.getByTestId("budget-value-1").textContent).toBe("150%");
    expect(screen.getByTestId("budget-posture-1").textContent).toBe("Overtime service");
    expect(screen.getByTestId("budget-posture-1").getAttribute("data-budget-posture")).toBe(
      "overtime",
    );
    expect(dispatched.at(-1)).toEqual({ type: 13, service: 1, permille: 1500 });
    expect(dispatched.at(-1)).not.toHaveProperty("seq");
    expect(dispatched.at(-1)).not.toHaveProperty("tick");
  });
});
