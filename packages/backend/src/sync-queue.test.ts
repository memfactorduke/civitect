import { describe, expect, it } from "vitest";
import {
  compactSyncQueue,
  planNextSyncOperation,
  recordSyncFailure,
  recordSyncSuccess,
  SyncQueueError,
  type SyncQueueOperation,
} from "./sync-queue";

function operation(overrides: Partial<SyncQueueOperation> = {}): SyncQueueOperation {
  return {
    id: "op-1",
    cityId: "city-1",
    kind: "push-save",
    generation: 1,
    enqueuedAtMs: 100,
    attempts: 0,
    ...overrides,
  };
}

describe("offline cloud sync queue", () => {
  it("compacts redundant city work so the latest push supersedes stale pulls and pushes", () => {
    expect(
      compactSyncQueue([
        operation({ id: "pull-1", kind: "pull-save", generation: 1, enqueuedAtMs: 100 }),
        operation({ id: "push-1", kind: "push-save", generation: 2, enqueuedAtMs: 110 }),
        operation({ id: "push-2", kind: "push-save", generation: 3, enqueuedAtMs: 120 }),
        operation({ id: "other-city", cityId: "city-2", generation: 1, enqueuedAtMs: 90 }),
      ]),
    ).toEqual([
      operation({ id: "other-city", cityId: "city-2", generation: 1, enqueuedAtMs: 90 }),
      operation({ id: "push-2", kind: "push-save", generation: 3, enqueuedAtMs: 120 }),
    ]);
  });

  it("lets account and city deletion work supersede pending save work", () => {
    const queue = [
      operation({ id: "push-1", generation: 4, enqueuedAtMs: 100 }),
      operation({ id: "delete-1", kind: "delete-city", generation: 4, enqueuedAtMs: 120 }),
      operation({ id: "late-push", generation: 5, enqueuedAtMs: 130 }),
      operation({ id: "other-city", cityId: "city-2", generation: 1, enqueuedAtMs: 90 }),
    ];

    expect(compactSyncQueue(queue)).toEqual([
      operation({ id: "other-city", cityId: "city-2", generation: 1, enqueuedAtMs: 90 }),
      operation({ id: "delete-1", kind: "delete-city", generation: 4, enqueuedAtMs: 120 }),
    ]);
    expect(planNextSyncOperation(queue, 1_000)).toEqual({
      kind: "run",
      operation: operation({
        id: "delete-1",
        kind: "delete-city",
        generation: 4,
        enqueuedAtMs: 120,
      }),
    });
  });

  it("plans deterministic work without reading wall-clock time", () => {
    const retrying = operation({
      id: "retrying",
      generation: 2,
      enqueuedAtMs: 100,
      retryAfterMs: 5_000,
      attempts: 1,
    });

    expect(planNextSyncOperation([retrying], 4_999)).toEqual({
      kind: "idle",
      reason: "waiting-for-retry",
    });
    expect(planNextSyncOperation([retrying], 5_000)).toEqual({
      kind: "run",
      operation: retrying,
    });
  });

  it("records bounded retry backoff from explicit timestamps", () => {
    const firstFailure = recordSyncFailure(operation(), 1_000, "network offline");
    expect(firstFailure).toEqual({
      ...operation(),
      attempts: 1,
      retryAfterMs: 2_000,
      lastError: "network offline",
    });

    const secondFailure = recordSyncFailure(firstFailure, 2_000, "still offline");
    expect(secondFailure).toEqual({
      ...operation(),
      attempts: 2,
      retryAfterMs: 7_000,
      lastError: "still offline",
    });
  });

  it("removes completed work and re-compacts the remainder", () => {
    expect(
      recordSyncSuccess(
        [
          operation({ id: "push-1", generation: 1, enqueuedAtMs: 100 }),
          operation({ id: "push-2", generation: 2, enqueuedAtMs: 110 }),
          operation({ id: "other-city", cityId: "city-2", generation: 1, enqueuedAtMs: 90 }),
        ],
        "push-2",
      ),
    ).toEqual([operation({ id: "other-city", cityId: "city-2", generation: 1, enqueuedAtMs: 90 })]);
  });

  it("rejects unsafe queue records before they can drive sync behavior", () => {
    expect(() => compactSyncQueue([operation({ id: "" })])).toThrow(SyncQueueError);
    expect(() => compactSyncQueue([operation({ cityId: " city-1" })])).toThrow(SyncQueueError);
    expect(() => compactSyncQueue([operation({ generation: -1 })])).toThrow(SyncQueueError);
    expect(() => compactSyncQueue([operation({ enqueuedAtMs: 1.5 })])).toThrow(SyncQueueError);
    expect(() => recordSyncFailure(operation(), 1_000, " ")).toThrow(SyncQueueError);
    expect(() => planNextSyncOperation([operation()], -1)).toThrow(SyncQueueError);
  });
});
