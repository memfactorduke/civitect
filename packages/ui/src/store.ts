/**
 * zustand store fed by snapshot scalars (TDD §9, ADR-009).
 *
 * Vanilla store + React hook split: the app shell (not React) feeds
 * snapshots in from the worker boundary, components subscribe via the hook.
 * The store holds *display scalars only* — world rendering state belongs to
 * the renderer's DisplayState, and game truth lives across the wall.
 */
import {
  type AdvisorEvent,
  type BuildingInfo,
  type DemandBlock,
  type EnvironInfo,
  type InspectorResponse,
  type MilestoneBlock,
  type MonthlyReport,
  type RoadInfo,
  type Snapshot,
  SnapshotKind,
  type TileCoord,
} from "@civitect/protocol";
import { useStore } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";

export interface UiState {
  readonly tick: number;
  readonly speed: number;
  readonly population: number;
  readonly fundsCents: number;
  readonly selectedTile: TileCoord | null;
  /** Snapshot-derived counts for lightweight panels; renderer still owns the full lists. */
  readonly roadCount: number;
  readonly buildingCount: number;
  readonly zonedTileCount: number;
  /** Rolling advisor feed (latest first, capped) — events ACCUMULATE. */
  readonly advisorEvents: readonly AdvisorEvent[];
  readonly demand: DemandBlock;
  /** Road inspector payload for the selected tile (GDD §9.5); null = none. */
  readonly roadInfo: RoadInfo | null;
  /** Building + environment payloads for the selected tile (v11). */
  readonly buildingInfo: BuildingInfo | null;
  readonly environInfo: EnvironInfo | null;
  /** Latest monthly report — RIDES one snapshot (the close tick), then we
   *  keep showing it until the next close replaces it (GDD §12/§13). */
  readonly report: MonthlyReport | null;
  /** Milestone progression block — present on every snapshot (task 4). */
  readonly milestone: MilestoneBlock | null;
  applySnapshot(snapshot: Snapshot): void;
  applyInspectorResponse(response: InspectorResponse): void;
}

export type UiStore = StoreApi<UiState>;

function countNonZero(cells: Uint16Array): number {
  let count = 0;
  for (const cell of cells) {
    if (cell !== 0) {
      count++;
    }
  }
  return count;
}

export function createUiStore(): UiStore {
  return createStore<UiState>()((set, get) => ({
    tick: -1,
    speed: 1,
    population: 0,
    fundsCents: 0,
    selectedTile: null,
    roadCount: 0,
    buildingCount: 0,
    zonedTileCount: 0,
    advisorEvents: [],
    demand: { r: 0, c: 0, i: 0, o: 0, factors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    roadInfo: null,
    buildingInfo: null,
    environInfo: null,
    report: null,
    milestone: null,
    applySnapshot(snapshot: Snapshot): void {
      // Keyframes are authoritative resets (scene load / save-load rewind,
      // TDD §7) and apply even to an older tick; stale DELTAS lose.
      if (snapshot.kind !== SnapshotKind.keyframe && snapshot.tick < get().tick) {
        return;
      }
      const current = get();
      const isKeyframe = snapshot.kind === SnapshotKind.keyframe;
      set({
        tick: snapshot.tick,
        speed: snapshot.speed,
        population: snapshot.hud.population,
        fundsCents: snapshot.hud.fundsCents,
        selectedTile: snapshot.selectedTile,
        roadCount:
          snapshot.roads === null ? (isKeyframe ? 0 : current.roadCount) : snapshot.roads.length,
        buildingCount:
          snapshot.buildings === null
            ? isKeyframe
              ? 0
              : current.buildingCount
            : snapshot.buildings.length,
        zonedTileCount:
          snapshot.zones === null
            ? isKeyframe
              ? 0
              : current.zonedTileCount
            : countNonZero(snapshot.zones),
        // Feed semantics: snapshots carry only NEW events; accumulate.
        advisorEvents: [...snapshot.advisorEvents, ...current.advisorEvents].slice(0, 20),
        demand: snapshot.demand,
        // The report rides only the close tick — keep the last one until the
        // next close; the milestone block is on every snapshot.
        report: snapshot.report ?? current.report,
        milestone: snapshot.milestone,
      });
    },
    applyInspectorResponse(response: InspectorResponse): void {
      set({
        roadInfo: response.road,
        buildingInfo: response.building,
        environInfo: response.environ,
      });
    },
  }));
}

/** Subscribe a component to a slice of UI state. */
export function useUiStore<T>(store: UiStore, selector: (state: UiState) => T): T {
  return useStore(store, selector);
}
