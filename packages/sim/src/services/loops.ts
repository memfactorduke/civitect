/**
 * Service loops (GDD §7, board phase-4 task 3): garbage, health/sickness,
 * deathcare and the education pipeline, as one staggered hourly slice over
 * buildings in CANONICAL (aliveByTile) order — slot order is construction
 * history and desyncs the rng.services stream after a load (the Phase 2/3
 * lesson, baked in from day one here).
 *
 * Capacity model: each service's daily city capacity derives from its
 * buildings × budget; every hourly slice spends that day's 1/24 bucket on
 * the buildings it visits, in canonical order. Oversubscription IS the
 * queue: later buildings in the slice go unserved — GDD §7's
 * "coverage × capacity-fill" with the fill emerging from real shortfall.
 *
 * Effectiveness gates on the coverage field (network distance, task 2):
 * no coverage ⇒ no service, weak coverage ⇒ scaled-down service. Routine
 * rounds (garbage, hearses) run on planned free-flow coverage; EMERGENCY
 * dispatch on the live congested field is the fire loop (task 5), where
 * "the truck is late because of the jam" is the exit criterion.
 *
 * RNG discipline (ADR-005): draws happen ONLY per eligible entity (an R
 * building with residents) — never unconditionally — so worlds with no
 * eligible entities consume nothing and replay/undo identities hold.
 */
import { BuildingKind, ServiceId, ZoneKind } from "@civitect/protocol";
import {
  aliveByTile,
  type Buildings,
  COHORT_BLOCK,
  EDU_TIERS,
  PLOPPABLE_KIND_OFFSET,
  residentsOf,
} from "../growth/buildings";
import type { Pcg32 } from "../rng";
import { GROUND_PER_INDUSTRY_DAY, GROUND_PER_LANDFILL_10K_DAY } from "./pollution";
import { scaledCapacity, specForTableKind } from "./registry";

export const SERVICE_SLICES = 24; // one visit per building per game-day

// ── rates, all [TUNE] ───────────────────────────────────────────────────────
/** Garbage units generated per building per day, by zone kind × level. */
export function garbagePerDay(kind: number, level: number): number {
  if (kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh) {
    return 2 * level;
  }
  if (kind === ZoneKind.commercialLow || kind === ZoneKind.commercialHigh) {
    return 3 * level;
  }
  if (kind === ZoneKind.industrial) {
    return 5 * level;
  }
  if (kind === ZoneKind.office) {
    return 2 * level;
  }
  return 0; // ploppables generate none (v1)
}

/** Units one garbage vehicle clears per day. */
export const TRUCK_CLEAR_PER_DAY = 600;
/** Stock above this blocks leveling (thriveDays reset); 2× draws an advisor. */
export const GARBAGE_TOLERANCE = 200;
/** New sickness per day, permille of residents (pollution multiplies, task 4). */
export const BASE_SICK_PERMILLE = 2;
/**
 * Untreated sick who shake it off per day, permille of the sick. Without
 * recovery the sick pool only grows and an unserviced town HALVES in a
 * year (found by the balance gate: pop 39.9k → 19.3k); with it, steady-
 * state sickness ≈ 2% of residents and unserviced decline ≈ 11%/year —
 * pressure, not annihilation.
 */
export const NATURAL_RECOVERY_PERMILLE = 100;
/** Sick residents dying per day, permille of the (still-)sick. */
export const SICK_MORTALITY_PERMILLE = 20;
/** Corpses one hearse clears per day. */
export const CORPSES_PER_HEARSE_PER_DAY = 8;
/** A school seat graduates one student every EDUCATION_DAYS. */
export const EDUCATION_DAYS = 30;
/** Neglect effects (garbage/corpse leveling block) start at this level. */
export const NEGLECT_MIN_LEVEL = 2;

/** Diagnostics ledger (GrowthFlows pattern) — monotone counters, NOT hashed. */
export interface ServiceFlows {
  garbageGenerated: number;
  garbageCleared: number;
  sickened: number;
  treated: number;
  deaths: number;
  corpsesCleared: number;
  buried: number;
  cremated: number;
  promotedE1: number;
  promotedE2: number;
  promotedE3: number;
}

