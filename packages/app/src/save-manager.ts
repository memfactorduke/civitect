/**
 * Main-thread save manager (TDD §10): asks the worker for .civ blobs and
 * hands them back, persisting the quicksave in localStorage (base64 — an
 * empty-world save is ~220 bytes; real slot/OPFS storage and the 3-slot
 * autosave ring arrive with platform lifecycle work, Phase 9).
 *
 * One in-flight save and one in-flight load at a time — the protocol bodies
 * carry no request ids by design (PR 9a), so this manager is where that
 * contract is enforced.
 */
import type { LoadResponse, SaveResponse } from "@civitect/protocol";

const QUICKSAVE_KEY = "civitect.quicksave";
const CORRUPT_QUICKSAVE_DETAIL = "quicksave data is unreadable";

export interface SaveManager {
  /** Snapshot the worker's world; resolves with the .civ bytes (also persisted). Rejects when the worker reports a failed save (empty civ). */
  saveQuick(): Promise<Uint8Array>;
  /** Load the persisted quicksave into the worker. Resolves with the worker's verdict. */
  loadQuick(): Promise<LoadResponse>;
  /** Worker message taps — the app's onmessage routes save/load kinds here. */
  onSaveResponse(body: SaveResponse): void;
  onLoadResponse(body: LoadResponse): void;
  hasQuicksave(): boolean;
}

export interface SaveManagerPorts {
  postSaveRequest(slot: number): void;
  postLoadRequest(civ: Uint8Array): void;
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

function readStoredQuicksave(): LoadResponse | Uint8Array {
  const stored = localStorage.getItem(QUICKSAVE_KEY);
  if (stored === null) {
    return { ok: false, tick: 0, detail: "no quicksave exists" };
  }
  try {
    return fromBase64(stored);
  } catch {
    localStorage.removeItem(QUICKSAVE_KEY);
    return { ok: false, tick: 0, detail: CORRUPT_QUICKSAVE_DETAIL };
  }
}

export function createSaveManager(ports: SaveManagerPorts): SaveManager {
  let pendingSave: { resolve: (bytes: Uint8Array) => void; reject: (e: Error) => void } | null =
    null;
  let pendingLoad: ((verdict: LoadResponse) => void) | null = null;

  return {
    saveQuick(): Promise<Uint8Array> {
      if (pendingSave !== null) {
        return Promise.reject(new Error("a save is already in flight"));
      }
      return new Promise((resolve, reject) => {
        pendingSave = { resolve, reject };
        ports.postSaveRequest(0);
      });
    },
    loadQuick(): Promise<LoadResponse> {
      if (pendingLoad !== null) {
        return Promise.reject(new Error("a load is already in flight"));
      }
      const stored = readStoredQuicksave();
      if (!(stored instanceof Uint8Array)) {
        return Promise.resolve(stored);
      }
      return new Promise((resolve) => {
        pendingLoad = resolve;
        ports.postLoadRequest(stored);
      });
    },
    onSaveResponse(body: SaveResponse): void {
      if (body.civ.length === 0) {
        pendingSave?.reject(new Error("worker reported a failed save"));
        pendingSave = null;
        return;
      }
      localStorage.setItem(QUICKSAVE_KEY, toBase64(body.civ));
      pendingSave?.resolve(body.civ);
      pendingSave = null;
    },
    onLoadResponse(body: LoadResponse): void {
      pendingLoad?.(body);
      pendingLoad = null;
    },
    hasQuicksave(): boolean {
      return localStorage.getItem(QUICKSAVE_KEY) !== null;
    },
  };
}
