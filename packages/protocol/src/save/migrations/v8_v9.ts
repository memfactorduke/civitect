/**
 * Save migration v8 → v9 (ADR-010): Phase 5 goods chain.
 *
 * - BUILDINGS rows grow three fields (chainRole u8, stockIn u16,
 *   stockOut u16) — pre-v9 builds ran no chain, so zero-fill is recorded
 *   truth (no role, empty shelves). Existing industrial buildings stay
 *   role-none until the sim's adoption pass assigns roles on load-side
 *   spawn semantics (deliberate: the migration stays dumb about terrain).
 * - SHIPMENTS section injected: empty queue, zeroed conservation ledgers
 *   (nothing produced, nothing in flight, nothing lost).
 */
import { ByteReader } from "../../bytes/reader";
import { ByteWriter } from "../../bytes/writer";
import { DecodeError } from "../../errors";

const COMMODITY_KINDS = 6;
const LEDGER_COUNT = 5; // produced, consumed, imported, exported, lost

export function migrateSectionsV8toV9(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly buildings: number; readonly shipments: number },
): Map<number, Uint8Array> {
  const migrated = new Map(sections);

  const oldBuildings = sections.get(ids.buildings);
  if (oldBuildings === undefined) {
    throw new DecodeError("v8 save is missing BUILDINGS — corrupt save");
  }
  const r = new ByteReader(oldBuildings);
  const count = r.u32();
  const w = new ByteWriter();
  w.u32(count);
  for (let i = 0; i < count; i++) {
    // v8 row: tileIdx u32, kind u16, level u8, status u8, failDays u8,
    // thriveDays u8, stock u32, sick u16, corpses u16, fireTicks u8.
    w.u32(r.u32()).u16(r.u16()).u8(r.u8()).u8(r.u8()).u8(r.u8()).u8(r.u8());
    w.u32(r.u32()).u16(r.u16()).u16(r.u16()).u8(r.u8());
    // v9 appends: chainRole u8, stockIn u16, stockOut u16 — all zero.
    w.u8(0).u16(0).u16(0);
  }
  r.expectEnd();
  migrated.set(ids.buildings, w.finish());

  const chain = new ByteWriter();
  chain.u32(0); // no shipments in flight
  for (let l = 0; l < LEDGER_COUNT; l++) {
    for (let c = 0; c < COMMODITY_KINDS; c++) {
      chain.u32(0);
    }
  }
  migrated.set(ids.shipments, chain.finish());
  return migrated;
}
