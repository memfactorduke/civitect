/**
 * Snapshot → display-state projection (TDD §8).
 *
 * The renderer's only knowledge of the sim is what protocol snapshots say —
 * this module turns them into the view-model the stage draws from. Pure and
 * DOM/Pixi-free so the board PR 5 verification ("snapshot→display-state
 * units") runs in Node.
 */
import type { Snapshot } from "@civitect/protocol";

export interface DisplayState {
  /** Last applied sim tick — stale-frame detection once deltas interleave. */
  readonly tick: number;
  readonly speed: number;
  /** Highlighted tile, or null when nothing is selected. */
  readonly highlight: { readonly x: number; readonly y: number } | null;
  readonly hud: {
    readonly population: number;
    readonly fundsCents: number;
  };
}

export function initialDisplayState(): DisplayState {
  return {
    tick: -1,
    speed: 1,
    highlight: null,
    hud: { population: 0, fundsCents: 0 },
  };
}

/**
 * Apply one snapshot. Phase 0 snapshots carry full visible state, so delta
 * and keyframe apply identically; once Phase 1 chunks land, keyframes reset
 * accumulated chunk state and deltas patch it (TDD §7).
 *
 * Out-of-order snapshots (tick older than current) are ignored — transferable
 * postMessage preserves order, but a re-posted keyframe after a scene jump
 * may race a stale delta; last-tick-wins is the rule.
 */
export function applySnapshot(state: DisplayState, snapshot: Snapshot): DisplayState {
  if (snapshot.tick < state.tick) {
    return state;
  }
  return {
    tick: snapshot.tick,
    speed: snapshot.speed,
    highlight: snapshot.selectedTile === null ? null : { ...snapshot.selectedTile },
    hud: {
      population: snapshot.hud.population,
      fundsCents: snapshot.hud.fundsCents,
    },
  };
}
