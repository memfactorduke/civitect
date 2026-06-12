/**
 * Snapshot → display-state projection (TDD §8).
 *
 * The renderer's only knowledge of the sim is what protocol snapshots say —
 * this module turns them into the view-model the stage draws from. Pure and
 * DOM/Pixi-free so the board PR 5 verification ("snapshot→display-state
 * units") runs in Node.
 */
import {
  type BuildingView,
  type RoadSegment,
  type Snapshot,
  SnapshotKind,
} from "@civitect/protocol";

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
  /** Road layer rebuilds when this moves. */
  readonly roadVersion: number;
  /** Last full segment list received (deltas with null keep the previous). */
  readonly roads: readonly RoadSegment[];
  readonly buildingVersion: number;
  readonly buildings: readonly BuildingView[];
  readonly zoneVersion: number;
  readonly zones: Uint16Array | null;
  /** Agents in the latest transform rider (the buffer rides separately). */
  readonly agentCount: number;
  /** Traffic overlay redraws when this moves. */
  readonly congestionVersion: number;
  /** v/c permille parallel to `roads` (deltas with null keep the previous). */
  readonly congestion: Uint16Array | null;
  /** Active coverage overlay's service (0 = none) + content digest. */
  readonly coverageService: number;
  readonly coverageVersion: number;
  /** Coverage 0–255 per tile (deltas with null keep the previous layer). */
  readonly coverage: Uint8Array | null;
}

export function initialDisplayState(): DisplayState {
  return {
    tick: -1,
    speed: 1,
    highlight: null,
    hud: { population: 0, fundsCents: 0 },
    roadVersion: -1,
    roads: [],
    buildingVersion: -1,
    buildings: [],
    zoneVersion: -1,
    zones: null,
    agentCount: 0,
    congestionVersion: -1,
    congestion: null,
    coverageService: 0,
    coverageVersion: -1,
    coverage: null,
  };
}

/**
 * Apply one snapshot.
 *
 * KEYFRAMES are authoritative resets — scene load, camera jump, save-load
 * rewind (TDD §7) — and apply unconditionally, even to an older tick:
 * rewinding time is exactly what a load does. DELTAS are last-tick-wins:
 * a stale delta racing a newer one must lose.
 */
export function applySnapshot(state: DisplayState, snapshot: Snapshot): DisplayState {
  if (snapshot.kind !== SnapshotKind.keyframe && snapshot.tick < state.tick) {
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
    roadVersion: snapshot.roadVersion,
    roads: snapshot.roads ?? state.roads,
    buildingVersion: snapshot.buildingVersion,
    buildings: snapshot.buildings ?? state.buildings,
    zoneVersion: snapshot.zoneVersion,
    zones: snapshot.zones ?? state.zones,
    agentCount: snapshot.agentCount,
    congestionVersion: snapshot.congestionVersion,
    congestion: snapshot.congestion ?? state.congestion,
    coverageService: snapshot.coverageService,
    coverageVersion: snapshot.coverageVersion,
    // A service switch invalidates the kept layer; same service keeps it.
    coverage:
      snapshot.coverage ??
      (snapshot.coverageService === state.coverageService ? state.coverage : null),
  };
}
