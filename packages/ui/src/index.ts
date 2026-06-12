/**
 * @civitect/ui — React panels/HUD above the Pixi canvas (TDD §9, ADR-009).
 *
 * Placeholder shell: React overlay, zustand stores, and command dispatch land
 * per docs/board/phase-0.md PR 6.
 *
 * Boundaries once real (TDD §9): talks to sim only via protocol commands;
 * advisor events render through the generic CauseChain inspector — events
 * without cause chains fail typecheck (ADR-009); all strings through i18n keys.
 */
export const UI_PACKAGE = "@civitect/ui";
