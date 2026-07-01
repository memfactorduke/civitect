/**
 * The money cycle (GDD §2/§8, board phase-5 task 2). Money is INTEGER
 * CENTS, always (ADR-005 §2 [LOCKED]); every flow below floors.
 *
 * Monthly close (every 30 game-days, on the tick boundary — TDD §4's
 * economy slot): property taxes by zone × level × land value, service
 * upkeep through the budget sliders, road maintenance by class × length,
 * loan debits. The close writes the report lines that the monthly report
 * shows with MoM deltas (pillar 2: the report explains itself).
 *
 * Failure pressure (GDD §2): first close in the red offers the ONE-TIME
 * bailout (a forced tier-3-style loan with advisor scrutiny); in the red
 * again after the bailout ⇒ receivership (sandbox-continue, achievements
 * disabled). All numbers [TUNE].
 */
import { BuildingKind, ReportLineKind, ZoneKind } from "@civitect/protocol";
import { BuildingStatus, type Buildings, capacityFor, residentsOf } from "../growth/buildings";
import { ROAD_CLASS_SPEC, type RoadClass, type RoadGraph } from "../roads/graph";
import { budgetScalePermille, specForTableKind } from "../services/registry";

export const TICKS_PER_MONTH = 43_200; // 30 game-days × 1440

/** Starting funds by difficulty (relaxed / mayor / ironclad), cents. */
export const STARTING_FUNDS_CENTS: readonly number[] = [100_000_00, 50_000_00, 25_000_00];

/** Loan tiers (GDD §8): flat-interest, fixed-term [TUNE]. */
export interface LoanTerms {
  readonly principalCents: number;
  readonly totalInterestPermille: number;
  readonly months: number;
}
export const LOAN_TERMS: readonly LoanTerms[] = [
  { principalCents: 50_000_00, totalInterestPermille: 250, months: 60 },
  { principalCents: 200_000_00, totalInterestPermille: 500, months: 120 },
  { principalCents: 500_000_00, totalInterestPermille: 1000, months: 240 },
];

/** The bailout: tier-3 sized, punitive interest, one per city (GDD §2). */
export const BAILOUT_TERMS: LoanTerms = {
  principalCents: 250_000_00,
  totalInterestPermille: 2000,
  months: 120,
};

export function monthlyPaymentCents(terms: LoanTerms): number {
  const total = Math.floor((terms.principalCents * (1000 + terms.totalInterestPermille)) / 1000);
  return Math.floor(total / terms.months);
}

/** Road construction cost per supercover tile, by class [TUNE]. */
export function roadCostPerTileCents(roadClass: RoadClass): number {
  const base: Record<number, number> = { 1: 100_00, 2: 250_00, 3: 600_00, 4: 30_00 };
  const cls = roadClass as number;
  if (cls > 10) {
    return (base[cls - 10] ?? 100_00) * 3; // bridges build dear
  }
  return base[cls] ?? 100_00;
}

/** Ploppable construction costs, cents, by BuildingKind [TUNE]. */
export const PLOPPABLE_COST_CENTS: ReadonlyMap<number, number> = new Map([
  [BuildingKind.powerPlant, 25_000_00],
  [BuildingKind.waterPump, 10_000_00],
  [BuildingKind.fireStation, 8_000_00],
  [BuildingKind.fireStationLarge, 20_000_00],
  [BuildingKind.policeStation, 8_000_00],
  [BuildingKind.policeHQ, 20_000_00],
  [BuildingKind.clinic, 6_000_00],
  [BuildingKind.hospital, 25_000_00],
  [BuildingKind.cemetery, 4_000_00],
  [BuildingKind.crematorium, 10_000_00],
  [BuildingKind.schoolElementary, 8_000_00],
  [BuildingKind.schoolHigh, 15_000_00],
  [BuildingKind.university, 40_000_00],
  [BuildingKind.library, 5_000_00],
  [BuildingKind.parkSmall, 1_500_00],
  [BuildingKind.plaza, 3_000_00],
  [BuildingKind.telecomTower, 12_000_00],
  [BuildingKind.landfill, 5_000_00],
  [BuildingKind.incinerator, 18_000_00],
  [BuildingKind.recyclingCenter, 12_000_00],
  [BuildingKind.sewageOutlet, 3_000_00],
  [BuildingKind.sewageTreatment, 15_000_00],
]);

