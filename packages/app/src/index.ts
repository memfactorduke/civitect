/**
 * @civitect/app — composition root: boot, sim-worker management, scenes,
 * settings, save manager (TDD §1 runtime topology).
 *
 * Placeholder shell: the worker↔renderer↔UI round trip lands per
 * docs/board/phase-0.md PR 7; the save manager per PR 9.
 *
 * This is the only package allowed to depend on all the others — it wires the
 * worker boundary (entire sim in a dedicated Worker; main thread = renderer +
 * UI + input, ADR-006).
 */
export const APP_PACKAGE = "@civitect/app";
