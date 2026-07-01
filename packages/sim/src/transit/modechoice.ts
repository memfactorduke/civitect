/**
 * Transit mode-choice CORE (GDD §9, TDD §6.2, Phase 6 task 4a). Transit
 * competes with the CAR on the car margin: for a commute that would otherwise
 * drive, if a line serves the OD (a stop near the origin AND a different stop
 * near the destination), a share of the trips ride instead.
 *
 * ADR-005 determinism: everything is integer and float-free. The share is a
 * function of the cost RATIO cTransit/cCar (scale-invariant, so it needs no
 * absolute-unit calibration), read from a hardcoded SHARP step table — a mode
 * ≥ 1.8× the car cost gets 0 share, so an OD with no serving line (or an
 * uncompetitive one) is 100% car, exactly as before transit existed. That
 * keeps every transit-free city (all goldens) byte-identical.
 *
 * v1 model: in-vehicle time is proxied as a fraction of the CONGESTED car time
 * (so rising road congestion pulls riders onto transit — the C:S feedback);
 * task 4b routes stops on the twin for true free-flow time, and 4c books the
 * per-line fare/upkeep economics. Vehicle capacity is task 4b.
 */
import type { TransitState } from "./transit";

/** Stops within this Chebyshev cell distance of a cell are walkable to it. */
const CATCHMENT_CELLS = 1;
/** Transit in-vehicle time ≈ this permille of the congested car time. [TUNE] */
const INVEH_PERMILLE = 700;
/** Avg wait = half the headway; edgeCost units are travel-ticks × 1000. [TUNE] */
const WAIT_PER_HEADWAY_TICK = 500;
/** Access-walk penalty per catchment cell, in edgeCost units. [TUNE] */
const ACCESS_PER_CELL = 8000;

/** A line reduced to its stop cells + headway — enough for catchment + cost. */
export interface LineRoute {
  readonly lineIndex: number;
  readonly stopCX: Int32Array;
  readonly stopCY: Int32Array;
  readonly headwayTicks: number;
}

export interface TransitService {
  readonly routes: readonly LineRoute[];
}

/** Reduce the transit network to a cell-space service for one solve. Lines with
 *  fewer than two stops can't carry a trip and are dropped. */
export function buildTransitService(
  transit: TransitState,
  mapWidth: number,
  cellTiles: number,
): TransitService {
  const routes: LineRoute[] = [];
  for (let i = 0; i < transit.lines.length; i++) {
    const line = transit.lines[i];
    if (line === undefined || line.stops.length < 2) {
      continue;
    }
    const n = line.stops.length;
    const stopCX = new Int32Array(n);
    const stopCY = new Int32Array(n);
    for (let s = 0; s < n; s++) {
      const tile = line.stops[s] as number;
      stopCX[s] = Math.floor((tile % mapWidth) / cellTiles);
      stopCY[s] = Math.floor(Math.floor(tile / mapWidth) / cellTiles);
    }
    routes.push({ lineIndex: i, stopCX, stopCY, headwayTicks: line.headwayTicks });
  }
  return { routes };
}

/** Min Chebyshev cell walk from any of the route's stops to (cx,cy), or -1 if
 *  no stop is within catchment. */
function nearestStopWalk(route: LineRoute, cx: number, cy: number): number {
  let best = -1;
  for (let s = 0; s < route.stopCX.length; s++) {
    const d = Math.max(
      Math.abs((route.stopCX[s] as number) - cx),
      Math.abs((route.stopCY[s] as number) - cy),
    );
    if (d <= CATCHMENT_CELLS && (best === -1 || d < best)) {
      best = d;
    }
  }
  return best;
}

/**
 * Best transit generalized cost for an OD (cells), or null if no line serves
 * it. Deterministic: min cost, ties broken by lowest lineIndex. cCar is the
 * congested car time for the OD (same integer unit as the returned cost).
 */
export function transitCostFor(
  service: TransitService,
  ocx: number,
  ocy: number,
  dcx: number,
  dcy: number,
  cCar: number,
): { lineIndex: number; cost: number } | null {
  let best: { lineIndex: number; cost: number } | null = null;
  for (const route of service.routes) {
    const board = nearestStopWalk(route, ocx, ocy);
    if (board === -1) {
      continue;
    }
    const alight = nearestStopWalk(route, dcx, dcy);
    if (alight === -1) {
      continue;
    }
    const inVeh = Math.floor((cCar * INVEH_PERMILLE) / 1000);
    const wait = route.headwayTicks * WAIT_PER_HEADWAY_TICK;
    const access = (board + alight) * ACCESS_PER_CELL;
    const cost = inVeh + wait + access;
    if (
      best === null ||
      cost < best.cost ||
      (cost === best.cost && route.lineIndex < best.lineIndex)
    ) {
      best = { lineIndex: route.lineIndex, cost };
    }
  }
  return best;
}

