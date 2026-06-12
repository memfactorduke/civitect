/**
 * The .civ save view over the section container (TDD §10, ADR-010) —
 * container layout/integrity lives in container.ts; this module owns which
 * sections a SAVE carries and their codecs.
 *
 * Section ids are append-only. Ids 1–10 are reserved in TDD §10's listed
 * order (terrain…commandTail); Phase 0 ships WORLDCORE (11) carrying the
 * whole empty-world state — system sections take over from it as their
 * systems land, each takeover being a formatVersion bump with a migration
 * (ADR-010 [binding]).
 *
 * The protocol package owns this layout but knows no sim types: WorldCore
 * is the *serialized* shape; sim/app map their live state onto it.
 */
import { ByteReader } from "../bytes/reader";
import { ByteWriter } from "../bytes/writer";
import { type Command, decodeCommandBody, encodeCommandBody } from "../commands";
import { DecodeError } from "../errors";
import {
  type ContainerHeader,
  decodeContainer,
  encodeContainer,
  SAVE_FORMAT_VERSION,
  SAVE_MAGIC,
} from "./container";

export { SAVE_FORMAT_VERSION, SAVE_MAGIC };

export const SectionId = {
  terrain: 1,
  roads: 2,
  buildings: 3,
  cohorts: 4,
  networks: 5,
  economy: 6,
  policies: 7,
  agentPins: 8,
  settings: 9,
  commandTail: 10,
  worldCore: 11,
} as const;
export type SectionId = (typeof SectionId)[keyof typeof SectionId];

export type SaveHeader = ContainerHeader;

export interface RngStreamState {
  readonly name: string;
  readonly stateHi: number;
  readonly stateLo: number;
  readonly incHi: number;
  readonly incLo: number;
}

/** Serialized form of the Phase 0 world (minus what the header carries). */
export interface WorldCore {
  readonly speed: number;
  readonly selectedTileIdx: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly fundsCents: number;
  readonly population: number;
  readonly rngStreams: readonly RngStreamState[];
}

export interface CivSave {
  readonly header: SaveHeader;
  readonly worldCore: WorldCore;
  /** Commands since the snapshot, in applied (tick, seq) order. */
  readonly commandTail: readonly Command[];
}

function encodeWorldCore(core: WorldCore): Uint8Array {
  const w = new ByteWriter();
  w.u8(core.speed)
    .i64(core.selectedTileIdx)
    .u16(core.mapWidth)
    .u16(core.mapHeight)
    .i64(core.fundsCents)
    .u32(core.population)
    .u8(core.rngStreams.length);
  for (const s of core.rngStreams) {
    w.str(s.name).u32(s.stateHi).u32(s.stateLo).u32(s.incHi).u32(s.incLo);
  }
  return w.finish();
}

function decodeWorldCore(bytes: Uint8Array): WorldCore {
  const r = new ByteReader(bytes);
  const speed = r.u8();
  const selectedTileIdx = r.i64();
  const mapWidth = r.u16();
  const mapHeight = r.u16();
  const fundsCents = r.i64();
  const population = r.u32();
  const streamCount = r.u8();
  const rngStreams: RngStreamState[] = [];
  for (let i = 0; i < streamCount; i++) {
    rngStreams.push({
      name: r.str(),
      stateHi: r.u32(),
      stateLo: r.u32(),
      incHi: r.u32(),
      incLo: r.u32(),
    });
  }
  r.expectEnd();
  return { speed, selectedTileIdx, mapWidth, mapHeight, fundsCents, population, rngStreams };
}

function encodeCommandTail(commands: readonly Command[]): Uint8Array {
  const w = new ByteWriter();
  w.u32(commands.length);
  for (const command of commands) {
    encodeCommandBody(w, command);
  }
  return w.finish();
}

function decodeCommandTail(bytes: Uint8Array): Command[] {
  const r = new ByteReader(bytes);
  const count = r.u32();
  const commands: Command[] = [];
  for (let i = 0; i < count; i++) {
    commands.push(decodeCommandBody(r));
  }
  r.expectEnd();
  return commands;
}

export async function encodeCiv(save: CivSave): Promise<Uint8Array> {
  return encodeContainer(save.header, [
    { id: SectionId.worldCore, raw: encodeWorldCore(save.worldCore) },
    { id: SectionId.commandTail, raw: encodeCommandTail(save.commandTail) },
  ]);
}

export async function decodeCiv(bytes: Uint8Array): Promise<CivSave> {
  const { header, sections } = await decodeContainer(bytes);
  const worldCoreRaw = sections.get(SectionId.worldCore);
  const commandTailRaw = sections.get(SectionId.commandTail);
  if (worldCoreRaw === undefined || commandTailRaw === undefined) {
    throw new DecodeError("v1 save must carry WORLDCORE and COMMANDTAIL sections");
  }
  return {
    header,
    worldCore: decodeWorldCore(worldCoreRaw),
    commandTail: decodeCommandTail(commandTailRaw),
  };
}
