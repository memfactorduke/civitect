/**
 * Money cycle verification (board phase-5 task 2). The headline property:
 * EVERY cent is conserved — funds delta ≡ Σ report lines + construction −
 * loans, exactly, month after month (ADR-005 §2: integer cents, ADR-013
 * §2: money conservation).
 */
import { BuildingKind, CommandType, RejectionReason, ReportLineKind } from "@civitect/protocol";
import { describe, expect, it } from "vitest";
import { createWorld, runTick, stateHash, type World } from "../world";
import {
  LOAN_TERMS,
  monthlyPaymentCents,
  PLOPPABLE_COST_CENTS,
  roadCostPerTileCents,
  STARTING_FUNDS_CENTS,
  TICKS_PER_MONTH,
} from "./budget";

function cmdRunner(world: World): (c: object) => ReturnType<typeof runTick> {
  let seq = 5000;
  return (c: object) => runTick(world, [{ ...c, seq: seq++, tick: world.tick } as never]);
}

function taxTown(): World {
  const world = createWorld(31337);
  const cmd = cmdRunner(world);
  cmd({ type: CommandType.buildRoad, ax: 4, ay: 8, bx: 50, by: 8, roadClass: 1 });
  cmd({ type: CommandType.placeBuilding, x: 5, y: 9, building: 1 });
  cmd({ type: CommandType.placeBuilding, x: 6, y: 9, building: 2 });
  cmd({ type: CommandType.placeBuilding, x: 8, y: 9, building: BuildingKind.clinic });
  cmd({ type: CommandType.zoneRect, x0: 8, y0: 10, x1: 40, y1: 12, zone: 1 });
  cmd({ type: CommandType.zoneRect, x0: 8, y0: 5, x1: 40, y1: 7, zone: 3 });
  return world;
}

describe("construction money (GDD §8)", () => {
  it("roads and ploppables charge exactly; insufficient funds rejects without fingerprints", () => {
    const world = createWorld(1);
    const cmd = cmdRunner(world);
    const before = world.fundsCents;
    expect(before).toBe(STARTING_FUNDS_CENTS[1]);
    expect(cmd({ type: CommandType.buildRoad, ax: 2, ay: 2, bx: 12, by: 2, roadClass: 1 })).toEqual(
      [],
    );
    const roadCost = 11 * roadCostPerTileCents(1 as never);
    expect(world.fundsCents).toBe(before - roadCost);
    expect(cmd({ type: CommandType.placeBuilding, x: 3, y: 3, building: 1 })).toEqual([]);
    expect(world.fundsCents).toBe(
      before - roadCost - (PLOPPABLE_COST_CENTS.get(BuildingKind.powerPlant) as number),
    );

    // Drain the treasury, then try to build a hospital: rejected, and the
    // hash matches a world that idled the same ticks (no fingerprints).
    world.fundsCents = 100;
    const reference = createWorld(1);
    const refCmd = cmdRunner(reference);
    refCmd({ type: CommandType.buildRoad, ax: 2, ay: 2, bx: 12, by: 2, roadClass: 1 });
    refCmd({ type: CommandType.placeBuilding, x: 3, y: 3, building: 1 });
    reference.fundsCents = 100;
    const rejections = cmd({ type: CommandType.placeBuilding, x: 4, y: 3, building: 8 });
    expect(rejections.map((r) => r.reason)).toEqual([4]); // insufficientFunds
    runTick(reference, []);
    expect(stateHash(world)).toBe(stateHash(reference));
  });

  it("build∘undo refunds exactly (the Phase 1 identity extends to money)", () => {
    const world = createWorld(7);
    const cmd = cmdRunner(world);
    const before = world.fundsCents;
    cmd({ type: CommandType.buildRoad, ax: 2, ay: 2, bx: 10, by: 2, roadClass: 2 });
    expect(world.fundsCents).toBeLessThan(before);
    cmd({ type: CommandType.undo });
    expect(world.fundsCents).toBe(before);
    cmd({ type: CommandType.redo });
    expect(world.fundsCents).toBe(before - 9 * roadCostPerTileCents(2 as never));
  });
});

