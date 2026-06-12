/**
 * Save migration v4 → v5 (ADR-010): v5 adds TRAFFIC (persistent MSA
 * volumes + sliced-solver job state, TDD §6.3). Pre-v5 traffic was DERIVED
 * state — recomputed from world state at every hour boundary and zeroed on
 * load — so the zeroed section the migration injects reproduces exactly
 * what a v4-era load did: a fresh incremental solve at the next boundary.
 *
 * Volumes are per canonical road edge; the count is read off the ROADS
 * section (first u32) so the injected section validates against it.
 */
import { ByteReader } from "../../bytes/reader";
import { ByteWriter } from "../../bytes/writer";

export function migrateSectionsV4toV5(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly roads: number; readonly traffic: number },
): Map<number, Uint8Array> {
  const roadsRaw = sections.get(ids.roads);
  const edgeCount = roadsRaw === undefined ? 0 : new ByteReader(roadsRaw).u32();
  const w = new ByteWriter();
  w.u8(0); // msaK = 0 — no equilibrium memory
  w.u32(0).u32(0).u32(0).u32(0); // ledger: generated/assigned/walked/unroutable
  w.u32(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    w.u32(0);
  }
  w.u8(0); // no in-flight solver job
  const migrated = new Map(sections);
  migrated.set(ids.traffic, w.finish());
  return migrated;
}
