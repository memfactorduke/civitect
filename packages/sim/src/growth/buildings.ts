/**
 * Buildings table (TDD §4 [LOCKED]: SoA, free-lists, no objects in hot
 * paths) + per-building cohort blocks (GDD §8: counts by age band ×
 * education tier; employed adults by tier).
 *
 * Cohort block layout (Uint16 × 20 per building):
 *   [0..15]  counts[age][edu]  (age: child/teen/adult/senior × E0..E3)
 *   [16..19] employed adults by edu tier
 */
import { ZoneKind } from "@civitect/protocol";

export const COHORT_BLOCK = 20;
export const AGE_BANDS = 4; // child, teen, adult, senior
export const EDU_TIERS = 4;

export const BuildingStatus = {
  normal: 0,
  unpowered: 1,
  unwatered: 2,
  abandoned: 3,
  /** Phase 4 fire states (append-only — status rides snapshots as u8). */
  onFire: 4,
  ruin: 5,
} as const;
export type BuildingStatus = (typeof BuildingStatus)[keyof typeof BuildingStatus];

/** Ploppables are encoded as 100 + BuildingKind to share the kind field. */
export const PLOPPABLE_KIND_OFFSET = 100;

/** Capacity (residents for R, job slots for C/I/O) by level 1..5 [TUNE]. */
export function capacityFor(kind: number, level: number): number {
  if (kind === ZoneKind.residentialLow) return [0, 8, 12, 18, 26, 36][level] as number;
  if (kind === ZoneKind.residentialHigh) return [0, 20, 32, 50, 76, 110][level] as number;
  if (kind === ZoneKind.commercialLow) return [0, 4, 6, 9, 13, 18][level] as number;
  if (kind === ZoneKind.commercialHigh) return [0, 10, 16, 24, 36, 52][level] as number;
  if (kind === ZoneKind.industrial) return [0, 8, 12, 18, 26, 36][level] as number;
  if (kind === ZoneKind.office) return [0, 10, 16, 24, 36, 52][level] as number;
  return 0; // ploppables house no one
}

export interface Buildings {
  count: number;
  freeHead: number;
  capacity: number;
  /** Monotone version — snapshots key on it (road pattern). */
  version: number;
  tileIdx: Uint32Array;
  kind: Uint16Array;
  level: Uint8Array;
  status: Uint8Array;
  /** Consecutive game-days of utility failure (abandonment clock). */
  failDays: Uint8Array;
  /** Game-days at high desirability (leveling clock). */
  thriveDays: Uint8Array;
  /**
   * Phase 4 service state (canonical, hashed, save v7). `stock` is
   * kind-contextual: garbage held for occupied buildings, fill level for
   * landfills/cemeteries. All zero until the service loops run them.
   */
  stock: Uint32Array;
  sick: Uint16Array;
  corpses: Uint16Array;
  /** 0 = not burning; burn progress in fire steps (board task 5). */
  fireTicks: Uint8Array;
  alive: Uint8Array;
  nextFree: Uint32Array;
  cohorts: Uint16Array; // capacity × COHORT_BLOCK
  /** tileIdx → building index (lookup only, never iterated — ADR-005 §4). */
  readonly byTile: Map<number, number>;
}

const INITIAL = 64;
const NO_INDEX = 0xffffffff;

export function createBuildings(): Buildings {
  return {
    count: 0,
    freeHead: NO_INDEX,
    capacity: INITIAL,
    version: 0,
    tileIdx: new Uint32Array(INITIAL),
    kind: new Uint16Array(INITIAL),
    level: new Uint8Array(INITIAL),
    status: new Uint8Array(INITIAL),
    failDays: new Uint8Array(INITIAL),
    thriveDays: new Uint8Array(INITIAL),
    stock: new Uint32Array(INITIAL),
    sick: new Uint16Array(INITIAL),
    corpses: new Uint16Array(INITIAL),
    fireTicks: new Uint8Array(INITIAL),
    alive: new Uint8Array(INITIAL),
    nextFree: new Uint32Array(INITIAL).fill(NO_INDEX),
    cohorts: new Uint16Array(INITIAL * COHORT_BLOCK),
    byTile: new Map(),
  };
}

