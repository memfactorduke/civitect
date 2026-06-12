/**
 * Service registry (GDD §7, Phase 4 board task 2): which BuildingKind
 * provides which service, with base capacity, coverage radius and vehicle
 * count. All numbers [TUNE].
 *
 * Radii are NETWORK COST units (the edgeCost scale: milli-tick×1000 of
 * travel time), not tiles — coverage IS response time, so fast roads carry
 * a station's reach farther and a jammed grid (dispatch, task 5) or a torn
 * street shrinks it. One street tile costs STREET_TILE_COST; radii read as
 * "N street-tiles of travel".
 */
import { BuildingKind, SERVICE_ID_LIST, ServiceId } from "@civitect/protocol";

const S = ServiceId;

/** Cost of traversing one street tile (length 1000 milli-tiles at speed 500). */
export const STREET_TILE_COST = 2000;

const tiles = (n: number): number => n * STREET_TILE_COST;

export interface ServiceBuildingSpec {
  readonly service: ServiceId;
  /**
   * Capacity in the service's GDD §7 unit (trucks, patrols, treated/day,
   * hearses, seats; 0 for pure-coverage services like parks/telecom).
   */
  readonly capacity: number;
  /** Coverage reach in network cost units, before budget scaling. */
  readonly radiusCost: number;
  /** Dispatchable vehicles (fire/garbage/deathcare loops, tasks 3/5). */
  readonly vehicles: number;
  /** Stock ceiling (cemetery graves, landfill units); 0 = not stock-bound. */
  readonly stockCap: number;
}

/** Keyed by PLOPPABLE BuildingKind (the protocol id, NOT kind+100). */
export const SERVICE_BUILDING_SPECS: ReadonlyMap<number, ServiceBuildingSpec> = new Map<
  number,
  ServiceBuildingSpec
>([
  [
    BuildingKind.fireStation,
    { service: S.fire, capacity: 4, radiusCost: tiles(30), vehicles: 4, stockCap: 0 },
  ],
  [
    BuildingKind.fireStationLarge,
    { service: S.fire, capacity: 8, radiusCost: tiles(48), vehicles: 8, stockCap: 0 },
  ],
  [
    BuildingKind.policeStation,
    { service: S.police, capacity: 6, radiusCost: tiles(32), vehicles: 6, stockCap: 0 },
  ],
  [
    BuildingKind.policeHQ,
    { service: S.police, capacity: 12, radiusCost: tiles(64), vehicles: 12, stockCap: 0 },
  ],
  [
    BuildingKind.clinic,
    { service: S.health, capacity: 40, radiusCost: tiles(28), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.hospital,
    { service: S.health, capacity: 160, radiusCost: tiles(56), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.cemetery,
    { service: S.deathcare, capacity: 2, radiusCost: tiles(40), vehicles: 2, stockCap: 2000 },
  ],
  [
    BuildingKind.crematorium,
    { service: S.deathcare, capacity: 4, radiusCost: tiles(40), vehicles: 4, stockCap: 0 },
  ],
  [
    BuildingKind.schoolElementary,
    { service: S.education, capacity: 200, radiusCost: tiles(24), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.schoolHigh,
    { service: S.education, capacity: 400, radiusCost: tiles(40), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.university,
    { service: S.education, capacity: 600, radiusCost: tiles(80), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.library,
    { service: S.education, capacity: 0, radiusCost: tiles(24), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.parkSmall,
    { service: S.parks, capacity: 0, radiusCost: tiles(12), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.plaza,
    { service: S.parks, capacity: 0, radiusCost: tiles(16), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.telecomTower,
    { service: S.telecom, capacity: 0, radiusCost: tiles(96), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.landfill,
    { service: S.garbage, capacity: 6, radiusCost: tiles(48), vehicles: 6, stockCap: 50_000 },
  ],
  [
    BuildingKind.incinerator,
    { service: S.garbage, capacity: 4, radiusCost: tiles(48), vehicles: 4, stockCap: 0 },
  ],
  [
    BuildingKind.recyclingCenter,
    { service: S.garbage, capacity: 2, radiusCost: tiles(40), vehicles: 2, stockCap: 0 },
  ],
  [
    BuildingKind.sewageOutlet,
    { service: S.sewage, capacity: 8000, radiusCost: tiles(36), vehicles: 0, stockCap: 0 },
  ],
  [
    BuildingKind.sewageTreatment,
    { service: S.sewage, capacity: 8000, radiusCost: tiles(36), vehicles: 0, stockCap: 0 },
  ],
]);

/** Spec for a buildings-table `kind` value (100+BuildingKind), else null. */
export function specForTableKind(tableKind: number): ServiceBuildingSpec | null {
  return SERVICE_BUILDING_SPECS.get(tableKind - 100) ?? null;
}

/**
 * Budget slider scaling (GDD §7): linear below 100%, diminishing returns
 * above — 150% budget buys 125% effect. Integer permille → permille.
 */
export function budgetScalePermille(budgetPermille: number): number {
  return budgetPermille <= 1000 ? budgetPermille : 1000 + ((budgetPermille - 1000) >> 1);
}

/** Effective coverage radius after the service's budget slider. */
export function scaledRadius(spec: ServiceBuildingSpec, budgetPermille: number): number {
  return Math.floor((spec.radiusCost * budgetScalePermille(budgetPermille)) / 1000);
}

/** Effective capacity after the service's budget slider. */
export function scaledCapacity(spec: ServiceBuildingSpec, budgetPermille: number): number {
  return Math.floor((spec.capacity * budgetScalePermille(budgetPermille)) / 1000);
}

/** Index of a ServiceId in the canonical SERVICE_ID_LIST order. */
export function serviceIndex(service: ServiceId): number {
  return SERVICE_ID_LIST.indexOf(service);
}
