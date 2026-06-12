/**
 * Board task 9 verification: save → load → state-hash-equal, through the
 * EXACT pipeline the worker runs (worldToCiv → encodeCiv → bytes →
 * decodeCiv → civToWorld). The Playwright spec covers the same loop through
 * the real worker boundary observably; this test proves bit-equality.
 */
import { CommandType, decodeCiv, encodeCiv } from "@civitect/protocol";
import { replay, runTick, stateHash } from "@civitect/sim";
import { describe, expect, it } from "vitest";
import { BOOT } from "./boot-config";
import { civToWorld, worldToCiv } from "./save-codec";

describe("save → load → state-hash-equal (TDD §10)", () => {
  it("round-trips a played world bit-exactly", async () => {
    const { world } = replay(
      BOOT.seed,
      [
        { seq: 0, tick: 3, type: CommandType.selectTile, x: 5, y: 7 },
        { seq: 1, tick: 10, type: CommandType.setSpeed, speed: 3 },
      ],
      500,
      { mapWidth: BOOT.mapWidth, mapHeight: BOOT.mapHeight },
    );
    const before = stateHash(world);

    const bytes = await encodeCiv(worldToCiv(world, []));
    const restored = civToWorld(await decodeCiv(bytes));

    expect(stateHash(restored)).toBe(before);
  });

  it("restored worlds keep simulating identically (RNG streams resume mid-sequence)", async () => {
    const { world } = replay(BOOT.seed, [], 100, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));

    for (let i = 0; i < 50; i++) {
      runTick(world, []);
      runTick(restored, []);
    }
    expect(stateHash(restored)).toBe(stateHash(world));
  });

  it("preserves the command tail through the container", async () => {
    const { world } = replay(BOOT.seed, [], 10, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    const tail = [{ seq: 4, tick: 8, type: CommandType.setSpeed, speed: 9 }] as const;
    const decoded = await decodeCiv(await encodeCiv(worldToCiv(world, [...tail])));
    expect(decoded.commandTail).toEqual([...tail]);
  });

  it("rejects saves with foreign map dimensions (until Phase 1 scene rebuild)", async () => {
    const { world } = replay(BOOT.seed, [], 5, { mapWidth: 32, mapHeight: 32 });
    const decoded = await decodeCiv(await encodeCiv(worldToCiv(world, [])));
    expect(() => civToWorld(decoded)).toThrow(/32×32 map/);
  });

  it("rejects saves missing an RNG stream", async () => {
    const { world } = replay(BOOT.seed, [], 5, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    const save = worldToCiv(world, []);
    const broken = {
      ...save,
      worldCore: { ...save.worldCore, rngStreams: save.worldCore.rngStreams.slice(1) },
    };
    const decoded = await decodeCiv(await encodeCiv(broken));
    expect(() => civToWorld(decoded)).toThrow(/missing RNG stream/);
  });
});
