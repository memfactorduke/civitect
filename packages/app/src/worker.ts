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
  decodeMessage,
  encodeMessage,
  MessageKind,
  type Snapshot,
  SnapshotKind,
} from "@civitect/protocol";
import { createWorld, runTick, toSnapshot } from "@civitect/sim";
import { BOOT } from "./boot-config";

const ctx = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, options?: { transfer?: ArrayBuffer[] }): void;
};

const TICK_MS = 100; // 10 Hz (ADR-005)

const world = createWorld(BOOT.seed, BOOT.mapWidth, BOOT.mapHeight);

/**
 * Authoritative session command log, in applied (re-stamped) form — the
 * substrate for save command-tails (board PR 9) and bug-report repros
 * (seed + log = perfect repro, ADR-005 §6).
 */
const commandLog: Command[] = [];

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

ctx.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
  const message = decodeMessage(bytes);
  if (message.kind !== MessageKind.command) {
    throw new Error(`sim worker received unexpected MessageKind ${message.kind}`);
  }
  // Re-stamp to the tick this command actually applies on (see header).
  const command = { ...message.body, tick: world.tick } as Command;
  commandLog.push(command);
  applyBatch([command]);
  postSnapshot(SnapshotKind.delta);
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
