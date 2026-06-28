/**
 * Main-thread save manager (TDD §10): asks the worker for .civ blobs and
 * hands them back, persisting quicksave/autosave blobs in localStorage
 * (base64 — an empty-world save is ~220 bytes; OPFS storage arrives with
 * platform lifecycle work, Phase 9).
 *
 * One in-flight save and one in-flight load at a time — the protocol bodies
 * carry no request ids by design (PR 9a), so this manager is where that
 * contract is enforced.
 */
import type { LoadResponse, SaveResponse } from "@civitect/protocol";

const QUICKSAVE_KEY = "civitect.quicksave";
const AUTOSAVE_INDEX_KEY = "civitect.autosave.index";
const AUTOSAVE_SLOT_FIRST = 1;
const AUTOSAVE_SLOT_LAST = 3;
const AUTOSAVE_SLOT_COUNT = AUTOSAVE_SLOT_LAST - AUTOSAVE_SLOT_FIRST + 1;

/** TDD §10: autosave every 5 game-days; 1 tick = 1 game-minute. */
export const AUTOSAVE_INTERVAL_TICKS = 5 * 24 * 60;

export interface AutosaveEntry {
  readonly slot: number;
  readonly tick: number;
  readonly savedAtMs: number;
}

export interface SaveManager {
  /** Snapshot the worker's world into slot 0. Rejects when the worker reports a failed save. */
  saveQuick(): Promise<Uint8Array>;
  /** Snapshot the worker's world into the rolling autosave ring, slots 1-3. */
  saveAuto(tick: number): Promise<Uint8Array>;
  /** Request an autosave only when the 5-game-day interval has elapsed. */
  maybeSaveAuto(tick: number): Promise<Uint8Array> | null;
  /** Load the persisted quicksave into the worker. Resolves with the worker's verdict. */
  loadQuick(): Promise<LoadResponse>;
  /** Load the newest persisted autosave into the worker. */
  loadLatestAuto(): Promise<LoadResponse>;
  /** Worker message taps — the app's onmessage routes save/load kinds here. */
  onSaveResponse(body: SaveResponse): void;
  onLoadResponse(body: LoadResponse): void;
  hasQuicksave(): boolean;
  hasAutosave(): boolean;
  autosaves(): readonly AutosaveEntry[];
}

export interface SaveManagerPorts {
  postSaveRequest(slot: number): void;
  postLoadRequest(civ: Uint8Array): void;
}

export interface SaveManagerOptions {
  nowMs?: () => number;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function autosaveKey(slot: number): string {
  return `civitect.autosave.${slot}`;
}

function isAutosaveSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= AUTOSAVE_SLOT_FIRST && slot <= AUTOSAVE_SLOT_LAST;
}

function normalizeTick(tick: number): number {
  return Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
}

function readAutosaveIndex(): AutosaveEntry[] {
  const raw = localStorage.getItem(AUTOSAVE_INDEX_KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is AutosaveEntry => {
        if (entry === null || typeof entry !== "object") {
          return false;
        }
        const candidate = entry as Record<string, unknown>;
        return (
          typeof candidate.slot === "number" &&
          isAutosaveSlot(candidate.slot) &&
          typeof candidate.tick === "number" &&
          typeof candidate.savedAtMs === "number" &&
          localStorage.getItem(autosaveKey(candidate.slot)) !== null
        );
      })
      .sort((a, b) => b.tick - a.tick || b.savedAtMs - a.savedAtMs || b.slot - a.slot);
  } catch {
    return [];
  }
}

function writeAutosaveEntry(entry: AutosaveEntry): void {
  const entries = [entry, ...readAutosaveIndex().filter((item) => item.slot !== entry.slot)]
    .sort((a, b) => b.tick - a.tick || b.savedAtMs - a.savedAtMs || b.slot - a.slot)
    .slice(0, AUTOSAVE_SLOT_COUNT);
  localStorage.setItem(AUTOSAVE_INDEX_KEY, JSON.stringify(entries));
}

function newestAutosave(): AutosaveEntry | null {
  return readAutosaveIndex()[0] ?? null;
}

