/**
 * Save migration v5 → v6 (ADR-010): v6 adds AGENTPINS (pinned cim persona
 * refs, GDD §17.5). Pre-v6 builds had no pinning, so the empty list the
 * migration injects is recorded truth.
 */
import { ByteWriter } from "../../bytes/writer";

export function migrateSectionsV5toV6(
  sections: ReadonlyMap<number, Uint8Array>,
  ids: { readonly agentPins: number },
): Map<number, Uint8Array> {
  const w = new ByteWriter();
  w.u32(0);
  const migrated = new Map(sections);
  migrated.set(ids.agentPins, w.finish());
  return migrated;
}
