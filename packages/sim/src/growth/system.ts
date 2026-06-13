/**
 * Growth, leveling, abandonment + cohort lifecycle (GDD §6/§8) — the
 * Phase 2 bodies of the locked TDD §4 tick pipeline. Heavy work is
 * STAGGERED: zoned-lot growth processes 1/60 of tiles per tick; cohort
 * lifecycle processes 1/24 of buildings each game-hour. rng.growth is the
 * only randomness (ADR-005 stream discipline).
 */
import { ZoneKind } from "@civitect/protocol";
import type { Pcg32 } from "../rng";
import type { Buildings } from "./buildings";
import {
  adultsOf,
  aliveByTile,
  BuildingStatus,
  COHORT_BLOCK,
  capacityFor,
  demolishBuilding,
  EDU_TIERS,
  employedOf,
  PLOPPABLE_KIND_OFFSET,
  residentsOf,
  spawnBuilding,
} from "./buildings";
import { type CityAggregates, computeDemand } from "./demand";
import type { UtilityState } from "./utilities";

export const TICKS_PER_DAY = 1440; // 1 tick = 1 game-minute
export const TICKS_PER_HOUR = 60;
const GROWTH_SLICES = 60;
const LIFECYCLE_SLICES = 24;
const ABANDON_AFTER_DAYS = 2; // GDD §6 [LOCKED-ish: "2+ days"]
const DEMOLISH_AFTER_DAYS = 30; // [TUNE]
const LEVEL_AFTER_DAYS = 5; // sustained desirability [TUNE]

export interface GrowthFlows {
  births: number;
  deaths: number;
  immigrants: number;
  emigrants: number;
}

export function emptyFlows(): GrowthFlows {
  return { births: 0, deaths: 0, immigrants: 0, emigrants: 0 };
}

export function aggregates(b: Buildings): CityAggregates {
  let housingCapacity = 0;
  let residents = 0;
  let jobsC = 0;
  let jobsI = 0;
  let jobsO = 0;
  let employed = 0;
  let adults = 0;
  let educated = 0;
  let countC = 0;
  let countI = 0;
  let countO = 0;
  for (let i = 0; i < b.count; i++) {
    if (
      b.alive[i] !== 1 ||
      (b.status[i] as number) === BuildingStatus.abandoned ||
      (b.status[i] as number) === BuildingStatus.ruin
    ) {
      continue;
    }
    const kind = b.kind[i] as number;
    const cap = capacityFor(kind, b.level[i] as number);
    if (kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh) {
      housingCapacity += cap;
      residents += residentsOf(b, i);
      adults += adultsOf(b, i);
      employed += employedOf(b, i);
      const base = i * COHORT_BLOCK + 2 * EDU_TIERS;
      educated += (b.cohorts[base + 2] as number) + (b.cohorts[base + 3] as number);
    } else if (kind === ZoneKind.commercialLow || kind === ZoneKind.commercialHigh) {
      jobsC += cap;
      countC++;
    } else if (kind === ZoneKind.industrial) {
      jobsI += cap;
      countI++;
    } else if (kind === ZoneKind.office) {
      jobsO += cap;
      countO++;
    }
  }
  return {
    housingCapacity,
    residents,
    jobsC,
    jobsI,
    jobsO,
    employed,
    adults,
    educatedPermille: adults === 0 ? 0 : Math.floor((educated * 1000) / adults),
    countC,
    countI,
    countO,
  };
}

export interface GrowthContext {
  readonly buildings: Buildings;
  readonly utilities: UtilityState;
  readonly zoneAt: (tileIdx: number) => number;
  readonly landAt: (tileIdx: number) => boolean;
  readonly nearRoad: (tileIdx: number) => boolean;
  readonly mapTiles: number;
  readonly rng: Pcg32;
  readonly flows: GrowthFlows;
  /** Tax rates (GDD §8 demand pressure); omitted = pre-economy default. */
  readonly taxRatesPermille?: Uint16Array;
}

