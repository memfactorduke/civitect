// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UI_PREFERENCES,
  normalizeUiPreferences,
  SettingsPanel,
  type UiPreferences,
} from "./SettingsPanel";

afterEach(cleanup);

describe("SettingsPanel", () => {
  it("renders the current preference state", () => {
    render(
      <SettingsPanel
        preferences={{ reducedMotion: true, batterySaver: false, agentDensityPermille: 750 }}
        onChange={() => {}}
      />,
    );

    expect(
      (screen.getByRole("checkbox", { name: "Reduced motion" }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Battery saver" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.getByTestId("settings-agent-density-value").textContent).toBe("75%");
  });

  it("emits full preference objects when toggles change", () => {
    const changes: UiPreferences[] = [];
    render(
      <SettingsPanel
        preferences={DEFAULT_UI_PREFERENCES}
        onChange={(next) => changes.push(next)}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Reduced motion" }));
    expect(changes.at(-1)).toEqual({
      reducedMotion: true,
      batterySaver: false,
      agentDensityPermille: 1000,
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Battery saver" }));
    expect(changes.at(-1)).toEqual({
      reducedMotion: false,
      batterySaver: true,
      agentDensityPermille: 1000,
    });
  });

  it("emits stepped agent-density changes", () => {
    const changes: UiPreferences[] = [];
    render(
      <SettingsPanel
        preferences={DEFAULT_UI_PREFERENCES}
        onChange={(next) => changes.push(next)}
      />,
    );

    fireEvent.change(screen.getByTestId("settings-agent-density"), { target: { value: "600" } });
    expect(changes.at(-1)).toEqual({
      reducedMotion: false,
      batterySaver: false,
      agentDensityPermille: 600,
    });
  });

  it("normalizes density to the supported range and step", () => {
    expect(
      normalizeUiPreferences({
        reducedMotion: false,
        batterySaver: true,
        agentDensityPermille: 1024,
      }),
    ).toEqual({ reducedMotion: false, batterySaver: true, agentDensityPermille: 1000 });
    expect(
      normalizeUiPreferences({
        reducedMotion: true,
        batterySaver: false,
        agentDensityPermille: 221,
      }),
    ).toEqual({ reducedMotion: true, batterySaver: false, agentDensityPermille: 250 });
    expect(
      normalizeUiPreferences({
        reducedMotion: true,
        batterySaver: true,
        agentDensityPermille: 627,
      }),
    ).toEqual({ reducedMotion: true, batterySaver: true, agentDensityPermille: 650 });
  });
});
