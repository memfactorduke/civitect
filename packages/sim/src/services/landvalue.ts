/**
 * Land value v1 (GDD §6 desirability field, board phase-5 task 1): the
 * per-tile weighted sum that Phase 5 taxes multiply against —
 *
 *   base + service coverages (parks/education/police/health/telecom)
 *        + water view − air − ground − noise, clamped to 0–255.
 *
 * DERIVED, like every Phase 4 field: a pure function of canonical state,
 * cache-fenced, content-digested for the wire. It deliberately reuses the
 * coverage/pollution spot-read substrates so its fence is exactly the
 * union of theirs. All weights [TUNE].
 */
import { ServiceId } from "@civitect/protocol";
import { fnv1a64 } from "../hash";

export const LAND_VALUE_BASE = 50;
/** Coverage contributions, as shifts of the 0–255 coverage value. */
export const LV_PARKS_SHIFT = 2; // +coverage/4
export const LV_EDUCATION_SHIFT = 3; // +coverage/8
export const LV_POLICE_SHIFT = 3;
export const LV_HEALTH_SHIFT = 3;
export const LV_TELECOM_SHIFT = 4; // +coverage/16
/** Pollution penalties, as shifts of the 0–255 field values. */
export const LV_AIR_SHIFT = 1; // −air/2
export const LV_GROUND_SHIFT = 1;
export const LV_NOISE_SHIFT = 2; // −noise/4 (traffic noise included)
/** Flat bonus for water within Chebyshev 2 (GDD §6 "water view +"). */
export const LV_WATER_VIEW = 30;
export const WATER_VIEW_REACH = 2;

export interface LandValueInputs {
  readonly coverageAt: (service: ServiceId, tileIdx: number) => number;
  readonly airAt: (tileIdx: number) => number;
  readonly groundAt: (tileIdx: number) => number;
  readonly noiseAt: (tileIdx: number) => number;
  readonly waterLayer: Uint16Array;
  readonly mapWidth: number;
  readonly mapHeight: number;
}

/** Land value at ONE tile — the spot-read primitive (taxes, inspector). */
export function landValueAt(inputs: LandValueInputs, tileIdx: number): number {
  const x = tileIdx % inputs.mapWidth;
  const y = Math.floor(tileIdx / inputs.mapWidth);
  let value = LAND_VALUE_BASE;
  value += inputs.coverageAt(ServiceId.parks, tileIdx) >> LV_PARKS_SHIFT;
  value += inputs.coverageAt(ServiceId.education, tileIdx) >> LV_EDUCATION_SHIFT;
  value += inputs.coverageAt(ServiceId.police, tileIdx) >> LV_POLICE_SHIFT;
  value += inputs.coverageAt(ServiceId.health, tileIdx) >> LV_HEALTH_SHIFT;
  value += inputs.coverageAt(ServiceId.telecom, tileIdx) >> LV_TELECOM_SHIFT;
  value -= inputs.airAt(tileIdx) >> LV_AIR_SHIFT;
  value -= inputs.groundAt(tileIdx) >> LV_GROUND_SHIFT;
  value -= inputs.noiseAt(tileIdx) >> LV_NOISE_SHIFT;
  if (hasWaterView(inputs, x, y)) {
    value += LV_WATER_VIEW;
  }
  return Math.max(0, Math.min(255, value));
}

function hasWaterView(inputs: LandValueInputs, x: number, y: number): boolean {
  for (let dy = -WATER_VIEW_REACH; dy <= WATER_VIEW_REACH; dy++) {
    const ny = y + dy;
    if (ny < 0 || ny >= inputs.mapHeight) {
      continue;
    }
    for (let dx = -WATER_VIEW_REACH; dx <= WATER_VIEW_REACH; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= inputs.mapWidth) {
        continue;
      }
      if ((inputs.waterLayer[ny * inputs.mapWidth + nx] as number) !== 0) {
        return true;
      }
    }
  }
  return false;
}

/** The full field — overlay + property-test surface. */
export function computeLandValueField(inputs: LandValueInputs): Uint8Array {
  const out = new Uint8Array(inputs.mapWidth * inputs.mapHeight);
  for (let idx = 0; idx < out.length; idx++) {
    out[idx] = landValueAt(inputs, idx);
  }
  return out;
}

/** Fence-keyed cache (coverage-cache pattern; digest for the wire). */
export interface LandValueCache {
  fenceKey: string;
  field: Uint8Array | null;
  digestU32: number;
}

export function createLandValueCache(): LandValueCache {
  return { fenceKey: "", field: null, digestU32: 0 };
}

export function landValueFor(
  cache: LandValueCache,
  inputs: LandValueInputs,
  fenceKey: string,
): { field: Uint8Array; digestU32: number } {
  if (cache.fenceKey !== fenceKey || cache.field === null) {
    cache.fenceKey = fenceKey;
    cache.field = computeLandValueField(inputs);
    cache.digestU32 = Number.parseInt(fnv1a64(cache.field).slice(0, 8), 16);
  }
  return { field: cache.field, digestU32: cache.digestU32 };
}