/**
 * Transit mode share (permille of the car+transit trips) as a SHARP step
 * function of the cost ratio cTransit/cCar (permille). A discretized logit
 * S-curve; 0 beyond 1.8× keeps uncompetitive/served-nowhere ODs all-car. [TUNE]
 */
export function transitShareFromRatio(ratioPermille: number): number {
  if (ratioPermille <= 400) return 850;
  if (ratioPermille <= 600) return 720;
  if (ratioPermille <= 800) return 560;
  if (ratioPermille <= 1000) return 400;
  if (ratioPermille <= 1200) return 250;
  if (ratioPermille <= 1500) return 120;
  if (ratioPermille <= 1800) return 40;
  return 0;
}

/** Number of an OD's trips that choose transit (floor split — exact over the
 *  two modes; the complement drives). */
export function transitSplit(trips: number, cCar: number, cTransit: number): number {
  const ratio = cCar === 0 ? 4000 : Math.floor((cTransit * 1000) / cCar);
  return Math.floor((trips * transitShareFromRatio(ratio)) / 1000);
}

// ── economics (task 4c) ──────────────────────────────────────────────────────
/** Fare per boarding, cents, by TransitMode (1..7; [0] unused). [TUNE] */
const FARE_CENTS: readonly number[] = [0, 1_50, 1_75, 2_50, 3_00, 4_00, 3_50, 15_00];
/** Monthly upkeep per vehicle, cents, by TransitMode. [TUNE] */
const UPKEEP_CENTS_PER_VEHICLE: readonly number[] = [
  0, 800_00, 1_500_00, 4_000_00, 5_000_00, 3_000_00, 2_500_00, 20_000_00,
];

export function fareCentsFor(mode: number): number {
  return FARE_CENTS[mode] ?? FARE_CENTS[1] ?? 1_50;
}
export function upkeepCentsFor(mode: number): number {
  return UPKEEP_CENTS_PER_VEHICLE[mode] ?? UPKEEP_CENTS_PER_VEHICLE[1] ?? 800_00;
}

/** Cell fields the attribution needs (a subset of the traffic Cell). */
interface DemandCell {
  readonly cx: number;
  readonly cy: number;
  readonly workers: number;
  readonly jobs: number;
}

/**
 * Attribute a solve's total transit ridership to lines by SERVED-DEMAND WEIGHT
 * (each line's covered worker+job mass) — cheap (no routing) and deterministic,
 * split by largest-remainder so Σ = totalRidden exactly. Returns per-lineIndex
 * rider counts. Coarser than a per-OD split, but the right fidelity for fares.
 */
export function attributeRidership(
  service: TransitService,
  cells: readonly DemandCell[],
  totalRidden: number,
): Map<number, number> {
  const out = new Map<number, number>();
  if (totalRidden <= 0 || service.routes.length === 0) {
    return out;
  }
  let totalWeight = 0;
  const weights = service.routes.map((route) => {
    let weight = 0;
    for (const cell of cells) {
      if (nearestStopWalk(route, cell.cx, cell.cy) !== -1) {
        weight += cell.workers + cell.jobs;
      }
    }
    totalWeight += weight;
    return { lineIndex: route.lineIndex, weight };
  });
  if (totalWeight === 0) {
    return out;
  }
  let allocated = 0;
  const shares = weights.map((w) => {
    const exact = totalRidden * w.weight;
    const base = Math.floor(exact / totalWeight);
    allocated += base;
    return { lineIndex: w.lineIndex, base, rem: exact % totalWeight };
  });
  shares.sort((a, b) => b.rem - a.rem || a.lineIndex - b.lineIndex);
  for (let k = 0; k < totalRidden - allocated && k < shares.length; k++) {
    (shares[k] as { base: number }).base++;
  }
  for (const s of shares) {
    if (s.base > 0) {
      out.set(s.lineIndex, s.base);
    }
  }
  return out;
}
