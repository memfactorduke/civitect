import { describe, expect, it } from "vitest";
import {
  decideCitySync,
  type LocalCitySyncState,
  type RemoteCitySyncState,
  SyncPolicyError,
} from "./sync-policy";

function local(overrides: Partial<LocalCitySyncState> = {}): LocalCitySyncState {
  return {
    cityId: "city-1",
    deviceId: "phone",
    lastSyncedGeneration: 7,
    generation: 7,
    simVersion: 12,
    updatedAtMs: 1000,
    hasUnpushedChanges: false,
    ...overrides,
  };
}

function remote(overrides: Partial<RemoteCitySyncState> = {}): RemoteCitySyncState {
  return {
    cityId: "city-1",
    deviceId: "desktop",
    generation: 7,
    simVersion: 12,
    updatedAtMs: 900,
    ...overrides,
  };
}

describe("cloud save sync conflict policy", () => {
  it("does nothing when local and remote are at the same clean generation", () => {
    expect(decideCitySync(local(), remote())).toEqual({
      kind: "in-sync",
      reason: "local and remote generations match with no local edits",
    });
  });

  it("pushes with a compare-and-swap guard when only local has offline edits", () => {
    expect(decideCitySync(local({ hasUnpushedChanges: true }), remote())).toEqual({
      kind: "push",
      reason: "local has offline edits and remote has not advanced",
      expectedRemoteGeneration: 7,
      nextGeneration: 8,
    });
  });

  it("pulls when remote advanced and the local city has no unpushed edits", () => {
    expect(decideCitySync(local(), remote({ generation: 8 }))).toEqual({
      kind: "pull",
      reason: "remote generation is newer than local sync cursor",
    });
  });

  it("forks instead of merging when both devices advanced from the same base", () => {
    expect(decideCitySync(local({ hasUnpushedChanges: true }), remote({ generation: 8 }))).toEqual({
      kind: "fork",
      reason: "local has offline edits and remote advanced on another device",
    });
  });

  it("pushes a local-only city and requires the remote row to be absent", () => {
    expect(decideCitySync(local({ generation: 0, lastSyncedGeneration: 0 }), null)).toEqual({
      kind: "push",
      reason: "local city exists and remote city is missing",
      expectedRemoteGeneration: null,
      nextGeneration: 1,
    });
  });

  it("pulls a remote-only city", () => {
    expect(decideCitySync(null, remote())).toEqual({
      kind: "pull",
      reason: "remote city exists and local city is missing",
    });
  });

  it("ignores a stale remote snapshot that is older than the sync cursor", () => {
    expect(decideCitySync(local({ lastSyncedGeneration: 9, generation: 9 }), remote())).toEqual({
      kind: "ignore-stale-remote",
      reason: "remote generation is older than this device's sync cursor",
    });
  });

  it("rejects comparisons across different city ids", () => {
    expect(() => decideCitySync(local(), remote({ cityId: "city-2" }))).toThrow(SyncPolicyError);
  });

  it("rejects invalid generation counters", () => {
    expect(() => decideCitySync(local({ generation: -1 }), remote())).toThrow(SyncPolicyError);
    expect(() => decideCitySync(local({ generation: 6 }), remote())).toThrow(SyncPolicyError);
    expect(() => decideCitySync(local({ generation: 8 }), remote())).toThrow(SyncPolicyError);
    expect(() => decideCitySync(local(), remote({ generation: 1.5 }))).toThrow(SyncPolicyError);
  });
});
