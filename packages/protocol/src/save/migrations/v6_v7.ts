/**
 * Save migration v6 → v7 (ADR-010): Phase 4 services.
 *
 * - BUILDINGS rows grow four fields (stock u32, sick u16, corpses u16,
 *   fireTicks u8) — pre-v7 builds had no service loops, so zero-fill is
 *   recorded truth (no garbage held, nobody sick, no corpses, nothing
 *   burning).
 * - SERVICES section injected: every budget slider at 1000‰ (the pre-v7
 *   implicit default) and a zero-length ground-pollution field (the
 *   sim reads length 0 as "all clean" — the migration stays dumb about
 *   map dimensions on purpose).
 */
import { ByteReader } from "../../bytes/reader";
import { ByteWriter } from "../../bytes/writer";
import { DecodeError } from "../../errors";

const SERVICE_COUNT = 9;
const DEFAULT_BUDGET_PERMILLE = 1000;

export function migrateSectionsV6toV7(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly buildings: number; readonly services: number },
): Map<number, Uint8Array> {
  const migrated = new Map(sections);

  const oldBuildings = sections.get(ids.buildings);
  if (oldBuildings === undefined) {
    throw new DecodeError("v6 save is missing BUILDINGS — corrupt save");
  }
  const r = new ByteReader(oldBuildings);
  const count = r.u32();
  const w = new ByteWriter();
  w.u32(count);
  for (let i = 0; i < count; i++) {
    // v6 row: tileIdx u32, kind u16, level u8, status u8, failDays u8, thriveDays u8.
    w.u32(r.u32()).u16(r.u16()).u8(r.u8()).u8(r.u8()).u8(r.u8()).u8(r.u8());
    // v7 appends: stock u32, sick u16, corpses u16, fireTicks u8 — all zero.
    w.u32(0).u16(0).u16(0).u8(0);
  }
  r.expectEnd();
  migrated.set(ids.buildings, w.finish());

  const services = new ByteWriter();
  for (let s = 0; s < SERVICE_COUNT; s++) {
    services.u16(DEFAULT_BUDGET_PERMILLE);
  }
  services.u32(0); // ground pollution: length 0 = all clean
  migrated.set(ids.services, services.finish());
  return migrated;
}
