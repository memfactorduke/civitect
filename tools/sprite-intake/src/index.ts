/**
 * @civitect/sprite-intake — the ADR-012 mechanical gates: every sprite
 * enters the game through here or not at all (CLAUDE.md hard rule).
 *
 * Live: PNG codec (gate-internal), 64-swatch palette linter, dimension/
 * anchor/footprint/state validators, the asset CI gate.
 * Follow-up (board 11b, parked on an image-library decision): bg removal,
 * palette snap, atlas packing, contact sheets for the taste pass.
 */
export {
  type DownscaleSpriteOptions,
  downscaleSprite3x,
  type SpriteTargetScale,
} from "./downscale";
export {
  checkPalette,
  loadMasterPalette,
  PALETTE_MEAN_DISTANCE_MAX,
  PALETTE_OFFENDER_RATIO_MAX,
  PALETTE_PIXEL_DISTANCE_MAX,
  type PaletteCheckResult,
  type Rgb,
} from "./palette";
export { decodePng, encodePng, type RawImage } from "./png";
export {
  expectedCanvasWidth,
  maxCanvasHeight,
  type SpriteIssue,
  type SpriteReport,
  validateSprite,
} from "./validate";