function grow(b: Buildings): void {
  const cap = b.capacity * 2;
  const copy = <T extends Uint8Array | Uint16Array | Uint32Array>(a: T, c: T): T => {
    c.set(a);
    return c;
  };
  b.tileIdx = copy(b.tileIdx, new Uint32Array(cap));
  b.kind = copy(b.kind, new Uint16Array(cap));
  b.level = copy(b.level, new Uint8Array(cap));
  b.status = copy(b.status, new Uint8Array(cap));
  b.failDays = copy(b.failDays, new Uint8Array(cap));
  b.thriveDays = copy(b.thriveDays, new Uint8Array(cap));
  b.stock = copy(b.stock, new Uint32Array(cap));
  b.sick = copy(b.sick, new Uint16Array(cap));
  b.corpses = copy(b.corpses, new Uint16Array(cap));
  b.fireTicks = copy(b.fireTicks, new Uint8Array(cap));
  b.alive = copy(b.alive, new Uint8Array(cap));
  const nf = new Uint32Array(cap).fill(NO_INDEX);
  nf.set(b.nextFree);
  b.nextFree = nf;
  b.cohorts = copy(b.cohorts, new Uint16Array(cap * COHORT_BLOCK));
  b.capacity = cap;
}

export function spawnBuilding(b: Buildings, tileIdx: number, kind: number): number {
  let index: number;
  if (b.freeHead !== NO_INDEX) {
    index = b.freeHead;
    b.freeHead = b.nextFree[index] as number;
  } else {
    if (b.count === b.capacity) {
      grow(b);
    }
    index = b.count;
  }
  b.count = Math.max(b.count, index + 1);
  b.tileIdx[index] = tileIdx;
  b.kind[index] = kind;
  b.level[index] = 1;
  b.status[index] = BuildingStatus.normal;
  b.failDays[index] = 0;
  b.thriveDays[index] = 0;
  b.stock[index] = 0;
  b.sick[index] = 0;
  b.corpses[index] = 0;
  b.fireTicks[index] = 0;
  b.alive[index] = 1;
  b.cohorts.fill(0, index * COHORT_BLOCK, (index + 1) * COHORT_BLOCK);
  b.byTile.set(tileIdx, index);
  b.version++;
  return index;
}

export function demolishBuilding(b: Buildings, index: number): void {
  b.alive[index] = 0;
  b.byTile.delete(b.tileIdx[index] as number);
  b.nextFree[index] = b.freeHead;
  b.freeHead = index;
  b.version++;
}

/**
 * Alive slots in CANONICAL (tileIdx) order, cached on version. Every
 * RNG-consuming scan over buildings must walk THIS order, never raw slots:
 * slot order is spawn history, and a loaded save rebuilds sorted by tile —
 * slot-order draws desynchronize the growth stream after load (found by
 * the mid-solve save test; latent since Phase 2 for interleaved zones).
 */
const tileOrders = new WeakMap<Buildings, { version: number; order: number[] }>();

export function aliveByTile(b: Buildings): readonly number[] {
  let cached = tileOrders.get(b);
  if (cached === undefined || cached.version !== b.version) {
    const order: number[] = [];
    for (let i = 0; i < b.count; i++) {
      if (b.alive[i] === 1) {
        order.push(i);
      }
    }
    order.sort((p, q) => (b.tileIdx[p] as number) - (b.tileIdx[q] as number));
    cached = { version: b.version, order };
    tileOrders.set(b, cached);
  }
  return cached.order;
}

export function residentsOf(b: Buildings, index: number): number {
  let total = 0;
  const base = index * COHORT_BLOCK;
  for (let i = 0; i < 16; i++) {
    total += b.cohorts[base + i] as number;
  }
  return total;
}

export function adultsOf(b: Buildings, index: number): number {
  const base = index * COHORT_BLOCK + 2 * EDU_TIERS; // adult band row
  let total = 0;
  for (let e = 0; e < EDU_TIERS; e++) {
    total += b.cohorts[base + e] as number;
  }
  return total;
}

export function employedOf(b: Buildings, index: number): number {
  const base = index * COHORT_BLOCK + 16;
  let total = 0;
  for (let e = 0; e < EDU_TIERS; e++) {
    total += b.cohorts[base + e] as number;
  }
  return total;
}