/** Monthly upkeep per service/utility building, cents, before sliders [TUNE]. */
export const PLOPPABLE_UPKEEP_CENTS: ReadonlyMap<number, number> = new Map([
  [BuildingKind.powerPlant, 1_200_00],
  [BuildingKind.waterPump, 500_00],
  [BuildingKind.fireStation, 600_00],
  [BuildingKind.fireStationLarge, 1_500_00],
  [BuildingKind.policeStation, 600_00],
  [BuildingKind.policeHQ, 1_500_00],
  [BuildingKind.clinic, 500_00],
  [BuildingKind.hospital, 2_000_00],
  [BuildingKind.cemetery, 200_00],
  [BuildingKind.crematorium, 700_00],
  [BuildingKind.schoolElementary, 700_00],
  [BuildingKind.schoolHigh, 1_200_00],
  [BuildingKind.university, 3_000_00],
  [BuildingKind.library, 300_00],
  [BuildingKind.parkSmall, 100_00],
  [BuildingKind.plaza, 200_00],
  [BuildingKind.telecomTower, 800_00],
  [BuildingKind.landfill, 400_00],
  [BuildingKind.incinerator, 1_200_00],
  [BuildingKind.recyclingCenter, 900_00],
  [BuildingKind.sewageOutlet, 200_00],
  [BuildingKind.sewageTreatment, 1_000_00],
]);

/** Monthly road maintenance per supercover tile, by base class [TUNE]. */
export function roadUpkeepPerTileCents(roadClass: RoadClass): number {
  const base: Record<number, number> = { 1: 2_00, 2: 5_00, 3: 12_00, 4: 50 };
  const cls = roadClass as number;
  return base[cls > 10 ? cls - 10 : cls] ?? 2_00;
}

/** Monthly tax base per occupant/job-slot, cents, by zone kind [TUNE]. */
export function taxBaseCents(kind: number): number {
  if (kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh) {
    return 8_00;
  }
  if (kind === ZoneKind.commercialLow || kind === ZoneKind.commercialHigh) {
    return 12_00;
  }
  if (kind === ZoneKind.industrial) {
    return 10_00;
  }
  if (kind === ZoneKind.office) {
    return 15_00;
  }
  return 0;
}

/** Active loan state (canonical). */
export interface Loan {
  principalCents: number;
  monthlyPaymentCents: number;
  monthsLeft: number;
}

/** Canonical economy state on the world. */
export interface EconomyState {
  /** Permille per ZoneKind 1–6 (index = zone − 1). */
  readonly taxRatesPermille: Uint16Array;
  loans: Loan[];
  /** Current month's accumulating report lines (ReportLineKind − 1). */
  readonly monthAccumCents: number[];
  /** Last closed month's lines — the MoM delta base. */
  readonly lastMonthCents: number[];
  milestoneIndex: number;
  readonly achievements: Uint8Array;
  uniquesMask: number;
  difficulty: number;
  receivership: number;
  bailoutUsed: number;
}

export const REPORT_KINDS = 14;

export function createEconomy(difficulty = 1): EconomyState {
  return {
    taxRatesPermille: new Uint16Array(6).fill(90),
    loans: [],
    monthAccumCents: new Array(REPORT_KINDS).fill(0),
    lastMonthCents: new Array(REPORT_KINDS).fill(0),
    milestoneIndex: 0,
    achievements: new Uint8Array(8),
    uniquesMask: 0,
    difficulty,
    receivership: 0,
    bailoutUsed: 0,
  };
}

/** Add cents to a report line (kind is 1-based, ReportLineKind). */
export function accumulate(economy: EconomyState, kind: ReportLineKind, cents: number): void {
  economy.monthAccumCents[kind - 1] = (economy.monthAccumCents[kind - 1] as number) + cents;
}

export interface CloseInputs {
  readonly buildings: Buildings;
  readonly roads: RoadGraph;
  readonly serviceBudgetsPermille: Uint16Array;
  readonly landValueAt: (tileIdx: number) => number;
  /** Effective tax rate for a tile+zone: a district override supersedes the
   *  passed city rate (GDD §11, task 2). Identity ⇒ city rate everywhere. */
  readonly taxRateAt: (tileIdx: number, zoneIdx: number, cityRate: number) => number;
}

export interface CloseResult {
  /** Net funds movement this close, cents (the conservation handle). */
  readonly netCents: number;
  /** Lines for the monthly report (amount + MoM delta), kind-ordered. */
  readonly lines: readonly { kind: ReportLineKind; amountCents: number; deltaCents: number }[];
}

/**
 * PHASE 1 of the close: accumulate this month's taxes/upkeep/maintenance/
 * loan flows and return the cash THEY move. Mid-month lines (construction,
 * bailout) already moved the treasury when they happened — the first build
 * double-counted construction and handed a bankrupt town +3.5M (caught by
 * the bankruptcy test). The caller applies netCents, runs the bankruptcy
 * check (a bailout accumulates into THIS month so its report explains it),
 * then calls finalizeReport.
 */
