/**
 * Offline-first cloud sync queue primitives (ADR-003/011, TDD 10).
 *
 * This module has no Supabase client, timers, or wall-clock reads. The future
 * sync adapter owns persistence and networking; this file only decides which
 * queued save operation is safe to try next.
 */

export type SyncQueueOperationKind = "push-save" | "pull-save" | "delete-city";

export interface SyncQueueOperation {
  readonly id: string;
  readonly cityId: string;
  readonly kind: SyncQueueOperationKind;
  readonly generation: number;
  readonly enqueuedAtMs: number;
  readonly attempts: number;
  readonly retryAfterMs?: number;
  readonly lastError?: string;
}

export type SyncQueuePlan =
  | {
      readonly kind: "idle";
      readonly reason: "empty" | "waiting-for-retry";
    }
  | {
      readonly kind: "run";
      readonly operation: SyncQueueOperation;
    };

export class SyncQueueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncQueueError";
  }
}

const RETRY_BACKOFF_MS = [1_000, 5_000, 30_000, 120_000, 600_000, 1_800_000] as const;

function assertNonEmpty(label: string, value: string): void {
  if (value.length === 0 || value.trim() !== value) {
    throw new SyncQueueError(`${label} must be a non-empty trimmed string`);
  }
}

function assertSafeNonNegativeInteger(label: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SyncQueueError(`${label} must be a non-negative safe integer`);
  }
}

function assertOperation(operation: SyncQueueOperation): void {
  assertNonEmpty("operation.id", operation.id);
  assertNonEmpty("operation.cityId", operation.cityId);
  assertSafeNonNegativeInteger("operation.generation", operation.generation);
  assertSafeNonNegativeInteger("operation.enqueuedAtMs", operation.enqueuedAtMs);
  assertSafeNonNegativeInteger("operation.attempts", operation.attempts);
  if (operation.retryAfterMs !== undefined) {
    assertSafeNonNegativeInteger("operation.retryAfterMs", operation.retryAfterMs);
  }
  if (
    operation.lastError !== undefined &&
    (operation.lastError.length === 0 || operation.lastError.trim() !== operation.lastError)
  ) {
    throw new SyncQueueError("operation.lastError must be trimmed when present");
  }
}

function assertNowMs(nowMs: number): void {
  assertSafeNonNegativeInteger("nowMs", nowMs);
}

function operationOrder(a: SyncQueueOperation, b: SyncQueueOperation): number {
  if (a.enqueuedAtMs !== b.enqueuedAtMs) {
    return a.enqueuedAtMs - b.enqueuedAtMs;
  }
  return a.id.localeCompare(b.id);
}

function runPriority(operation: SyncQueueOperation): number {
  switch (operation.kind) {
    case "delete-city":
      return 0;
    case "push-save":
      return 1;
    case "pull-save":
      return 2;
  }
}

function nextRetryDelayMs(attemptsBeforeFailure: number): number {
  const index = Math.min(attemptsBeforeFailure, RETRY_BACKOFF_MS.length - 1);
  const delay = RETRY_BACKOFF_MS[index];
  if (delay === undefined) {
    throw new SyncQueueError("retry backoff table is empty");
  }
  return delay;
}

function replaceCityOperation(
  compacted: SyncQueueOperation[],
  next: SyncQueueOperation,
): SyncQueueOperation[] {
  switch (next.kind) {
    case "delete-city":
      return [...compacted.filter((operation) => operation.cityId !== next.cityId), next];
    case "push-save":
      if (
        compacted.some(
          (operation) => operation.cityId === next.cityId && operation.kind === "delete-city",
        )
      ) {
        return compacted;
      }
      return [
        ...compacted.filter(
          (operation) =>
            operation.cityId !== next.cityId ||
            (operation.kind !== "push-save" && operation.kind !== "pull-save"),
        ),
        next,
      ];
    case "pull-save":
      if (
        compacted.some(
          (operation) =>
            operation.cityId === next.cityId &&
            (operation.kind === "delete-city" || operation.kind === "push-save"),
        )
      ) {
        return compacted;
      }
      return [
        ...compacted.filter(
          (operation) => operation.cityId !== next.cityId || operation.kind !== "pull-save",
        ),
        next,
      ];
  }
}

export function compactSyncQueue(queue: readonly SyncQueueOperation[]): SyncQueueOperation[] {
  let compacted: SyncQueueOperation[] = [];
  const ordered = [...queue].sort(operationOrder);

  for (const operation of ordered) {
    assertOperation(operation);
    compacted = replaceCityOperation(compacted, operation);
  }

  return compacted.sort(operationOrder);
}

export function planNextSyncOperation(
  queue: readonly SyncQueueOperation[],
  nowMs: number,
): SyncQueuePlan {
  assertNowMs(nowMs);
  const compacted = compactSyncQueue(queue);
  if (compacted.length === 0) {
    return { kind: "idle", reason: "empty" };
  }

  const eligible = compacted
    .filter((operation) => operation.retryAfterMs === undefined || operation.retryAfterMs <= nowMs)
    .sort((a, b) => {
      const priority = runPriority(a) - runPriority(b);
      if (priority !== 0) {
        return priority;
      }
      return operationOrder(a, b);
    });

  const operation = eligible[0];
  if (operation === undefined) {
    return { kind: "idle", reason: "waiting-for-retry" };
  }
  return { kind: "run", operation };
}

export function recordSyncFailure(
  operation: SyncQueueOperation,
  failedAtMs: number,
  error: string,
): SyncQueueOperation {
  assertOperation(operation);
  assertNowMs(failedAtMs);
  assertNonEmpty("error", error);

  return {
    ...operation,
    attempts: operation.attempts + 1,
    retryAfterMs: failedAtMs + nextRetryDelayMs(operation.attempts),
    lastError: error,
  };
}

export function recordSyncSuccess(
  queue: readonly SyncQueueOperation[],
  completedOperationId: string,
): SyncQueueOperation[] {
  assertNonEmpty("completedOperationId", completedOperationId);
  return compactSyncQueue(queue).filter((operation) => operation.id !== completedOperationId);
}
