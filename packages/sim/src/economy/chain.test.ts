/**
 * Goods-chain verification (board phase-5 task 3, GDD §8 [chain LOCKED]).
 * The headline properties: per-commodity CONSERVATION is exact at every hour
 * boundary (produced + imported ≡ consumed + exported + lost + inTransit +
 * stock), freight JOINS the traffic ledger (trucks generated ≡ assigned +
 * unroutable), starvation de-levels (GDD §6), and specialized industry never
 * sites off its resource.
 */
import { ChainRole, CommandType, ResourceKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { spawnBuilding } from "../growth/buildings";
import { createWorld, runTick, stateHash, type World } from "../world";
import {
  chainConservationResidual,
  chainDailyPass,
  chainRoleForSpawn,
  createChain,
  outputCommodityOf,
} from "./chain";

const TICKS_PER_HOUR = 60;

function cmd(world: World, c: object): ReturnType<typeof runTick> {
  return runTick(world, [{ ...c, seq: nextSeq(), tick: world.tick } as never]);
}
let seqCounter = 9000;
function nextSeq(): number {
  return seqCounter++;
}

/** A 64×64 town: a road grid reaching all four edges (border anchors exist),
 *  an industrial belt and a commercial strip, funded so construction lands. */
function chainTown(seed = 71): World {
  const world = createWorld(seed, 64, 64);
  world.fundsCents = 100_000_000_00; // fund every road + ploppable
  // Grid roads to the map edge so outside connections (imports/exports) have
  // anchors, and so industry/commerce sit near roads.
  cmd(world, { type: CommandType.buildRoad, ax: 0, ay: 8, bx: 63, by: 8, roadClass: 2 });
  cmd(world, { type: CommandType.buildRoad, ax: 0, ay: 32, bx: 63, by: 32, roadClass: 2 });
  cmd(world, { type: CommandType.buildRoad, ax: 0, ay: 56, bx: 63, by: 56, roadClass: 2 });
  cmd(world, { type: CommandType.buildRoad, ax: 8, ay: 0, bx: 8, by: 63, roadClass: 2 });
  cmd(world, { type: CommandType.buildRoad, ax: 32, ay: 0, bx: 32, by: 63, roadClass: 2 });
  cmd(world, { type: CommandType.buildRoad, ax: 56, ay: 0, bx: 56, by: 63, roadClass: 2 });
  // Residential (workers + shoppers), industrial (the chain), commercial.
  // ZoneKind: residentialLow 1, industrial 5, commercialLow 3.
  cmd(world, { type: CommandType.zoneRect, x0: 10, y0: 10, x1: 30, y1: 30, zone: 1 });
  cmd(world, { type: CommandType.zoneRect, x0: 34, y0: 10, x1: 54, y1: 30, zone: 5 });
  cmd(world, { type: CommandType.zoneRect, x0: 10, y0: 34, x1: 30, y1: 54, zone: 3 });
  // Power + water so buildings hold (services slot).
  cmd(world, { type: CommandType.placeBuilding, x: 33, y: 9, building: 1 });
  cmd(world, { type: CommandType.placeBuilding, x: 35, y: 9, building: 2 });
  return world;
}

describe("chain conservation (the exact identity, GDD §8)", () => {
  it("produced + imported ≡ consumed + exported + lost + inTransit + stock, per commodity", () => {
    const world = chainTown();
    // Run a few game-days; check at every hour boundary that the books
    // balance EXACTLY (reconcile folds any demolished cargo into `lost`).
    for (let day = 0; day < 4; day++) {
      for (let t = 0; t < 24; t++) {
        for (let m = 0; m < TICKS_PER_HOUR; m++) {
          runTick(world, []);
        }
        // World is now on an hour boundary: chainHourlyPass just reconciled.
        const residual = chainConservationResidual(world.chain, world.buildings);
        expect(residual).toEqual([0, 0, 0, 0, 0, 0]);
      }
    }
  });

  it("books real money: imports drain, exports earn (the report lines move)", () => {
    const world = chainTown();
    for (let t = 0; t < TICKS_PER_HOUR * 24 * 6; t++) {
      runTick(world, []);
    }
    // After six days a young industrial town with thin internal supply leans
    // on imports — the city has bought SOMETHING from outside (line 9), and
    // the conservation books still balance.
    const totalImported = world.chain.imported.reduce((a, b) => a + b, 0);
    expect(totalImported).toBeGreaterThan(0);
    expect(chainConservationResidual(world.chain, world.buildings)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("freight joins the traffic ledger (the deferred volume injection)", () => {
  it("trucks generated ≡ assigned + unroutable, and freight loads real edges", () => {
    const world = chainTown();
    let sawFreight = false;
    for (let t = 0; t < TICKS_PER_HOUR * 24 * 5; t++) {
      runTick(world, []);
      if (world.tick % TICKS_PER_HOUR === 0) {
        const { freightGenerated, freightAssigned, freightUnroutable } = world.traffic;
        // The freight conservation property (mirrors the commute ledger's).
        expect(freightGenerated).toBe(freightAssigned + freightUnroutable);
        if (world.traffic.freightVolumes.size > 0) {
          sawFreight = true;
        }
      }
    }
    // The chain dispatched trucks that actually loaded network edges.
    expect(sawFreight).toBe(true);
  });

  it("freight is reproducible: two identical towns hash-match through a chain run", () => {
    const a = chainTown(404);
    const b = chainTown(404);
    for (let t = 0; t < TICKS_PER_HOUR * 24 * 3; t++) {
      runTick(a, []);
      runTick(b, []);
    }
    // The freight path (twin-routed, tie-broken by node index) is
    // construction-history-free — identical builds stay bit-identical.
    expect(stateHash(a)).toBe(stateHash(b));
  });
});

describe("starvation de-levels (GDD §6 pressure)", () => {
  it("the daily pass zeroes a starved consumer's thrive days; a fed one keeps them", () => {
    const world = createWorld(5, 32, 32);
    const b = world.buildings;
    // A goods plant with EMPTY input shelves: the daily pass starves it.
    const starvedIdx = spawnBuilding(b, 9 * 32 + 9, 5); // industrial
    b.chainRole[starvedIdx] = ChainRole.goods;
    b.thriveDays[starvedIdx] = 5; // had been thriving
    b.stockIn[starvedIdx] = 0;
    // A goods plant WITH input keeps thriving (the control).
    const fedIdx = spawnBuilding(b, 9 * 32 + 12, 5);
    b.chainRole[fedIdx] = ChainRole.goods;
    b.thriveDays[fedIdx] = 5;
    b.stockIn[fedIdx] = 40;
    chainDailyPass(world.chain, b);
    expect(b.thriveDays[starvedIdx]).toBe(0);
    expect(b.thriveDays[fedIdx]).toBe(5); // untouched: it produced from stock
    expect(b.stockOut[fedIdx]).toBeGreaterThan(0); // it actually made goods
  });
});

describe("specialized industry refuses off-resource tiles (the spawn invariant)", () => {
  it("a raw role appears ONLY on its resource; plain land balances processed/goods", () => {
    const chain = createChain();
    // On-resource: the role IS that resource's extractor.
    expect(chainRoleForSpawn(chain, ResourceKind.ore)).toBe(ChainRole.rawOre);
    expect(chainRoleForSpawn(chain, ResourceKind.farm)).toBe(ChainRole.rawFarm);
    expect(chainRoleForSpawn(chain, ResourceKind.forest)).toBe(ChainRole.rawForest);
    expect(chainRoleForSpawn(chain, ResourceKind.oil)).toBe(ChainRole.rawOil);
    // Off-resource: NEVER a raw role — only the generic tiers, balanced.
    const roles: number[] = [];
    for (let i = 0; i < 200; i++) {
      roles.push(chainRoleForSpawn(chain, ResourceKind.none));
    }
    for (const r of roles) {
      expect(r === ChainRole.processed || r === ChainRole.goods).toBe(true);
    }
    const processed = roles.filter((r) => r === ChainRole.processed).length;
    const goods = roles.filter((r) => r === ChainRole.goods).length;
    expect(Math.abs(processed - goods)).toBeLessThanOrEqual(1); // alternating balance
  });

  it("a producer's output commodity matches its role (the books' commodity axis)", () => {
    const world = createWorld(9, 16, 16);
    const i = spawnBuilding(world.buildings, 8 * 16 + 8, 4);
    world.buildings.chainRole[i] = ChainRole.rawForest;
    expect(outputCommodityOf(world.buildings, i)).toBe(ChainRole.rawForest);
  });
});
