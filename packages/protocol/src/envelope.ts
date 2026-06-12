/**
 * Message envelope — the one frame every cross-boundary byte wears (TDD §7):
 *
 *   u16 PROTOCOL_VERSION | u8 MessageKind | u32 bodyLength | body
 *
 * decodeMessage checks the version before reading a single body byte;
 * mismatch is a hard error at boot, by design. The explicit bodyLength makes
 * truncation detectable up front and leaves room for batching frames later
 * without a version bump to the envelope itself.
 */
import { ByteReader } from "./bytes/reader";
import { ByteWriter } from "./bytes/writer";
import {
  type Command,
  type CommandRejection,
  decodeCommandBody,
  decodeRejectionBody,
  encodeCommandBody,
  encodeRejectionBody,
} from "./commands";
import { DecodeError, ProtocolVersionMismatchError } from "./errors";
import {
  decodeInspectorRequestBody,
  decodeInspectorResponseBody,
  encodeInspectorRequestBody,
  encodeInspectorResponseBody,
  type InspectorRequest,
  type InspectorResponse,
} from "./inspector";
import {
  decodeLoadRequestBody,
  decodeLoadResponseBody,
  decodeSaveRequestBody,
  decodeSaveResponseBody,
  encodeLoadRequestBody,
  encodeLoadResponseBody,
  encodeSaveRequestBody,
  encodeSaveResponseBody,
  type LoadRequest,
  type LoadResponse,
  type SaveRequest,
  type SaveResponse,
} from "./save/messages";
import {
  decodeOverlayRequestBody,
  decodeSnapshotBody,
  decodeViewportHintBody,
  encodeOverlayRequestBody,
  encodeSnapshotBody,
  encodeViewportHintBody,
  type OverlayRequest,
  type Snapshot,
  type ViewportHint,
} from "./snapshot";
import { PROTOCOL_VERSION } from "./version";

export const MessageKind = {
  command: 1,
  commandRejection: 2,
  snapshot: 3,
  inspectorRequest: 4,
  inspectorResponse: 5,
  saveRequest: 6,
  saveResponse: 7,
  loadRequest: 8,
  loadResponse: 9,
  /** UI → sim camera bounds for the agent sampler (ADR-002 chokepoint). */
  viewportHint: 10,
  /** UI → sim worker: which coverage overlay rides snapshots (v11). */
  overlayRequest: 11,
} as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

export type Message =
  | { readonly kind: typeof MessageKind.command; readonly body: Command }
  | { readonly kind: typeof MessageKind.commandRejection; readonly body: CommandRejection }
  | { readonly kind: typeof MessageKind.snapshot; readonly body: Snapshot }
  | { readonly kind: typeof MessageKind.inspectorRequest; readonly body: InspectorRequest }
  | { readonly kind: typeof MessageKind.inspectorResponse; readonly body: InspectorResponse }
  | { readonly kind: typeof MessageKind.saveRequest; readonly body: SaveRequest }
  | { readonly kind: typeof MessageKind.saveResponse; readonly body: SaveResponse }
  | { readonly kind: typeof MessageKind.loadRequest; readonly body: LoadRequest }
  | { readonly kind: typeof MessageKind.loadResponse; readonly body: LoadResponse }
  | { readonly kind: typeof MessageKind.viewportHint; readonly body: ViewportHint }
  | { readonly kind: typeof MessageKind.overlayRequest; readonly body: OverlayRequest };

export function encodeMessage(message: Message): Uint8Array {
  const w = new ByteWriter();
  w.u16(PROTOCOL_VERSION).u8(message.kind);
  const lengthAt = w.length;
  w.u32(0); // body length, patched below
  const bodyStart = w.length;
  switch (message.kind) {
    case MessageKind.command:
      encodeCommandBody(w, message.body);
      break;
    case MessageKind.commandRejection:
      encodeRejectionBody(w, message.body);
      break;
    case MessageKind.snapshot:
      encodeSnapshotBody(w, message.body);
      break;
    case MessageKind.inspectorRequest:
      encodeInspectorRequestBody(w, message.body);
      break;
    case MessageKind.inspectorResponse:
      encodeInspectorResponseBody(w, message.body);
      break;
    case MessageKind.saveRequest:
      encodeSaveRequestBody(w, message.body);
      break;
    case MessageKind.saveResponse:
      encodeSaveResponseBody(w, message.body);
      break;
    case MessageKind.loadRequest:
      encodeLoadRequestBody(w, message.body);
      break;
    case MessageKind.loadResponse:
      encodeLoadResponseBody(w, message.body);
      break;
    case MessageKind.viewportHint:
      encodeViewportHintBody(w, message.body);
      break;
    case MessageKind.overlayRequest:
      encodeOverlayRequestBody(w, message.body);
      break;
  }
  w.patchU32(lengthAt, w.length - bodyStart);
  return w.finish();
}

export function decodeMessage(bytes: Uint8Array): Message {
  const r = new ByteReader(bytes);
  const version = r.u16();
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolVersionMismatchError(PROTOCOL_VERSION, version);
  }
  const kind = r.u8();
  const bodyLength = r.u32();
  if (bodyLength !== r.remaining) {
    throw new DecodeError(`body length ${bodyLength} disagrees with ${r.remaining} actual bytes`);
  }
  let message: Message;
  switch (kind) {
    case MessageKind.command:
      message = { kind, body: decodeCommandBody(r) };
      break;
    case MessageKind.commandRejection:
      message = { kind, body: decodeRejectionBody(r) };
      break;
    case MessageKind.snapshot:
      message = { kind, body: decodeSnapshotBody(r) };
      break;
    case MessageKind.inspectorRequest:
      message = { kind, body: decodeInspectorRequestBody(r) };
      break;
    case MessageKind.inspectorResponse:
      message = { kind, body: decodeInspectorResponseBody(r) };
      break;
    case MessageKind.saveRequest:
      message = { kind, body: decodeSaveRequestBody(r) };
      break;
    case MessageKind.saveResponse:
      message = { kind, body: decodeSaveResponseBody(r) };
      break;
    case MessageKind.loadRequest:
      message = { kind, body: decodeLoadRequestBody(r) };
      break;
    case MessageKind.loadResponse:
      message = { kind, body: decodeLoadResponseBody(r) };
      break;
    case MessageKind.viewportHint:
      message = { kind, body: decodeViewportHintBody(r) };
      break;
    case MessageKind.overlayRequest:
      message = { kind, body: decodeOverlayRequestBody(r) };
      break;
    default:
      throw new DecodeError(`unknown MessageKind ${kind}`);
  }
  r.expectEnd();
  return message;
}
