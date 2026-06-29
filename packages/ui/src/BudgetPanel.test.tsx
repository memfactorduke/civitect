// @vitest-environment jsdom
/**
 * Focused service-budget UI coverage (GDD §7): every slider maps to a protocol
 * service id, stays in the 50-150% range, and dispatches only app-stamped
 * command intents.
 */
import { CommandType, SERVICE_ID_LIST } from "@civitect/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetPanel } from "./BudgetPanel";
import type { CommandIntent } from "./dispatch";
import { DispatchProvider } from "./dispatch";

afterEach(cleanup);

function renderBudgetPanel(): CommandIntent[] {
  const dispatched: CommandIntent[] = [];
  render(
    <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
      <BudgetPanel />
    </DispatchProvider>,
  );
  return dispatched;
}

describe("BudgetPanel", () => {
  it("renders one bounded 100% slider for every service budget", () => {
    renderBudgetPanel();

    for (const service of SERVICE_ID_LIST) {
      const slider = screen.getByTestId(`budget-slider-${service}`) as HTMLInputElement;
      expect(slider.getAttribute("min")).toBe("500");
      expect(slider.getAttribute("max")).toBe("1500");
      expect(slider.getAttribute("step")).toBe("50");
      expect(slider.value).toBe("1000");
      expect(screen.getByTestId(`budget-value-${service}`).textContent).toBe("100%");
    }
  });

  it("dispatches setServiceBudget intents and updates the shown percent", () => {
    const dispatched = renderBudgetPanel();

    for (const [index, service] of SERVICE_ID_LIST.entries()) {
      const permille = 550 + index * 100;
      fireEvent.change(screen.getByTestId(`budget-slider-${service}`), {
        target: { value: String(permille) },
      });
      expect(dispatched.at(-1)).toEqual({
        type: CommandType.setServiceBudget,
        service,
        permille,
      });
      expect(screen.getByTestId(`budget-value-${service}`).textContent).toBe(
        `${(permille / 10).toFixed(0)}%`,
      );
    }

    expect(dispatched).toHaveLength(SERVICE_ID_LIST.length);
    for (const intent of dispatched) {
      expect(intent).not.toHaveProperty("seq");
      expect(intent).not.toHaveProperty("tick");
    }
  });
});
