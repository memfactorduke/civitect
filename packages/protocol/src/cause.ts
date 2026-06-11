/**
 * Cause chains — pillar-2 enforcement at the type level (ADR-009, TDD §9).
 *
 * AdvisorEvent.cause is REQUIRED: a sim system that cannot say *why* it is
 * warning the player cannot emit the warning at all. The UI renders chains
 * through one generic tappable component; links reference entities by stable
 * id so panels can navigate to the culprit (TDD §7 inspector ids).
 *
 * Wire ids are append-only (see version.ts).
 */
import type { ByteReader } from "./bytes/reader";
import type { ByteWriter } from "./bytes/writer";
import { DecodeError, EncodeError } from "./errors";

export const EntityKind = {
  tile: 1,
  building: 2,
  edge: 3,
  agent: 4,
  /** A sim system itself (e.g. "city budget") when no single entity is the subject. */
  system: 5,
} as const;
export type EntityKind = (typeof EntityKind)[keyof typeof EntityKind];

const ENTITY_KINDS: ReadonlySet<number> = new Set(Object.values(EntityKind));

export interface EntityRef {
  readonly kind: EntityKind;
  /** u32. Stable across snapshots while the entity lives (TDD §7). */
  readonly id: number;
}

export const AdvisorSeverity = {
  info: 1,
  warning: 2,
  alert: 3,
} as const;
export type AdvisorSeverity = (typeof AdvisorSeverity)[keyof typeof AdvisorSeverity];

const SEVERITIES: ReadonlySet<number> = new Set(Object.values(AdvisorSeverity));

/** One step of "because": a subject entity, an i18n label, and its share of the blame. */
export interface CauseLink {
  readonly subject: EntityRef;
  /** i18n key (TDD §9: all strings through keys), e.g. "cause.no-road-access". */
  readonly labelKey: string;
  /** Contribution weight in permille (0–1000) — integer, per the no-floats culture. */
  readonly weightPermille: number;
}

export interface CauseChain {
  /** i18n key for the one-line summary, e.g. "advisor.power-shortage.summary". */
  readonly summaryKey: string;
  readonly links: readonly CauseLink[];
}

export interface AdvisorEvent {
  /** u32, unique per event instance within a session. */
  readonly id: number;
  readonly tick: number;
  readonly severity: AdvisorSeverity;
  /** i18n key for the headline. */
  readonly messageKey: string;
  /** Required — events without cause chains do not typecheck (ADR-009). */
  readonly cause: CauseChain;
}

export function encodeEntityRef(w: ByteWriter, ref: EntityRef): void {
  w.u8(ref.kind).u32(ref.id);
}

export function decodeEntityRef(r: ByteReader): EntityRef {
  const kind = r.u8();
  if (!ENTITY_KINDS.has(kind)) {
    throw new DecodeError(`unknown EntityKind ${kind}`);
  }
  return { kind: kind as EntityKind, id: r.u32() };
}

export function encodeCauseChain(w: ByteWriter, chain: CauseChain): void {
  w.str(chain.summaryKey);
  w.u16(chain.links.length);
  for (const link of chain.links) {
    if (link.weightPermille > 1000) {
      throw new EncodeError(`CauseLink weight ${link.weightPermille} exceeds 1000 permille`);
    }
    encodeEntityRef(w, link.subject);
    w.str(link.labelKey);
    w.u16(link.weightPermille);
  }
}

export function decodeCauseChain(r: ByteReader): CauseChain {
  const summaryKey = r.str();
  const count = r.u16();
  const links: CauseLink[] = [];
  for (let i = 0; i < count; i++) {
    const subject = decodeEntityRef(r);
    const labelKey = r.str();
    const weightPermille = r.u16();
    if (weightPermille > 1000) {
      throw new DecodeError(`CauseLink weight ${weightPermille} exceeds 1000 permille`);
    }
    links.push({ subject, labelKey, weightPermille });
  }
  return { summaryKey, links };
}

export function encodeAdvisorEvent(w: ByteWriter, event: AdvisorEvent): void {
  w.u32(event.id).u64(event.tick).u8(event.severity).str(event.messageKey);
  encodeCauseChain(w, event.cause);
}

export function decodeAdvisorEvent(r: ByteReader): AdvisorEvent {
  const id = r.u32();
  const tick = r.u64();
  const severity = r.u8();
  if (!SEVERITIES.has(severity)) {
    throw new DecodeError(`unknown AdvisorSeverity ${severity}`);
  }
  const messageKey = r.str();
  const cause = decodeCauseChain(r);
  return { id, tick, severity: severity as AdvisorSeverity, messageKey, cause };
}
