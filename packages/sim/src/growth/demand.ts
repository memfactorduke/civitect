/**
 * RCIO demand from first principles (GDD §6 [LOCKED]: factors, not a
 * mystery meter). Pure integer math over city aggregates; every sector's
 * net demand IS exactly the sum of its three factors — the demand panel
 * proves it with a property test (Phase 2 exit criterion 3). No clamping
 * anywhere on this path: a clamp would break the sum and lie to the panel.
 *
 * Factor magnitudes are [TUNE]; goods-supply (C) and export (I) terms are
 * honest zeros until the Phase 5 goods chain.
 */
import type { DemandBlock } from "@civitect/protocol";

export interface CityAggregates {
  readonly housingCapacity: number;
  readonly residents: number;
  readonly jobsC: number;
  readonly jobsI: number;
  readonly jobsO: number;
  readonly employed: number;
  readonly adults: number;
  /** Educated (E2+) share of adults, permille. */
  readonly educatedPermille: number;
  readonly countC: number;
  readonly countI: number;
  readonly countO: number;
}

/**
 * Vacancy pressure as a NEGATIVE factor [TUNE]. Scales with ABSOLUTE empty
 * units, not the ratio — a single half-empty pioneer building must not
 * strangle a newborn city (ratio-based vacancy deadlocked growth at two
 * residents; the growth test caught it).
 */
function vacancy(capacity: number, used: number): number {
  const pressure = Math.min(500, Math.max(0, capacity - used) * 10);
  return pressure === 0 ? 0 : -pressure; // never emit -0 (wire/equality hygiene)
}

/**
 * Tax pressure on a sector's lead factor (GDD §8: >12% suppresses
 * progressively, <7% stimulates). Permille of deviation from the 9%
 * default, scaled [TUNE]; folded INTO existing factors so the panel's
 * factors-sum-exactly property keeps holding without a wire change.
 */
function taxPressure(ratePermille: number): number {
  if (ratePermille > 120) {
    return -Math.floor((ratePermille - 120) / 2);
  }
  if (ratePermille < 70) {
    return Math.floor((70 - ratePermille) / 2);
  }
  return 0;
}

export function computeDemand(
  a: CityAggregates,
  /** Tax rates permille per ZoneKind 1–6; omitted = pre-economy default. */
  taxRatesPermille?: Uint16Array,
): DemandBlock {
  const taxR = taxPressure(taxRatesPermille?.[0] ?? 90) + taxPressure(taxRatesPermille?.[1] ?? 90);
  const taxC = taxPressure(taxRatesPermille?.[2] ?? 90) + taxPressure(taxRatesPermille?.[3] ?? 90);
  const taxI = taxPressure(taxRatesPermille?.[4] ?? 90);
  const taxO = taxPressure(taxRatesPermille?.[5] ?? 90);
  const openJobs = Math.max(0, a.jobsC + a.jobsI + a.jobsO - a.employed);
  const unemployedAdults = Math.max(0, a.adults - a.employed);

  const rJobs = Math.min(500, openJobs * 2);
  // Attractiveness sinks with unemployment — a jobless city stops pulling
  // people in (the balance gate caught a 24k-pop/88%-unemployment spiral
  // when this was a constant) [TUNE].
  const unemploymentPermille =
    a.adults === 0 ? 0 : Math.floor((unemployedAdults * 1000) / a.adults);
  const rAttract =
    (a.residents === 0 ? 300 : Math.max(-300, 100 - Math.floor(unemploymentPermille / 3))) + taxR;
  const rVacancy = vacancy(a.housingCapacity, a.residents);

  const cPurchasing = Math.min(500, Math.floor(a.residents / 4)) + taxC;
  const cSupply = 0; // goods chain lands in Phase 5 — honest zero
  const cVacancy = vacancy(a.jobsC, Math.min(a.jobsC, a.employed));

  const iOrders = Math.min(400, a.countC * 30) + taxI;
  const iWorkforce = Math.min(300, unemployedAdults);
  const iVacancy = vacancy(a.jobsI, Math.min(a.jobsI, a.employed));

  const oEducated = Math.floor(a.educatedPermille / 4);
  const oAdmin = Math.min(300, (a.countC + a.countI) * 10) + taxO;
  const oVacancy = vacancy(a.jobsO, Math.min(a.jobsO, a.employed));

  return {
    r: rJobs + rAttract + rVacancy,
    c: cPurchasing + cSupply + cVacancy,
    i: iOrders + iWorkforce + iVacancy,
    o: oEducated + oAdmin + oVacancy,
    // Fixed wire order: [R×3, C×3, I×3, O×3].
    factors: [
      rJobs,
      rAttract,
      rVacancy,
      cPurchasing,
      cSupply,
      cVacancy,
      iOrders,
      iWorkforce,
      iVacancy,
      oEducated,
      oAdmin,
      oVacancy,
    ],
  };
}
