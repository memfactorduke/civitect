// @vitest-environment jsdom
import { CommandType } from "@civitect/protocol";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type CommandIntent, DispatchProvider } from "./dispatch";
import { OrdinancePanel } from "./OrdinancePanel";

afterEach(cleanup);

describe("OrdinancePanel", () => {
  it("dispatches setOrdinance intents without stamping seq or tick", () => {
    const intents: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(intent) => intents.push(intent)}>
        <OrdinancePanel />
      </DispatchProvider>,
    );

    fireEvent.click(screen.getByText("City ordinances"));
    const recycling = screen.getByTestId("ordinance-toggle-1");
    fireEvent.click(recycling);

    expect(intents).toEqual([{ type: CommandType.setOrdinance, ordinance: 1, on: 1 }]);
    expect(intents[0]).not.toHaveProperty("seq");
    expect(intents[0]).not.toHaveProperty("tick");
  });

  it("keeps independent optimistic checkbox state while commands settle", () => {
    const intents: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(intent) => intents.push(intent)}>
        <OrdinancePanel />
      </DispatchProvider>,
    );

    fireEvent.click(screen.getByText("City ordinances"));
    const smokeDetectors = screen.getByTestId("ordinance-toggle-0") as HTMLInputElement;
    const waterRestrictions = screen.getByTestId("ordinance-toggle-2") as HTMLInputElement;

    fireEvent.click(smokeDetectors);
    fireEvent.click(waterRestrictions);
    expect(smokeDetectors.checked).toBe(true);
    expect(waterRestrictions.checked).toBe(true);

    fireEvent.click(smokeDetectors);
    expect(smokeDetectors.checked).toBe(false);
    expect(waterRestrictions.checked).toBe(true);
    expect(intents).toEqual([
      { type: CommandType.setOrdinance, ordinance: 0, on: 1 },
      { type: CommandType.setOrdinance, ordinance: 2, on: 1 },
      { type: CommandType.setOrdinance, ordinance: 0, on: 0 },
    ]);
  });
});