describe("the monthly close (GDD §8/§12)", () => {
  it("conserves every cent: close-to-close funds delta ≡ Σ report lines, with mid-month flows", () => {
    // The window is [just after close M, just after close M+1]: mid-month
    // construction and loan cash land in the NEXT report, and the delta
    // over the same window includes their cash — every line in a report
    // corresponds to money that moved in its window, exactly. Months 2–4
    // each inject different mid-month flows so the property covers the
    // command paths, not just the close itself (the take/repay handlers
    // once moved cash without lines — this test is why they can't).
    const world = taxTown();
    world.economy.milestoneIndex = 1; // loans unlock at the first milestone (GDD §13)
    const cmd = cmdRunner(world);
    // Harness headroom BEFORE the measured window: month 3's early repay
    // needs the full remaining principal on hand or it would reject.
    world.fundsCents += 50_000_00;
    const crossClose = (midMonth?: () => void): void => {
      let fired = false;
      while (world.tick % TICKS_PER_MONTH !== 0 || world.tick === 0) {
        runTick(world, []);
        if (!fired && midMonth !== undefined && world.tick % TICKS_PER_MONTH === 15_000) {
          fired = true;
          midMonth();
        }
      }
      runTick(world, []); // execute the close tick itself
    };
    const midMonthFlows: (undefined | (() => void))[] = [
      // month 2: borrow and build mid-month — proceeds + construction cash.
      () => {
        expect(cmd({ type: CommandType.takeLoan, tier: 1 })).toEqual([]);
        expect(
          cmd({ type: CommandType.buildRoad, ax: 4, ay: 30, bx: 30, by: 30, roadClass: 2 }),
        ).toEqual([]);
      },
      // month 3: early repay — the forgiven interest is no one's cash;
      // only the principal moves, and it must be a line.
      () => {
        expect(cmd({ type: CommandType.repayLoan, tier: 1 })).toEqual([]);
      },
      // month 4: quiet — the close alone still balances.
      undefined,
    ];
    crossClose();
    for (let month = 2; month <= 4; month++) {
      const fundsAfterPrev = world.fundsCents;
      crossClose(midMonthFlows[month - 2]);
      const report = world.pendingReport;
      expect(report).not.toBeNull();
      expect(report?.month).toBe(month);
      let net = 0;
      for (const line of report?.lines ?? []) {
        net += line.amountCents;
      }
      expect(world.fundsCents - fundsAfterPrev).toBe(net);
    }
  });

  it("a grown town pays taxes scaled by land value and rates", () => {
    const world = taxTown();
    const cmd = cmdRunner(world);
    cmd({ type: CommandType.setTaxRate, zone: 1, permille: 200 }); // soak R
    for (let t = 0; t < TICKS_PER_MONTH + 10; t++) {
      runTick(world, []);
    }
    const lines = world.pendingReport?.lines ?? [];
    void lines;
    const taxLine = world.economy.lastMonthCents[ReportLineKind.taxResidential - 1] as number;
    expect(taxLine).toBeGreaterThan(0);
    // MoM delta machinery: the SECOND close sees the first as its base.
    for (let t = 0; t < TICKS_PER_MONTH; t++) {
      runTick(world, []);
    }
    const second = world.pendingReport;
    const rLine = second?.lines.find((l) => l.kind === ReportLineKind.taxResidential);
    expect(rLine).toBeDefined();
    expect(rLine?.deltaCents).toBe((rLine?.amountCents as number) - taxLine);
  });

  it("loans debit monthly and terminate; early repay clears the slot", () => {
    const world = createWorld(99);
    world.economy.milestoneIndex = 1; // loans unlock at the first milestone (GDD §13)
    const cmd = cmdRunner(world);
    const t1 = LOAN_TERMS[0] as (typeof LOAN_TERMS)[number];
    const before = world.fundsCents;
    expect(cmd({ type: CommandType.takeLoan, tier: 1 })).toEqual([]);
    expect(world.fundsCents).toBe(before + t1.principalCents);
    expect(world.economy.loans.length).toBe(1);
    expect(world.economy.loans[0]?.monthlyPaymentCents).toBe(monthlyPaymentCents(t1));
    // One close: principal shrinks, a payment left the treasury.
    for (let t = 0; t < TICKS_PER_MONTH + 5; t++) {
      runTick(world, []);
    }
    expect(world.economy.loans[0]?.monthsLeft).toBe(t1.months - 1);
    expect(world.economy.loans[0]?.principalCents).toBeLessThan(t1.principalCents);
    // Early repayment clears it.
    expect(cmd({ type: CommandType.repayLoan, tier: 1 })).toEqual([]);
    expect(world.economy.loans.length).toBe(0);
  });

  it("bankruptcy: the one-time bailout, then receivership (GDD §2)", () => {
    const world = createWorld(13);
    const cmd = cmdRunner(world);
    cmd({ type: CommandType.buildRoad, ax: 2, ay: 2, bx: 60, by: 2, roadClass: 3 });
    const seen: string[] = [];
    const runMonth = (): void => {
      for (let t = 0; t < TICKS_PER_MONTH; t++) {
        runTick(world, []);
        for (const e of world.advisorQueue) {
          seen.push(e.messageKey);
        }
        world.advisorQueue.length = 0;
      }
    };
    // Month 1 in the red: the one-time bailout arrives, with its advisor
    // and its report line in the SAME month's report.
    world.fundsCents = 1000;
    runMonth();
    expect(world.economy.bailoutUsed).toBe(1);
    expect(seen).toContain("advisor.bailout");
    expect(world.economy.receivership).toBe(0);
    expect(
      world.economy.lastMonthCents[12 - 1], // ReportLineKind.bailout
    ).toBeGreaterThan(0);
    // Deep in the red AGAIN after the bailout: receivership.
    world.fundsCents = -1_000_00;
    runMonth();
    expect(world.economy.receivership).toBe(1);
    expect(seen).toContain("advisor.receivership");
  });
});

