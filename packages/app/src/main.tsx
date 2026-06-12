/**
 * Composition root (TDD §1): boots the renderer, mounts the React overlay,
 * spawns the sim worker, and wires the three together. Boundary discipline:
 * the MAIN THREAD never imports @civitect/sim — the sim exists only inside
 * the worker (ADR-006); everything it learns arrives as protocol snapshots.
 */
import {
  AGENT_FLOATS,
  CommandType,
  decodeMessage,
  EntityKind,
  encodeMessage,
  MessageKind,
  RoadClassWire,
} from "@civitect/protocol";
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

  let lastAgents: Float32Array | null = null;
  worker.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data;
    // Snapshots arrive as { bytes, agents } so the transform rider can ride
    // the same transfer (TDD §7); every other reply is raw envelope bytes.
    const wrapped =
      data !== null && typeof data === "object" && "bytes" in (data as object)
        ? (data as { bytes: Uint8Array; agents: Float32Array | null })
        : null;
    const raw = wrapped === null ? data : wrapped.bytes;
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
    const message = decodeMessage(bytes); // hard version check at boot (TDD §7)
    switch (message.kind) {
      case MessageKind.snapshot: {
        const agents = wrapped?.agents ?? null;
        const expected = message.body.agentCount * AGENT_FLOATS;
        if ((agents?.length ?? 0) !== expected) {
          throw new Error(
            `agent rider carries ${agents?.length ?? 0} floats, snapshot promises ${expected}`,
          );
        }
        lastAgents = agents;
        renderer.consume(message.body, agents);
        store.getState().applySnapshot(message.body);
        break;
      }
      case MessageKind.inspectorResponse:
        store.getState().applyInspectorResponse(message.body);
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

  // Tool modes (v0, keyboard-switched: R road, B bulldoze, Esc/S select —
  // toolbar UI rides the next ui-package slice). Select taps on pointerdown
  // (keeps the <50 ms path hot); road/bulldoze own the drag with a ghost
  // preview; camera drag-pan only in select mode (wheel zoom always).
  type Tool = "select" | "road" | "bulldoze";
  let tool: Tool = "select";
  let zoneOverlayOn = false;
  let trafficOverlayOn = false;
  let anchor: { x: number; y: number } | null = null;

  const tileAt = (event: PointerEvent): { x: number; y: number } | null => {
    const rect = renderer.app.canvas.getBoundingClientRect();
    const w = renderer.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    return pickTileAt(w.wx, w.wy, BOOT.mapWidth, BOOT.mapHeight);
  };

  renderer.app.canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const tile = tileAt(event);
    if (tile === null) {
      return;
    }
    if (tool === "select") {
      dispatch({ type: CommandType.selectTile, x: tile.x, y: tile.y });
      inspectTile(tile.y * BOOT.mapWidth + tile.x);
    } else {
      anchor = tile;
      renderer.stage.setGhost(anchor, tile);
    }
  });
  renderer.app.canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (anchor === null) {
      return;
    }
    const tile = tileAt(event);
    if (tile !== null) {
      renderer.stage.setGhost(anchor, tile);
    }
  });
  renderer.app.canvas.addEventListener("pointerup", (event: PointerEvent) => {
    if (anchor === null) {
      return;
    }
    const start = anchor;
    anchor = null;
    renderer.stage.setGhost(null);
    const end = tileAt(event);
    if (end === null || (end.x === start.x && end.y === start.y)) {
      return; // zero-length drags build nothing
    }
    if (tool === "road") {
      dispatch({
        type: CommandType.buildRoad,
        ax: start.x,
        ay: start.y,
        bx: end.x,
        by: end.y,
        roadClass: RoadClassWire.street,
      });
    } else if (tool === "bulldoze") {
      dispatch({ type: CommandType.bulldozeRoad, ax: start.x, ay: start.y, bx: end.x, by: end.y });
    }
  });
  window.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey) {
      return; // quicksave bindings live below
    }
    if (event.key === "z") {
      zoneOverlayOn = !zoneOverlayOn;
      renderer.stage.setZoneOverlay(zoneOverlayOn);
    } else if (event.key === "t") {
      trafficOverlayOn = !trafficOverlayOn;
      renderer.stage.setTrafficOverlay(trafficOverlayOn);
    } else if (event.key === "r") tool = "road";
    else if (event.key === "b") tool = "bulldoze";
    else if (event.key === "s" || event.key === "Escape") tool = "select";
  });
  attachCameraControls(renderer, renderer.app.canvas as unknown as HTMLElement, {
    panEnabled: () => tool === "select",
  });

  // Tap-to-inspect (GDD §9.5): selected tiles also query the inspector
  // channel (4 Hz re-poll while a panel is open arrives with panel state;
  // v1 queries per tap — the snapshot keeps HUD fresh regardless).
  let inspectorRequestId = 0;
  const inspectTile = (tileIdx: number): void => {
    const bytes = encodeMessage({
      kind: MessageKind.inspectorRequest,
      body: { requestId: ++inspectorRequestId, target: { kind: EntityKind.tile, id: tileIdx } },
    });
    worker.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
  };

  // Camera → sampler viewport (ADR-002): visible tile bbox, sent through
  // the protocol like everything else, throttled and only on change.
  let lastViewportKey = "";
  const sendViewport = (): void => {
    const rect = renderer.app.canvas.getBoundingClientRect();
    const corners = [
      renderer.screenToWorld(0, 0),
      renderer.screenToWorld(rect.width, 0),
      renderer.screenToWorld(0, rect.height),
      renderer.screenToWorld(rect.width, rect.height),
    ];
    let x0 = BOOT.mapWidth - 1;
    let y0 = BOOT.mapHeight - 1;
    let x1 = 0;
    let y1 = 0;
    for (const c of corners) {
      const tile = pickTileAt(c.wx, c.wy, BOOT.mapWidth, BOOT.mapHeight);
      // Off-map corners clamp to the map edge (zoomed way out = whole map).
      const tx = tile?.x ?? (c.wx < 0 ? 0 : BOOT.mapWidth - 1);
      const ty = tile?.y ?? (c.wy < 0 ? 0 : BOOT.mapHeight - 1);
      x0 = Math.min(x0, tx);
      y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx);
      y1 = Math.max(y1, ty);
    }
    const key = `${x0},${y0},${x1},${y1}`;
    if (key === lastViewportKey) {
      return;
    }
    lastViewportKey = key;
    const bytes = encodeMessage({ kind: MessageKind.viewportHint, body: { x0, y0, x1, y1 } });
    worker.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
  };
  sendViewport();
  setInterval(sendViewport, 500);

  // Coverage overlay selection: presentation state, posted as an
  // overlayRequest message (viewportHint pattern, never a command).
  const selectOverlay = (service: number): void => {
    const bytes = encodeMessage({ kind: MessageKind.overlayRequest, body: { service } });
    worker.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
    renderer.stage.setCoverageOverlay(service !== 0);
  };

  createRoot(overlayHost).render(
    <Overlay store={store} dispatch={dispatch} onSelectOverlay={selectOverlay} />,
  );

  // Test/debug hook: lets the e2e smoke (and humans in devtools) observe the
  // renderer's display state without reaching into Pixi internals.
  (globalThis as Record<string, unknown>).__civitect = {
    displayState: () => renderer.state(),
    commandCount: () => queue.count(),
    saveQuick: () => saveManager.saveQuick().then((bytes) => bytes.length),
    loadQuick: () => saveManager.loadQuick(),
    hasQuicksave: () => saveManager.hasQuicksave(),
    // Tool UIs land per-phase; until then e2e drives intents directly.
    dispatchIntent: (intent: CommandIntent) => {
      dispatch(intent);
    },
    tool: () => tool,
    inspectTile: (tileIdx: number) => {
      inspectTile(tileIdx);
    },
    roadInfo: () => store.getState().roadInfo,
    setTrafficOverlay: (on: boolean) => {
      trafficOverlayOn = on;
      renderer.stage.setTrafficOverlay(on);
    },
    selectOverlay: (service: number) => {
      selectOverlay(service);
    },
    coverage: () => {
      const state = renderer.state();
      return {
        service: state.coverageService,
        version: state.coverageVersion,
        field: state.coverage === null ? null : Array.from(state.coverage),
      };
    },
    buildingInfo: () => store.getState().buildingInfo,
    environInfo: () => store.getState().environInfo,
    // Agents observability for the follow e2e (GDD §17.5): the latest
    // transform rider, decoded into plain objects.
    agents: () => {
      const buffer = lastAgents;
      if (buffer === null) {
        return [];
      }
      const out: { id: number; kind: number; x: number; y: number }[] = [];
      for (let at = 0; at + AGENT_FLOATS <= buffer.length; at += AGENT_FLOATS) {
        out.push({
          id: buffer[at] as number,
          kind: buffer[at + 1] as number,
          x: buffer[at + 2] as number,
          y: buffer[at + 3] as number,
        });
      }
      return out;
    },
  };
}

void main();
