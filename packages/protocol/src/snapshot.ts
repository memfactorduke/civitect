/**
 * Snapshots, sim → renderer/UI (TDD §7): per-render-frame delta of visible
 * state; full keyframe on scene load / camera jump.
 *
 * v1 carries the empty-world round trip: tick/speed for the HUD clock,
 * selectedTile for the tap→highlight exit criterion, and the structural
 * slots that grow in later phases (dirtyChunkIds → Phase 1 terrain re-bake,
 * advisorEvents → Phase 2 cause chains).
 *
 * NOT in these bytes: the agent transform ring. TDD §7 sends it as a separate
 * transferable Float32Array alongside the encoded snapshot (zero-copy
 * postMessage; SharedArrayBuffer fast path where isolation allows) — it joins
 * the message at the app worker boundary in Phase 3, not the codec.
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { type AdvisorEvent, decodeAdvisorEvent, encodeAdvisorEvent } from "./cause";
import { DecodeError } from "./errors";

export const SnapshotKind = {
  keyframe: 1,
  delta: 2,
} as const;
export type SnapshotKind = (typeof SnapshotKind)[keyof typeof SnapshotKind];

export interface HudScalars {
  /** u32 */
  readonly population: number;
  /** i64. Money is integer cents, always (ADR-005) — negative means debt. */
  readonly fundsCents: number;
}

export interface TileCoord {
  readonly x: number;
  readonly y: number;
}

export interface Snapshot {
  readonly kind: SnapshotKind;
  readonly tick: number;
  /** Current speed multiplier index, u8; 0 = paused. */
  readonly speed: number;
  /** Drives the selection highlight (Phase 0 exit criterion). Null = nothing selected. */
  readonly selectedTile: TileCoord | null;
  /** Chunk ids needing re-bake (TDD §8 static layer). Empty until Phase 1 terrain. */
  readonly dirtyChunkIds: Uint32Array;
  readonly hud: HudScalars;
  /** Each event carries a required CauseChain (ADR-009). Empty until Phase 2. */
  readonly advisorEvents: readonly AdvisorEvent[];
}

export function encodeSnapshotBody(w: ByteWriter, snap: Snapshot): void {
  w.u8(snap.kind).u64(snap.tick).u8(snap.speed);
  if (snap.selectedTile === null) {
    w.u8(0);
  } else {
    w.u8(1).u16(snap.selectedTile.x).u16(snap.selectedTile.y);
  }
  w.u32(snap.dirtyChunkIds.length);
  for (const id of snap.dirtyChunkIds) {
    w.u32(id);
  }
  w.u32(snap.hud.population);
  w.i64(snap.hud.fundsCents);
  w.u16(snap.advisorEvents.length);
  for (const event of snap.advisorEvents) {
    encodeAdvisorEvent(w, event);
  }
}

export function decodeSnapshotBody(r: ByteReader): Snapshot {
  const kind = r.u8();
  if (kind !== SnapshotKind.keyframe && kind !== SnapshotKind.delta) {
    throw new DecodeError(`unknown SnapshotKind ${kind}`);
  }
  const tick = r.u64();
  const speed = r.u8();
  const hasSelection = r.u8();
  if (hasSelection > 1) {
    throw new DecodeError(`selectedTile presence flag must be 0|1, got ${hasSelection}`);
  }
  const selectedTile = hasSelection === 1 ? { x: r.u16(), y: r.u16() } : null;
  const chunkCount = r.u32();
  const dirtyChunkIds = new Uint32Array(chunkCount);
  for (let i = 0; i < chunkCount; i++) {
    dirtyChunkIds[i] = r.u32();
  }
  const hud: HudScalars = { population: r.u32(), fundsCents: r.i64() };
  const eventCount = r.u16();
  const advisorEvents: AdvisorEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    advisorEvents.push(decodeAdvisorEvent(r));
  }
  return { kind, tick, speed, selectedTile, dirtyChunkIds, hud, advisorEvents };
}
