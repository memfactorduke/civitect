// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { AUTOSAVE_INTERVAL_TICKS, createSaveManager, type SaveManager } from "./save-manager";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function requirePromise<T>(promise: Promise<T> | null): Promise<T> {
  if (promise === null) {
    throw new Error("expected autosave request");
  }
  return promise;
}

function harness() {
  let now = 1000;
  const saveSlots: number[] = [];
  const loadBlobs: Uint8Array[] = [];
  const manager = createSaveManager(
    {
      postSaveRequest(slot) {
        saveSlots.push(slot);
      },
      postLoadRequest(civ) {
        loadBlobs.push(civ);
      },
    },
    { nowMs: () => now++ },
  );
  return { manager, saveSlots, loadBlobs };
}

function finishSave(manager: SaveManager, slot: number, bytes: Uint8Array): void {
  manager.onSaveResponse({ slot, civ: bytes });
}

describe("save manager autosave ring", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it("keeps quicksave separate from the autosave ring", async () => {
    const { manager, saveSlots } = harness();

    const save = manager.saveQuick();
    expect(saveSlots).toEqual([0]);
    finishSave(manager, 0, Uint8Array.of(1, 2, 3));

    await expect(save).resolves.toEqual(Uint8Array.of(1, 2, 3));
    expect(manager.hasQuicksave()).toBe(true);
    expect(manager.hasAutosave()).toBe(false);
    expect(manager.autosaves()).toEqual([]);
  });

  it("rotates autosaves through slots 1-3 and loads the newest blob", async () => {
    const { manager, saveSlots, loadBlobs } = harness();

    const first = manager.saveAuto(100);
    expect(saveSlots).toEqual([1]);
    finishSave(manager, 1, Uint8Array.of(1));
    await first;

    const second = manager.saveAuto(200);
    expect(saveSlots).toEqual([1, 2]);
    finishSave(manager, 2, Uint8Array.of(2));
    await second;

    const third = manager.saveAuto(300);
    expect(saveSlots).toEqual([1, 2, 3]);
    finishSave(manager, 3, Uint8Array.of(3));
    await third;

    const fourth = manager.saveAuto(400);
    expect(saveSlots).toEqual([1, 2, 3, 1]);
    finishSave(manager, 1, Uint8Array.of(4));
    await fourth;

    expect(manager.autosaves().map((entry) => `${entry.slot}:${entry.tick}`)).toEqual([
      "1:400",
      "3:300",
      "2:200",
    ]);

    const load = manager.loadLatestAuto();
    expect(loadBlobs).toEqual([Uint8Array.of(4)]);
    manager.onLoadResponse({ ok: true, tick: 400, detail: "" });
    await expect(load).resolves.toEqual({ ok: true, tick: 400, detail: "" });
  });

  it("saves automatically only after each 5-game-day interval", async () => {
    const { manager, saveSlots } = harness();

    expect(manager.maybeSaveAuto(AUTOSAVE_INTERVAL_TICKS - 1)).toBeNull();

    const first = requirePromise(manager.maybeSaveAuto(AUTOSAVE_INTERVAL_TICKS));
    expect(saveSlots).toEqual([1]);
    expect(manager.maybeSaveAuto(AUTOSAVE_INTERVAL_TICKS * 2)).toBeNull();
    finishSave(manager, 1, Uint8Array.of(1));
    await first;

    expect(manager.maybeSaveAuto(AUTOSAVE_INTERVAL_TICKS * 2 - 1)).toBeNull();
    const second = requirePromise(manager.maybeSaveAuto(AUTOSAVE_INTERVAL_TICKS * 2));
    expect(saveSlots).toEqual([1, 2]);
    finishSave(manager, 2, Uint8Array.of(2));
    await second;
  });

  it("returns an explicit failed verdict when no autosave exists", async () => {
    const { manager } = harness();

    await expect(manager.loadLatestAuto()).resolves.toEqual({
      ok: false,
      tick: 0,
      detail: "no autosave exists",
    });
  });
});
