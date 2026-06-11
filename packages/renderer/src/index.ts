/**
 * @civitect/renderer — PixiJS v8 world rendering (TDD §8, ADR-008).
 *
 * Placeholder shell: Pixi boot, chunked static layer, and snapshot consumption
 * land per docs/board/phase-0.md PR 5.
 *
 * Boundary (TDD §1): consumes protocol snapshots, knows nothing of rules —
 * never imports @civitect/sim (dependency-cruiser enforced).
 */
export const RENDERER_PACKAGE = "@civitect/renderer";
