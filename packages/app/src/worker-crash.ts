import type { Command } from "@civitect/protocol";

export const CRASH_SAVE_SLOT = 255;
export const CRASH_QUARANTINE_SAVE_KEY = "civitect.crash-quarantine.save";
export const CRASH_QUARANTINE_REPORT_KEY = "civitect.crash-quarantine.report";

export type WorkerCrashSource =
  | "worker-error"
  | "worker-messageerror"
  | "worker-boundary"
  | "worker-quarantine-save";

export interface WorkerCrashReport {
  readonly schemaVersion: 1;
  readonly source: WorkerCrashSource;
  readonly capturedAtIso: string;
  readonly message: string;
  readonly stack: string;
  readonly lastSnapshotTick: number | null;
  readonly recentCommands: readonly Command[];
  readonly quarantineSaveBytes: number;
}

export interface CrashStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkerCrashQuarantine {
  recordSnapshotTick(tick: number): void;
  recordCrashSaveBytes(bytes: number): void;
  capture(source: WorkerCrashSource, error: unknown): WorkerCrashReport;
  latest(): WorkerCrashReport | null;
  clear(): void;
}

export interface WorkerCrashQuarantineOptions {
  readonly storage: CrashStorage;
  readonly recentCommands: () => readonly Command[];
  readonly now?: () => Date;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

function base64ToBytes(text: string): Uint8Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export function storeCrashQuarantineSave(storage: CrashStorage, civ: Uint8Array): number {
  if (civ.length === 0) {
    storage.removeItem(CRASH_QUARANTINE_SAVE_KEY);
    return 0;
  }
  storage.setItem(CRASH_QUARANTINE_SAVE_KEY, bytesToBase64(civ));
  return civ.length;
}

export function loadCrashQuarantineSave(storage: CrashStorage): Uint8Array | null {
  const saved = storage.getItem(CRASH_QUARANTINE_SAVE_KEY);
  return saved === null ? null : base64ToBytes(saved);
}

function describeError(error: unknown): { readonly message: string; readonly stack: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack ?? "" };
  }
  const event = error as {
    readonly message?: unknown;
    readonly error?: unknown;
    readonly type?: unknown;
  };
  if (event.error instanceof Error) {
    return { message: event.error.message, stack: event.error.stack ?? "" };
  }
  if (typeof event.message === "string") {
    return { message: event.message, stack: "" };
  }
  if (typeof event.type === "string") {
    return { message: event.type, stack: "" };
  }
  return { message: String(error), stack: "" };
}

export function createWorkerCrashQuarantine(
  options: WorkerCrashQuarantineOptions,
): WorkerCrashQuarantine {
  const now = options.now ?? (() => new Date());
  let lastSnapshotTick: number | null = null;
  let quarantineSaveBytes = loadCrashQuarantineSave(options.storage)?.length ?? 0;

  return {
    recordSnapshotTick(tick: number): void {
      lastSnapshotTick = tick;
    },
    recordCrashSaveBytes(bytes: number): void {
      quarantineSaveBytes = bytes;
    },
    capture(source: WorkerCrashSource, error: unknown): WorkerCrashReport {
      const detail = describeError(error);
      const report: WorkerCrashReport = {
        schemaVersion: 1,
        source,
        capturedAtIso: now().toISOString(),
        message: detail.message,
        stack: detail.stack,
        lastSnapshotTick,
        recentCommands: [...options.recentCommands()],
        quarantineSaveBytes,
      };
      options.storage.setItem(CRASH_QUARANTINE_REPORT_KEY, JSON.stringify(report));
      return report;
    },
    latest(): WorkerCrashReport | null {
      const saved = options.storage.getItem(CRASH_QUARANTINE_REPORT_KEY);
      if (saved === null) {
        return null;
      }
      return JSON.parse(saved) as WorkerCrashReport;
    },
    clear(): void {
      options.storage.removeItem(CRASH_QUARANTINE_REPORT_KEY);
      options.storage.removeItem(CRASH_QUARANTINE_SAVE_KEY);
      quarantineSaveBytes = 0;
    },
  };
}
