import { CommandType } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import {
  CRASH_QUARANTINE_REPORT_KEY,
  CRASH_QUARANTINE_SAVE_KEY,
  type CrashStorage,
  createWorkerCrashQuarantine,
  loadCrashQuarantineSave,
  storeCrashQuarantineSave,
} from "./worker-crash";

function memoryStorage(): CrashStorage & { readonly entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

describe("worker crash quarantine (TDD §14 app shell)", () => {
  it("stores and loads a quarantine save blob", () => {
    const storage = memoryStorage();

    expect(storeCrashQuarantineSave(storage, Uint8Array.of(1, 2, 3))).toBe(3);
    expect(loadCrashQuarantineSave(storage)).toEqual(Uint8Array.of(1, 2, 3));

    expect(storeCrashQuarantineSave(storage, new Uint8Array(0))).toBe(0);
    expect(storage.getItem(CRASH_QUARANTINE_SAVE_KEY)).toBeNull();
  });

  it("captures the last snapshot tick, recent commands, and quarantine-save size", () => {
    const storage = memoryStorage();
    const quarantine = createWorkerCrashQuarantine({
      storage,
      now: () => new Date("2026-06-27T12:00:00.000Z"),
      recentCommands: () => [
        { seq: 7, tick: 0, type: CommandType.selectTile, x: 4, y: 5 },
        { seq: 8, tick: 0, type: CommandType.setSpeed, speed: 9 },
      ],
    });

    quarantine.recordSnapshotTick(1234);
    quarantine.recordCrashSaveBytes(456);
    const report = quarantine.capture("worker-quarantine-save", new Error("boom"));

    expect(report).toEqual({
      schemaVersion: 1,
      source: "worker-quarantine-save",
      capturedAtIso: "2026-06-27T12:00:00.000Z",
      message: "boom",
      stack: expect.any(String),
      lastSnapshotTick: 1234,
      recentCommands: [
        { seq: 7, tick: 0, type: CommandType.selectTile, x: 4, y: 5 },
        { seq: 8, tick: 0, type: CommandType.setSpeed, speed: 9 },
      ],
      quarantineSaveBytes: 456,
    });
    expect(quarantine.latest()).toEqual(report);

    quarantine.clear();
    expect(storage.getItem(CRASH_QUARANTINE_REPORT_KEY)).toBeNull();
  });
});
