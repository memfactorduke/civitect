/**
 * The generic .civ section container (TDD §10, ADR-010): magic, header,
 * per-section xxh64 checksum table (over RAW bytes), deflate-raw sections.
 * Two views sit on top: saves (civ.ts — WORLDCORE + COMMANDTAIL) and map
 * files (map.ts — TERRAIN only). One byte layout, one integrity story.
 */
import { ByteReader } from "../bytes/reader";
import { ByteWriter } from "../bytes/writer";
import { DecodeError, SaveIntegrityError } from "../errors";
import { compressDeflateRaw, decompressDeflateRaw } from "./compression";
import { xxh64 } from "./xxhash64";

export const SAVE_MAGIC = "CIVT";
// v2: saves carry a TERRAIN section (phase-1 task 7a); v1 loads via
// migrations/v1_v2 (flat-terrain injection — ADR-010).
export const SAVE_FORMAT_VERSION = 2;

export interface ContainerHeader {
  readonly formatVersion: number;
  /** Rules version of the producing sim; 0 for artifacts with no rules (maps). */
  readonly simVersion: number;
  readonly seed: number;
  readonly tick: number;
  /** Map catalog id; 0 = none. */
  readonly mapId: number;
  readonly flags: number;
}

export interface RawSection {
  readonly id: number;
  readonly raw: Uint8Array;
}

export async function encodeContainer(
  header: ContainerHeader,
  sections: readonly RawSection[],
): Promise<Uint8Array> {
  const w = new ByteWriter();
  for (const ch of SAVE_MAGIC) {
    w.u8(ch.charCodeAt(0));
  }
  w.u16(header.formatVersion)
    .u16(header.simVersion)
    .u64(header.seed)
    .u64(header.tick)
    .u16(header.mapId)
    .u16(header.flags)
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

export interface DecodedContainer {
  readonly header: ContainerHeader;
  readonly sections: ReadonlyMap<number, Uint8Array>;
}

export async function decodeContainer(bytes: Uint8Array): Promise<DecodedContainer> {
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
      `formatVersion ${formatVersion} is newer than this build understands ` +
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

  const sections = new Map<number, Uint8Array>();
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
        `section ${id} checksum mismatch — file is corrupt ` +
          `(expected ${expected.toString(16)}, got ${actual.toString(16)})`,
      );
    }
    sections.set(id, raw);
  }
  r.expectEnd();

  return {
    header: { formatVersion, simVersion, seed, tick, mapId, flags },
    sections,
  };
}
