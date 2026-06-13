/**
 * Goods-chain constants (GDD §8 [chain structure LOCKED], board phase-5
 * task 3): Raw (map-resource-gated) → Processed → Goods → retail. These are
 * cross-boundary vocabulary — the sim runs the chain, the UI names it
 * (task 5), saves carry it (v9 SHIPMENTS + BUILDINGS rows).
 */

/** Values of the terrain `resource` layer (u16; 0 = none). Ore predates
 * the chain (map-generator v1 painted ore veins as 1 — preserved). */
export const ResourceKind = {
  none: 0,
  ore: 1,
  farm: 2,
  forest: 3,
  oil: 4,
} as const;
export type ResourceKind = (typeof ResourceKind)[keyof typeof ResourceKind];

/**
 * What a building makes or holds. Raw kinds align 1:1 with the resource
 * that gates them; the generic tiers follow.
 */
export const Commodity = {
  rawOre: 1,
  rawFarm: 2,
  rawForest: 3,
  rawOil: 4,
  processed: 5,
  goods: 6,
} as const;
export type Commodity = (typeof Commodity)[keyof typeof Commodity];
export const COMMODITY_COUNT = 6;

/**
 * Canonical per-building chain role (BUILDINGS row, save v9). Stored, not
 * derived: the processed/goods split is chosen at spawn to balance the
 * chain, and re-deriving it later from counts would rewrite history.
 * Raw roles share Commodity's 1–4 values; 0 = building plays no chain
 * part (R, services, plus C/office whose part follows from their kind).
 */
export const ChainRole = {
  none: 0,
  rawOre: 1,
  rawFarm: 2,
  rawForest: 3,
  rawOil: 4,
  processed: 5,
  goods: 6,
} as const;
export type ChainRole = (typeof ChainRole)[keyof typeof ChainRole];

/** Endpoint kind on a shipment: a building tile, or a map-edge anchor. */
export const ShipmentEndpoint = {
  building: 0,
  edgeAnchor: 1,
} as const;
export type ShipmentEndpoint = (typeof ShipmentEndpoint)[keyof typeof ShipmentEndpoint];
