import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveManager, type SaveManagerPorts } from "./save-manager";

const QUICK_SAVE_KEY = "civitect.quicksave";

function createHarness() {
  const saveSlots: number[] = [];
  const loadRequests: Uint8Array[] = [];
  const ports: SaveManagerPorts = {
    postSaveRequest: (slot) => saveSlots.push(slot),
    postLoadRequest: (civ) => loadRequests.push(civ),
  };
  return {
    manager: createSaveManager(ports),
    saveSlots,
    loadRequests,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
});

describe("save manager", () => {
  it("persists a successful quicksave and reloads the same bytes", async () => {
    const { manager, saveSlots, loadRequests } = createHarness();
    const bytes = Uint8Array.of(0xca, 0xfe, 0x01);

    const save = manager.saveQuick();
    expect(saveSlots).toEqual([0]);
    manager.onSaveResponse({ slot: 0, civ: bytes });
    await expect(save).resolves.toEqual(bytes);
    expect(manager.hasQuicksave()).toBe(true);

    const load = manager.loadQuick();
    expect(loadRequests).toEqual([bytes]);
    manager.onLoadResponse({ ok: true, tick: 42, detail: "" });
    await expect(load).resolves.toEqual({ ok: true, tick: 42, detail: "" });
  });

  it("reports an absent quicksave without posting to the worker", async () => {
    const { manager, loadRequests } = createHarness();

    await expect(manager.loadQuick()).resolves.toEqual({
      ok: false,
      tick: 0,
      detail: "no quicksave exists",
    });
    expect(loadRequests).toHaveLength(0);
    expect(manager.hasQuicksave()).toBe(false);
  });

  it("clears corrupt quicksave storage without leaving a load in flight", async () => {
    const { manager, saveSlots, loadRequests } = createHarness();
    localStorage.setItem(QUICK_SAVE_KEY, "not valid base64%%%");

    await expect(manager.loadQuick()).resolves.toEqual({
      ok: false,
      tick: 0,
      detail: "quicksave data is unreadable",
    });
    expect(loadRequests).toHaveLength(0);
    expect(manager.hasQuicksave()).toBe(false);

    const replacement = manager.saveQuick();
    expect(saveSlots).toEqual([0]);
    manager.onSaveResponse({ slot: 0, civ: Uint8Array.of(9, 8, 7) });
    await expect(replacement).resolves.toEqual(Uint8Array.of(9, 8, 7));
  });

  it("rejects a failed worker save without persisting an empty blob", async () => {
    const { manager } = createHarness();

    const save = manager.saveQuick();
    manager.onSaveResponse({ slot: 0, civ: new Uint8Array(0) });

    await expect(save).rejects.toThrow("worker reported a failed save");
    expect(manager.hasQuicksave()).toBe(false);
  });
});