function nextAutosaveSlot(): number {
  const entries = readAutosaveIndex();
  for (let slot = AUTOSAVE_SLOT_FIRST; slot <= AUTOSAVE_SLOT_LAST; slot++) {
    if (!entries.some((entry) => entry.slot === slot)) {
      return slot;
    }
  }
  const newest = entries[0];
  return newest === undefined || newest.slot === AUTOSAVE_SLOT_LAST
    ? AUTOSAVE_SLOT_FIRST
    : newest.slot + 1;
}

type PendingSave = {
  readonly slot: number;
  readonly tick: number | null;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (e: Error) => void;
};

export function createSaveManager(
  ports: SaveManagerPorts,
  options: SaveManagerOptions = {},
): SaveManager {
  const nowMs = options.nowMs ?? Date.now;
  let pendingSave: PendingSave | null = null;
  let pendingLoad: ((verdict: LoadResponse) => void) | null = null;

  const beginSave = (slot: number, tick: number | null): Promise<Uint8Array> => {
    if (pendingSave !== null) {
      return Promise.reject(new Error("a save is already in flight"));
    }
    return new Promise((resolve, reject) => {
      pendingSave = { slot, tick, resolve, reject };
      ports.postSaveRequest(slot);
    });
  };

  const beginLoad = (civ: Uint8Array): Promise<LoadResponse> => {
    if (pendingLoad !== null) {
      return Promise.reject(new Error("a load is already in flight"));
    }
    return new Promise((resolve) => {
      pendingLoad = resolve;
      ports.postLoadRequest(civ);
    });
  };

  return {
    saveQuick(): Promise<Uint8Array> {
      return beginSave(0, null);
    },
    saveAuto(tick: number): Promise<Uint8Array> {
      return beginSave(nextAutosaveSlot(), normalizeTick(tick));
    },
    maybeSaveAuto(tick: number): Promise<Uint8Array> | null {
      if (pendingSave !== null) {
        return null;
      }
      const normalized = normalizeTick(tick);
      const newest = newestAutosave();
      const lastTick = newest?.tick ?? 0;
      if (normalized - lastTick < AUTOSAVE_INTERVAL_TICKS) {
        return null;
      }
      return beginSave(nextAutosaveSlot(), normalized);
    },
    loadQuick(): Promise<LoadResponse> {
      const stored = localStorage.getItem(QUICKSAVE_KEY);
      if (stored === null) {
        return Promise.resolve({ ok: false, tick: 0, detail: "no quicksave exists" });
      }
      return beginLoad(fromBase64(stored));
    },
    loadLatestAuto(): Promise<LoadResponse> {
      const latest = newestAutosave();
      const stored = latest === null ? null : localStorage.getItem(autosaveKey(latest.slot));
      if (stored === null) {
        return Promise.resolve({ ok: false, tick: 0, detail: "no autosave exists" });
      }
      return beginLoad(fromBase64(stored));
    },
    onSaveResponse(body: SaveResponse): void {
      if (pendingSave === null) {
        return;
      }
      if (body.slot !== pendingSave.slot) {
        pendingSave.reject(
          new Error(`worker returned save slot ${body.slot}, expected ${pendingSave.slot}`),
        );
        pendingSave = null;
        return;
      }
      if (body.civ.length === 0) {
        pendingSave.reject(new Error("worker reported a failed save"));
        pendingSave = null;
        return;
      }
      if (body.slot === 0) {
        localStorage.setItem(QUICKSAVE_KEY, toBase64(body.civ));
      } else if (isAutosaveSlot(body.slot) && pendingSave.tick !== null) {
        localStorage.setItem(autosaveKey(body.slot), toBase64(body.civ));
        writeAutosaveEntry({
          slot: body.slot,
          tick: pendingSave.tick,
          savedAtMs: nowMs(),
        });
      }
      pendingSave.resolve(body.civ);
      pendingSave = null;
    },
    onLoadResponse(body: LoadResponse): void {
      pendingLoad?.(body);
      pendingLoad = null;
    },
    hasQuicksave(): boolean {
      return localStorage.getItem(QUICKSAVE_KEY) !== null;
    },
    hasAutosave(): boolean {
      return newestAutosave() !== null;
    },
    autosaves(): readonly AutosaveEntry[] {
      return readAutosaveIndex();
    },
  };
}
