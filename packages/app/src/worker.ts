/**
 * The sim worker (TDD §1 runtime topology): the ENTIRE simulation lives
 * here; the main thread renders and dispatches. Every byte in or out wears
 * the protocol envelope — decodeMessage's version check makes protocol
 * mismatch a hard boot error (TDD §7), with the first snapshot acting as
 * the handshake.
 *
 * Tick scheduling:
 * - Scheduled ticks: every TICK_MS, run `world.speed` ticks (0 = none).
 * - Command ticks: an arriving command is stamped to the current tick and
 *   applied by ONE immediate tick. This is what makes tap→highlight beat
 *   the 50 ms input→visual budget (TDD §2) — waiting for the next scheduled
 *   tick would cost up to 100 ms before the sim even saw the tap. Replay
 *   determinism is untouched: time is the tick counter, not the wall clock,
 *   and the log records the applied tick (ADR-005 §6).
 *
 * Typing note: the package compiles under the DOM lib (main thread is the
 * bulk of it); TS's DOM and WebWorker libs can't coexist in one project, so
 * the few worker globals used here are typed structurally.
 */
import {
  type Command,
  decodeCiv,
  decodeMessage,
  encodeCiv,
  encodeMessage,
  MessageKind,
  type Snapshot,
  SnapshotKind,
} from "@civitect/protocol";
import { createWorld, runTick, toSnapshot } from "@civitect/sim";
import { BOOT } from "./boot-config";
import { civToWorld, worldToCiv } from "./save-codec";

const ctx = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, options?: { transfer?: ArrayBuffer[] }): void;
};

const TICK_MS = 100; // 10 Hz (ADR-005)

let world = createWorld(BOOT.seed, BOOT.mapWidth, BOOT.mapHeight);

/**
 * Authoritative session command log, in applied (re-stamped) form — the
 * save command-tail and the bug-report repro (seed + log, ADR-005 §6).
 * Loading replaces the world wholesale, so the log resets with it.
 */
let commandLog: Command[] = [];

function post(bytes: Uint8Array): void {
  ctx.postMessage(bytes, { transfer: [bytes.buffer as ArrayBuffer] });
}

function postSnapshot(kind: Snapshot["kind"]): void {
  post(encodeMessage({ kind: MessageKind.snapshot, body: toSnapshot(world, kind) }));
}

function applyBatch(batch: readonly Command[]): void {
  const rejections = runTick(world, batch);
  for (const rejection of rejections) {
    post(encodeMessage({ kind: MessageKind.commandRejection, body: rejection }));
  }
}

async function handleSaveRequest(slot: number): Promise<void> {
  try {
    // Capture synchronously (plain numbers + RNG state tuples), THEN compress
    // async — ticks that land mid-encode can't smear into the snapshot.
    const captured = worldToCiv(world, commandLog);
    const civ = await encodeCiv(captured);
    post(encodeMessage({ kind: MessageKind.saveResponse, body: { slot, civ } }));
  } catch (error) {
    // Empty civ = save failed (e.g. roads await save format v3). The
    // manager rejects; a hung promise or a dead worker would be worse.
    console.error("[sim] save failed:", error);
    post(encodeMessage({ kind: MessageKind.saveResponse, body: { slot, civ: new Uint8Array(0) } }));
  }
}

async function handleLoadRequest(civ: Uint8Array): Promise<void> {
  try {
    const save = await decodeCiv(civ); // checksum + version-header validation (TDD §10)
    world = civToWorld(save);
    commandLog = [];
    post(
      encodeMessage({
        kind: MessageKind.loadResponse,
        body: { ok: true, tick: world.tick, detail: "" },
      }),
    );
    postSnapshot(SnapshotKind.keyframe); // scene-jump: full re-prime
  } catch (error) {
    post(
      encodeMessage({
        kind: MessageKind.loadResponse,
        body: {
          ok: false,
          tick: world.tick,
          detail: error instanceof Error ? error.message : String(error),
        },
      }),
    );
  }
}

ctx.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  const message = decodeMessage(bytes);
  switch (message.kind) {
    case MessageKind.command: {
      // Re-stamp to the tick this command actually applies on (see header).
      const command = { ...message.body, tick: world.tick } as Command;
      commandLog.push(command);
      applyBatch([command]);
      postSnapshot(SnapshotKind.delta);
      break;
    }
    case MessageKind.saveRequest:
      void handleSaveRequest(message.body.slot);
      break;
    case MessageKind.loadRequest:
      void handleLoadRequest(message.body.civ);
      break;
    default:
      throw new Error(`sim worker received unexpected MessageKind ${message.kind}`);
  }
};

setInterval(() => {
  const ticks = world.speed;
  if (ticks === 0) {
    return;
  }
  for (let i = 0; i < ticks; i++) {
    applyBatch([]);
  }
  postSnapshot(SnapshotKind.delta);
}, TICK_MS);

// Boot handshake: the first keyframe both proves protocol agreement
// (decodeMessage version-checks on the main thread) and primes the stage.
postSnapshot(SnapshotKind.keyframe);
