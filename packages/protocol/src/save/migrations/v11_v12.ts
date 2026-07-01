/**
 * Save migration v11 → v12 (ADR-010): Phase 6 transit task 4c.
 *
 * The transitFare ReportLineKind grows the economy's two report arrays from 13
 * to 14 entries — inject a trailing 0 (i64) into each. The economy section is a
 * variable-length record (taxRates, loans, the two arrays, then a fixed tail),
 * so we re-serialize it field-for-field, matching encodeEconomy's layout, and
 * append the new zero to monthAccum and lastMonth. Pre-v12 cities never earned
 * a fare, so 0 is recorded truth.
 */
import { ByteReader } from "../../bytes/reader";
import { ByteWriter } from "../../bytes/writer";

/** The economy carried 13 report-line kinds through v11. */
const OLD_REPORT_KINDS = 13;
const ZONE_COUNT = 6;

export function migrateSectionsV11toV12(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly economy: number },
): Map<number, Uint8Array> {
  const migrated = new Map(sections);
  const old = sections.get(ids.economy);
  if (old === undefined) {
    return migrated; // economy section was injected at v8 — should always exist
  }
  const r = new ByteReader(old);
  const w = new ByteWriter();
  // taxRates: ZONE_COUNT × u16
  for (let z = 0; z < ZONE_COUNT; z++) {
    w.u16(r.u16());
  }
  // loans: u8 count, then count × (i64, i64, u16)
  const loanCount = r.u8();
  w.u8(loanCount);
  for (let l = 0; l < loanCount; l++) {
    w.i64(r.i64()).i64(r.i64()).u16(r.u16());
  }
  // monthAccum + lastMonth: 13 → 14 (append a zero to each)
  for (let k = 0; k < OLD_REPORT_KINDS; k++) {
    w.i64(r.i64());
  }
  w.i64(0);
  for (let k = 0; k < OLD_REPORT_KINDS; k++) {
    w.i64(r.i64());
  }
  w.i64(0);
  // tail: milestoneIndex u8, achievements 8×u8, uniquesMask u32, then 3×u8.
  w.u8(r.u8());
  for (let b = 0; b < 8; b++) {
    w.u8(r.u8());
  }
  w.u32(r.u32()).u8(r.u8()).u8(r.u8()).u8(r.u8());
  r.expectEnd();
  migrated.set(ids.economy, w.finish());
  return migrated;
}
