/**
 * Offline-first save sync policy (ADR-003/011, TDD §10).
 *
 * This module deliberately contains no Supabase client code. It is the provider
 * neutral decision layer the future Supabase adapter must obey: generation
 * counters decide push/pull/fork, and divergent offline edits are never merged.
 */

export type SyncDecisionKind = "in-sync" | "push" | "pull" | "fork" | "ignore-stale-remote";

export interface LocalCitySyncState {
  readonly cityId: string;
  readonly deviceId: string;
  /** Last generation this device successfully pulled from or pushed to cloud. */
  readonly lastSyncedGeneration: number;
  /** Current local save generation. Equal to lastSyncedGeneration until push succeeds. */
  readonly generation: number;
  readonly simVersion: number;
  readonly updatedAtMs: number;
  readonly hasUnpushedChanges: boolean;
  readonly thumbnailUrl?: string;
}

export interface RemoteCitySyncState {
  readonly cityId: string;
  readonly deviceId: string;
  readonly generation: number;
  readonly simVersion: number;
  readonly updatedAtMs: number;
  readonly thumbnailUrl?: string;
}

export interface SyncDecision {
  readonly kind: SyncDecisionKind;
  readonly reason: string;
  /** Compare-and-swap guard for upload; null means "remote row must not exist". */
  readonly expectedRemoteGeneration?: number | null;
  /** Generation the cloud row should carry after a successful push. */
  readonly nextGeneration?: number;
}

export class SyncPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncPolicyError";
  }
}

function assertNonNegativeInteger(label: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new SyncPolicyError(`${label} must be a non-negative integer`);
  }
}

function assertState(state: LocalCitySyncState | RemoteCitySyncState, label: string): void {
  if (state.cityId.length === 0) {
    throw new SyncPolicyError(`${label}.cityId must be non-empty`);
  }
  if (state.deviceId.length === 0) {
    throw new SyncPolicyError(`${label}.deviceId must be non-empty`);
  }
  assertNonNegativeInteger(`${label}.generation`, state.generation);
  assertNonNegativeInteger(`${label}.simVersion`, state.simVersion);
  assertNonNegativeInteger(`${label}.updatedAtMs`, state.updatedAtMs);
}

function assertLocalState(local: LocalCitySyncState): void {
  assertState(local, "local");
  assertNonNegativeInteger("local.lastSyncedGeneration", local.lastSyncedGeneration);
  if (local.generation < local.lastSyncedGeneration) {
    throw new SyncPolicyError("local.generation cannot be older than lastSyncedGeneration");
  }
  if (local.generation !== local.lastSyncedGeneration) {
    throw new SyncPolicyError(
      "local.generation must match lastSyncedGeneration until a push succeeds",
    );
  }
}

function pushDecision(
  reason: string,
  expectedRemoteGeneration: number | null,
  nextGeneration: number,
): SyncDecision {
  return { kind: "push", reason, expectedRemoteGeneration, nextGeneration };
}

export function decideCitySync(
  local: LocalCitySyncState | null,
  remote: RemoteCitySyncState | null,
): SyncDecision {
  if (local === null && remote === null) {
    return { kind: "in-sync", reason: "no local or remote city exists" };
  }

  if (local === null) {
    assertState(remote as RemoteCitySyncState, "remote");
    return { kind: "pull", reason: "remote city exists and local city is missing" };
  }

  assertLocalState(local);

  if (remote === null) {
    return pushDecision("local city exists and remote city is missing", null, local.generation + 1);
  }

  assertState(remote, "remote");
  if (local.cityId !== remote.cityId) {
    throw new SyncPolicyError(
      `cannot compare different cities: ${local.cityId} vs ${remote.cityId}`,
    );
  }

  if (remote.generation < local.lastSyncedGeneration) {
    return {
      kind: "ignore-stale-remote",
      reason: "remote generation is older than this device's sync cursor",
    };
  }

  if (local.hasUnpushedChanges) {
    if (remote.generation === local.lastSyncedGeneration) {
      return pushDecision(
        "local has offline edits and remote has not advanced",
        remote.generation,
        remote.generation + 1,
      );
    }
    return {
      kind: "fork",
      reason: "local has offline edits and remote advanced on another device",
    };
  }

  if (remote.generation > local.lastSyncedGeneration) {
    return { kind: "pull", reason: "remote generation is newer than local sync cursor" };
  }

  return { kind: "in-sync", reason: "local and remote generations match with no local edits" };
}