describe("tax pressure reaches demand (GDD §8: >12% suppresses)", () => {
  it("punitive R taxes lower R demand vs the default", () => {
    const base = taxTown();
    const soaked = taxTown();
    cmdRunner(soaked)({ type: CommandType.setTaxRate, zone: 1, permille: 290 });
    cmdRunner(soaked)({ type: CommandType.setTaxRate, zone: 2, permille: 290 });
    for (let t = 0; t < 1440 * 5; t++) {
      runTick(base, []);
      runTick(soaked, []);
    }
    expect(soaked.lastDemand.r).toBeLessThan(base.lastDemand.r);
    // The panel's factors still sum exactly (the locked property).
    const sum = (d: typeof base.lastDemand) =>
      (d.factors[0] as number) + (d.factors[1] as number) + (d.factors[2] as number);
    expect(sum(soaked.lastDemand)).toBe(soaked.lastDemand.r);
  });
});

describe("district tax override (phase-6 task 2, GDD §11)", () => {
  const RES_LINE = ReportLineKind.taxResidential - 1;
  // The residential block taxTown() zones: y 10..12, x 8..40.
  const paintRes = (world: World) =>
    cmdRunner(world)({
      type: CommandType.paintDistrict,
      x0: 8,
      y0: 10,
      x1: 40,
      y1: 12,
      districtId: 1,
    });

  it("a district override supersedes the city rate inside it (revenue, not demand)", () => {
    // Two identical towns; the override changes only the tax CLOSE (demand reads
    // the city rate), so growth stays identical and revenue isolates the override.
    const base = taxTown();
    const overridden = taxTown();
    paintRes(overridden);
    cmdRunner(overridden)({
      type: CommandType.setDistrictTax,
      districtId: 1,
      zone: 1,
      permille: 180,
    });
    for (let t = 0; t < TICKS_PER_MONTH + 10; t++) {
      runTick(base, []);
      runTick(overridden, []);
    }
    const baseR = base.economy.lastMonthCents[RES_LINE] as number;
    const overR = overridden.economy.lastMonthCents[RES_LINE] as number;
    expect(baseR).toBeGreaterThan(0); // the town actually taxes R (not vacuous)
    expect(overR).toBeGreaterThan(baseR); // the override lifted R revenue
    expect(overridden.population).toBe(base.population); // growth untouched
  });

  it("a painted district with no override (0) taxes exactly like no district", () => {
    const base = taxTown();
    const painted = taxTown();
    paintRes(painted); // override stays 0 = inherit the city rate
    for (let t = 0; t < TICKS_PER_MONTH + 10; t++) {
      runTick(base, []);
      runTick(painted, []);
    }
    expect(painted.economy.lastMonthCents[RES_LINE]).toBe(base.economy.lastMonthCents[RES_LINE]);
  });

  it("rejects out-of-range district tax commands without writing an override", () => {
    const world = taxTown();
    const cmd = cmdRunner(world);
    paintRes(world);
    for (const bad of [
      { districtId: 0, zone: 1, permille: 100 }, // id < 1
      { districtId: 64, zone: 1, permille: 100 }, // id > MAX_DISTRICTS
      { districtId: 1, zone: 0, permille: 100 }, // zone < 1
      { districtId: 1, zone: 7, permille: 100 }, // zone > 6
      { districtId: 1, zone: 1, permille: 5 }, // below TAX_MIN and != 0
      { districtId: 1, zone: 1, permille: 999 }, // above TAX_MAX
    ]) {
      const rej = cmd({ type: CommandType.setDistrictTax, ...bad });
      expect(rej).toHaveLength(1);
      expect(rej[0]?.reason).toBe(RejectionReason.invalidTarget);
    }
    expect(world.districts.rows[0]?.taxOverridePermille[0]).toBe(0);
  });
});
