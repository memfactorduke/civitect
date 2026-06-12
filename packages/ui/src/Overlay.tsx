/**
 * The DOM overlay root (ADR-009): everything panel-shaped lives under here,
 * above the Pixi canvas. The split rule: if it scrolls or contains
 * paragraphs it's DOM; if it's anchored to a world position it's Pixi.
 */
import type { ReactNode } from "react";
import { AdvisorFeed } from "./AdvisorFeed";
import { DemandPanel } from "./DemandPanel";
import { type DispatchFn, DispatchProvider } from "./dispatch";
import { Hud } from "./Hud";
import { SpeedControls } from "./SpeedControls";
import type { UiStore } from "./store";

export function Overlay(props: {
  readonly store: UiStore;
  readonly dispatch: DispatchFn;
}): ReactNode {
  return (
    <DispatchProvider dispatch={props.dispatch}>
      <Hud store={props.store} />
      <SpeedControls store={props.store} />
      <DemandPanel store={props.store} />
      <AdvisorFeed store={props.store} />
    </DispatchProvider>
  );
}
