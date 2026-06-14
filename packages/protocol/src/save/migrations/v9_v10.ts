/**
 * Save migration v9 → v10 (ADR-010): Phase 6 districts.
 *
 * DISTRICTS section injected: no districts, zero ordinance mask. Pre-v10
 * cities never painted a district (the per-tile district layer migrates as
 * all-zero with the rest of TERRAIN), so an empty list is recorded truth —
 * the whole city runs on its global rates and no policies, exactly as before.
 */
import { ByteWriter } from "../../bytes/writer";

export function migrateSectionsV9toV10(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly districts: number },
): Map<number, Uint8Array> {
  const migrated = new Map(sections);
  const w = new ByteWriter();
  w.u32(0); // ordinanceMask: none
  w.u16(0); // district count: none
  migrated.set(ids.districts, w.finish());
  return migrated;
}
