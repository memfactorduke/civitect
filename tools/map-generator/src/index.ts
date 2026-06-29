/**
 * @civitect/map-generator — seeded terrain generation + the v1 map catalog
 * (TDD §13, GDD §3; phase-1 board task 6). Maps are reproducible artifacts:
 * same archetype + seed ⇒ byte-identical terrain on every platform.
 */
export {
  archetypeMapId,
  CATALOG_SEEDS,
  GENERATED_MAP_SIZE,
  generateMap,
  MAP_ARCHETYPES,
  MapArchetype,
} from "./generate";
export { fractalNoise, latticeHash, valueNoise } from "./noise";
export { renderPreview } from "./preview";
export { findStartSites, type StartSite, type StartSiteOptions } from "./start-sites";
