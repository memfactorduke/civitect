/**
 * The .civ save container (TDD §10, ADR-010). Little-endian, sectioned:
 *
 *   magic "CIVT" | formatVersion u16 | simVersion u16 | seed u64 | tick u64
 *   | mapId u16 | flags u16
 *   | sectionCount u16 | per section: (id u16 | xxh64-of-RAW-bytes u64×hex)
 *   | per section: (id u16 | compressedLen u32 | rawLen u32 | bytes)
 *
 * Checksums cover the RAW (uncompressed) section payload, so a verified
 * load proves end-to-end integrity: storage, transport, AND decompression.
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
import { type Command, decodeCommandBody, encodeCommandBody } from "./../commands";
import { DecodeError, SaveIntegrityError } from "../errors";
import { compressDeflateRaw, decompressDeflateRaw } from "./compression";
import { xxh64 } from "./xxhash64";

export const SAVE_MAGIC = "CIVT";
export const SAVE_FORMAT_VERSION = 1;

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

export interface SaveHeader {
  readonly formatVersion: number;
  /** Rules version of the sim that produced this save (TDD §10). */
  readonly simVersion: number;
  readonly seed: number;
  readonly tick: number;
  /** Map catalog id; 0 = none (Phase 0 default world). */
  readonly mapId: number;
  readonly flags: number;
}

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

interface RawSection {
  readonly id: SectionId;
  readonly raw: Uint8Array;
}

export async function encodeCiv(save: CivSave): Promise<Uint8Array> {
  const sections: RawSection[] = [
    { id: SectionId.worldCore, raw: encodeWorldCore(save.worldCore) },
    { id: SectionId.commandTail, raw: encodeCommandTail(save.commandTail) },
  ];

  const w = new ByteWriter();
  for (const ch of SAVE_MAGIC) {
    w.u8(ch.charCodeAt(0));
  }
  w.u16(save.header.formatVersion)
    .u16(save.header.simVersion)
    .u64(save.header.seed)
    .u64(save.header.tick)
    .u16(save.header.mapId)
    .u16(save.header.flags)
    .u16(sections.length);
  for (const section of sections) {
    const sum = xxh64(section.raw);
    w.u16(section.id);
    w.u32(Number(sum & 0xffffffffn)).u32(Number(sum >> 32n));
  }
  for (const section of sections) {
    const compressed = await compressDeflateRaw(section.raw);
    w.u16(section.id).u32(compressed.length).u32(section.raw.length).bytes(compressed);
  }
  return w.finish();
}

export async function decodeCiv(bytes: Uint8Array): Promise<CivSave> {
  const r = new ByteReader(bytes);
  let magic = "";
  for (let i = 0; i < SAVE_MAGIC.length; i++) {
    magic += String.fromCharCode(r.u8());
  }
  if (magic !== SAVE_MAGIC) {
    throw new DecodeError(`not a .civ file (magic "${magic}")`);
  }
  const formatVersion = r.u16();
  if (formatVersion > SAVE_FORMAT_VERSION) {
    throw new DecodeError(
      `save formatVersion ${formatVersion} is newer than this build understands ` +
        `(${SAVE_FORMAT_VERSION}) — refusing to guess`,
    );
  }
  // formatVersion < current routes through migrations once v2 exists
  // (ADR-010 [binding]); v1 is the first version, so nothing to migrate yet.
  const simVersion = r.u16();
  const seed = r.u64();
  const tick = r.u64();
  const mapId = r.u16();
  const flags = r.u16();
  const sectionCount = r.u16();

  const checksums = new Map<number, bigint>();
  for (let i = 0; i < sectionCount; i++) {
    const id = r.u16();
    const lo = BigInt(r.u32());
    const hi = BigInt(r.u32());
    checksums.set(id, (hi << 32n) | lo);
  }

  const rawSections = new Map<number, Uint8Array>();
  for (let i = 0; i < sectionCount; i++) {
    const id = r.u16();
    const compressedLen = r.u32();
    const rawLen = r.u32();
    const compressed = r.bytes(compressedLen);
    const raw = await decompressDeflateRaw(compressed);
    if (raw.length !== rawLen) {
      throw new SaveIntegrityError(
        `section ${id}: rawLen ${rawLen} disagrees with ${raw.length} decompressed bytes`,
      );
    }
    const expected = checksums.get(id);
    if (expected === undefined) {
      throw new SaveIntegrityError(`section ${id} has no checksum in the header`);
    }
    const actual = xxh64(raw);
    if (actual !== expected) {
      throw new SaveIntegrityError(
        `section ${id} checksum mismatch — save is corrupt ` +
          `(expected ${expected.toString(16)}, got ${actual.toString(16)})`,
      );
    }
    rawSections.set(id, raw);
  }
  r.expectEnd();

  const worldCoreRaw = rawSections.get(SectionId.worldCore);
  const commandTailRaw = rawSections.get(SectionId.commandTail);
  if (worldCoreRaw === undefined || commandTailRaw === undefined) {
    throw new DecodeError("v1 save must carry WORLDCORE and COMMANDTAIL sections");
  }

  return {
    header: { formatVersion, simVersion, seed, tick, mapId, flags },
    worldCore: decodeWorldCore(worldCoreRaw),
    commandTail: decodeCommandTail(commandTailRaw),
  };
}