/** Per-tick growth slice: spawn buildings on demand, move people in. */
export function growthSlice(
  ctx: GrowthContext,
  tick: number,
  agg = aggregates(ctx.buildings),
): void {
  const b = ctx.buildings;
  const demand = computeDemand(agg, ctx.taxRatesPermille);
  const slice = tick % GROWTH_SLICES;

  // 1. Spawn pass over this tick's share of tiles.
  for (let tileIdx = slice; tileIdx < ctx.mapTiles; tileIdx += GROWTH_SLICES) {
    const zone = ctx.zoneAt(tileIdx);
    if (zone === ZoneKind.none || b.byTile.has(tileIdx)) {
      continue;
    }
    if (!ctx.landAt(tileIdx) || !ctx.nearRoad(tileIdx)) {
      continue;
    }
    const sectorDemand =
      zone === ZoneKind.residentialLow || zone === ZoneKind.residentialHigh
        ? demand.r
        : zone === ZoneKind.commercialLow || zone === ZoneKind.commercialHigh
          ? demand.c
          : zone === ZoneKind.industrial
            ? demand.i
            : demand.o;
    if (sectorDemand <= 0) {
      continue;
    }
    // Spawn probability ∝ demand [TUNE]: permille roll per visit.
    if (ctx.rng.nextBounded(1000) < Math.min(400, sectorDemand)) {
      spawnBuilding(b, tileIdx, zone);
    }
  }

  // 2. Occupancy: immigration into vacant R, employment into vacant jobs.
  //    Gated on PULL factors (jobs + attractiveness), NOT net demand —
  //    vacancy throttles construction, never move-ins (a vacancy-gated
  //    inflow deadlocks the city the moment housing overshoots; the
  //    balance gate caught exactly that at pop 22) [TUNE].
  const pull = (demand.factors[0] as number) + (demand.factors[1] as number);
  if (pull > 0 && agg.housingCapacity > agg.residents) {
    const moves = 1 + (ctx.rng.nextBounded(3) | 0);
    for (let m = 0; m < moves; m++) {
      const target = pickVacantResidential(b, ctx.rng);
      if (target === -1) {
        break;
      }
      // A new adult household member arrives (edu E0–E2 weighted).
      const edu = [0, 0, 1, 1, 2][ctx.rng.nextBounded(5)] as number;
      const base = target * COHORT_BLOCK;
      b.cohorts[base + 2 * EDU_TIERS + edu] = (b.cohorts[base + 2 * EDU_TIERS + edu] as number) + 1;
      ctx.flows.immigrants++;
    }
  }
  employmentPass(b, ctx.rng, agg);
}

function pickVacantResidential(b: Buildings, rng: Pcg32): number {
  // Deterministic scan from a random start over the CANONICAL (tileIdx)
  // order — slot order is spawn history and desyncs after load.
  const order = aliveByTile(b);
  if (order.length === 0) {
    return -1;
  }
  const start = rng.nextBounded(order.length);
  for (let k = 0; k < order.length; k++) {
    const i = order[(start + k) % order.length] as number;
    if (b.alive[i] !== 1 || (b.status[i] as number) !== BuildingStatus.normal) {
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind !== ZoneKind.residentialLow && kind !== ZoneKind.residentialHigh) {
      continue;
    }
    if (residentsOf(b, i) < capacityFor(kind, b.level[i] as number)) {
      return i;
    }
  }
  return -1;
}

/** Move unemployed adults into open job slots (a trickle per tick) [TUNE]. */
function employmentPass(b: Buildings, rng: Pcg32, agg: ReturnType<typeof aggregates>): void {
  // One aggregate scan per tick serves spawn, immigration, AND hiring —
  // intra-tick staleness is deterministic and costs nothing semantically
  // (the per-tick trickles are tiny vs. the aggregate scale) [PERF: this
  // took the year-long balance run from 302 s to ~⅓].
  const openJobs = agg.jobsC + agg.jobsI + agg.jobsO - agg.employed;
  const unemployed = agg.adults - agg.employed;
  if (openJobs <= 0 || unemployed <= 0) {
    return;
  }
  const hires = Math.min(3, openJobs, unemployed);
  for (let h = 0; h < hires; h++) {
    const i = pickWithUnemployed(b, rng);
    if (i === -1) {
      return;
    }
    const base = i * COHORT_BLOCK;
    for (let e = 0; e < EDU_TIERS; e++) {
      const adultsE = b.cohorts[base + 2 * EDU_TIERS + e] as number;
      const employedE = b.cohorts[base + 16 + e] as number;
      if (adultsE > employedE) {
        b.cohorts[base + 16 + e] = employedE + 1;
        break;
      }
    }
  }
}

function pickWithUnemployed(b: Buildings, rng: Pcg32): number {
  const order = aliveByTile(b);
  if (order.length === 0) {
    return -1;
  }
  const start = rng.nextBounded(order.length);
  for (let k = 0; k < order.length; k++) {
    const i = order[(start + k) % order.length] as number;
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind !== ZoneKind.residentialLow && kind !== ZoneKind.residentialHigh) {
      continue;
    }
    if (adultsOf(b, i) > employedOf(b, i)) {
      return i;
    }
  }
  return -1;
}

