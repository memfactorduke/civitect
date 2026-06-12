/**
 * fast-check arbitraries for every protocol type — exported via
 * "@civitect/protocol/testing" so downstream packages (sim's command fuzzing,
 * ADR-013 §2) generate valid protocol values instead of reinventing them.
 * Test-only: never import from production code.
 */
import * as fc from "fast-check";
import {
  type AdvisorEvent,
  AdvisorSeverity,
  type CauseChain,
  type CauseLink,
  EntityKind,
  type EntityRef,
} from "../cause";
import {
  BuildingKind,
  type BuildRoadCommand,
  type BulldozeRoadCommand,
  type Command,
  type CommandRejection,
  CommandType,
  type DezoneRectCommand,
  type PlaceBuildingCommand,
  type RedoCommand,
  RejectionReason,
  RoadClassWire,
  type SelectTileCommand,
  type SetSpeedCommand,
  type UndoCommand,
  type UpgradeRoadCommand,
  ZoneKind,
  type ZoneRectCommand,
} from "../commands";
import { type Message, MessageKind } from "../envelope";
import type { InspectorRequest, InspectorResponse, TileInfo } from "../inspector";
import type { LoadRequest, LoadResponse, SaveRequest, SaveResponse } from "../save/messages";
import { type Snapshot, SnapshotKind } from "../snapshot";

const u8Arb = fc.integer({ min: 0, max: 0xff });
const u16Arb = fc.integer({ min: 0, max: 0xffff });
export const u32Arb = fc
  .tuple(fc.integer({ min: 0, max: 0xffff }), fc.integer({ min: 0, max: 0xffff }))
  .map(([hi, lo]) => hi * 0x10000 + lo);
export const tickArb = fc.maxSafeNat();
/** Integer cents, full safe range, both signs (debt is a number too). */
export const moneyCentsArb = fc.maxSafeInteger();
/** Well-formed Unicode (lone surrogates excluded — they encode lossily, as in TextEncoder). */
export const keyArb = fc.fullUnicodeString({ maxLength: 40 });

export const entityRefArb: fc.Arbitrary<EntityRef> = fc.record({
  kind: fc.constantFrom(...Object.values(EntityKind)),
  id: u32Arb,
});

export const causeLinkArb: fc.Arbitrary<CauseLink> = fc.record({
  subject: entityRefArb,
  labelKey: keyArb,
  weightPermille: fc.integer({ min: 0, max: 1000 }),
});

export const causeChainArb: fc.Arbitrary<CauseChain> = fc.record({
  summaryKey: keyArb,
  links: fc.array(causeLinkArb, { maxLength: 8 }),
});

export const advisorEventArb: fc.Arbitrary<AdvisorEvent> = fc.record({
  id: u32Arb,
  tick: tickArb,
  severity: fc.constantFrom(...Object.values(AdvisorSeverity)),
  messageKey: keyArb,
  cause: causeChainArb,
});

export const selectTileCommandArb: fc.Arbitrary<SelectTileCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.selectTile),
  x: u16Arb,
  y: u16Arb,
});

export const setSpeedCommandArb: fc.Arbitrary<SetSpeedCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.setSpeed),
  speed: u8Arb,
});

const roadClassArb = fc.constantFrom(...Object.values(RoadClassWire));

export const buildRoadCommandArb: fc.Arbitrary<BuildRoadCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.buildRoad),
  ax: u16Arb,
  ay: u16Arb,
  bx: u16Arb,
  by: u16Arb,
  roadClass: roadClassArb,
});

export const bulldozeRoadCommandArb: fc.Arbitrary<BulldozeRoadCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.bulldozeRoad),
  ax: u16Arb,
  ay: u16Arb,
  bx: u16Arb,
  by: u16Arb,
});

export const upgradeRoadCommandArb: fc.Arbitrary<UpgradeRoadCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.upgradeRoad),
  ax: u16Arb,
  ay: u16Arb,
  bx: u16Arb,
  by: u16Arb,
  roadClass: roadClassArb,
});

export const undoCommandArb: fc.Arbitrary<UndoCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.undo),
});

export const redoCommandArb: fc.Arbitrary<RedoCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.redo),
});

export const zoneRectCommandArb: fc.Arbitrary<ZoneRectCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.zoneRect),
  x0: u16Arb,
  y0: u16Arb,
  x1: u16Arb,
  y1: u16Arb,
  zone: fc.constantFrom(
    ZoneKind.residentialLow,
    ZoneKind.residentialHigh,
    ZoneKind.commercialLow,
    ZoneKind.commercialHigh,
    ZoneKind.industrial,
    ZoneKind.office,
  ),
});

export const dezoneRectCommandArb: fc.Arbitrary<DezoneRectCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.dezoneRect),
  x0: u16Arb,
  y0: u16Arb,
  x1: u16Arb,
  y1: u16Arb,
});

export const placeBuildingCommandArb: fc.Arbitrary<PlaceBuildingCommand> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  type: fc.constant(CommandType.placeBuilding),
  x: u16Arb,
  y: u16Arb,
  building: fc.constantFrom(...Object.values(BuildingKind)),
});

