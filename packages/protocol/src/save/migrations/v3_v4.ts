/**
 * Save migration v3 → v4 (ADR-010): v4 adds BUILDINGS + COHORTS. v3-era
 * builds REFUSED to save worlds with buildings, so the empty sections the
 * migration injects are recorded truth, not guesses.
 */
import { ByteWriter } from "../../bytes/writer";

export function migrateSectionsV3toV4(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly buildings: number; readonly cohorts: number },
): Map<number, Uint8Array> {
  const empty = (): Uint8Array => {
    const w = new ByteWriter();
    w.u32(0);
    return w.finish();
  };
  const migrated = new Map(sections);
  migrated.set(ids.buildings, empty());
  migrated.set(ids.cohorts, empty());
  return migrated;
}
