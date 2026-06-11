/**
 * ADR-013 gate — golden-master cities (TDD §12.1).
 *
 * TODO(ROADMAP Phase 0 — board PR 4): replace this no-op with the real gate:
 * replay each golden city (seed + command log) headlessly in Node via
 * packages/sim, hash the final state, and compare bit-exactly against the
 * committed hashes. Support `--bless` to regenerate hashes with a balance-diff
 * report — the diff is the review artifact.
 *
 * Stubbed because packages/sim and the golden corpus do not exist yet.
 * A no-op pass is permitted ONLY while the system under test doesn't exist.
 */
console.log(
  "[gate:golden] STUB — no-op pass. Real gate lands with ROADMAP Phase 0 golden harness (ADR-013 §1, TDD §12.1).",
);
