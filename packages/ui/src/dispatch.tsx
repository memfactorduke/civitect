/**
 * Command dispatch seam (TDD §9: "UI dispatches protocol commands only").
 *
 * Components emit *intents* — a Command minus seq/tick — because stamping is
 * the app shell's monopoly: the queue owner assigns seq order and the tick a
 * command applies on (TDD §7). The UI never guesses sim time.
 */
import type { Command } from "@civitect/protocol";
import { createContext, type ReactNode, useContext } from "react";

/** A protocol command before the app shell stamps seq + tick. */
export type CommandIntent = Command extends infer C
  ? C extends { seq: number; tick: number }
    ? Omit<C, "seq" | "tick">
    : never
  : never;

export type DispatchFn = (intent: CommandIntent) => void;

const DispatchContext = createContext<DispatchFn | null>(null);

export function DispatchProvider(props: {
  readonly dispatch: DispatchFn;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <DispatchContext.Provider value={props.dispatch}>{props.children}</DispatchContext.Provider>
  );
}

export function useDispatch(): DispatchFn {
  const dispatch = useContext(DispatchContext);
  if (dispatch === null) {
    throw new Error("useDispatch outside <DispatchProvider> — the app shell must wrap the overlay");
  }
  return dispatch;
}
