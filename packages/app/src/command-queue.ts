/**
 * Main-thread command queue (TDD §1/§7): stamps seq, encodes via protocol
 * codecs, posts transferably to the sim worker.
 *
 * Tick semantics: the main thread stamps tick 0 = "apply as soon as legal".
 * The worker shell is the stamping authority — it re-stamps each command to
 * the tick it actually applies on (that re-stamped form is what the
 * authoritative command log records; TDD §7 "sim is authoritative").
 * The main thread guessing real ticks would race the worker's clock.
 */
import { type Command, encodeMessage, MessageKind } from "@civitect/protocol";
import type { CommandIntent } from "@civitect/ui";

export interface CommandQueue {
  dispatch(intent: CommandIntent): Command;
  /** Commands dispatched so far this session (seq mirrors index). */
  readonly count: () => number;
  /** Recent main-thread commands for local crash reports. */
  readonly recent: () => readonly Command[];
}

export type PostFn = (bytes: Uint8Array, transfer: Transferable[]) => void;

export interface CommandQueueOptions {
  /** Retained command history for local crash reports. Defaults to 200 (TDD §14). */
  readonly historyLimit?: number;
}

export function createCommandQueue(post: PostFn, options: CommandQueueOptions = {}): CommandQueue {
  const historyLimit = options.historyLimit ?? 200;
  let seq = 0;
  const recent: Command[] = [];
  return {
    dispatch(intent: CommandIntent): Command {
      const command = { ...intent, seq: seq++, tick: 0 } as Command;
      if (historyLimit > 0) {
        recent.push(command);
        if (recent.length > historyLimit) {
          recent.splice(0, recent.length - historyLimit);
        }
      }
      const bytes = encodeMessage({ kind: MessageKind.command, body: command });
      post(bytes, [bytes.buffer]); // finish() copies, so the buffer is exactly ours to give away
      return command;
    },
    count: () => seq,
    recent: () => [...recent],
  };
}