export function emptyServiceFlows(): ServiceFlows {
  return {
    garbageGenerated: 0,
    garbageCleared: 0,
    sickened: 0,
    treated: 0,
    deaths: 0,
    corpsesCleared: 0,
    buried: 0,
    cremated: 0,
    promotedE1: 0,
    promotedE2: 0,
    promotedE3: 0,
  };
}

/**
 * This slice's share of a daily quota: remainder-first buckets, rotated by
 * day. Buildings live in FIXED slices (canonical-order position), so a
 * static bucket layout would starve whoever sits where the remainder
 * never lands (a 16-hearse day gave slice 0 nothing, forever). Rotation
 * moves the remainder units around the clock day by day — deterministic,
 * sums to `daily` exactly.
 */
export function sliceShare(daily: number, slice: number, day = 0): number {
  const rotated = (slice + day) % SERVICE_SLICES;
  return Math.floor(daily / SERVICE_SLICES) + (rotated < daily % SERVICE_SLICES ? 1 : 0);
}

export interface ServicesContext {
  readonly buildings: Buildings;
  readonly budgetsPermille: Uint16Array;
  /** coverage(service) — 0–255 per tile, the task-2 fenced field. */
  readonly coverageAt: (service: ServiceId, tileIdx: number) => number;
  /**
   * Extra sickness pressure at a tile, permille/day, from pollution
   * (task 4): air + ground + the pump-crisis multiplier. 0 pre-pollution.
   */
  readonly extraSickPermille: (tileIdx: number) => number;
  /** CANONICAL ground-pollution field — industry/landfill accrual target. */
  readonly groundPollution: Uint8Array;
  readonly rng: Pcg32;
  readonly flows: ServiceFlows;
  /** Advisor sink — at most a handful per slice, each with a cause chain. */
  readonly emit: (
    messageKey: string,
    summaryKey: string,
    subjectTile: number,
    weightPermille: number,
  ) => void;
}

/** Daily city capacity of one service, in its unit, after budget sliders. */
function dailyCapacity(ctx: ServicesContext, service: ServiceId, perVehicle: number): number {
  const b = ctx.buildings;
  const budget = ctx.budgetsPermille[service - 1] as number;
  let total = 0;
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const spec = specForTableKind(b.kind[i] as number);
    if (spec === null || spec.service !== service) {
      continue;
    }
    total += scaledCapacity(spec, budget) * perVehicle;
  }
  return total;
}

/** Education seats per tier (elementary / high / university), budget-scaled. */
function seatTiers(ctx: ServicesContext): [number, number, number] {
  const b = ctx.buildings;
  const budget = ctx.budgetsPermille[ServiceId.education - 1] as number;
  const tiers: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < b.count; i++) {
    if (b.alive[i] !== 1) {
      continue;
    }
    const spec = specForTableKind(b.kind[i] as number);
    if (spec === null || spec.service !== ServiceId.education) {
      continue;
    }
    const kind = (b.kind[i] as number) - PLOPPABLE_KIND_OFFSET;
    if (kind === BuildingKind.schoolElementary) {
      tiers[0] += scaledCapacity(spec, budget);
    } else if (kind === BuildingKind.schoolHigh) {
      tiers[1] += scaledCapacity(spec, budget);
    } else if (kind === BuildingKind.university) {
      tiers[2] += scaledCapacity(spec, budget);
    }
  }
  return tiers;
}

/** Stock sinks in canonical order: landfills+cemeteries; crematorium flag. */
function stockSinks(b: Buildings): {
  landfills: number[];
  cemeteries: number[];
  hasCrematorium: boolean;
} {
  const landfills: number[] = [];
  const cemeteries: number[] = [];
  let hasCrematorium = false;
  for (const i of aliveByTile(b)) {
    const kind = (b.kind[i] as number) - PLOPPABLE_KIND_OFFSET;
    if (kind === BuildingKind.landfill) {
      landfills.push(i);
    } else if (kind === BuildingKind.cemetery) {
      cemeteries.push(i);
    } else if (kind === BuildingKind.crematorium) {
      hasCrematorium = true;
    }
  }
  return { landfills, cemeteries, hasCrematorium };
}

