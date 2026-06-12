/**
 * Save migration v1 → v2 (ADR-010 [binding]: every formatVersion bump ships
 * one, tested against the archived fixture corpus forever).
 *
 * v2 adds the TERRAIN section. v1 saves predate terrain entirely — their
 * worlds were definitionally flat (Phase 0 empty world), so the migration
 * injects an all-zero terrain grid at the world's dimensions. Loading a v1
 * save into a v2+ build is lossless by construction.
 */
import { ByteWriter } from "../../bytes/writer";
import { DecodeError } from "../../errors";
import { encodeTerrainSection, flatTerrain } from "../terrain";

/**
 * Operates on the decoded section map (raw bytes), BEFORE view decoding:
 * reads the v1 WORLDCORE dims, synthesizes a flat TERRAIN section.
 * Section ids are stable constants (civ.ts SectionId) passed in to avoid
 * an import cycle with the view module.
 */
export function migrateSectionsV1toV2(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly terrain: number; readonly worldCore: number },
): Map<number, Uint8Array> {
  const worldCore = sections.get(ids.worldCore);
  if (worldCore === undefined) {
    throw new DecodeError("v1 save has no WORLDCORE section — cannot migrate");
  }
  // WORLDCORE layout (v1, unchanged in v2): speed u8 | selectedTileIdx i64
  // | mapWidth u16 | mapHeight u16 | ... — dims sit at byte offsets 9 and 11.
  if (worldCore.length < 13) {
    throw new DecodeError("v1 WORLDCORE section truncated — cannot migrate");
  }
  const view = new DataView(worldCore.buffer, worldCore.byteOffset, worldCore.byteLength);
  const mapWidth = view.getUint16(9, true);
  const mapHeight = view.getUint16(11, true);

  const w = new ByteWriter();
  encodeTerrainSection(flatTerrain(mapWidth, mapHeight), w);
  const migrated = new Map(sections);
  migrated.set(ids.terrain, w.finish());
  return migrated;
}
