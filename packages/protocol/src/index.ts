/**
 * @civitect/protocol — the contract: shared types + binary codecs for
 * commands, snapshots, inspector queries (TDD §7, ADR-006), and the .civ
 * save container (TDD §10, ADR-010 — its own formatVersion, independent of
 * PROTOCOL_VERSION: message layouts didn't change when saves joined).
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
  ChainRole,
  COMMODITY_COUNT,
  Commodity,
  ResourceKind,
  ShipmentEndpoint,
} from "./chain";
export {
  type AddStopCommand,
  BRIDGE_CLASS_OFFSET,
  BuildingKind,
  type BuildRoadCommand,
  type BulldozeRoadCommand,
  type Command,
  type CommandRejection,
  CommandType,
  type CreateLineCommand,
  type DeleteLineCommand,
  type DezoneRectCommand,
  decodeCommandBody,
  decodeRejectionBody,
  encodeCommandBody,
  encodeRejectionBody,
  LOAN_TIERS,
  MAX_DISTRICTS,
  MAX_LINES,
  MAX_STOPS,
  type NameDistrictCommand,
  type PaintDistrictCommand,
  type PinCimCommand,
  type PlaceBuildingCommand,
  POLICY_BITS,
  Policy,
  type RedoCommand,
  RejectionReason,
  type RemoveStopCommand,
  type RepayLoanCommand,
  RoadClassWire,
  SERVICE_BUDGET_MAX_PERMILLE,
  SERVICE_BUDGET_MIN_PERMILLE,
  SERVICE_COUNT,
  SERVICE_ID_LIST,
  type SelectTileCommand,
  ServiceId,
  type SetDistrictTaxCommand,
  type SetLineVehiclesCommand,
  type SetOrdinanceCommand,
  type SetPolicyCommand,
  type SetServiceBudgetCommand,
  type SetSpeedCommand,
  type SetTaxRateCommand,
  TAX_DEFAULT_PERMILLE,
  TAX_MAX_PERMILLE,
  TAX_MIN_PERMILLE,
  type TakeLoanCommand,
  TransitMode,
  type UndoCommand,
  type UnpinCimCommand,
  type UpgradeRoadCommand,
  ZoneKind,
  type ZoneRectCommand,
} from "./commands";
export { decodeMessage, encodeMessage, type Message, MessageKind } from "./envelope";
export {
  DecodeError,
  EncodeError,
  ProtocolError,
  ProtocolVersionMismatchError,
  SaveIntegrityError,
} from "./errors";
export {
  type BuildingInfo,
  decodeInspectorRequestBody,
  decodeInspectorResponseBody,
  type EnvironInfo,
  encodeInspectorRequestBody,
  encodeInspectorResponseBody,
  type InspectorRequest,
  type InspectorResponse,
  type RoadInfo,
  type TileInfo,
} from "./inspector";
export {
  type BuildingRow,
  type ChainSave,
  type CimPinSave,
  type CivSave,
  type DistrictRow,
  type DistrictsSave,
  decodeCiv,
  type EconomySave,
  encodeCiv,
  type LoanSave,
  type RngStreamState,
  SAVE_FORMAT_VERSION,
  SAVE_MAGIC,
  type SaveHeader,
  SectionId,
  type ServicesSave,
  type ShipmentRow,
  type TrafficJobSave,
  type TrafficSave,
  type WorldCore,
} from "./save/civ";
export { compressDeflateRaw, decompressDeflateRaw } from "./save/compression";
export {
  type ContainerHeader,
  decodeContainer,
  encodeContainer,
  type RawSection,
} from "./save/container";
export { decodeMap, encodeMap, type MapFile } from "./save/map";
export {
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
export {
  decodeTerrainSection,
  encodeTerrainSection,
  flatTerrain,
  TERRAIN_LAYER_NAMES,
  type TerrainGrid,
  TerrainLayerId,
  type TerrainLayerName,
} from "./save/terrain";
export { xxh64, xxh64Hex } from "./save/xxhash64";
export {
  AGENT_FLOATS,
  AgentKind,
  type BuildingView,
  type DemandBlock,
  decodeOverlayRequestBody,
  decodeSnapshotBody,
  decodeViewportHintBody,
  encodeOverlayRequestBody,
  encodeSnapshotBody,
  encodeViewportHintBody,
  type HudScalars,
  type MilestoneBlock,
  type MonthlyReport,
  OVERLAY_MAX,
  OverlayId,
  type OverlayRequest,
  type ReportLine,
  ReportLineKind,
  type RoadSegment,
  type Snapshot,
  SnapshotKind,
  type TileCoord,
  type ViewportHint,
} from "./snapshot";
export {
  FOOTPRINT_MAX,
  FOOTPRINT_MIN,
  parseSpriteSidecar,
  SPRITE_SOURCE_SCALE,
  SPRITE_TILE_3X,
  SpriteCategory,
  type SpriteSidecar,
  SpriteState,
} from "./sprite";
export { PROTOCOL_VERSION } from "./version";
