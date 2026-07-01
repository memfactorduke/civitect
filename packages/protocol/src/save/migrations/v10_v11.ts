/**
 * Save migration v10 → v11 (ADR-010): Phase 6 transit.
 *
 * TRANSIT section injected: no lines, nextLineId 1. Pre-v11 cities never had
 * transit, so an empty network is recorded truth — everyone walks or drives,
 * exactly as before.
 */
import { ByteWriter } from "../../bytes/writer";

export function migrateSectionsV10toV11(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly transit: number },
): Map<number, Uint8Array> {
  const migrated = new Map(sections);
  const w = new ByteWriter();
  w.u16(1); // nextLineId
  w.u16(0); // line count: none
  migrated.set(ids.transit, w.finish());
  return migrated;
}
