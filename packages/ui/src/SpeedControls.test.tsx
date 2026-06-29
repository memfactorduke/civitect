// @vitest-environment jsdom
import { CommandType } from "@civitect/protocol";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandIntent } from "./dispatch";
import { DispatchProvider } from "./dispatch";
import { SpeedControls } from "./SpeedControls";
import { createUiStore, type UiStore } from "./store";

afterEach(cleanup);

function renderSpeedControls(store: UiStore = createUiStore()): {
  readonly dispatched: CommandIntent[];
  readonly group: HTMLElement;
  readonly store: UiStore;
} {
  const dispatched: CommandIntent[] = [];
  render(
    <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
      <SpeedControls store={store} />
    </DispatchProvider>,
  );
  return {
    dispatched,
    group: screen.getByRole("group", { name: "Speed" }),
    store,
  };
}

function button(group: HTMLElement, name: string): HTMLElement {
  return within(group).getByRole("button", { name });
}

describe("SpeedControls", () => {
  it("marks only the current sim speed as pressed", () => {
    const { group, store } = renderSpeedControls();

    expect(button(group, "Pause").getAttribute("aria-pressed")).toBe("false");
    expect(button(group, "1×").getAttribute("aria-pressed")).toBe("true");
    expect(button(group, "3×").getAttribute("aria-pressed")).toBe("false");
    expect(button(group, "9×").getAttribute("aria-pressed")).toBe("false");

    act(() => store.setState({ speed: 9 }));

    expect(button(group, "Pause").getAttribute("aria-pressed")).toBe("false");
    expect(button(group, "1×").getAttribute("aria-pressed")).toBe("false");
    expect(button(group, "3×").getAttribute("aria-pressed")).toBe("false");
    expect(button(group, "9×").getAttribute("aria-pressed")).toBe("true");
  });

  it("dispatches setSpeed intents for the supported tiers", () => {
    const { dispatched, group } = renderSpeedControls();

    fireEvent.click(button(group, "Pause"));
    fireEvent.click(button(group, "1×"));
    fireEvent.click(button(group, "3×"));
    fireEvent.click(button(group, "9×"));

    expect(dispatched).toEqual([
      { type: CommandType.setSpeed, speed: 0 },
      { type: CommandType.setSpeed, speed: 1 },
      { type: CommandType.setSpeed, speed: 3 },
      { type: CommandType.setSpeed, speed: 9 },
    ]);
  });
});
