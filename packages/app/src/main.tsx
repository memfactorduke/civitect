/**
 * Composition root (TDD §1): boots the renderer, mounts the React overlay,
 * spawns the sim worker, and wires the three together. Boundary discipline:
 * the MAIN THREAD never imports @civitect/sim — the sim exists only inside
 * the worker (ADR-006); everything it learns arrives as protocol snapshots.
 */
import { CommandType, decodeMessage, MessageKind } from "@civitect/protocol";
import { bootRenderer } from "@civitect/renderer";
import { type CommandIntent, createUiStore, Overlay } from "@civitect/ui";
import { createRoot } from "react-dom/client";
import { BOOT } from "./boot-config";
import { createCommandQueue } from "./command-queue";
import { pickTile } from "./picking";

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
      default:
        throw new Error(`main thread received unexpected MessageKind ${message.kind}`);
    }
  };

  const dispatch = (intent: CommandIntent): void => {
    queue.dispatch(intent);
  };

  renderer.app.canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const rect = renderer.app.canvas.getBoundingClientRect();
    const tile = pickTile(
      {
        offsetX: renderer.stage.root.position.x + rect.left,
        offsetY: renderer.stage.root.position.y + rect.top,
        scale: 1,
      },
      event.clientX,
      event.clientY,
      BOOT.mapWidth,
      BOOT.mapHeight,
    );
    if (tile !== null) {
      dispatch({ type: CommandType.selectTile, x: tile.x, y: tile.y });
    }
  });

  createRoot(overlayHost).render(<Overlay store={store} dispatch={dispatch} />);

  // Test/debug hook: lets the e2e smoke (and humans in devtools) observe the
  // renderer's display state without reaching into Pixi internals.
  (globalThis as Record<string, unknown>).__civitect = {
    displayState: () => renderer.state(),
    commandCount: () => queue.count(),
  };
}

void main();
