/**
 * zustand store fed by snapshot scalars (TDD §9, ADR-009).
 *
 * Vanilla store + React hook split: the app shell (not React) feeds
 * snapshots in from the worker boundary, components subscribe via the hook.
 * The store holds *display scalars only* — world rendering state belongs to
 * the renderer's DisplayState, and game truth lives across the wall.
 */
import type { AdvisorEvent, Snapshot, TileCoord } from "@civitect/protocol";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface UiState {
  readonly tick: number;
  readonly speed: number;
  readonly population: number;
  readonly fundsCents: number;
  readonly selectedTile: TileCoord | null;
  readonly advisorEvents: readonly AdvisorEvent[];
  applySnapshot(snapshot: Snapshot): void;
}

export type UiStore = StoreApi<UiState>;

export function createUiStore(): UiStore {
  return createStore<UiState>()((set, get) => ({
    tick: -1,
    speed: 1,
    population: 0,
    fundsCents: 0,
    selectedTile: null,
    advisorEvents: [],
    applySnapshot(snapshot: Snapshot): void {
      if (snapshot.tick < get().tick) {
        return; // last-tick-wins, mirroring the renderer's display projection
      }
      set({
        tick: snapshot.tick,
        speed: snapshot.speed,
        population: snapshot.hud.population,
        fundsCents: snapshot.hud.fundsCents,
        selectedTile: snapshot.selectedTile,
        advisorEvents: snapshot.advisorEvents,
      });
    },
  }));
}

/** Subscribe a component to a slice of UI state. */
export function useUiStore<T>(store: UiStore, selector: (state: UiState) => T): T {
  return useStore(store, selector);
}