/**
 * Remove `count` residents from a building's cohorts in a fixed canonical
 * order (senior → adult → teen → child, E3 → E0 within each), keeping the
 * employed[edu] ≤ adults[edu] invariant intact. Returns actually removed.
 */
function removeResidents(b: Buildings, building: number, count: number): number {
  const base = building * COHORT_BLOCK;
  let left = count;
  for (let age = 3; age >= 0 && left > 0; age--) {
    for (let edu = EDU_TIERS - 1; edu >= 0 && left > 0; edu--) {
      const at = base + age * EDU_TIERS + edu;
      const have = b.cohorts[at] as number;
      if (have === 0) {
        continue;
      }
      const take = Math.min(have, left);
      b.cohorts[at] = have - take;
      left -= take;
      if (age === 2) {
        // Dead adults release their job slots (employed ≤ adults).
        const adultsLeft = b.cohorts[at] as number;
        const empAt = base + 16 + edu;
        if ((b.cohorts[empAt] as number) > adultsLeft) {
          b.cohorts[empAt] = adultsLeft;
        }
      }
    }
  }
  return count - left;
}

/** Promote up to `quota` residents of `age` band from `fromEdu` to +1. */
function promote(
  b: Buildings,
  building: number,
  age: number,
  fromEdu: number,
  quota: number,
): number {
  if (quota <= 0) {
    return 0;
  }
  const base = building * COHORT_BLOCK;
  const at = base + age * EDU_TIERS + fromEdu;
  const have = b.cohorts[at] as number;
  const take = Math.min(have, quota);
  if (take === 0) {
    return 0;
  }
  b.cohorts[at] = have - take;
  b.cohorts[at + 1] = (b.cohorts[at + 1] as number) + take;
  if (age === 2) {
    // Promoted adults keep jobs only up to the new tier split — migrate
    // employment counts conservatively (employed ≤ adults per tier).
    const empAt = base + 16 + fromEdu;
    const adultsLeft = b.cohorts[at] as number;
    if ((b.cohorts[empAt] as number) > adultsLeft) {
      const spill = (b.cohorts[empAt] as number) - adultsLeft;
      b.cohorts[empAt] = adultsLeft;
      b.cohorts[empAt + 1] = (b.cohorts[empAt + 1] as number) + spill;
    }
  }
  return take;
}

/**
 * One hourly services slice (1/24 of buildings, canonical order). Returns
 * nothing; effects land in the buildings table, the flows ledger and the
 * advisor sink. Caller owns scheduling (the TDD §4 services slot).
 */