export function accumulateClose(economy: EconomyState, inputs: CloseInputs): number {
  let preApplied = 0;
  for (let k = 0; k < REPORT_KINDS; k++) {
    preApplied += economy.monthAccumCents[k] as number;
  }
  const b = inputs.buildings;
  // ── taxes by zone × level × land value (GDD §8) ──
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const status = b.status[i] as number;
    if (status === BuildingStatus.abandoned || status === BuildingStatus.ruin) {
      continue;
    }
    const kind = b.kind[i] as number;
    const base = taxBaseCents(kind);
    if (base === 0) {
      continue;
    }
    const level = b.level[i] as number;
    const occupants =
      kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh
        ? residentsOf(b, i)
        : capacityFor(kind, level);
    if (occupants === 0) {
      continue;
    }
    const zi = zoneIndex(kind);
    const cityRate = economy.taxRatesPermille[zi] as number;
    const rate = inputs.taxRateAt(b.tileIdx[i] as number, zi, cityRate);
    const lv = inputs.landValueAt(b.tileIdx[i] as number);
    // tax = base × occupants × level ×(rate/90)×(lv/100), floored stepwise.
    let tax = base * occupants * level;
    tax = Math.floor((tax * rate) / 90);
    tax = Math.floor((tax * lv) / 100);
    const line =
      kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh
        ? ReportLineKind.taxResidential
        : kind === ZoneKind.commercialLow || kind === ZoneKind.commercialHigh
          ? ReportLineKind.taxCommercial
          : kind === ZoneKind.industrial
            ? ReportLineKind.taxIndustrial
            : ReportLineKind.taxOffice;
    accumulate(economy, line, tax);
  }
  // ── service/utility upkeep through the sliders ──
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = (b.kind[i] as number) - 100;
    const upkeep = PLOPPABLE_UPKEEP_CENTS.get(kind);
    if (upkeep === undefined) {
      continue;
    }
    // Utilities (power/water) have no service slider — flat upkeep.
    const spec = specForTableKind(b.kind[i] as number);
    const scale =
      spec === null
        ? 1000
        : budgetScalePermille(inputs.serviceBudgetsPermille[spec.service - 1] as number);
    accumulate(economy, ReportLineKind.serviceUpkeep, -Math.floor((upkeep * scale) / 1000));
  }
  // ── road maintenance by class × length ──
  const g = inputs.roads;
  let roadUpkeep = 0;
  for (let e = 0; e < g.edgeCount; e++) {
    if (g.edgeAlive[e] !== 1) {
      continue;
    }
    const tiles = Math.max(1, Math.floor((g.edgeLengthMilliTiles[e] as number) / 1000));
    roadUpkeep += roadUpkeepPerTileCents(g.edgeClass[e] as RoadClass) * tiles;
  }
  if (roadUpkeep > 0) {
    accumulate(economy, ReportLineKind.roadMaintenance, -roadUpkeep);
  }
  // ── loans: flat principal + interest split per month ──
  const liveLoans: Loan[] = [];
  for (const loan of economy.loans) {
    const principalShare = Math.floor(loan.principalCents / Math.max(1, loan.monthsLeft));
    const interestShare = loan.monthlyPaymentCents - principalShare;
    accumulate(economy, ReportLineKind.loanPrincipal, -principalShare);
    accumulate(economy, ReportLineKind.loanInterest, -Math.max(0, interestShare));
    loan.principalCents -= principalShare;
    loan.monthsLeft -= 1;
    if (loan.monthsLeft > 0 && loan.principalCents > 0) {
      liveLoans.push(loan);
    }
  }
  economy.loans = liveLoans;
  let total = 0;
  for (let k = 0; k < REPORT_KINDS; k++) {
    total += economy.monthAccumCents[k] as number;
  }
  return total - preApplied;
}

/** PHASE 2: freeze the month's lines (with MoM deltas) and reset. */
export function finalizeReport(economy: EconomyState): CloseResult["lines"] {
  const lines: { kind: ReportLineKind; amountCents: number; deltaCents: number }[] = [];
  for (let k = 0; k < REPORT_KINDS; k++) {
    const amount = economy.monthAccumCents[k] as number;
    const last = economy.lastMonthCents[k] as number;
    if (amount !== 0 || last !== 0) {
      lines.push({
        kind: (k + 1) as ReportLineKind,
        amountCents: amount,
        deltaCents: amount - last,
      });
    }
    economy.lastMonthCents[k] = amount;
    economy.monthAccumCents[k] = 0;
  }
  return lines;
}

/** Convenience for tests: phase 1 + phase 2 with no bankruptcy window. */
export function monthlyClose(economy: EconomyState, inputs: CloseInputs): CloseResult {
  const netCents = accumulateClose(economy, inputs);
  return { netCents, lines: finalizeReport(economy) };
}

export function zoneIndex(kind: number): number {
  return Math.min(5, Math.max(0, kind - 1));
}
