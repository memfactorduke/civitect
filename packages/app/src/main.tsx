/**
 * Composition root (TDD §1): boots the renderer, mounts the React overlay,
 * spawns the sim worker, and wires the three together. Boundary discipline:
 * the MAIN THREAD never imports @civitect/sim — the sim exists only inside
 * the worker (ADR-006); everything it learns arrives as protocol snapshots.
 */
import { CommandType, decodeMessage, encodeMessage, MessageKind } from "@civitect/protocol";
import { attachCameraControls, bootRenderer } from "@civitect/renderer";
import { type CommandIntent, createUiStore, Overlay } from "@civitect/ui";
import { createRoot } from "react-dom/client";
import { BOOT } from "./boot-config";
import { createCommandQueue } from "./command-queue";
import { pickTileAt } from "./picking";
import { createSaveManager } from "./save-manager";

async function main(): Promise<void> {
  const host = document.getElementById("world");
  const overlayHost = document.getElementById("overlay");
  if (host === null || overlayHost === null) {
    throw new Error("app page is missing #world / #overlay");
  }

  const store = createUiStore();
  const renderer = await bootRenderer({
    host,
    mapWidth: BOOT.mapWidth,
    mapHeight: BOOT.mapHeight,
  });

  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const queue = createCommandQueue((bytes, transfer) => worker.postMessage(bytes, { transfer }));

  const saveManager = createSaveManager({
    postSaveRequest(slot) {
      const bytes = encodeMessage({ kind: MessageKind.saveRequest, body: { slot } });
      worker.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
    },
    postLoadRequest(civ) {
      const bytes = encodeMessage({ kind: MessageKind.loadRequest, body: { civ } });
      worker.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
    },
  });

  worker.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
    const message = decodeMessage(bytes); // hard version check at boot (TDD §7)
    switch (message.kind) {
      case MessageKind.snapshot:
        renderer.consume(message.body);
        store.getState().applySnapshot(message.body);
        break;
      case MessageKind.commandRejection:
        // Optimistic ghosts arrive with build tools (Phase 1); for now a
        // rejection is just developer-visible.
        console.warn("[sim] rejected command", message.body);
        break;
      case MessageKind.saveResponse:
        saveManager.onSaveResponse(message.body);
        break;
      case MessageKind.loadResponse:
        if (!message.body.ok) {
          console.warn("[save] load refused:", message.body.detail);
        }
        saveManager.onLoadResponse(message.body);
        break;
      default:
        throw new Error(`main thread received unexpected MessageKind ${message.kind}`);
    }
  };

  // Quicksave/quickload (TDD §10; slot UI arrives with the pause menu).
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void saveManager.saveQuick();
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "o") {
      event.preventDefault();
      void saveManager.loadQuick();
    }
  });

  const dispatch = (intent: CommandIntent): void => {
    queue.dispatch(intent);
  };

  // Tap selects on pointerdown (keeps the <50 ms path hot); dragging past
  // the threshold pans via the camera controls. A drag still selects its
  // start tile first — acceptable until the Phase 1 tool-mode UX pass.
  renderer.app.canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const rect = renderer.app.canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    const tile = pickTileAt(w.wx, w.wy, BOOT.mapWidth, BOOT.mapHeight);
    if (tile !== null) {
      dispatch({ type: CommandType.selectTile, x: tile.x, y: tile.y });
    }
  });
  attachCameraControls(renderer, renderer.app.canvas as unknown as HTMLElement);

  createRoot(overlayHost).render(<Overlay store={store} dispatch={dispatch} />);

  // Test/debug hook: lets the e2e smoke (and humans in devtools) observe the
  // renderer's display state without reaching into Pixi internals.
  (globalThis as Record<string, unknown>).__civitect = {
    displayState: () => renderer.state(),
    commandCount: () => queue.count(),
    saveQuick: () => saveManager.saveQuick().then((bytes) => bytes.length),
    loadQuick: () => saveManager.loadQuick(),
    hasQuicksave: () => saveManager.hasQuicksave(),
  };
}

void main();