export function servicesSlice(ctx: ServicesContext, tick: number): void {
  const b = ctx.buildings;
  const order = aliveByTile(b);
  if (order.length === 0) {
    return;
  }
  const slice = Math.floor(tick / 60) % SERVICE_SLICES;
  const day = Math.floor(tick / 1440);

  // This slice's budgets from daily city capacities (derived, canonical).
  let garbageBudget = sliceShare(
    dailyCapacity(ctx, ServiceId.garbage, TRUCK_CLEAR_PER_DAY),
    slice,
    day,
  );
  let treatBudget = sliceShare(dailyCapacity(ctx, ServiceId.health, 1), slice, day);
  let hearseBudget = sliceShare(
    dailyCapacity(ctx, ServiceId.deathcare, CORPSES_PER_HEARSE_PER_DAY),
    slice,
    day,
  );
  const seats = seatTiers(ctx);
  let elemQuota = sliceShare(Math.floor(seats[0] / EDUCATION_DAYS), slice, day);
  let highQuota = sliceShare(Math.floor(seats[1] / EDUCATION_DAYS), slice, day);
  let uniQuota = sliceShare(Math.floor(seats[2] / EDUCATION_DAYS), slice, day);
  const sinks = stockSinks(b);

  let advisorsThisSlice = 0;
  const advise = (messageKey: string, summaryKey: string, tile: number, weight: number): void => {
    if (advisorsThisSlice < 2) {
      advisorsThisSlice++;
      ctx.emit(messageKey, summaryKey, tile, weight);
    }
  };

  for (let p = slice; p < order.length; p += SERVICE_SLICES) {
    const i = order[p] as number;
    if (b.alive[i] !== 1) {
      continue;
    }
    const kind = b.kind[i] as number;
    if (kind >= PLOPPABLE_KIND_OFFSET) {
      // Landfills leach into the ground as they fill (GDD §10).
      if (kind - PLOPPABLE_KIND_OFFSET === BuildingKind.landfill) {
        const leach = Math.floor(((b.stock[i] as number) * GROUND_PER_LANDFILL_10K_DAY) / 10_000);
        if (leach > 0) {
          const at = b.tileIdx[i] as number;
          ctx.groundPollution[at] = Math.min(255, (ctx.groundPollution[at] as number) + leach);
        }
      }
      continue; // service/utility buildings neither rot nor sicken (v1)
    }
    const tile = b.tileIdx[i] as number;
    // Industry stains its ground daily — the persistent legacy field.
    if (kind === ZoneKind.industrial) {
      ctx.groundPollution[tile] = Math.min(
        255,
        (ctx.groundPollution[tile] as number) + GROUND_PER_INDUSTRY_DAY,
      );
    }

    // ── garbage: daily accrual, then collection from the slice budget ──
    const gen = garbagePerDay(kind, b.level[i] as number);
    if (gen > 0) {
      b.stock[i] = (b.stock[i] as number) + gen;
      ctx.flows.garbageGenerated += gen;
    }
    const stock = b.stock[i] as number;
    if (stock > 0) {
      const cov = ctx.coverageAt(ServiceId.garbage, tile);
      if (cov > 0 && garbageBudget > 0) {
        const cleared = Math.min(stock, Math.ceil((garbageBudget * cov) / 255));
        b.stock[i] = stock - cleared;
        garbageBudget -= cleared;
        ctx.flows.garbageCleared += cleared;
        // Cleared units fill the first landfill with space (canonical
        // order); the remainder burns/recycles without fill — incinerator
        // capacity is already inside the city budget.
        let toStore = cleared;
        for (const f of sinks.landfills) {
          if (toStore === 0) {
            break;
          }
          const spec = specForTableKind(b.kind[f] as number);
          const space = (spec === null ? 0 : spec.stockCap) - (b.stock[f] as number);
          if (space <= 0) {
            continue;
          }
          const put = Math.min(space, toStore);
          b.stock[f] = (b.stock[f] as number) + put;
          toStore -= put;
        }
      } else if (stock > 2 * GARBAGE_TOLERANCE) {
        advise(
          "advisor.garbage",
          cov === 0 ? "cause.noGarbageService" : "cause.garbageCapacityShort",
          tile,
          Math.min(1000, Math.floor((stock * 1000) / (4 * GARBAGE_TOLERANCE))),
        );
      }
    }

    const isResidential = kind === ZoneKind.residentialLow || kind === ZoneKind.residentialHigh;
    if (isResidential) {
      const residents = residentsOf(b, i);
      if (residents > 0) {
        // ── sickness: base urban rate + pollution pressure (GDD §10) ──
        const rate = BASE_SICK_PERMILLE + ctx.extraSickPermille(tile);
        const expected = residents * rate;
        let sickInc = Math.floor(expected / 1000);
        if (ctx.rng.nextBounded(1000) < expected % 1000) {
          sickInc++;
        }
        if (sickInc > 0) {
          const headroom = residents - (b.sick[i] as number);
          sickInc = Math.min(sickInc, Math.max(0, headroom));
          b.sick[i] = (b.sick[i] as number) + sickInc;
          ctx.flows.sickened += sickInc;
        }
        // ── treatment: coverage-gated share of the health budget ──
        const sick = b.sick[i] as number;
        if (sick > 0) {
          const cov = ctx.coverageAt(ServiceId.health, tile);
          if (cov > 0 && treatBudget > 0) {
            const treated = Math.min(sick, Math.ceil((treatBudget * cov) / 255));
            b.sick[i] = sick - treated;
            treatBudget -= treated;
            ctx.flows.treated += treated;
          } else if (sick * 4 > residents) {
            advise(
              "advisor.health",
              cov === 0 ? "cause.noHealthcare" : "cause.healthCapacityShort",
              tile,
              Math.min(1000, Math.floor((sick * 1000) / residents)),
            );
          }
        }
        // ── natural recovery: most untreated sickness passes [TUNE] ──
        const afterTreatment = b.sick[i] as number;
        if (afterTreatment > 0) {
          const rexp = afterTreatment * NATURAL_RECOVERY_PERMILLE;
          let recovered = Math.floor(rexp / 1000);
          if (ctx.rng.nextBounded(1000) < rexp % 1000) {
            recovered++;
          }
          b.sick[i] = afterTreatment - Math.min(afterTreatment, recovered);
        }
        // ── mortality: the (still-)sick die untreated [TUNE] ──
        const stillSick = b.sick[i] as number;
        if (stillSick > 0) {
          const dexp = stillSick * SICK_MORTALITY_PERMILLE;
          let deaths = Math.floor(dexp / 1000);
          if (ctx.rng.nextBounded(1000) < dexp % 1000) {
            deaths++;
          }
          if (deaths > 0) {
            const removed = removeResidents(b, i, deaths);
            b.sick[i] = Math.max(0, stillSick - removed);
            b.corpses[i] = (b.corpses[i] as number) + removed;
            ctx.flows.deaths += removed;
          }
        }
      }
      // ── deathcare: hearses clear corpses into graves/cremation ──
      const corpses = b.corpses[i] as number;
      if (corpses > 0) {
        const cov = ctx.coverageAt(ServiceId.deathcare, tile);
        if (cov > 0 && hearseBudget > 0) {
          let cleared = Math.min(corpses, Math.ceil((hearseBudget * cov) / 255));
          hearseBudget -= cleared;
          // Graves first (canonical cemetery order), cremation absorbs
          // the rest if a crematorium exists, else the hearse waits.
          let done = 0;
          for (const c of sinks.cemeteries) {
            if (cleared === 0) {
              break;
            }
            const spec = specForTableKind(b.kind[c] as number);
            const space = (spec === null ? 0 : spec.stockCap) - (b.stock[c] as number);
            if (space <= 0) {
              continue;
            }
            const put = Math.min(space, cleared);
            b.stock[c] = (b.stock[c] as number) + put;
            ctx.flows.buried += put;
            cleared -= put;
            done += put;
          }
          if (cleared > 0 && sinks.hasCrematorium) {
            ctx.flows.cremated += cleared;
            done += cleared;
            cleared = 0;
          }
          b.corpses[i] = corpses - done;
          ctx.flows.corpsesCleared += done;
          if (done < corpses && !sinks.hasCrematorium) {
            advise("advisor.deathcare", "cause.cemeteriesFull", tile, 1000);
          }
        } else {
          advise(
            "advisor.deathcare",
            cov === 0 ? "cause.noDeathcare" : "cause.deathcareCapacityShort",
            tile,
            Math.min(1000, corpses * 250),
          );
        }
      }
      // ── education pipeline: seats gate tier progression (GDD §8) ──
      if (ctx.coverageAt(ServiceId.education, tile) > 0) {
        const tookE1 = promote(b, i, 0, 0, elemQuota); // children E0→E1
        elemQuota -= tookE1;
        ctx.flows.promotedE1 += tookE1;
        const tookE2 = promote(b, i, 1, 1, highQuota); // teens E1→E2
        highQuota -= tookE2;
        ctx.flows.promotedE2 += tookE2;
        const tookE3 = promote(b, i, 2, 2, uniQuota); // adults E2→E3
        uniQuota -= tookE3;
        ctx.flows.promotedE3 += tookE3;
      }
    }

    // ── neglect gates leveling: garbage piles or corpses freeze thriving
    //    (level ≥ NEGLECT_MIN_LEVEL — young buildings get grace) ──
    if (
      (b.level[i] as number) >= NEGLECT_MIN_LEVEL &&
      ((b.stock[i] as number) > GARBAGE_TOLERANCE || (b.corpses[i] as number) > 0)
    ) {
      b.thriveDays[i] = 0;
    }
  }
}
