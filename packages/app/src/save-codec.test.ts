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

  it("an ACTIVE chain (freight in flight) resumes identically across the load (GDD §8)", async () => {
    // Border roads → outside connections; R/I/C so the chain dispatches real
    // freight whose arrival ticks (hashed) were priced on the FREIGHT-loaded
    // cost field. freightVolumes is derived (not saved): the load must
    // re-derive it before the next hourly pass or pricing — and the hash —
    // diverges. This is the adversarial-review regression; it FAILS without
    // recomputeFreight() in civToWorld.
    let seq = 0;
    const cmd = (tick: number, c: object) => ({ seq: seq++, tick, ...c }) as unknown;
    const log = [
      cmd(0, { type: CommandType.buildRoad, ax: 0, ay: 8, bx: 63, by: 8, roadClass: 2 }),
      cmd(0, { type: CommandType.buildRoad, ax: 0, ay: 32, bx: 63, by: 32, roadClass: 2 }),
      cmd(0, { type: CommandType.buildRoad, ax: 8, ay: 0, bx: 8, by: 63, roadClass: 2 }),
      cmd(0, { type: CommandType.buildRoad, ax: 32, ay: 0, bx: 32, by: 63, roadClass: 2 }),
      cmd(0, { type: CommandType.buildRoad, ax: 56, ay: 0, bx: 56, by: 63, roadClass: 2 }),
      cmd(0, { type: CommandType.placeBuilding, x: 33, y: 9, building: 1 }), // power
      cmd(0, { type: CommandType.placeBuilding, x: 35, y: 9, building: 2 }), // water
      cmd(0, { type: CommandType.zoneRect, x0: 10, y0: 10, x1: 30, y1: 30, zone: 1 }), // R
      cmd(0, { type: CommandType.zoneRect, x0: 34, y0: 10, x1: 54, y1: 30, zone: 5 }), // I
      cmd(0, { type: CommandType.zoneRect, x0: 10, y0: 34, x1: 30, y1: 54, zone: 3 }), // C
    ] as Parameters<typeof replay>[1];
    // Five game-days in: industry has spawned, reordered, and trucks are en
    // route — save mid-flight (the tick is an hour boundary).
    const { world } = replay(BOOT.seed, log, 7200, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
      startingFundsCents: 100_000_000_00,
    });
    expect(world.chain.shipments.length).toBeGreaterThan(0); // freight is live
    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(stateHash(world)); // identical at the boundary
    // Continue both across several hour boundaries (where freight prices new
    // shipments): they must stay bit-identical.
    for (let i = 0; i < 200; i++) {
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

describe("traffic through the save pipeline (save format v5, TDD §6.3)", () => {
  it("a save taken MID-SOLVE resumes the in-flight job bit-exactly", async () => {
    const { world } = replay(BOOT.seed, [], 1, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    let seq = 0;
    const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
    cmd({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
    cmd({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
    cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
    cmd({ type: CommandType.zoneRect, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 });
    cmd({ type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 });
    // Run past a few days, then stop a handful of ticks after an hour
    // boundary — squarely inside a sliced solve.
    while (world.tick < 1440 * 3 + 5) {
      runTick(world, []);
    }
    expect(world.traffic.job).not.toBeNull(); // the premise: we ARE mid-solve
    const before = stateHash(world);

    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(before);
    expect(restored.traffic.job).not.toBeNull();

    // The strong claim: the resumed job and the never-interrupted one
    // finish the solve — and the night, the 04:00 FULL equilibrium solve,
    // and the morning rush — identically (600 ticks = hours 0→10).
    for (let t = 0; t < 600; t++) {
      runTick(world, []);
      runTick(restored, []);
      expect(stateHash(restored)).toBe(stateHash(world));
    }
    expect(world.traffic.generated).toBeGreaterThan(0); // morning peak ran
  });
});

describe("services through the save pipeline (save format v7, phase-4 task 3)", () => {
  // The serviced-city continuation test is THE order-leak hunter: a loaded
  // world must make byte-identical service decisions (clearance order,
  // sickness draws, promotion quotas, anchor choices) as the world that
  // never stopped — the Phase 3 tranche-2 desync class.
  const servicedLog = [
    { seq: 0, tick: 0, type: CommandType.buildRoad, ax: 4, ay: 8, bx: 40, by: 8, roadClass: 1 },
    { seq: 1, tick: 0, type: CommandType.buildRoad, ax: 4, ay: 16, bx: 40, by: 16, roadClass: 1 },
    { seq: 2, tick: 0, type: CommandType.buildRoad, ax: 4, ay: 8, bx: 4, by: 16, roadClass: 1 },
    { seq: 3, tick: 1, type: CommandType.placeBuilding, x: 5, y: 9, building: 1 },
    { seq: 4, tick: 1, type: CommandType.placeBuilding, x: 6, y: 9, building: 2 },
    { seq: 5, tick: 1, type: CommandType.placeBuilding, x: 7, y: 9, building: 18 },
    { seq: 6, tick: 1, type: CommandType.placeBuilding, x: 8, y: 9, building: 7 },
    { seq: 7, tick: 1, type: CommandType.placeBuilding, x: 9, y: 9, building: 9 },
    { seq: 8, tick: 1, type: CommandType.placeBuilding, x: 10, y: 9, building: 11 },
    { seq: 9, tick: 2, type: CommandType.zoneRect, x0: 5, y0: 10, x1: 38, y1: 14, zone: 1 },
    { seq: 10, tick: 2, type: CommandType.zoneRect, x0: 5, y0: 4, x1: 38, y1: 7, zone: 5 },
    { seq: 11, tick: 3, type: CommandType.setServiceBudget, service: 8, permille: 1300 },
  ] as Parameters<typeof replay>[1];

  it("budgets, building service fields and ground pollution round-trip bit-exactly", async () => {
    const { world } = replay(BOOT.seed, servicedLog, 2 * 1440, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    // Make the optional fields non-trivial before saving.
    world.groundPollution[123] = 77;
    const before = stateHash(world);
    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(before);
    expect(restored.services.budgetsPermille[7]).toBe(1300);
    expect(restored.groundPollution[123]).toBe(77);
  });

  it("a save taken MID-DAY continues identically through two more service days", async () => {
    // Save at a deliberately awkward tick: mid-day, mid-hour (not a slice
    // boundary), with garbage half-collected and sickness in flight.
    const horizon = 1440 + 700;
    const { world } = replay(BOOT.seed, servicedLog, horizon, {
      mapWidth: BOOT.mapWidth,
      mapHeight: BOOT.mapHeight,
    });
    const restored = civToWorld(await decodeCiv(await encodeCiv(worldToCiv(world, []))));
    expect(stateHash(restored)).toBe(stateHash(world));
    for (let t = 0; t < 2 * 1440; t++) {
      runTick(world, []);
      runTick(restored, []);
      if (t % 480 === 0) {
        expect(stateHash(restored)).toBe(stateHash(world));
      }
    }
    expect(stateHash(restored)).toBe(stateHash(world));
    // The run was service-active, not vacuously green.
    expect(world.serviceFlows.garbageGenerated).toBeGreaterThan(0);
  });
});
