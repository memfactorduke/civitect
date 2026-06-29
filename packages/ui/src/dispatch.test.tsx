// @vitest-environment jsdom
/**
 * TDD section 9 boundary check: UI components emit protocol intents through context;
 * the app shell owns seq/tick stamping.
 */
import { CommandType } from "@civitect/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CommandIntent, DispatchProvider, useDispatch } from "./dispatch";

afterEach(cleanup);

function DispatchButton(props: { readonly intent: CommandIntent }): ReactNode {
  const dispatch = useDispatch();
  return (
    <button type="button" onClick={() => dispatch(props.intent)}>
      Dispatch intent
    </button>
  );
}

function MissingProviderProbe(): ReactNode {
  useDispatch();
  return null;
}

describe("DispatchProvider/useDispatch", () => {
  it("forwards protocol intents without seq/tick stamping", () => {
    const dispatched: CommandIntent[] = [];
    render(
      <DispatchProvider dispatch={(intent) => dispatched.push(intent)}>
        <DispatchButton intent={{ type: CommandType.setSpeed, speed: 3 }} />
      </DispatchProvider>,
    );

    screen.getByRole("button", { name: "Dispatch intent" }).click();

    expect(dispatched).toEqual([{ type: CommandType.setSpeed, speed: 3 }]);
    expect(dispatched[0]).not.toHaveProperty("seq");
    expect(dispatched[0]).not.toHaveProperty("tick");
  });

  it("uses the nearest provider so panel islands can override the app-shell sink", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <DispatchProvider dispatch={outer}>
        <DispatchProvider dispatch={inner}>
          <DispatchButton intent={{ type: CommandType.setSpeed, speed: 0 }} />
        </DispatchProvider>
      </DispatchProvider>,
    );

    screen.getByRole("button", { name: "Dispatch intent" }).click();

    expect(outer).not.toHaveBeenCalled();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledWith({ type: CommandType.setSpeed, speed: 0 });
  });

  it("fails loudly when a command-emitting component is rendered outside the app shell", () => {
    expect(() => render(<MissingProviderProbe />)).toThrow(
      /useDispatch outside <DispatchProvider>/,
    );
  });
});
