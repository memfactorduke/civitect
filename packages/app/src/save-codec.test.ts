/**
 * Board task 9 verification: save → load → state-hash-equal, through the
 * EXACT pipeline the worker runs (worldToCiv → encodeCiv → bytes →
 * decodeCiv → civToWorld). The Playwright spec covers the same loop through
 * the real worker boundary observably; this test proves bit-equality.
 */
import { CommandType, decodeCiv, encodeCiv, flatTerrain } from "@civitect/protocol";
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

describe("roads through the save pipeline (save format v3, task 12f)", () => {
  it("a world with roads round-trips to an identical state hash", async () => {
    const { world } = replay(BOOT.seed, [], 1, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    runTick(world, [
      { seq: 0, tick: 1, type: CommandType.buildRoad, ax: 1, ay: 1, bx: 2, by: 1, roadClass: 1 },
    ]);
    runTick(world, [
      { seq: 1, tick: 2, type: CommandType.buildRoad, ax: 2, ay: 1, bx: 2, by: 4, roadClass: 3 },
    ]);
    const before = stateHash(world);
    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(before);
  });
});

describe("terrain through the save pipeline (phase-1 task 7b)", () => {
  it("non-flat terrain round-trips bit-exactly, hash included", async () => {
    const terrain = flatTerrain(BOOT.mapWidth, BOOT.mapHeight);
    terrain.layers.elevation[100] = 3;
    terrain.layers.water[200] = 1;
    terrain.layers.resource[300] = 2;
    const { world } = replay(BOOT.seed, [], 50, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
      terrain,
    });
    const before = stateHash(world);

    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(before);
    expect(restored.terrain.layers.elevation[100]).toBe(3);
  });

  it("terrain differences move the state hash (it is canonical state now)", () => {
    const flat = replay(BOOT.seed, [], 10, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    }).world;
    const bumpy = flatTerrain(BOOT.mapWidth, BOOT.mapHeight);
    bumpy.layers.elevation[0] = 1;
    const hilly = replay(BOOT.seed, [], 10, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
      terrain: bumpy,
    }).world;
    expect(stateHash(hilly)).not.toBe(stateHash(flat));
  });
});

describe("grown cities through the save pipeline (save format v4)", () => {
  it("a grown city (buildings, cohorts, zones) round-trips to an identical hash and keeps living", async () => {
    const { world } = replay(BOOT.seed, [], 1, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    let seq = 0;
    const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
    cmd({ type: CommandType.buildRoad, ax: 10, ay: 20, bx: 40, by: 20, roadClass: 1 });
    cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 1 });
    cmd({ type: CommandType.placeBuilding, x: 14, y: 21, building: 2 });
    cmd({ type: CommandType.zoneRect, x0: 15, y0: 18, x1: 38, y1: 19, zone: 1 });
    for (let t = 0; t < 1440 * 5; t++) {
      runTick(world, []);
    }
    expect(world.population).toBeGreaterThan(0);
    const before = stateHash(world);

    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(before);

    // And the loaded city KEEPS SIMULATING identically.
    for (let t = 0; t < 1440; t++) {
      runTick(world, []);
      runTick(restored, []);
    }
    expect(stateHash(restored)).toBe(stateHash(world));
  });
});