export const commandArb: fc.Arbitrary<Command> = fc.oneof(
  selectTileCommandArb,
  setSpeedCommandArb,
  buildRoadCommandArb,
  bulldozeRoadCommandArb,
  upgradeRoadCommandArb,
  undoCommandArb,
  redoCommandArb,
  zoneRectCommandArb,
  dezoneRectCommandArb,
  placeBuildingCommandArb,
);

export const rejectionArb: fc.Arbitrary<CommandRejection> = fc.record({
  seq: u32Arb,
  tick: tickArb,
  reason: fc.constantFrom(...Object.values(RejectionReason)),
});

const roadSegmentArb = fc.record({
  ax: u16Arb,
  ay: u16Arb,
  bx: u16Arb,
  by: u16Arb,
  roadClass: fc.constantFrom(...Object.values(RoadClassWire)),
});

const demandArb = fc.record({
  r: fc.integer({ min: -1000, max: 1000 }),
  c: fc.integer({ min: -1000, max: 1000 }),
  i: fc.integer({ min: -1000, max: 1000 }),
  o: fc.integer({ min: -1000, max: 1000 }),
  factors: fc.array(fc.integer({ min: -1000, max: 1000 }), { maxLength: 12 }),
});

const buildingViewArb = fc.record({
  x: u16Arb,
  y: u16Arb,
  kind: u16Arb,
  level: fc.integer({ min: 1, max: 5 }),
  status: fc.integer({ min: 0, max: 3 }),
});

export const snapshotArb: fc.Arbitrary<Snapshot> = fc.record({
  kind: fc.constantFrom(...Object.values(SnapshotKind)),
  tick: tickArb,
  speed: u8Arb,
  selectedTile: fc.option(fc.record({ x: u16Arb, y: u16Arb }), { nil: null }),
  dirtyChunkIds: fc.array(u32Arb, { maxLength: 32 }).map((ids) => Uint32Array.from(ids)),
  hud: fc.record({ population: u32Arb, fundsCents: moneyCentsArb }),
  advisorEvents: fc.array(advisorEventArb, { maxLength: 4 }),
  roadVersion: u32Arb,
  roads: fc.option(fc.array(roadSegmentArb, { maxLength: 12 }), { nil: null }),
  demand: demandArb,
  buildingVersion: u32Arb,
  buildings: fc.option(fc.array(buildingViewArb, { maxLength: 12 }), { nil: null }),
  zoneVersion: u32Arb,
  zones: fc.option(
    fc.array(fc.integer({ min: 0, max: 6 }), { maxLength: 64 }).map((zs) => Uint16Array.from(zs)),
    { nil: null },
  ),
});

export const tileInfoArb: fc.Arbitrary<TileInfo> = fc.record({
  tileIdx: u32Arb,
  terrainKind: u8Arb,
  elevationTerrace: u8Arb,
  zoneKind: u8Arb,
});

export const inspectorRequestArb: fc.Arbitrary<InspectorRequest> = fc.record({
  requestId: u32Arb,
  target: entityRefArb,
});

export const inspectorResponseArb: fc.Arbitrary<InspectorResponse> = fc.record({
  requestId: u32Arb,
  tick: tickArb,
  tile: fc.option(tileInfoArb, { nil: null }),
});

const civBytesArb = fc
  .array(fc.integer({ min: 0, max: 0xff }), { maxLength: 256 })
  .map((bytes) => Uint8Array.from(bytes));

export const saveRequestArb: fc.Arbitrary<SaveRequest> = fc.record({ slot: u8Arb });

export const saveResponseArb: fc.Arbitrary<SaveResponse> = fc.record({
  slot: u8Arb,
  civ: civBytesArb,
});

export const loadRequestArb: fc.Arbitrary<LoadRequest> = fc.record({ civ: civBytesArb });

export const loadResponseArb: fc.Arbitrary<LoadResponse> = fc.record({
  ok: fc.boolean(),
  tick: tickArb,
  detail: keyArb,
});

export const messageArb: fc.Arbitrary<Message> = fc.oneof(
  commandArb.map((body): Message => ({ kind: MessageKind.command, body })),
  rejectionArb.map((body): Message => ({ kind: MessageKind.commandRejection, body })),
  snapshotArb.map((body): Message => ({ kind: MessageKind.snapshot, body })),
  inspectorRequestArb.map((body): Message => ({ kind: MessageKind.inspectorRequest, body })),
  inspectorResponseArb.map((body): Message => ({ kind: MessageKind.inspectorResponse, body })),
  saveRequestArb.map((body): Message => ({ kind: MessageKind.saveRequest, body })),
  saveResponseArb.map((body): Message => ({ kind: MessageKind.saveResponse, body })),
  loadRequestArb.map((body): Message => ({ kind: MessageKind.loadRequest, body })),
  loadResponseArb.map((body): Message => ({ kind: MessageKind.loadResponse, body })),
);
