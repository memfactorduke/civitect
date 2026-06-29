import type { LoadResponse } from "@civitect/protocol";
import type { SaveManager } from "./save-manager";

export interface SaveControls {
  saveQuick(): Promise<Uint8Array>;
  loadQuick(): Promise<LoadResponse>;
  destroy(): void;
}

function setBusy(buttons: readonly HTMLButtonElement[], busy: boolean): void {
  for (const button of buttons) {
    button.disabled = busy;
  }
}

export function createSaveControls(host: HTMLElement, manager: SaveManager): SaveControls {
  host.replaceChildren();
  host.setAttribute("role", "group");
  host.setAttribute("aria-label", "Save controls");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.dataset.action = "save";
  saveButton.title = "Quicksave this city";

  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.textContent = "Load";
  loadButton.dataset.action = "load";
  loadButton.title = "Load the latest quicksave";

  const status = document.createElement("output");
  status.dataset.testid = "save-controls-status";
  status.setAttribute("aria-live", "polite");

  const refreshAvailability = (): void => {
    loadButton.disabled = !manager.hasQuicksave();
    status.textContent = manager.hasQuicksave() ? "Quicksave ready" : "No quicksave";
  };

  const saveQuick = async (): Promise<Uint8Array> => {
    setBusy([saveButton, loadButton], true);
    status.textContent = "Saving...";
    try {
      const bytes = await manager.saveQuick();
      status.textContent = "Saved";
      loadButton.disabled = false;
      return bytes;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Save failed";
      loadButton.disabled = !manager.hasQuicksave();
      throw error;
    } finally {
      saveButton.disabled = false;
    }
  };

  const loadQuick = async (): Promise<LoadResponse> => {
    if (!manager.hasQuicksave()) {
      const verdict = { ok: false, tick: 0, detail: "no quicksave exists" };
      status.textContent = verdict.detail;
      loadButton.disabled = true;
      return verdict;
    }
    setBusy([saveButton, loadButton], true);
    status.textContent = "Loading...";
    try {
      const verdict = await manager.loadQuick();
      status.textContent = verdict.ok ? `Loaded tick ${verdict.tick}` : verdict.detail;
      return verdict;
    } finally {
      saveButton.disabled = false;
      loadButton.disabled = !manager.hasQuicksave();
    }
  };

  const onSave = (): void => {
    void saveQuick();
  };
  const onLoad = (): void => {
    void loadQuick();
  };
  saveButton.addEventListener("click", onSave);
  loadButton.addEventListener("click", onLoad);

  host.append(saveButton, loadButton, status);
  refreshAvailability();

  return {
    saveQuick,
    loadQuick,
    destroy(): void {
      saveButton.removeEventListener("click", onSave);
      loadButton.removeEventListener("click", onLoad);
      host.replaceChildren();
    },
  };
}
