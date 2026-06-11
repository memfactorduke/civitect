/**
 * Replay: seed + command log → world, deterministically (ADR-005 §6).
 * This is the spine of golden-master tests (ADR-013 §1), bug repros, and —
 * later — time-travel debugging and replay-verified leaderboards.
 *
 * The log is canonicalized by (tick, seq) before applying, so the same SET
 * of commands always produces the same world no matter how the log was
 * assembled.
 */
import type { Command, CommandRejection } from "@civitect/protocol";
import { createWorld, runTick, type World } from "./world";

export interface ReplayResult {
  readonly world: World;
  readonly rejections: readonly CommandRejection[];
}

export interface ReplayOptions {
  readonly mapWidth?: number;
  readonly mapHeight?: number;
}

export function replay(
  seed: number,
  commands: readonly Command[],
  untilTick: number,
  options: ReplayOptions = {},
): ReplayResult {
  if (!Number.isSafeInteger(untilTick) || untilTick < 0) {
    throw new Error(`untilTick must be a non-negative safe integer, got ${untilTick}`);
  }
  const log = [...commands].sort((a, b) => (a.tick === b.tick ? a.seq - b.seq : a.tick - b.tick));
  const last = log[log.length - 1];
  if (last !== undefined && last.tick >= untilTick) {
    // Silently dropping tail commands would make "same log, same world" a lie.
    throw new Error(
      `command log extends to tick ${last.tick} but replay stops before tick ${untilTick}`,
    );
  }

  const world = createWorld(seed, options.mapWidth ?? undefined, options.mapHeight ?? undefined);
  const rejections: CommandRejection[] = [];
  let cursor = 0;
  const batch: Command[] = [];
  while (world.tick < untilTick) {
    batch.length = 0;
    while (cursor < log.length && (log[cursor] as Command).tick === world.tick) {
      batch.push(log[cursor] as Command);
      cursor++;
    }
    rejections.push(...runTick(world, batch));
  }
  return { world, rejections };
}
