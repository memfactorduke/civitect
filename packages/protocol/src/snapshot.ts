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
 * postMessage; SharedArrayBuffer fast path where isolation allows). The
 * codec carries only the CONTRACT: agentCount, validated against the
 * rider's length (AGENT_FLOATS floats per agent) at the worker boundary.
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { type AdvisorEvent, decodeAdvisorEvent, encodeAdvisorEvent } from "./cause";
import { DecodeError } from "./errors";

/**
 * Transform rider layout, per agent: [agentId, kind, x, y, headingMilli].
 * Positions in float tiles; heading in milliradians (renderer-only floats —
 * agents are a sampled projection, never canonical state, ADR-002/GDD §8).
 */
export const AGENT_FLOATS = 5;

export const AgentKind = {
  pedestrian: 1,
  car: 2,
} as const;
export type AgentKind = (typeof AgentKind)[keyof typeof AgentKind];

/**
 * Camera bounds, UI → sim (tile rect, inclusive). Input to the camera-aware
 * agent sampler ONLY (ADR-002): it must never influence canonical state —
 * the projection-purity test in sim enforces that hashes ignore it.
 */
export interface ViewportHint {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function encodeViewportHintBody(w: ByteWriter, v: ViewportHint): void {
  w.u16(v.x0).u16(v.y0).u16(v.x1).u16(v.y1);
}

export function decodeViewportHintBody(r: ByteReader): ViewportHint {
  return { x0: r.u16(), y0: r.u16(), x1: r.u16(), y1: r.u16() };
}

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

/** RCIO demand with its factor breakdown — the panel shows FACTORS (GDD §6). */
export interface DemandBlock {
  /** Net demand per sector, -1000..1000 permille. */
  readonly r: number;
  readonly c: number;
  readonly i: number;
  readonly o: number;
  /**
   * Factor contributions per sector, permille, SUMMING to the net value
   * (exit criterion: the panel proves it with a property test).
   * Layout: [jobs, attractiveness, vacancy] for R; [purchasing, vacancy,
   * supply] for C; [orders, vacancy, workforce] for I; [educated, adminNeed,
   * vacancy] for O — fixed wire order, i16 each.
   */
  readonly factors: readonly number[];
}

/** One building as renderers/inspectors need it. */
export interface BuildingView {
  readonly x: number;
  readonly y: number;
  /** ZoneKind for grown buildings; 100+BuildingKind for ploppables. */
  readonly kind: number;
  readonly level: number;
  /** 0 normal, 1 unpowered, 2 unwatered, 3 abandoned (worst wins). */
  readonly status: number;
}

/** One road segment as the renderer needs it (tile-pair + class). */
export interface RoadSegment {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  /** RoadClassWire value (commands.ts). */
  readonly roadClass: number;
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
  /** Road-network version (u32) — renderers rebuild their road layer when it moves. */
  readonly roadVersion: number;
  /**
   * Full segment list when the sender includes it (keyframes always; deltas
   * after a road mutation); null = unchanged since the last list.
   */
  readonly roads: readonly RoadSegment[] | null;
  /** Current demand + factors (small, rides every snapshot). */
  readonly demand: DemandBlock;
  /** Building-set version; list rides keyframes/changes (road pattern). */
  readonly buildingVersion: number;
  readonly buildings: readonly BuildingView[] | null;
  /** Zone-paint version; full layer rides keyframes/changes (u16/tile). */
  readonly zoneVersion: number;
  readonly zones: Uint16Array | null;
  /** Agents in the transferable rider (AGENT_FLOATS floats each); 0 = none. */
  readonly agentCount: number;
  /** Bumps when MSA volumes re-blend; congestion rides changes (v10). */
  readonly congestionVersion: number;
  /**
   * v/c permille per snapshot ROAD (same canonical order as `roads`),
   * capped 3000. Null = unchanged since the last carried block.
   */
  readonly congestion: Uint16Array | null;
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
  w.u32(snap.roadVersion);
  if (snap.roads === null) {
    w.u8(0);
  } else {
    w.u8(1).u32(snap.roads.length);
    for (const seg of snap.roads) {
      w.u16(seg.ax).u16(seg.ay).u16(seg.bx).u16(seg.by).u8(seg.roadClass);
    }
  }
  w.i64(snap.demand.r);
  w.i64(snap.demand.c);
  w.i64(snap.demand.i);
  w.i64(snap.demand.o);
  w.u8(snap.demand.factors.length);
  for (const f of snap.demand.factors) {
    w.i64(f);
  }
  w.u32(snap.buildingVersion);
  if (snap.buildings === null) {
    w.u8(0);
  } else {
    w.u8(1).u32(snap.buildings.length);
    for (const b of snap.buildings) {
      w.u16(b.x).u16(b.y).u16(b.kind).u8(b.level).u8(b.status);
    }
  }
  w.u32(snap.zoneVersion);
  if (snap.zones === null) {
    w.u8(0);
  } else {
    w.u8(1).u32(snap.zones.length);
    for (const z of snap.zones) {
      w.u16(z);
    }
  }
  w.u16(snap.agentCount);
  w.u32(snap.congestionVersion);
  if (snap.congestion === null) {
    w.u8(0);
  } else {
    w.u8(1).u32(snap.congestion.length);
    for (const c of snap.congestion) {
      w.u16(c);
    }
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
  const roadVersion = r.u32();
  const hasRoads = r.u8();
  if (hasRoads > 1) {
    throw new DecodeError(`roads presence flag must be 0|1, got ${hasRoads}`);
  }
  let roads: RoadSegment[] | null = null;
  if (hasRoads === 1) {
    const count = r.u32();
    roads = [];
    for (let i = 0; i < count; i++) {
      roads.push({ ax: r.u16(), ay: r.u16(), bx: r.u16(), by: r.u16(), roadClass: r.u8() });
    }
  }
  const dr = r.i64();
  const dc = r.i64();
  const di = r.i64();
  const dod = r.i64();
  const factorCount = r.u8();
  const factors: number[] = [];
  for (let i = 0; i < factorCount; i++) {
    factors.push(r.i64());
  }
  const demand = { r: dr, c: dc, i: di, o: dod, factors };
  const buildingVersion = r.u32();
  const hasBuildings = r.u8();
  if (hasBuildings > 1) {
    throw new DecodeError(`buildings presence flag must be 0|1, got ${hasBuildings}`);
  }
  let buildings: BuildingView[] | null = null;
  if (hasBuildings === 1) {
    const count = r.u32();
    buildings = [];
    for (let i = 0; i < count; i++) {
      buildings.push({ x: r.u16(), y: r.u16(), kind: r.u16(), level: r.u8(), status: r.u8() });
    }
  }
  const zoneVersion = r.u32();
  const hasZones = r.u8();
  if (hasZones > 1) {
    throw new DecodeError(`zones presence flag must be 0|1, got ${hasZones}`);
  }
  let zones: Uint16Array | null = null;
  if (hasZones === 1) {
    const count = r.u32();
    zones = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      zones[i] = r.u16();
    }
  }
  const agentCount = r.u16();
  const congestionVersion = r.u32();
  const hasCongestion = r.u8();
  if (hasCongestion > 1) {
    throw new DecodeError(`congestion presence flag must be 0|1, got ${hasCongestion}`);
  }
  let congestion: Uint16Array | null = null;
  if (hasCongestion === 1) {
    const count = r.u32();
    congestion = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      congestion[i] = r.u16();
    }
  }
  return {
    kind,
    tick,
    speed,
    selectedTile,
    dirtyChunkIds,
    hud,
    advisorEvents,
    roadVersion,
    roads,
    demand,
    buildingVersion,
    buildings,
    zoneVersion,
    zones,
    agentCount,
    congestionVersion,
    congestion,
  };
}
