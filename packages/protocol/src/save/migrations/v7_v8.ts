/**
 * Save migration v7 → v8 (ADR-010): Phase 5 economy. Pre-v8 builds had no
 * money cycle, so the injected ECONOMY section is the recorded truth of a
 * pre-economy world: default 9% taxes, no loans, zeroed report
 * accumulators, milestone ladder at 0, no achievements/uniques, Mayor
 * difficulty, not in receivership.
 */
import { ByteWriter } from "../../bytes/writer";

const ZONE_COUNT = 6;
const REPORT_KINDS = 13;
const TAX_DEFAULT_PERMILLE = 90;

export function migrateSectionsV7toV8(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly economy: number },
): Map<number, Uint8Array> {
  const w = new ByteWriter();
  for (let z = 0; z < ZONE_COUNT; z++) {
    w.u16(TAX_DEFAULT_PERMILLE);
  }
  w.u8(0); // no loans
  for (let k = 0; k < REPORT_KINDS * 2; k++) {
    w.i64(0); // month accumulators + last-month lines
  }
  w.u8(0); // milestoneIndex
  for (let b = 0; b < 8; b++) {
    w.u8(0); // achievements bitset
  }
  w.u32(0); // uniquesMask
  w.u8(1); // difficulty: Mayor
  w.u8(0); // receivership: no
  const migrated = new Map(sections);
  migrated.set(ids.economy, w.finish());
  return migrated;
}
