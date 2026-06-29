// @vitest-environment jsdom
import type { LoadResponse, SaveResponse } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createSaveControls } from "./save-controls";
import type { SaveManager } from "./save-manager";

function tick(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function manager(overrides: Partial<SaveManager> = {}): SaveManager {
  let has = false;
  return {
    saveQuick: async () => {
      has = true;
      return Uint8Array.from([1, 2, 3]);
    },
    loadQuick: async () => ({ ok: true, tick: 12, detail: "" }),
    onSaveResponse(_body: SaveResponse): void {},
    onLoadResponse(_body: LoadResponse): void {},
    hasQuicksave: () => has,
    ...overrides,
  };
}

describe("save controls", () => {
  it("starts with Load disabled until a quicksave exists", async () => {
    const host = document.createElement("div");
    createSaveControls(host, manager());

    const save = host.querySelector<HTMLButtonElement>('[data-action="save"]');
    const load = host.querySelector<HTMLButtonElement>('[data-action="load"]');
    const status = host.querySelector<HTMLOutputElement>('[data-testid="save-controls-status"]');

    expect(load?.disabled).toBe(true);
    expect(status?.textContent).toBe("No quicksave");

    save?.click();
    await tick();

    expect(load?.disabled).toBe(false);
    expect(status?.textContent).toBe("Saved");
  });

  it("loads through the same manager and reports the loaded tick", async () => {
    const host = document.createElement("div");
    const controls = createSaveControls(
      host,
      manager({
        hasQuicksave: () => true,
        loadQuick: async () => ({ ok: true, tick: 99, detail: "" }),
      }),
    );

    const verdict = await controls.loadQuick();

    expect(verdict).toEqual({ ok: true, tick: 99, detail: "" });
    expect(host.querySelector('[data-testid="save-controls-status"]')?.textContent).toBe(
      "Loaded tick 99",
    );
  });

  it("returns the existing no-quicksave verdict without posting a load", async () => {
    const host = document.createElement("div");
    let loadCalls = 0;
    const controls = createSaveControls(
      host,
      manager({
        hasQuicksave: () => false,
        loadQuick: async () => {
          loadCalls++;
          return { ok: true, tick: 1, detail: "" };
        },
      }),
    );

    const verdict = await controls.loadQuick();

    expect(loadCalls).toBe(0);
    expect(verdict).toEqual({ ok: false, tick: 0, detail: "no quicksave exists" });
    expect(host.querySelector('[data-testid="save-controls-status"]')?.textContent).toBe(
      "no quicksave exists",
    );
  });
});
