import { CommandType, decodeMessage, MessageKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createCommandQueue } from "./command-queue";

describe("command queue (main-thread side of TDD §7)", () => {
  it("stamps monotonic seq and tick 0 (worker is the tick authority)", () => {
    const posted: Uint8Array[] = [];
    const queue = createCommandQueue((bytes) => posted.push(bytes));

    queue.dispatch({ type: CommandType.selectTile, x: 3, y: 4 });
    queue.dispatch({ type: CommandType.setSpeed, speed: 9 });

    expect(queue.count()).toBe(2);
    const first = decodeMessage(posted[0] as Uint8Array);
    const second = decodeMessage(posted[1] as Uint8Array);
    expect(first).toEqual({
      kind: MessageKind.command,
      body: { seq: 0, tick: 0, type: CommandType.selectTile, x: 3, y: 4 },
    });
    expect(second).toEqual({
      kind: MessageKind.command,
      body: { seq: 1, tick: 0, type: CommandType.setSpeed, speed: 9 },
    });
  });

  it("hands the encoded buffer over for zero-copy transfer", () => {
    let transferred: Transferable[] = [];
    const queue = createCommandQueue((bytes, transfer) => {
      transferred = transfer;
      expect(transfer).toEqual([bytes.buffer]);
    });
    queue.dispatch({ type: CommandType.setSpeed, speed: 0 });
    expect(transferred).toHaveLength(1);
  });

  it("keeps a bounded recent-command history for crash reports", () => {
    const queue = createCommandQueue(() => undefined, { historyLimit: 2 });

    queue.dispatch({ type: CommandType.setSpeed, speed: 1 });
    queue.dispatch({ type: CommandType.selectTile, x: 3, y: 4 });
    queue.dispatch({ type: CommandType.setSpeed, speed: 9 });

    expect(queue.recent()).toEqual([
      { seq: 1, tick: 0, type: CommandType.selectTile, x: 3, y: 4 },
      { seq: 2, tick: 0, type: CommandType.setSpeed, speed: 9 },
    ]);
    expect(queue.count()).toBe(3);
  });
});
