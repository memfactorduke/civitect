/**
 * Districts (GDD §11, board phase-6 task 1 interface; aggregation + policy
 * effects land in tasks 2/3). The per-TILE district id lives in the terrain
 * district layer (id 0 = none, 1–63 a district); THIS is the per-district
 * metadata policies and tax overrides hang off — CANONICAL, hashed, saved
 * (v10 DISTRICTS). All integer/string, no RNG.
 */
const ZONE_COUNT = 6;

export interface District {
  name: string;
  /** Policy bits set for this district (effects land with task 3). */
  policyMask: number;
  /** Per-zone tax override permille (0 = inherit the city rate). */
  readonly taxOverridePermille: Uint16Array;
}

export interface DistrictState {
  /** rows[i] is district id (i+1); index 0 = district 1. */
  rows: District[];
  /** City-wide ordinance bits (the globally-applied policy subset). */
  ordinanceMask: number;
}

export function createDistricts(): DistrictState {
  return { rows: [], ordinanceMask: 0 };
}

/** Grow the rows so district `id` (1–63) exists, defaulting new ones. */
export function ensureDistrict(d: DistrictState, id: number): void {
  while (d.rows.length < id) {
    d.rows.push({
      name: `District ${d.rows.length + 1}`,
      policyMask: 0,
      taxOverridePermille: new Uint16Array(ZONE_COUNT),
    });
  }
}

/** Does district `id` (or the city, id 0) have policy/ordinance bit set? */
export function hasPolicy(d: DistrictState, districtId: number, bit: number): boolean {
  if (districtId === 0) {
    return ((d.ordinanceMask >>> bit) & 1) === 1;
  }
  const row = d.rows[districtId - 1];
  return row !== undefined && ((row.policyMask >>> bit) & 1) === 1;
}
