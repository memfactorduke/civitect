/**
 * Save migration v2 → v3 (ADR-010): v3 adds the ROADS section. v2 saves
 * predate road persistence entirely — and the v2-era builds REFUSED to save
 * worlds with roads, so the empty network the migration injects is not a
 * guess, it is the recorded truth of every v2 save in existence.
 */
import { ByteWriter } from "../../bytes/writer";

export function migrateSectionsV2toV3(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly roads: number },
): Map<number, Uint8Array> {
  const w = new ByteWriter();
  w.u32(0); // zero segments
  const migrated = new Map(sections);
  migrated.set(ids.roads, w.finish());
  return migrated;
}
