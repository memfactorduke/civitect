/**
 * Inspector queries, request/response with stable ids (TDD §7). Panels poll
 * at 4 Hz while open, not per-tick — this channel is for detail-on-demand,
 * never for frame-rate state (that's the snapshot's job).
 *
 * v1 can inspect tiles only; building/agent/edge payloads arrive with their
 * systems (each addition bumps PROTOCOL_VERSION).
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { decodeEntityRef, type EntityRef, encodeEntityRef } from "./cause";
import { DecodeError } from "./errors";

export interface InspectorRequest {
  /** u32, echoes back in the response — panels may have several in flight. */
  readonly requestId: number;
  readonly target: EntityRef;
}

export interface TileInfo {
  /** Flat tile index (y * mapWidth + x) — the stable tile id (TDD §5). */
  readonly tileIdx: number;
  /** u8 terrain kind id. 0 = grass until the Phase 1 terrain table lands. */
  readonly terrainKind: number;
  /** u8 elevation terrace (TDD §5 tile grid). */
  readonly elevationTerrace: number;
  /** u8 zone kind. 0 = unzoned until Phase 2. */
  readonly zoneKind: number;
}

export interface InspectorResponse {
  readonly requestId: number;
  /** Tick the answer was computed on — stale answers are detectable. */
  readonly tick: number;
  /** Null = target not found / kind not inspectable in this protocol version. */
  readonly tile: TileInfo | null;
}

export function encodeInspectorRequestBody(w: ByteWriter, req: InspectorRequest): void {
  w.u32(req.requestId);
  encodeEntityRef(w, req.target);
}

export function decodeInspectorRequestBody(r: ByteReader): InspectorRequest {
  return { requestId: r.u32(), target: decodeEntityRef(r) };
}

export function encodeInspectorResponseBody(w: ByteWriter, res: InspectorResponse): void {
  w.u32(res.requestId).u64(res.tick);
  if (res.tile === null) {
    w.u8(0);
    return;
  }
  w.u8(1);
  w.u32(res.tile.tileIdx);
  w.u8(res.tile.terrainKind).u8(res.tile.elevationTerrace).u8(res.tile.zoneKind);
}

export function decodeInspectorResponseBody(r: ByteReader): InspectorResponse {
  const requestId = r.u32();
  const tick = r.u64();
  const found = r.u8();
  if (found > 1) {
    throw new DecodeError(`tile presence flag must be 0|1, got ${found}`);
  }
  if (found === 0) {
    return { requestId, tick, tile: null };
  }
  const tile: TileInfo = {
    tileIdx: r.u32(),
    terrainKind: r.u8(),
    elevationTerrace: r.u8(),
    zoneKind: r.u8(),
  };
  return { requestId, tick, tile };
}
