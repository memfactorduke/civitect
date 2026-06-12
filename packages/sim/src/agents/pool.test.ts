/**
 * Phase 3 tranche 3 verification: the camera-aware sampler is the ADR-002
 * chokepoint — agents exist only as a projection of assigned flows near
 * the camera (plus pinned cims), and NOTHING they do touches canonical
 * state. PROJECTION PURITY is the headline test.
 */
import { CommandType } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createWorld, runTick, stateHash, type World } from "../world";
import { AGENT_POOL_CAP, AgentKindSim, VIEW_MARGIN_TILES } from "./pool";

function grownWorld(seed: number, days: number): World {
  const world = createWorld(seed);
  let seq = 0;
  const cmd = (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
  cmd({ type: CommandType.buildRoad, ax: 8, ay: 20, bx: 56, by: 20, roadClass: 1 });
  cmd({ type: CommandType.placeBuilding, x: 10, y: 21, building: 1 });
  cmd({ type: CommandType.placeBuilding, x: 12, y: 21, building: 2 });
  cmd({ type: CommandType.zoneRect, x0: 13, y0: 18, x1: 40, y1: 19, zone: 1 });
  cmd({ type: CommandType.zoneRect, x0: 41, y0: 21, x1: 55, y1: 22, zone: 5 });
  for (let t = 0; t < 1440 * days; t++) {
    runTick(world, []);
  }
  return world;
}

describe("camera-aware sampler (ADR-002 chokepoint)", () => {
  it("PROJECTION PURITY: an active sampler never moves the state hash", () => {
    const watched = grownWorld(7, 3);
    const unwatched = grownWorld(7, 3);
    watched.viewport = { x0: 0, y0: 0, x1: 63, y1: 63 };
    for (let t = 0; t < 720; t++) {
      runTick(watched, []);
      runTick(unwatched, []);
      expect(stateHash(watched)).toBe(stateHash(unwatched));
    }
    expect(watched.agents.liveCount).toBeGreaterThan(0); // it DID sample
    expect(unwatched.agents.liveCount).toBe(0); // no camera, no pins, no agents
  });

  it("agents spawn with journeys ∝ flows; origins respect the viewport", () => {
    const world = grownWorld(7, 3);
    // Camera over the residential west — origins must come from there.
    world.viewport = { x0: 8, y0: 12, x1: 24, y1: 28 };
    for (let t = 0; t < 600; t++) {
      runTick(world, []);
    }
    const pool = world.agents;
    expect(pool.liveCount).toBeGreaterThan(0);
    expect(pool.liveCount).toBeLessThanOrEqual(AGENT_POOL_CAP);
    let checked = 0;
    for (let s = 0; s < pool.count; s++) {
      if (pool.alive[s] !== 1) {
        continue;
      }
      // Persona home tile sits inside the expanded viewport.
      const tile = pool.cohortTile[s] as number;
      const x = tile % world.mapWidth;
      const y = Math.floor(tile / world.mapWidth);
      expect(x).toBeGreaterThanOrEqual(8 - VIEW_MARGIN_TILES - 8); // cell granularity
      expect(x).toBeLessThanOrEqual(24 + VIEW_MARGIN_TILES + 8);
      expect(y).toBeGreaterThanOrEqual(12 - VIEW_MARGIN_TILES - 8);
      expect(y).toBeLessThanOrEqual(28 + VIEW_MARGIN_TILES + 8);
      checked++;
    }
    expect(checked).toBe(pool.liveCount);
  });

  it("agents move along the network and recycle at journey's end", () => {
    const world = grownWorld(7, 3);
    world.viewport = { x0: 0, y0: 0, x1: 63, y1: 63 };
    while (world.agents.liveCount === 0) {
      runTick(world, []);
    }
    const pool = world.agents;
    let slot = -1;
    for (let s = 0; s < pool.count; s++) {
      if (pool.alive[s] === 1 && pool.kind[s] === AgentKindSim.car) {
        slot = s;
        break;
      }
    }
    if (slot === -1) {
      for (let s = 0; s < pool.count; s++) {
        if (pool.alive[s] === 1) {
          slot = s;
          break;
        }
      }
    }
    expect(slot).not.toBe(-1);
    const id = pool.id[slot] as number;
    const x0 = pool.xMilli[slot] as number;
    const y0 = pool.yMilli[slot] as number;
    let moved = false;
    let recycled = false;
    for (let t = 0; t < 5000 && !recycled; t++) {
      runTick(world, []);
      if (pool.alive[slot] !== 1 || (pool.id[slot] as number) !== id) {
        recycled = true; // journey completed, slot returned to the free list
        break;
      }
      if ((pool.xMilli[slot] as number) !== x0 || (pool.yMilli[slot] as number) !== y0) {
        moved = true;
      }
    }
    expect(moved).toBe(true);
    expect(recycled).toBe(true);
  });

  it("a network edit clears the pool (twin changed) without crashing", () => {
    const world = grownWorld(7, 3);
    world.viewport = { x0: 0, y0: 0, x1: 63, y1: 63 };
    for (let t = 0; t < 300; t++) {
      runTick(world, []);
    }
    expect(world.agents.liveCount).toBeGreaterThan(0);
    let maxIdBefore = 0;
    for (let s2 = 0; s2 < world.agents.count; s2++) {
      maxIdBefore = Math.max(maxIdBefore, world.agents.id[s2] as number);
    }
    runTick(world, [
      {
        seq: 9000,
        tick: world.tick,
        type: CommandType.buildRoad,
        ax: 8,
        ay: 30,
        bx: 20,
        by: 30,
        roadClass: 1,
      } as never,
    ]);
    // The pool cleared with the old twin; anything alive now (the sampler
    // may refill the very same tick) is a NEW spawn on the NEW twin.
    expect(world.agents.twin).toBe(world.traffic.twin);
    for (let s2 = 0; s2 < world.agents.count; s2++) {
      if (world.agents.alive[s2] === 1) {
        expect(world.agents.id[s2] as number).toBeGreaterThan(maxIdBefore);
      }
    }
    for (let t = 0; t < 300; t++) {
      runTick(world, []);
    }
    expect(world.agents.liveCount).toBeGreaterThan(0); // alive on the new twin
  });
});

describe("pinned cims (GDD §17.5 — canonical player state)", () => {
  it("pin validates, moves the hash, materializes WITHOUT a camera, and unpins", () => {
    const world = grownWorld(7, 3);
    const before = stateHash(world);
    // A real, alive building tile to pin (the power plant at 10,21).
    const tile = 21 * world.mapWidth + 10;
    expect(
      runTick(world, [
        { seq: 500, tick: world.tick, type: CommandType.pinCim, tileIdx: tile, slot: 3 } as never,
      ]),
    ).toEqual([]);
    expect(stateHash(world)).not.toBe(before); // pins are canonical
    // Dup pin and bogus-building pin reject.
    expect(
      runTick(world, [
        { seq: 501, tick: world.tick, type: CommandType.pinCim, tileIdx: tile, slot: 3 } as never,
      ]),
    ).toHaveLength(1);
    expect(
      runTick(world, [
        { seq: 502, tick: world.tick, type: CommandType.pinCim, tileIdx: 1, slot: 0 } as never,
      ]),
    ).toHaveLength(1);
    // No viewport at all — the pinned cim still gets a live agent.
    for (let t = 0; t < 300; t++) {
      runTick(world, []);
    }
    const pool = world.agents;
    let pinnedLive = 0;
    for (let s = 0; s < pool.count; s++) {
      if (pool.alive[s] === 1 && pool.pinned[s] === 1) {
        pinnedLive++;
      }
    }
    expect(pinnedLive).toBe(1);
    expect(
      runTick(world, [
        { seq: 503, tick: world.tick, type: CommandType.unpinCim, tileIdx: tile, slot: 3 } as never,
      ]),
    ).toEqual([]);
    expect(
      runTick(world, [
        { seq: 504, tick: world.tick, type: CommandType.unpinCim, tileIdx: tile, slot: 3 } as never,
      ]),
    ).toHaveLength(1); // already gone
  });
});
