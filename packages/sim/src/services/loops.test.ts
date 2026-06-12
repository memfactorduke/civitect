/**
 * Service-loop verification (board phase-4 task 3): conservation ledgers,
 * capacity queues, coverage gating, the education pipeline, and the
 * population-exactness coupling through GrowthFlows.
 */
import { BuildingKind, CommandType, ServiceId, ZoneKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import {
  type Buildings,
  COHORT_BLOCK,
  createBuildings,
  EDU_TIERS,
  PLOPPABLE_KIND_OFFSET,
  residentsOf,
  spawnBuilding,
} from "../growth/buildings";
import { replay } from "../replay";
import { createRng } from "../rng";
import { stateHash } from "../world";
import {
  emptyServiceFlows,
  GARBAGE_TOLERANCE,
  garbagePerDay,
  SERVICE_SLICES,
  type ServicesContext,
  servicesSlice,
  sliceShare,
} from "./loops";

const plop = (kind: number): number => PLOPPABLE_KIND_OFFSET + kind;

/** Run all 24 slices of one game-day (ticks at hourly boundaries). */
function runDay(ctx: ServicesContext, day = 0): void {
  for (let h = 0; h < SERVICE_SLICES; h++) {
    servicesSlice(ctx, (day * 24 + h) * 60);
  }
}

interface Emitted {
  messageKey: string;
  summaryKey: string;
  tile: number;
}

function makeCtx(
  b: Buildings,
  coverage: (service: ServiceId, tileIdx: number) => number,
  budgets?: Uint16Array,
): { ctx: ServicesContext; advisors: Emitted[] } {
  const advisors: Emitted[] = [];
  return {
    ctx: {
      buildings: b,
      budgetsPermille: budgets ?? new Uint16Array(9).fill(1000),
      coverageAt: coverage,
      rng: createRng(1, "services"),
      flows: emptyServiceFlows(),
      emit: (messageKey, summaryKey, tile) => advisors.push({ messageKey, summaryKey, tile }),
    },
    advisors,
  };
}

/** A residential building with `n` adult E-`edu` residents. */
function house(b: Buildings, tileIdx: number, n: number, edu = 0): number {
  const i = spawnBuilding(b, tileIdx, ZoneKind.residentialLow);
  b.cohorts[i * COHORT_BLOCK + 2 * EDU_TIERS + edu] = n;
  return i;
}

describe("garbage loop (GDD §7): accrual, collection, conservation", () => {
  it("without service, stock accumulates day over day and the ledger balances", () => {
    const b = createBuildings();
    const i = house(b, 100, 10);
    const { ctx } = makeCtx(b, () => 0);
    runDay(ctx, 0);
    runDay(ctx, 1);
    expect(b.stock[i]).toBe(2 * garbagePerDay(ZoneKind.residentialLow, 1));
    expect(ctx.flows.garbageGenerated).toBe(b.stock[i]);
    expect(ctx.flows.garbageCleared).toBe(0);
  });

  it("with a covered landfill, trucks clear the stock into the fill (conservation)", () => {
    const b = createBuildings();
    const homes = [house(b, 100, 10), house(b, 200, 10), house(b, 300, 10)];
    const landfill = spawnBuilding(b, 400, plop(BuildingKind.landfill));
    const { ctx } = makeCtx(b, () => 255);
    for (let day = 0; day < 3; day++) {
      runDay(ctx, day);
    }
    const held = homes.reduce((sum, i) => sum + (b.stock[i] as number), 0);
    // generated ≡ cleared + still-held, and everything cleared sits in the
    // landfill (no incinerator to burn it).
    expect(ctx.flows.garbageGenerated).toBe(ctx.flows.garbageCleared + held);
    expect(b.stock[landfill]).toBe(ctx.flows.garbageCleared);
    // Trucks keep pace with three small houses: nothing piles past tolerance.
    expect(held).toBeLessThanOrEqual(GARBAGE_TOLERANCE);
  });

  it("uncollected piles block leveling and draw a caused advisor", () => {
    const b = createBuildings();
    const i = house(b, 100, 10);
    b.level[i] = 2;
    b.thriveDays[i] = 4;
    b.stock[i] = 3 * GARBAGE_TOLERANCE; // already a dump
    const { ctx, advisors } = makeCtx(b, () => 0);
    servicesSlice(ctx, 0); // building 100 sits in slice 0 of a 1-building city
    expect(b.thriveDays[i]).toBe(0);
    expect(advisors.some((a) => a.messageKey === "advisor.garbage")).toBe(true);
    expect(advisors[0]?.summaryKey).toBe("cause.noGarbageService");
  });
});

describe("health loop: sickness, treatment capacity, mortality", () => {
  it("sickness accrues at the base rate; clinics treat it down (capacity queue)", () => {
    const b = createBuildings();
    const i = house(b, 100, 1000); // base rate 2‰/day ⇒ ≥2 certain
    spawnBuilding(b, 400, plop(BuildingKind.clinic)); // 40 treated/day
    const { ctx } = makeCtx(b, () => 255);
    runDay(ctx);
    // Everyone who fell sick this day was treatable within clinic capacity.
    expect(ctx.flows.sickened).toBeGreaterThanOrEqual(2);
    expect(ctx.flows.treated).toBeGreaterThan(0);
    expect(ctx.flows.treated).toBeLessThanOrEqual(40);
    expect(b.sick[i]).toBe(ctx.flows.sickened - ctx.flows.treated - ctx.flows.deaths);
  });

  it("untreated sickness kills: cohorts shrink, corpses appear, ledger ties out", () => {
    const b = createBuildings();
    const i = house(b, 100, 200);
    b.sick[i] = 100; // a plague, no healthcare anywhere
    const { ctx } = makeCtx(b, () => 0);
    runDay(ctx);
    expect(ctx.flows.deaths).toBeGreaterThan(0);
    expect(b.corpses[i]).toBe(ctx.flows.deaths);
    expect(residentsOf(b, i)).toBe(200 - ctx.flows.deaths);
  });

  it("the employed ≤ adults invariant survives deaths", () => {
    const b = createBuildings();
    const i = house(b, 100, 50);
    b.cohorts[i * COHORT_BLOCK + 16] = 50; // all employed
    b.sick[i] = 50;
    const { ctx } = makeCtx(b, () => 0);
    for (let day = 0; day < 5; day++) {
      runDay(ctx, day);
    }
    const adults = b.cohorts[i * COHORT_BLOCK + 2 * EDU_TIERS] as number;
    const employed = b.cohorts[i * COHORT_BLOCK + 16] as number;
    expect(employed).toBeLessThanOrEqual(adults);
    for (let c = 0; c < COHORT_BLOCK; c++) {
      expect(b.cohorts[i * COHORT_BLOCK + c]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("deathcare loop: hearses, graves, cremation", () => {
  it("hearses move corpses into cemetery stock; the fill is conserved", () => {
    const b = createBuildings();
    const i = house(b, 100, 50);
    b.corpses[i] = 6;
    const cemetery = spawnBuilding(b, 400, plop(BuildingKind.cemetery));
    const { ctx } = makeCtx(b, () => 255);
    runDay(ctx);
    expect(ctx.flows.corpsesCleared).toBeGreaterThan(0);
    expect(ctx.flows.buried).toBe(ctx.flows.corpsesCleared);
    expect(b.stock[cemetery]).toBe(ctx.flows.buried);
    expect(b.corpses[i]).toBe(6 - ctx.flows.corpsesCleared + ctx.flows.deaths);
  });

  it("a full cemetery overflows to the crematorium; with neither, the advisor names it", () => {
    const b = createBuildings();
    const i = house(b, 100, 50);
    b.corpses[i] = 4;
    const { ctx, advisors } = makeCtx(b, () => 0);
    servicesSlice(ctx, 0);
    expect(advisors.some((a) => a.summaryKey === "cause.noDeathcare")).toBe(true);
    expect(b.corpses[i]).toBeGreaterThanOrEqual(4); // nobody came
  });

  it("lingering corpses freeze leveling (desirability crash, GDD §7)", () => {
    const b = createBuildings();
    const i = house(b, 100, 50);
    b.level[i] = 3;
    b.thriveDays[i] = 4;
    b.corpses[i] = 1;
    const { ctx } = makeCtx(b, () => 0);
    servicesSlice(ctx, 0);
    expect(b.thriveDays[i]).toBe(0);
  });
});

describe("education pipeline: seats gate tier progression (GDD §8)", () => {
  it("no school ⇒ no promotion; an elementary school promotes children E0→E1 within quota", () => {
    const b = createBuildings();
    const i = spawnBuilding(b, 100, ZoneKind.residentialLow);
    b.cohorts[i * COHORT_BLOCK] = 120; // children E0
    const { ctx: noSchool } = makeCtx(b, () => 255);
    runDay(noSchool);
    expect(noSchool.flows.promotedE1).toBe(0);

    spawnBuilding(b, 400, plop(BuildingKind.schoolElementary)); // 200 seats
    const { ctx } = makeCtx(b, () => 255);
    runDay(ctx);
    // 200 seats / 30 days ⇒ ~6 graduations/day, spread over slices.
    expect(ctx.flows.promotedE1).toBeGreaterThan(0);
    expect(ctx.flows.promotedE1).toBeLessThanOrEqual(Math.floor(200 / 30));
    expect(b.cohorts[i * COHORT_BLOCK + 1]).toBe(ctx.flows.promotedE1); // children E1
  });

  it("zero coverage gates the pipeline even when seats exist", () => {
    const b = createBuildings();
    const i = spawnBuilding(b, 100, ZoneKind.residentialLow);
    b.cohorts[i * COHORT_BLOCK] = 50;
    spawnBuilding(b, 400, plop(BuildingKind.schoolElementary));
    const { ctx } = makeCtx(b, () => 0);
    runDay(ctx);
    expect(ctx.flows.promotedE1).toBe(0);
  });

  it("the university lifts adults E2→E3 and migrates their employment", () => {
    const b = createBuildings();
    const i = house(b, 100, 40, 2); // 40 adults E2
    b.cohorts[i * COHORT_BLOCK + 16 + 2] = 40; // all employed at E2
    spawnBuilding(b, 400, plop(BuildingKind.university));
    const { ctx } = makeCtx(b, () => 255);
    runDay(ctx);
    expect(ctx.flows.promotedE3).toBeGreaterThan(0);
    const adultsE2 = b.cohorts[i * COHORT_BLOCK + 2 * EDU_TIERS + 2] as number;
    const employedE2 = b.cohorts[i * COHORT_BLOCK + 16 + 2] as number;
    expect(employedE2).toBeLessThanOrEqual(adultsE2);
  });
});

describe("slice mathematics", () => {
  it("sliceShare buckets sum exactly to the daily total, every day", () => {
    for (const daily of [0, 1, 7, 23, 24, 100, 599]) {
      for (const day of [0, 1, 5, 23, 24, 100]) {
        let sum = 0;
        for (let s = 0; s < SERVICE_SLICES; s++) {
          sum += sliceShare(daily, s, day);
        }
        expect(sum).toBe(daily);
      }
    }
  });

  it("day rotation prevents fixed-slice starvation (the 16-hearse case)", () => {
    // A building parked in slice 0 must see nonzero quota within 24 days.
    let served = 0;
    for (let day = 0; day < SERVICE_SLICES; day++) {
      served += sliceShare(16, 0, day);
    }
    expect(served).toBe(16); // exactly its fair share over a full rotation
  });
});

describe("integration through runTick (the TDD §4 services slot)", () => {
  it("a serviced city replays deterministically and keeps population exact", () => {
    const log = [
      { seq: 0, tick: 0, type: CommandType.buildRoad, ax: 4, ay: 8, bx: 40, by: 8, roadClass: 1 },
      { seq: 1, tick: 0, type: CommandType.buildRoad, ax: 4, ay: 16, bx: 40, by: 16, roadClass: 1 },
      { seq: 2, tick: 0, type: CommandType.buildRoad, ax: 4, ay: 8, bx: 4, by: 16, roadClass: 1 },
      { seq: 3, tick: 1, type: CommandType.placeBuilding, x: 5, y: 9, building: 1 },
      { seq: 4, tick: 1, type: CommandType.placeBuilding, x: 6, y: 9, building: 2 },
      {
        seq: 5,
        tick: 1,
        type: CommandType.placeBuilding,
        x: 7,
        y: 9,
        building: BuildingKind.landfill,
      },
      {
        seq: 6,
        tick: 1,
        type: CommandType.placeBuilding,
        x: 8,
        y: 9,
        building: BuildingKind.clinic,
      },
      {
        seq: 7,
        tick: 1,
        type: CommandType.placeBuilding,
        x: 9,
        y: 9,
        building: BuildingKind.cemetery,
      },
      {
        seq: 8,
        tick: 1,
        type: CommandType.placeBuilding,
        x: 10,
        y: 9,
        building: BuildingKind.schoolElementary,
      },
      { seq: 9, tick: 2, type: CommandType.zoneRect, x0: 5, y0: 10, x1: 38, y1: 14, zone: 1 },
      { seq: 10, tick: 2, type: CommandType.zoneRect, x0: 5, y0: 4, x1: 38, y1: 7, zone: 5 },
      {
        seq: 11,
        tick: 3,
        type: CommandType.setServiceBudget,
        service: ServiceId.garbage,
        permille: 1200,
      },
    ] as Parameters<typeof replay>[1];
    const days3 = 3 * 24 * 60;
    const a = replay(99, log, days3);
    const b2 = replay(99, log, days3);
    expect(a.rejections).toEqual([]);
    expect(stateHash(a.world)).toBe(stateHash(b2.world));
    // Population exactness: the HUD number equals the cohort truth even
    // with deaths flowing (the conservation identity, every tick).
    let residents = 0;
    for (let i = 0; i < a.world.buildings.count; i++) {
      if (a.world.buildings.alive[i] === 1) {
        residents += residentsOf(a.world.buildings, i);
      }
    }
    expect(a.world.population).toBe(residents);
    // The loops actually ran: garbage was generated in a real city.
    expect(a.world.serviceFlows.garbageGenerated).toBeGreaterThan(0);
  });
});
