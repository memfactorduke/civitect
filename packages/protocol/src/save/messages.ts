/**
 * Save/load worker messages (TDD §10 meets TDD §7): how .civ blobs cross
 * the worker boundary. The shell asks; the worker (which owns the world)
 * produces or consumes the blob; the blob itself is the §10 container.
 *
 * Joined in protocol v2 — new message kinds, append-only ids. The bodies
 * are deliberately minimal: one in-flight save/load at a time is the app
 * contract (no request ids until something needs them).
 */
import type { ByteReader } from "../bytes/reader";
import type { ByteWriter } from "../bytes/writer";

/** Ask the sim worker to serialize its world. slot: u8, 0 = quicksave; 1–3 = autosave ring (TDD §10). */
export interface SaveRequest {
  readonly slot: number;
}

/** The serialized .civ blob coming back, tagged with its request's slot. */
export interface SaveResponse {
  readonly slot: number;
  readonly civ: Uint8Array;
}

/** Hand a .civ blob to the worker to replace its world. */
export interface LoadRequest {
  readonly civ: Uint8Array;
}

/** Load verdict. ok=false carries a human-readable reason; tick is the restored world's tick when ok. */
export interface LoadResponse {
  readonly ok: boolean;
  readonly tick: number;
  readonly detail: string;
}

export function encodeSaveRequestBody(w: ByteWriter, body: SaveRequest): void {
  w.u8(body.slot);
}

export function decodeSaveRequestBody(r: ByteReader): SaveRequest {
  return { slot: r.u8() };
}

export function encodeSaveResponseBody(w: ByteWriter, body: SaveResponse): void {
  w.u8(body.slot).u32(body.civ.length).bytes(body.civ);
}

export function decodeSaveResponseBody(r: ByteReader): SaveResponse {
  const slot = r.u8();
  const length = r.u32();
  return { slot, civ: r.bytes(length) };
}

export function encodeLoadRequestBody(w: ByteWriter, body: LoadRequest): void {
  w.u32(body.civ.length).bytes(body.civ);
}

export function decodeLoadRequestBody(r: ByteReader): LoadRequest {
  const length = r.u32();
  return { civ: r.bytes(length) };
}

export function encodeLoadResponseBody(w: ByteWriter, body: LoadResponse): void {
  w.u8(body.ok ? 1 : 0)
    .u64(body.tick)
    .str(body.detail);
}

export function decodeLoadResponseBody(r: ByteReader): LoadResponse {
  return { ok: r.u8() === 1, tick: r.u64(), detail: r.str() };
}
