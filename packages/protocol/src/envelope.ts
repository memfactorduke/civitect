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
import { decodeSnapshotBody, encodeSnapshotBody, type Snapshot } from "./snapshot";
import { PROTOCOL_VERSION } from "./version";

export const MessageKind = {
  command: 1,
  commandRejection: 2,
  snapshot: 3,
  inspectorRequest: 4,
  inspectorResponse: 5,
} as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

export type Message =
  | { readonly kind: typeof MessageKind.command; readonly body: Command }
  | { readonly kind: typeof MessageKind.commandRejection; readonly body: CommandRejection }
  | { readonly kind: typeof MessageKind.snapshot; readonly body: Snapshot }
  | { readonly kind: typeof MessageKind.inspectorRequest; readonly body: InspectorRequest }
  | { readonly kind: typeof MessageKind.inspectorResponse; readonly body: InspectorResponse };

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
    default:
      throw new DecodeError(`unknown MessageKind ${kind}`);
  }
  r.expectEnd();
  return message;
}
