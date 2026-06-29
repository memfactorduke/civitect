import { LodTier, type LodTier as LodTierValue } from "./camera";

export interface LayerVisibility {
  /** Placeholder buildings / future sprite batch. */
  readonly buildings: boolean;
  /** Live sampled agents. */
  readonly agents: boolean;
  /** Placement previews must stay visible at every zoom. */
  readonly toolGhosts: boolean;
  /** Planning overlays stay useful at map scale. */
  readonly dataOverlays: boolean;
}

/**
 * TDD §8 zoom LOD policy: far = map-scale planning, mid = full static city,
 * near = full detail including live citizens/vehicles.
 */
export function layerVisibilityForLod(tier: LodTierValue): LayerVisibility {
  switch (tier) {
    case LodTier.far:
      return { buildings: false, agents: false, toolGhosts: true, dataOverlays: true };
    case LodTier.mid:
      return { buildings: true, agents: false, toolGhosts: true, dataOverlays: true };
    case LodTier.near:
      return { buildings: true, agents: true, toolGhosts: true, dataOverlays: true };
  }
}
