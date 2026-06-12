/**
 * @civitect/sim — pure deterministic simulation core (TDD §3–§6, ADR-005/006).
 *
 * Placeholder shell: the deterministic tick loop, PCG32 streams (`sim/rng`),
 * and the structure-of-arrays store land per docs/board/phase-0.md PR 3.
 *
 * Hard rules for this package (CLAUDE.md, lint-enforced from PR 3):
 * no Math.random, no transcendentals, no wall clock, no DOM/Pixi imports,
 * no object-key iteration over sim state, money in integer cents.
 * Note: tsconfig deliberately omits the DOM lib — `document` does not typecheck here.
 */
export const SIM_PACKAGE = "@civitect/sim";