/** Hourly lifecycle slice: status clocks, leveling, abandonment, births/aging.
 * Returns the tile indices of buildings abandoned THIS slice (advisor fuel). */
export function lifecycleSlice(
  ctx: GrowthContext,
  hourOfDay: number,
  tick: number,
  agg = aggregates(ctx.buildings),
): number[] {
  const newlyAbandoned: number[] = [];
  const totalJobs = agg.jobsC + agg.jobsI + agg.jobsO;
  // City job-fill ratio drives WORKPLACE leveling: a C/I/O building's own
  // cohort block is empty by design (workers LIVE in R buildings) — the
  // jam-diagnosis scenario found workplaces frozen at L1 forever.
  const jobFillPermille = totalJobs === 0 ? 0 : Math.floor((agg.employed * 1000) / totalJobs);
  const b = ctx.buildings;
  const slice = Math.floor(tick / TICKS_PER_HOUR) % LIFECYCLE_SLICES;
  // Stagger over the CANONICAL (tileIdx) order — slice membership by raw
  // slot would shuffle after a load and desync the rng stream's draws.
  const order = aliveByTile(b);
  for (let p = slice; p < order.length; p += LIFECYCLE_SLICES) {
    const i = order[p] as number;
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind >= PLOPPABLE_KIND_OFFSET) {
      continue;
    }
    const served = ctx.utilities.powered[i] === 1 && ctx.utilities.watered[i] === 1;
    const status = b.status[i] as number;

    // Fire states belong to the fire pass (phase-4 task 5) — lifecycle
    // must neither "cure" a burning building nor abandon a ruin.
    if (status === BuildingStatus.onFire || status === BuildingStatus.ruin) {
      continue;
    }

    if (status === BuildingStatus.abandoned) {
      b.failDays[i] = Math.min(255, (b.failDays[i] as number) + 1);
      if ((b.failDays[i] as number) >= DEMOLISH_AFTER_DAYS) {
        demolishBuilding(b, i);
      }
      continue;
    }

    if (!served) {
      b.status[i] =
        ctx.utilities.powered[i] !== 1 ? BuildingStatus.unpowered : BuildingStatus.unwatered;
      b.failDays[i] = Math.min(255, (b.failDays[i] as number) + 1);
      b.thriveDays[i] = 0;
      if ((b.failDays[i] as number) >= ABANDON_AFTER_DAYS) {
        // Residents flee an abandoned building (emigration flow).
        const fleeing = residentsOf(b, i);
        if (fleeing > 0) {
          b.cohorts.fill(0, i * COHORT_BLOCK, (i + 1) * COHORT_BLOCK);
          ctx.flows.emigrants += fleeing;
        }
        b.status[i] = BuildingStatus.abandoned;
        b.failDays[i] = 0;
        b.version++;
        newlyAbandoned.push(b.tileIdx[i] as number);
      }
      continue;
    }

    if (status !== BuildingStatus.normal) {
      b.status[i] = BuildingStatus.normal;
      b.failDays[i] = 0;
      b.version++;
    }

    // Thriving: high occupancy levels the building up [TUNE thresholds].
    const cap = capacityFor(kind, b.level[i] as number);
    const used =
      kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh
        ? residentsOf(b, i)
        : Math.floor((cap * jobFillPermille) / 1000);
    if (cap > 0 && used * 5 >= cap * 4) {
      b.thriveDays[i] = Math.min(255, (b.thriveDays[i] as number) + 1);
      if ((b.thriveDays[i] as number) >= LEVEL_AFTER_DAYS && (b.level[i] as number) < 5) {
        b.level[i] = (b.level[i] as number) + 1;
        b.thriveDays[i] = 0;
        b.version++;
      }
    } else {
      b.thriveDays[i] = 0;
    }

    // Births in residential at night hours [TUNE], one per slice visit max.
    if (
      (kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh) &&
      hourOfDay < 6 &&
      residentsOf(b, i) > 1 &&
      residentsOf(b, i) < capacityFor(kind, b.level[i] as number) &&
      ctx.rng.nextBounded(100) < 4
    ) {
      const base = i * COHORT_BLOCK;
      b.cohorts[base] = (b.cohorts[base] as number) + 1; // child E0
      ctx.flows.births++;
    }
  }
  return newlyAbandoned;
}
