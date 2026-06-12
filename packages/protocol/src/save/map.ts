/**
 * Map files (.civmap — TDD §5, ROADMAP Phase 1): the .civ container with a
 * TERRAIN section only. A map is a save with no life in it: same magic,
 * same checksums, same versioning machinery; `seed` records the generator
 * seed that produced it (map reproducibility, GDD §3 catalog).
 */
import { ByteReader } from "../bytes/reader";
import { ByteWriter } from "../bytes/writer";
import { DecodeError } from "../errors";
import { SectionId } from "./civ";
import { decodeContainer, encodeContainer, SAVE_FORMAT_VERSION } from "./container";
import { decodeTerrainSection, encodeTerrainSection, type TerrainGrid } from "./terrain";

export interface MapFile {
  /** Catalog id (GDD §3); 0 while the catalog doesn't exist yet. */
  readonly mapId: number;
  /** Seed the generator used — same seed + same generator version = same map. */
  readonly generatorSeed: number;
  readonly terrain: TerrainGrid;
}

export async function encodeMap(map: MapFile): Promise<Uint8Array> {
  const w = new ByteWriter();
  encodeTerrainSection(map.terrain, w);
  return encodeContainer(
    {
      formatVersion: SAVE_FORMAT_VERSION,
      simVersion: 0, // maps carry no rules
      seed: map.generatorSeed,
      tick: 0,
      mapId: map.mapId,
      flags: 0,
    },
    [{ id: SectionId.terrain, raw: w.finish() }],
  );
}

export async function decodeMap(bytes: Uint8Array): Promise<MapFile> {
  const { header, sections } = await decodeContainer(bytes);
  const terrainRaw = sections.get(SectionId.terrain);
  if (terrainRaw === undefined) {
    throw new DecodeError("map file carries no TERRAIN section");
  }
  if (sections.size !== 1) {
    // A "map" smuggling world state is a category error — saves are saves.
    throw new DecodeError(`map file carries ${sections.size} sections, wants exactly TERRAIN`);
  }
  const r = new ByteReader(terrainRaw);
  const terrain = decodeTerrainSection(r);
  r.expectEnd();
  return { mapId: header.mapId, generatorSeed: header.seed, terrain };
}
