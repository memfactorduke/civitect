/**
 * @civitect/protocol — the contract: shared types + binary codecs for
 * commands, snapshots, and inspector queries (TDD §7, ADR-006). Save-format
 * sections (.civ) join in a later protocol version (ADR-010, board PR 8).
 *
 * Binding rules (CLAUDE.md): every wire-layout change bumps PROTOCOL_VERSION
 * and ships a symmetric encode∘decode property test; this package depends on
 * no other workspace package (dependency-cruiser enforced); wire ids are
 * append-only.
 */
export { ByteReader } from "./bytes/reader";
export { utf8Decode, utf8Encode } from "./bytes/utf8";
export { ByteWriter } from "./bytes/writer";
export {
  type AdvisorEvent,
  AdvisorSeverity,
  type CauseChain,
  type CauseLink,
  decodeAdvisorEvent,
  decodeCauseChain,
  decodeEntityRef,
  EntityKind,
  type EntityRef,
  encodeAdvisorEvent,
  encodeCauseChain,
  encodeEntityRef,
} from "./cause";
export {
  type Command,
  type CommandRejection,
  CommandType,
  decodeCommandBody,
  decodeRejectionBody,
  encodeCommandBody,
  encodeRejectionBody,
  RejectionReason,
  type SelectTileCommand,
  type SetSpeedCommand,
} from "./commands";
export { decodeMessage, encodeMessage, type Message, MessageKind } from "./envelope";
export { DecodeError, EncodeError, ProtocolError, ProtocolVersionMismatchError } from "./errors";
export {
  decodeInspectorRequestBody,
  decodeInspectorResponseBody,
  encodeInspectorRequestBody,
  encodeInspectorResponseBody,
  type InspectorRequest,
  type InspectorResponse,
  type TileInfo,
} from "./inspector";
export {
  decodeSnapshotBody,
  encodeSnapshotBody,
  type HudScalars,
  type Snapshot,
  SnapshotKind,
  type TileCoord,
} from "./snapshot";
export { PROTOCOL_VERSION } from "./version";
