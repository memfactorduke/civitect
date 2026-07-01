import { type Command, CommandType, decodeMessage, MessageKind } from "@civitect/protocol";
import type { CommandIntent } from "@civitect/ui";
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

  it("preserves command body fields while stamping app-owned seq/tick", () => {
    const posted: Uint8Array[] = [];
    const queue = createCommandQueue((bytes) => posted.push(bytes));
    const intents = [
      { type: CommandType.buildRoad, ax: 1, ay: 2, bx: 8, by: 2, roadClass: 2 },
      { type: CommandType.zoneRect, x0: 10, y0: 12, x1: 16, y1: 18, zone: 5 },
      { type: CommandType.placeBuilding, x: 20, y: 21, building: 3 },
      { type: CommandType.setServiceBudget, service: 8, permille: 1300 },
      { type: CommandType.setTaxRate, zone: 1, permille: 150 },
      { type: CommandType.takeLoan, tier: 2 },
      { type: CommandType.paintDistrict, x0: 2, y0: 3, x1: 9, y1: 10, districtId: 7 },
      { type: CommandType.nameDistrict, districtId: 7, name: "Founders Square" },
      { type: CommandType.setPolicy, districtId: 7, policy: 3, on: 1 },
      { type: CommandType.setOrdinance, ordinance: 2, on: 1 },
    ] satisfies readonly CommandIntent[];

    intents.forEach((intent, seq) => {
      const expected = { ...intent, seq, tick: 0 } as Command;
      expect(queue.dispatch(intent)).toEqual(expected);
      expect(decodeMessage(posted[seq] as Uint8Array)).toEqual({
        kind: MessageKind.command,
        body: expected,
      });
    });
    expect(queue.count()).toBe(intents.length);
  });
});
