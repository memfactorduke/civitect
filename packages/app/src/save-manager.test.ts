import { afterEach, describe, expect, it, vi } from "vitest";
import { createSaveManager } from "./save-manager";
import { CRASH_QUARANTINE_SAVE_KEY, CRASH_SAVE_SLOT } from "./worker-crash";

class MemoryLocalStorage implements Storage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.entries.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("save manager crash slot handling", () => {
  it("stores quarantine saves without completing a normal quicksave", async () => {
    vi.stubGlobal("localStorage", new MemoryLocalStorage());
    const manager = createSaveManager({
      postSaveRequest: vi.fn(),
      postLoadRequest: vi.fn(),
    });
    const quicksave = manager.saveQuick();
    let completed = false;
    quicksave.then(
      () => {
        completed = true;
      },
      () => {
        completed = true;
      },
    );

    manager.onSaveResponse({ slot: CRASH_SAVE_SLOT, civ: Uint8Array.of(0xca, 0xfe) });
    await Promise.resolve();
    expect(completed).toBe(false);
    expect(localStorage.getItem(CRASH_QUARANTINE_SAVE_KEY)).not.toBeNull();

    manager.onSaveResponse({ slot: 0, civ: Uint8Array.of(1, 2, 3) });
    await expect(quicksave).resolves.toEqual(Uint8Array.of(1, 2, 3));
  });
});
